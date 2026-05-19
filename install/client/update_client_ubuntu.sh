#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri (Client) Guncelleme Betigi
#
# Mevcut /opt/mailtrustai kurulumunu yeni surume yukseltir.
#   - .env DOKUNULMAZ (lisans + secret'lar korunur)
#   - customer-data ve customer-logs volume'lari DOKUNULMAZ
#   - git pull --ff-only + docker compose build + restart
#
# Kullanim:
#   sudo bash install/client/update_client_ubuntu.sh
#
# Otomasyon:
#   sudo UNATTENDED=true bash install/client/update_client_ubuntu.sh
# ============================================================
set -Euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

UPDATE_LOG="/tmp/mailtrustai-client-update-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$UPDATE_LOG") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()    { echo -e "${CYAN}------------------------------------------------------${NC}"; }

on_error() {
    local code=$?
    echo -e "${RED}${BOLD}===== GUNCELLEME BASARISIZ =====${NC}" >&2
    echo -e "${RED}Cikis kodu: $code | Satir: $1 | Komut: ${BASH_COMMAND}${NC}" >&2
    echo -e "${YELLOW}Log: ${UPDATE_LOG}${NC}" >&2
    exit "$code"
}
trap 'on_error $LINENO' ERR

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI - Ubuntu Musteri Guncelleme             ==="
echo "  ===  .env ve veriler korunur                             ==="
echo "  ============================================================"
echo -e "${NC}"

# ----- 1. Kurulum kontrolu -----
step "1/7  Kurulum tespit ediliyor..."
INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.customer.yml"

[[ -d "$INSTALL_DIR" && -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] \
    || fatal "Kurulum eksik. Once: sudo bash install/client/install_client_ubuntu.sh"

ok "Kurulum : $INSTALL_DIR"

# ----- 2. Docker kontrol -----
step "2/7  Docker kontrol..."
command -v docker &>/dev/null || fatal "Docker yok."
docker info &>/dev/null || fatal "Docker daemon kapali. systemctl start docker"
ok "Docker: $(docker --version)"

# ----- 3. Yedek -----
step "3/7  Otomatik yedek..."
BACKUP_DIR="$INSTALL_DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)

cp "$ENV_FILE" "$BACKUP_DIR/.env.pre-update.$TS"
ok "Env yedegi: $BACKUP_DIR/.env.pre-update.$TS"

backup_volume() {
    local vol="$1" lbl="$2"
    if docker volume ls --format '{{.Name}}' | grep -q "^${vol}$"; then
        if docker run --rm -v "${vol}:/data:ro" -v "$BACKUP_DIR":/backup \
             alpine tar czf "/backup/${lbl}-pre-update.$TS.tar.gz" -C /data . 2>/dev/null; then
            ok "$lbl yedegi: $BACKUP_DIR/${lbl}-pre-update.$TS.tar.gz"
        else
            warn "$lbl yedegi alinamadi (devam)."
        fi
    fi
}
backup_volume "mailtrustai-customer_customer-data" "customer-data"
backup_volume "mailtrustai-customer_customer-logs" "customer-logs"

# ----- 4. Git pull -----
step "4/7  Repo guncelleniyor..."
[[ -d "$REPO_ROOT/.git" ]] || fatal "$REPO_ROOT git repo'su degil."

cd "$REPO_ROOT"
PREV_COMMIT=$(git rev-parse HEAD)
echo "$PREV_COMMIT" > /tmp/mailtrustai-client-update-prev-commit
info "Onceki commit: $PREV_COMMIT"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Lokal degisiklikler var:"
    git status --short
    if [[ "${UNATTENDED:-false}" == "true" ]]; then
        fatal "UNATTENDED mod — lokal degisiklikler var."
    fi
    read -rp "  Stash'e atilsin? [e/H]: " ANS || ANS="H"
    [[ "${ANS,,}" == "e" || "${ANS,,}" == "y" ]] && git stash push -m "auto-stash $TS" \
        || fatal "Iptal."
fi

git fetch origin "$CURRENT_BRANCH"
git pull --ff-only origin "$CURRENT_BRANCH" || fatal "Pull basarisiz (divergent)."

NEW_COMMIT=$(git rev-parse HEAD)
if [[ "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
    ok "Zaten guncel: $NEW_COMMIT"
else
    ok "Guncellendi: ${PREV_COMMIT:0:12} -> ${NEW_COMMIT:0:12}"
    git log --oneline "$PREV_COMMIT..$NEW_COMMIT" | head -15 | sed 's/^/   /'
fi

# ----- 5. Compose senkron -----
step "5/7  Compose dosyasi senkronize..."
COMPOSE_SRC="$REPO_ROOT/docker-compose.customer.yml"
if ! diff -q "$COMPOSE_SRC" "$COMPOSE_FILE" &>/dev/null; then
    cp "$COMPOSE_FILE" "$BACKUP_DIR/docker-compose.customer.yml.pre-update.$TS"
    cp "$COMPOSE_SRC" "$COMPOSE_FILE"
fi
ok "Compose senkron."

# ----- 6. Build + up -----
step "6/7  Image rebuild + container restart..."
DOCKER_COMPOSE_CMD="docker compose"
docker compose version &>/dev/null 2>&1 || DOCKER_COMPOSE_CMD="docker-compose"

cd "$REPO_ROOT"
$DOCKER_COMPOSE_CMD --env-file "$ENV_FILE" -f docker-compose.customer.yml build --pull \
    || fatal "Build basarisiz."
ok "Image derlendi."

$DOCKER_COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans \
    || fatal "Up basarisiz."
ok "Container yeniden baslatildi."

# ----- 7. Healthcheck -----
step "7/7  Saglik kontrolu (max 60s)..."
PORT=$(grep -E '^CUSTOMER_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d ' \r\n')
PORT="${PORT:-3000}"

MAX_WAIT=60; ELAPSED=0; HEALTHY=false
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    curl -sf "http://localhost:${PORT}/healthz" 2>/dev/null | grep -q '"ok":true' && { HEALTHY=true; break; }
    sleep 5; ELAPSED=$((ELAPSED + 5))
    info "Bekleniyor... ($ELAPSED/${MAX_WAIT}s)"
done

hr
if [[ "$HEALTHY" == "true" ]]; then
    echo -e "${GREEN}${BOLD}  ===== GUNCELLEME TAMAMLANDI =====${NC}"
    echo -e "  http://localhost:${PORT}"
else
    echo -e "${YELLOW}${BOLD}  ===== GUNCELLEME BITTI - SAGLIK EKSIK =====${NC}"
    warn "Loglar: sudo docker logs mailtrustai-customer --tail 50"
fi
echo ""
echo -e "  ${BOLD}Rollback (gerekirse):${NC}"
echo -e "  ${CYAN}cd $REPO_ROOT && git reset --hard $PREV_COMMIT${NC}"
echo -e "  ${CYAN}sudo bash $SCRIPT_DIR/update_client_ubuntu.sh${NC}"
echo ""
hr
