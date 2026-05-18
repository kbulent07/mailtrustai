#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Kurulum Betiği
#
# Kurar: license-server (port 3200) + dealer panel (3100) + MariaDB
# Gereksinim: Ubuntu 22.04 LTS / 24.04 LTS, Docker 24+, 2 GB RAM
#
# Kullanım (repo kök dizininden):
#   sudo bash install/server/install_server_ubuntu.sh
#
# İlk kurulum : Secret'lar otomatik üretilir ve .env dosyasına yazılır.
# Güncelleme  : Mevcut .env korunur, yalnızca image yeniden derlenir.
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

# openssl rand ile güvenli rastgele değer üretir.
# pipefail ile pipe içinde head kullanmak SIGPIPE riski taşır;
# tüm çıktıyı önce değişkene alıp sonra keserek sorundan kaçınılır.
gen32() {
    openssl rand -hex 32
}

genpass() {
    # Önce tüm base64'ü üret, ardından filtrele — pipefail güvenli
    local raw
    raw=$(openssl rand -base64 36)
    # Özel karakterleri kaldır ve 28 karakter al
    printf '%s' "${raw//[\/+=]/}" | head -c 28
    echo ""
}

# ─── Root kontrolü ──────────────────────────────────────────
[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

# ─── Banner ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║   MailTrustAI  —  Sunucu Kurulum Betigi (Ubuntu)    ║"
echo "  ║   license-server + dealer panel + MariaDB            ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. Ubuntu kontrolü ─────────────────────────────────────
step "Ubuntu kontrol ediliyor..."

if [[ ! -f /etc/lsb-release ]] || ! grep -qi ubuntu /etc/lsb-release 2>/dev/null; then
    fatal "Bu betik yalnizca Ubuntu (22.04 / 24.04 LTS) uzerinde calisir."
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
    warn "Docker bulunamadi. Ubuntu icin otomatik kurulum yapiliyor..."
    install_docker_ubuntu
fi

if ! docker info &>/dev/null; then
    fatal "Docker daemon calısmiyor. Baslatin: systemctl start docker"
fi

DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    if command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
        warn "Eski docker-compose kullaniliyor. 'docker compose' plugin onerilir."
    else
        fatal "docker compose plugin bulunamadi. Docker 24+ kurun veya compose plugin ekleyin."
    fi
fi

ok "Docker hazir: $(docker --version)"
ok "Compose  : $($DOCKER_COMPOSE_CMD version --short 2>/dev/null || echo 'v1')"

# ─── 3. Yapılandırma ────────────────────────────────────────
step "Kurulum yapilandirmasi..."
hr

DEFAULT_INSTALL_DIR="/opt/mailtrustai"
read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR
INSTALL_DIR="${INPUT_DIR:-$DEFAULT_INSTALL_DIR}"

read -rp "  Sunucu domain veya IP (or: license.firma.com ya da 1.2.3.4): " SERVER_HOST
[[ -n "${SERVER_HOST:-}" ]] || fatal "Sunucu adresi zorunludur."

read -rp "  License-server port [3200]: " LS_PORT
LS_PORT="${LS_PORT:-3200}"

read -rp "  Dealer panel port   [3100]: " DEALER_PORT_VAR
DEALER_PORT_VAR="${DEALER_PORT_VAR:-3100}"

read -rp "  MariaDB dis portu (0 = sadece ic ag) [0]: " DB_PORT
DB_PORT="${DB_PORT:-0}"

ENV_FILE="$INSTALL_DIR/.env"

# ─── 4. Dizin yapısı (ENV kontrolünden önce oluştur) ────────
step "Dizin yapisi olusturuluyor: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/logs" "$INSTALL_DIR/backups"
chmod 750 "$INSTALL_DIR"
ok "Dizin hazir: $INSTALL_DIR"

# ─── 5. İlk kurulum mu, güncelleme mi? ──────────────────────
# .env geçerliyse (LICENSE_SIGNING_SECRET içeriyorsa) → güncelleme.
# Yoksa veya bos/kirik ise → ilk kurulum.
SKIP_ENV=false
if [[ -f "$ENV_FILE" ]] && [[ -s "$ENV_FILE" ]] && grep -q "LICENSE_SIGNING_SECRET=" "$ENV_FILE" 2>/dev/null; then
    SKIP_ENV=true
    echo ""
    ok "Mevcut yapilandirma korunuyor (guncelleme modu): $ENV_FILE"
    info "Secret'lar degistirilmeyecek — yalnizca image yeniden derlenecek."
else
    if [[ -f "$ENV_FILE" ]]; then
        warn ".env mevcut ama gecersiz/eksik — yeniden olusturuluyor."
        cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
    fi
    info "Ilk kurulum: Secret'lar otomatik uretilecek."
fi

# ─── 6. Secret üretimi ve .env yazımı ───────────────────────
if [[ "$SKIP_ENV" == "false" ]]; then
    step "Guvenli secret'lar uretiliyor..."

    LICENSE_SIGNING_SECRET=$(gen32)
    DEALER_API_SECRET=$(gen32)
    DEALER_SESSION_SECRET=$(gen32)
    ADMIN_PANEL_TOKEN=$(gen32)
    MARIADB_PASSWORD=$(genpass)
    MARIADB_ROOT_PASSWORD=$(genpass)

    # Değerlerin üretildiğini doğrula
    [[ -n "$LICENSE_SIGNING_SECRET" ]] || fatal "LICENSE_SIGNING_SECRET uretilemedi (openssl hatasi?)"
    [[ -n "$DEALER_API_SECRET" ]]      || fatal "DEALER_API_SECRET uretilemedi"
    [[ -n "$MARIADB_PASSWORD" ]]       || fatal "MARIADB_PASSWORD uretilemedi"

    # MariaDB port satırı
    if [[ "$DB_PORT" == "0" ]]; then
        DB_PORT_LINE="# MariaDB disariya acik degil (guvenli mod)"
    else
        DB_PORT_LINE="MARIADB_EXPOSE_PORT=${DB_PORT}"
    fi

    # .env yaz — printf kullan (heredoc locale sorunlari olmaz)
    {
        printf '# ============================================================\n'
        printf '# MailTrustAI Sunucu Yapilandirmasi\n'
        printf '# Olusturulma: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '#\n'
        printf '# BU DOSYAYI GUVENLI YERDE YEDEKLEYIN!\n'
        printf '# SECRET LARI DEGISTIRMEYIN - Mevcut lisanslar gecersiz olur.\n'
        printf '# ============================================================\n'
        printf '\n'
        printf '# === Core Secretlar (ZORUNLU) ===\n'
        printf 'LICENSE_SIGNING_SECRET=%s\n' "$LICENSE_SIGNING_SECRET"
        printf 'DEALER_API_SECRET=%s\n'      "$DEALER_API_SECRET"
        printf 'DEALER_SESSION_SECRET=%s\n'  "$DEALER_SESSION_SECRET"
        printf '\n'
        printf '# === Admin Panel (bossa /admin uclari 503 doner) ===\n'
        printf 'ADMIN_PANEL_TOKEN=%s\n'      "$ADMIN_PANEL_TOKEN"
        printf '\n'
        printf '# === MariaDB ===\n'
        printf 'MARIADB_DATABASE=mailtrustai_license\n'
        printf 'MARIADB_USER=mailtrustai\n'
        printf 'MARIADB_PASSWORD=%s\n'       "$MARIADB_PASSWORD"
        printf 'MARIADB_ROOT_PASSWORD=%s\n'  "$MARIADB_ROOT_PASSWORD"
        printf '%s\n'                        "$DB_PORT_LINE"
        printf '\n'
        printf '# === Port Mapping (host -> container) ===\n'
        printf 'LICENSE_SERVER_PORT=%s\n'    "$LS_PORT"
        printf 'DEALER_PORT=%s\n'            "$DEALER_PORT_VAR"
        printf '\n'
        printf '# === Servis Parametreleri ===\n'
        printf 'DEFAULT_GRACE_DAYS=7\n'
        printf 'HEARTBEAT_ONLINE_THRESHOLD_SECONDS=300\n'
        printf 'HEARTBEAT_STALE_THRESHOLD_SECONDS=1800\n'
        printf 'CUSTOMER_SYNC_MAX_PAYLOAD_BYTES=16384\n'
        printf 'DEALER_SESSION_TTL_MINUTES=480\n'
        printf 'TRUST_PROXY=1\n'
    } > "$ENV_FILE"

    chmod 600 "$ENV_FILE"

    # Dogrulama: Dosya gercekten yazildi mi?
    if [[ ! -f "$ENV_FILE" ]] || [[ ! -s "$ENV_FILE" ]]; then
        fatal ".env dosyasi olusturulamadi: $ENV_FILE — disk dolu mu? Izinleri kontrol edin."
    fi
    if ! grep -q "LICENSE_SIGNING_SECRET=" "$ENV_FILE"; then
        fatal ".env yazildi ama icerik dogrulanamadi: $ENV_FILE"
    fi

    echo ""
    echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════════╗"
    echo -e "  ║   .env DOSYASI OLUSTURULDU — HEMEN YEDEKLEYIN!      ║"
    echo -e "  ╚══════════════════════════════════════════════════════╝${NC}"
    echo -e "  Konum : ${YELLOW}${ENV_FILE}${NC}"
    echo -e "  Icerigi gormek icin: ${CYAN}cat ${ENV_FILE}${NC}"
    echo ""
else
    ok ".env mevcut ve gecerli: $ENV_FILE"
fi

# ─── 7. Compose dosyasını güncelle ──────────────────────────
step "Compose dosyasi guncelleniyor..."
COMPOSE_SRC="$REPO_ROOT/docker-compose.server.yml"
[[ -f "$COMPOSE_SRC" ]] || fatal "docker-compose.server.yml bulunamadi: $COMPOSE_SRC"
cp "$COMPOSE_SRC" "$INSTALL_DIR/docker-compose.server.yml"
ok "docker-compose.server.yml kopyalandi."

# ─── 8. Image build ─────────────────────────────────────────
step "Docker image'lar derleniyor (bu 3-10 dakika surebilir)..."
cd "$REPO_ROOT"

BUILD_OK=true
# build hatasinda script olmesin — hatayi raporla devam et
set +e
$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f docker-compose.server.yml \
    build --pull
BUILD_EXIT=$?
set -e

if [[ $BUILD_EXIT -ne 0 ]]; then
    warn "Docker build basarisiz oldu (cikis kodu: $BUILD_EXIT)"
    warn "Image'lar derlenemedi. Loglar icin:"
    warn "  cd $REPO_ROOT && $DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f docker-compose.server.yml build"
    BUILD_OK=false
else
    ok "Image'lar derlendi."
fi

# ─── 9. Servisleri başlat ───────────────────────────────────
if [[ "$BUILD_OK" == "true" ]]; then
    step "Servisler baslatiliyor..."
    set +e
    $DOCKER_COMPOSE_CMD \
        --env-file "$ENV_FILE" \
        -f docker-compose.server.yml \
        up -d --remove-orphans
    UP_EXIT=$?
    set -e

    if [[ $UP_EXIT -ne 0 ]]; then
        warn "Servisler baslatılamadi. Hata kodu: $UP_EXIT"
    else
        # ─── 10. Sağlık kontrolü ────────────────────────────────
        step "Saglik kontrolu (60 saniye bekleniyor)..."
        sleep 20

        MAX_WAIT=60
        ELAPSED=0
        while [[ $ELAPSED -lt $MAX_WAIT ]]; do
            LS_STATUS=$(curl -sf "http://localhost:${LS_PORT}/healthz" 2>/dev/null | grep -c '"ok":true' || true)
            if [[ "$LS_STATUS" -ge 1 ]]; then
                ok "License-server calisiyor."
                break
            fi
            sleep 5
            ELAPSED=$((ELAPSED + 5))
            info "Bekleniyor... ($ELAPSED/${MAX_WAIT}s)"
        done
        if [[ $ELAPSED -ge $MAX_WAIT ]]; then
            warn "Saglik kontrolu zaman asimi. Loglari inceleyin:"
            warn "  $DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f $INSTALL_DIR/docker-compose.server.yml logs --tail=30"
        fi
    fi
fi

# ─── 11. Bakım scripti oluştur ──────────────────────────────
cat > "$INSTALL_DIR/mailtrustai-ctl.sh" <<'CTLEOF'
#!/usr/bin/env bash
# MailTrustAI sunucu yonetim araci
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
        echo "Yedek olusturuldu: $BDIR/.env.$TS"
        docker run --rm \
            -v mailtrustai-server_mariadb-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/mariadb-$TS.tar.gz" -C /data . \
            && echo "MariaDB yedegi: $BDIR/mariadb-$TS.tar.gz"
        docker run --rm \
            -v mailtrustai-server_license-server-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/license-server-data-$TS.tar.gz" -C /data . \
            && echo "License-server verisi yedegi: $BDIR/license-server-data-$TS.tar.gz"
        ;;
    help|*)
        echo "Kullanim: $0 {start|stop|restart|status|logs|update|backup}"
        ;;
esac
CTLEOF
chmod +x "$INSTALL_DIR/mailtrustai-ctl.sh"

# Repo yolunu kaydet (update komutu için)
echo "$REPO_ROOT" > "$INSTALL_DIR/.repo_path"

# ─── 12. Özet ───────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
if [[ "$BUILD_OK" == "true" ]]; then
echo "  ║          ✓  Kurulum Tamamlandi!                      ║"
else
echo "  ║    ⚠  Kurulum KISMI — Docker build basarisiz!        ║"
fi
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Yapilandirma Dosyasi:${NC}"
echo -e "  ${YELLOW}${ENV_FILE}${NC}   ← SECRET'LARINIZI YEDEKLEYIN"
echo ""

if [[ "$BUILD_OK" == "true" ]]; then
    echo -e "  ${BOLD}Erisim Adresleri:${NC}"
    echo -e "  ├─ License Server API : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/healthz${NC}"
    echo -e "  ├─ Dealer Panel       : ${CYAN}http://${SERVER_HOST}:${DEALER_PORT_VAR}${NC}"
    echo -e "  └─ Admin Panel        : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/admin${NC}"
    echo ""
else
    echo -e "  ${RED}Docker build basarisiz oldu. Adimlar:${NC}"
    echo -e "  1. Hatanin nedenini inceleyin:"
    echo -e "     ${CYAN}cd $REPO_ROOT${NC}"
    echo -e "     ${CYAN}$DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f docker-compose.server.yml build 2>&1 | tail -50${NC}"
    echo -e "  2. Duzeltip yeniden calistirin:"
    echo -e "     ${CYAN}sudo bash install/server/install_server_ubuntu.sh${NC}"
    echo -e "  ${GREEN}Not: .env dosyasi basariyla olusturuldu, bir sonraki calistirmada korunacak.${NC}"
    echo ""
fi

echo -e "  ${BOLD}Onemli Dosyalar:${NC}"
echo -e "  ├─ Yapilandirma : ${YELLOW}${ENV_FILE}${NC}"
echo -e "  ├─ Yonetim araci: ${YELLOW}${INSTALL_DIR}/mailtrustai-ctl.sh${NC}"
echo -e "  └─ Yedekler     : ${YELLOW}${INSTALL_DIR}/backups/${NC}"
echo ""
echo -e "  ${BOLD}Hizli Komutlar:${NC}"
echo -e "  ├─ Durum  : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh status${NC}"
echo -e "  ├─ Loglar : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh logs${NC}"
echo -e "  ├─ Yedek  : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh backup${NC}"
echo -e "  └─ Durdur : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh stop${NC}"
echo ""
echo -e "  ${YELLOW}Firewall: ${LS_PORT}/tcp ve ${DEALER_PORT_VAR}/tcp portlarini acin.${NC}"
echo ""
hr
