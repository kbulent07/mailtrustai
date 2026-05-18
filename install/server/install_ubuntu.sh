#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Kurulum Betiği
#
# Kurar: license-server (port 3200) + dealer panel (3100) + MariaDB
# Gereksinim: Ubuntu 22.04 LTS / 24.04 LTS, Docker 24+, 2 GB RAM
#
# Kullanım (repo kök dizininden):
#   sudo bash install/server/install_ubuntu.sh
#
# Güncelleme (aynı komut — mevcut .env korunur, image yeniden build edilir):
#   sudo bash install/server/install_ubuntu.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Renkler ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal()   { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}▶ $*${NC}"; }
hr()      { echo -e "${CYAN}$(printf '─%.0s' {1..54})${NC}"; }

gen32()   { openssl rand -hex 32; }
genpass() { openssl rand -base64 24 | tr -d '/+=' | head -c 28; }

# ─── Root kontrolü ──────────────────────────────────────────
[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile çalıştırılmalıdır."

# ─── Banner ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║    MailTrustAI  —  Ubuntu Sunucu Kurulum Betiği     ║"
echo "  ║    license-server + dealer panel + MariaDB           ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. Ubuntu kontrolü ─────────────────────────────────────
step "Ubuntu kontrol ediliyor..."

if [[ ! -f /etc/lsb-release ]] || ! grep -qi ubuntu /etc/lsb-release 2>/dev/null; then
    fatal "Bu betik yalnızca Ubuntu (22.04 / 24.04 LTS) üzerinde çalışır."
fi

UBUNTU_VER=$(grep DISTRIB_RELEASE /etc/lsb-release | cut -d= -f2)
info "Ubuntu $UBUNTU_VER tespit edildi."

# ─── 2. Docker kurulum kontrolü ─────────────────────────────
step "Docker kontrol ediliyor..."

install_docker_ubuntu() {
    info "Docker Engine kuruluyor (resmi Docker deposu)..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    ok "Docker Engine kuruldu."
}

if ! command -v docker &>/dev/null; then
    warn "Docker bulunamadı. Ubuntu için otomatik kurulum yapılıyor..."
    install_docker_ubuntu
fi

if ! docker info &>/dev/null; then
    fatal "Docker daemon çalışmıyor. Başlatın: systemctl start docker"
fi

DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    if command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
        warn "Eski docker-compose kullanılıyor. 'docker compose' plugin önerilir."
    else
        fatal "docker compose plugin bulunamadı. Docker 24+ kurun veya compose plugin ekleyin."
    fi
fi

ok "Docker hazır: $(docker --version)"
ok "Compose  : $($DOCKER_COMPOSE_CMD version --short 2>/dev/null || echo 'v1')"

# ─── 2. Yapılandırma ────────────────────────────────────────
step "Kurulum yapılandırması..."
hr

DEFAULT_INSTALL_DIR="/opt/mailtrustai"
read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR
INSTALL_DIR="${INPUT_DIR:-$DEFAULT_INSTALL_DIR}"

read -rp "  Sunucu domain veya IP (ör: license.firma.com ya da 1.2.3.4): " SERVER_HOST
[[ -n "${SERVER_HOST:-}" ]] || fatal "Sunucu adresi zorunludur."

read -rp "  License-server port [3200]: " LS_PORT
LS_PORT="${LS_PORT:-3200}"

read -rp "  Dealer panel port   [3100]: " DEALER_PORT_VAR
DEALER_PORT_VAR="${DEALER_PORT_VAR:-3100}"

read -rp "  MariaDB dış portu (0 = sadece iç ağ) [0]: " DB_PORT
DB_PORT="${DB_PORT:-0}"

ENV_FILE="$INSTALL_DIR/.env"

# ─── 3. Mevcut kurulum kontrolü ─────────────────────────────
SKIP_ENV=false
if [[ -f "$ENV_FILE" ]]; then
    echo ""
    warn "Mevcut yapılandırma bulundu: $ENV_FILE"
    read -rp "  Mevcut secret'ları koru (güncelleme modu)? [E/h]: " KEEP_EXISTING
    KEEP_EXISTING="${KEEP_EXISTING:-E}"
    if [[ "${KEEP_EXISTING^^}" =~ ^(E|Y|EVET|YES)$ ]]; then
        SKIP_ENV=true
        info "Mevcut .env korunuyor. Yalnızca image yeniden build edilecek."
    fi
fi

# ─── 4. Dizin yapısı ────────────────────────────────────────
step "Dizin yapısı oluşturuluyor: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"/{logs,backups}
chmod 750 "$INSTALL_DIR"

# ─── 5. Secret üretimi ve .env yazımı ───────────────────────
if [[ "$SKIP_ENV" == "false" ]]; then
    step "Güvenli secret'lar üretiliyor..."

    LICENSE_SIGNING_SECRET=$(gen32)
    DEALER_API_SECRET=$(gen32)
    DEALER_SESSION_SECRET=$(gen32)
    ADMIN_PANEL_TOKEN=$(gen32)
    MARIADB_PASSWORD=$(genpass)
    MARIADB_ROOT_PASSWORD=$(genpass)

    # MariaDB port satırı
    if [[ "$DB_PORT" == "0" ]]; then
        DB_PORT_LINE="# MariaDB dışarıya açık değil (güvenli mod)"
    else
        DB_PORT_LINE="MARIADB_EXPOSE_PORT=${DB_PORT}"
    fi

    cat > "$ENV_FILE" <<EOF
# ============================================================
# MailTrustAI Sunucu Yapılandırması
# Oluşturulma: $(date '+%Y-%m-%d %H:%M:%S')
#
# ⚠  BU DOSYAYI GÜVENLİ YERDE YEDEKLEYİN!
# ⚠  SECRET'LARI DEĞİŞTİRMEYİN — Mevcut lisanslar geçersiz olur.
# ============================================================

# === Core Secret'lar (ZORUNLU — asla paylaşmayın) ===
LICENSE_SIGNING_SECRET=${LICENSE_SIGNING_SECRET}
DEALER_API_SECRET=${DEALER_API_SECRET}
DEALER_SESSION_SECRET=${DEALER_SESSION_SECRET}

# === Admin Panel (opsiyonel — boşsa /admin uçları 503 döner) ===
ADMIN_PANEL_TOKEN=${ADMIN_PANEL_TOKEN}

# === MariaDB ===
MARIADB_DATABASE=mailtrustai_license
MARIADB_USER=mailtrustai
MARIADB_PASSWORD=${MARIADB_PASSWORD}
MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}
${DB_PORT_LINE}

# === Port Mapping (host → container) ===
LICENSE_SERVER_PORT=${LS_PORT}
DEALER_PORT=${DEALER_PORT_VAR}

# === Servis Parametreleri ===
DEFAULT_GRACE_DAYS=7
HEARTBEAT_ONLINE_THRESHOLD_SECONDS=300
HEARTBEAT_STALE_THRESHOLD_SECONDS=1800
CUSTOMER_SYNC_MAX_PAYLOAD_BYTES=16384
DEALER_SESSION_TTL_MINUTES=480
TRUST_PROXY=1
EOF
    chmod 600 "$ENV_FILE"
    ok ".env oluşturuldu → $ENV_FILE"
else
    ok ".env mevcut → $ENV_FILE"
fi

# ─── 6. Compose dosyasını güncelle ──────────────────────────
step "Compose dosyası güncelleniyor..."
cp "$REPO_ROOT/docker-compose.server.yml" "$INSTALL_DIR/docker-compose.server.yml"
ok "docker-compose.server.yml kopyalandı."

# ─── 7. Image build ─────────────────────────────────────────
step "Docker image'lar derleniyor (bu 3-10 dakika sürebilir)..."
cd "$REPO_ROOT"

$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f docker-compose.server.yml \
    build --pull
ok "Image'lar derlendi."

# ─── 8. Servisleri başlat ───────────────────────────────────
step "Servisler başlatılıyor..."
$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f docker-compose.server.yml \
    up -d --remove-orphans

# ─── 9. Sağlık kontrolü ─────────────────────────────────────
step "Sağlık kontrolü (45 saniye bekleniyor)..."
sleep 20

MAX_WAIT=60
ELAPSED=0
while [[ $ELAPSED -lt $MAX_WAIT ]]; do
    LS_STATUS=$(curl -sf "http://localhost:${LS_PORT}/healthz" 2>/dev/null | grep -c '"ok":true' || true)
    if [[ "$LS_STATUS" -ge 1 ]]; then
        ok "License-server çalışıyor."
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    info "Bekleniyor... ($ELAPSED/${MAX_WAIT}s)"
done
if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    warn "Sağlık kontrolü zaman aşımı. Logları inceleyin:"
    warn "  docker compose -f $INSTALL_DIR/docker-compose.server.yml logs --tail=30"
fi

# ─── 10. Bakım scripti oluştur ──────────────────────────────
cat > "$INSTALL_DIR/mailtrustai-ctl.sh" <<'CTLEOF'
#!/usr/bin/env bash
# MailTrustAI sunucu yönetim aracı
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE="$INSTALL_DIR/docker-compose.server.yml"
DC="docker compose --env-file $ENV_FILE -f $COMPOSE"

case "${1:-help}" in
    start)   $DC up -d ;;
    stop)    $DC stop ;;
    restart) $DC restart ;;
    status)  $DC ps ;;
    logs)    $DC logs -f --tail=200 ;;
    update)
        echo "Servisler durduruluyor..."
        $DC down
        echo "Image'lar yeniden derleniyor..."
        cd "$(cat "$INSTALL_DIR/.repo_path" 2>/dev/null || echo '.')"
        $DC build --pull
        $DC up -d
        ;;
    backup)
        TS=$(date +%Y%m%d_%H%M%S)
        BDIR="$INSTALL_DIR/backups"
        mkdir -p "$BDIR"
        cp "$ENV_FILE" "$BDIR/.env.$TS"
        echo "Yedek oluşturuldu: $BDIR/.env.$TS"
        docker run --rm \
            -v mailtrustai-server_mariadb-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/mariadb-$TS.tar.gz" -C /data . \
            && echo "MariaDB yedeği: $BDIR/mariadb-$TS.tar.gz"
        docker run --rm \
            -v mailtrustai-server_license-server-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/license-server-data-$TS.tar.gz" -C /data . \
            && echo "License-server verisi yedeği: $BDIR/license-server-data-$TS.tar.gz"
        ;;
    help|*)
        echo "Kullanım: $0 {start|stop|restart|status|logs|update|backup}"
        ;;
esac
CTLEOF
chmod +x "$INSTALL_DIR/mailtrustai-ctl.sh"

# Repo yolunu kaydet (update komutu için)
echo "$REPO_ROOT" > "$INSTALL_DIR/.repo_path"

# ─── 11. Özet ───────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║          ✓  Kurulum Tamamlandı!                      ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Erişim Adresleri:${NC}"
echo -e "  ├─ License Server API : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/healthz${NC}"
echo -e "  ├─ Dealer Panel       : ${CYAN}http://${SERVER_HOST}:${DEALER_PORT_VAR}${NC}"
echo -e "  └─ Admin Panel        : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/admin${NC}"
echo ""
echo -e "  ${BOLD}Önemli Dosyalar:${NC}"
echo -e "  ├─ Yapılandırma : ${YELLOW}${ENV_FILE}${NC}"
echo -e "  ├─ Yönetim aracı: ${YELLOW}${INSTALL_DIR}/mailtrustai-ctl.sh${NC}"
echo -e "  └─ Yedekler     : ${YELLOW}${INSTALL_DIR}/backups/${NC}"
echo ""
echo -e "  ${BOLD}Hızlı Komutlar:${NC}"
echo -e "  ├─ Durum  : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh status${NC}"
echo -e "  ├─ Loglar : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh logs${NC}"
echo -e "  ├─ Yedek  : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh backup${NC}"
echo -e "  └─ Durdur : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh stop${NC}"
echo ""
echo -e "  ${YELLOW}⚠  SECRET'LARI YEDEKLEYİN: ${ENV_FILE}${NC}"
echo -e "  ${YELLOW}⚠  Firewall: ${LS_PORT}/tcp ve ${DEALER_PORT_VAR}/tcp portlarını açın.${NC}"
echo -e "  ${YELLOW}⚠  HTTPS için Nginx reverse proxy önerilir (Let's Encrypt).${NC}"
echo ""
hr
