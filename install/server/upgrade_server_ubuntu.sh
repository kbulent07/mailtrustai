#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Guncelleme Betigi
#
# Mevcut bir kurulumu YENI surume yukseltir.
#   - .env DOKUNULMAZ (parolalar/secret'lar korunur)
#   - MariaDB ve license-server volume'lari DOKUNULMAZ (veriler korunur)
#   - Migration'lar license-server boot'unda otomatik calisir
#   - Git repo guncellenir, Docker image'lar yeniden derlenir
#   - Servisler graceful restart edilir
#
# Kullanim (repo kok dizininden):
#   sudo bash install/server/upgrade_server_ubuntu.sh
#
# Otomatik mod (cron icin):
#   sudo UNATTENDED=true bash install/server/upgrade_server_ubuntu.sh
# ============================================================
set -Euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Log ────────────────────────────────────────────────────
UPGRADE_LOG="/tmp/mailtrustai-upgrade-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$UPGRADE_LOG") 2>&1

# ─── Renkler ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()    { echo -e "${CYAN}------------------------------------------------------${NC}"; }

# ─── ERR trap ───────────────────────────────────────────────
on_error() {
    local exit_code=$?
    local line=$1
    echo "" >&2
    echo -e "${RED}${BOLD}===== GUNCELLEME BASARISIZ =====${NC}" >&2
    echo -e "${RED}Cikis kodu : ${exit_code}${NC}" >&2
    echo -e "${RED}Satir no   : ${line}${NC}" >&2
    echo -e "${RED}Komut      : ${BASH_COMMAND}${NC}" >&2
    echo -e "${YELLOW}Tam log    : ${UPGRADE_LOG}${NC}" >&2
    echo "" >&2
    echo -e "${YELLOW}Rollback ipucu:${NC}" >&2
    echo -e "  cd $REPO_ROOT && git reset --hard \"\$(cat /tmp/mailtrustai-upgrade-prev-commit 2>/dev/null || echo HEAD~1)\"" >&2
    echo -e "  sudo docker compose --env-file \$INSTALL_DIR/.env -f \$INSTALL_DIR/docker-compose.server.yml up -d" >&2
    exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# ─── Root kontrolu ──────────────────────────────────────────
[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

# ─── Banner ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ======================================================"
echo "  ===   MailTrustAI  -  Sunucu Guncelleme Betigi    ==="
echo "  ===   .env ve veriler korunur                     ==="
echo "  ======================================================"
echo -e "${NC}"

# ─── 1. Kurulum dizinini bul ────────────────────────────────
step "1/7  Kurulum dizini tespit ediliyor..."
DEFAULT_INSTALL_DIR="/opt/mailtrustai"
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

if [[ ! -d "$INSTALL_DIR" ]] || [[ ! -f "$INSTALL_DIR/.env" ]]; then
    fatal "Kurulum bulunamadi: $INSTALL_DIR/.env yok. Ilk kurulum icin:
    sudo bash $SCRIPT_DIR/install_server_ubuntu.sh"
fi

ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.server.yml"

ok "Kurulum: $INSTALL_DIR"
ok "Env    : $ENV_FILE"
ok "Compose: $COMPOSE_FILE"

# ─── 2. Docker / compose kontrolu ───────────────────────────
step "2/7  Docker kontrol ediliyor..."
command -v docker &>/dev/null || fatal "Docker bulunamadi."
docker info &>/dev/null || fatal "Docker daemon calismiyor. systemctl start docker"

DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    command -v docker-compose &>/dev/null && DOCKER_COMPOSE_CMD="docker-compose" \
        || fatal "docker compose plugin yok."
fi
ok "Docker: $(docker --version)"

# ─── 3. Otomatik yedek (.env + volume'lar) ──────────────────
step "3/7  Otomatik yedekleme..."
BACKUP_DIR="$INSTALL_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)

# .env yedegi (kuyu)
cp "$ENV_FILE" "$BACKUP_DIR/.env.pre-upgrade.$TS"
ok "Env yedegi: $BACKUP_DIR/.env.pre-upgrade.$TS"

# MariaDB volume snapshot (kucuk database'ler icin hizli)
if docker volume ls --format '{{.Name}}' | grep -q '^mailtrustai-server_mariadb-data$'; then
    info "MariaDB volume snapshot aliniyor (arka planda)..."
    docker run --rm \
        -v mailtrustai-server_mariadb-data:/data:ro \
        -v "$BACKUP_DIR":/backup \
        alpine tar czf "/backup/mariadb-pre-upgrade.$TS.tar.gz" -C /data . 2>/dev/null \
        && ok "MariaDB yedegi: $BACKUP_DIR/mariadb-pre-upgrade.$TS.tar.gz" \
        || warn "MariaDB yedegi alinamadi (devam ediliyor)"
fi

# ─── 4. Git pull ────────────────────────────────────────────
step "4/7  Repo guncelleniyor..."
cd "$REPO_ROOT"

if [[ ! -d ".git" ]]; then
    fatal "$REPO_ROOT bir git repo'su degil. Repo'yu yeniden klonlayin:
    cd $(dirname "$REPO_ROOT") && git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git"
fi

# Mevcut commit'i kaydet — rollback icin
PREV_COMMIT=$(git rev-parse HEAD)
echo "$PREV_COMMIT" > /tmp/mailtrustai-upgrade-prev-commit
info "Onceki commit: $PREV_COMMIT (rollback icin /tmp/mailtrustai-upgrade-prev-commit)"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Aktif branch: $CURRENT_BRANCH"

# Lokal degisiklikler varsa kullaniciya sor
if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Lokal (commit edilmemis) degisiklikler var:"
    git status --short
    if [[ "${UNATTENDED:-false}" == "true" ]]; then
        fatal "UNATTENDED mod — lokal degisiklikler oldugu icin pull edilemez. Once stash/commit yapin."
    fi
    read -rp "  Devam etmek icin lokal degisiklikleri stash'e at? [e/H]: " STASH_CONFIRM || STASH_CONFIRM="H"
    if [[ "${STASH_CONFIRM,,}" == "e" || "${STASH_CONFIRM,,}" == "y" ]]; then
        git stash push -m "auto-stash before upgrade $TS"
        ok "Stash: 'auto-stash before upgrade $TS'  (git stash list ile gorulebilir)"
    else
        fatal "Iptal edildi. Lokal degisiklikleri commit/stash edin ve yeniden deneyin."
    fi
fi

info "Pull yapiliyor: origin/$CURRENT_BRANCH"
git fetch origin "$CURRENT_BRANCH"
git pull --ff-only origin "$CURRENT_BRANCH" || fatal "Fast-forward pull basarisiz (divergent history?). Manuel cozun: git status"

NEW_COMMIT=$(git rev-parse HEAD)
if [[ "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
    ok "Zaten guncel: $NEW_COMMIT"
    info "Yine de image rebuild + restart yapiliyor (degisiklik olabilir)."
else
    ok "Guncellendi: $PREV_COMMIT -> $NEW_COMMIT"
    info "Degisiklikler:"
    git log --oneline "$PREV_COMMIT..$NEW_COMMIT" | head -20 | sed 's/^/   /'
fi

# ─── 5. Compose dosyasini yenile ────────────────────────────
step "5/7  Compose dosyasi senkronize ediliyor..."
COMPOSE_SRC="$REPO_ROOT/docker-compose.server.yml"
[[ -f "$COMPOSE_SRC" ]] || fatal "$COMPOSE_SRC bulunamadi."

# Eski compose ile yeni compose farkliysa yedekle + degistir
if [[ -f "$COMPOSE_FILE" ]] && ! diff -q "$COMPOSE_SRC" "$COMPOSE_FILE" &>/dev/null; then
    cp "$COMPOSE_FILE" "$BACKUP_DIR/docker-compose.server.yml.pre-upgrade.$TS"
    info "Eski compose yedegi: $BACKUP_DIR/docker-compose.server.yml.pre-upgrade.$TS"
fi
cp "$COMPOSE_SRC" "$COMPOSE_FILE"
ok "Compose senkron."

# ─── 6. Image rebuild ───────────────────────────────────────
step "6/7  Docker image'lar yeniden derleniyor..."
cd "$REPO_ROOT"

$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f docker-compose.server.yml \
    build --pull \
    || fatal "Image build basarisiz. Detay icin: $UPGRADE_LOG"
ok "Image'lar derlendi."

# ─── 7. Graceful restart ────────────────────────────────────
step "7/7  Servisler yeniden baslatiliyor..."

# down -> up sirasi yerine `up -d` ile sadece degisen container'lar yenilenir
$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    up -d --remove-orphans \
    || fatal "docker compose up basarisiz."

# Saglik kontrolu
info "License-server saglik kontrolu (max 60s)..."
LS_PORT=$(grep -E '^LICENSE_SERVER_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' \r\n')
LS_PORT="${LS_PORT:-3200}"

MAX_WAIT=60
ELAPSED=0
HEALTHY=false
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    if curl -sf "http://localhost:${LS_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
        HEALTHY=true
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    info "Bekleniyor... ($ELAPSED/${MAX_WAIT}s)"
done

if [[ "$HEALTHY" == "true" ]]; then
    ok "License-server saglikli: http://localhost:${LS_PORT}/healthz"
else
    warn "Saglik kontrolu zaman asimi. Loglar:"
    warn "  sudo docker logs mailtrustai-license-server --tail 50"
fi

# ─── Ozet ───────────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}"
if [[ "$HEALTHY" == "true" ]]; then
    echo "  ======================================================"
    echo "  ===          GUNCELLEME TAMAMLANDI                ==="
    echo "  ======================================================"
else
    echo "  ======================================================"
    echo "  ===  GUNCELLEME BITTI - SAGLIK KONTROLU EKSIK    ==="
    echo "  ======================================================"
fi
echo -e "${NC}"

echo -e "  Onceki commit : ${YELLOW}${PREV_COMMIT:0:12}${NC}"
echo -e "  Yeni commit   : ${YELLOW}${NEW_COMMIT:0:12}${NC}"
echo -e "  Yedek         : ${YELLOW}$BACKUP_DIR/.env.pre-upgrade.$TS${NC}"
echo -e "  Log           : ${YELLOW}$UPGRADE_LOG${NC}"
echo ""
echo -e "  ${BOLD}Rollback (sorun varsa):${NC}"
echo -e "  ${CYAN}cd $REPO_ROOT && git reset --hard $PREV_COMMIT${NC}"
echo -e "  ${CYAN}sudo bash $SCRIPT_DIR/upgrade_server_ubuntu.sh${NC}"
echo ""
hr
