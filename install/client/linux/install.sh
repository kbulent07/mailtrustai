#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri (Client) Kurulum Betigi
#
# Bu betik MUSTERI tarafinda calisir. Customer Docker container'ini
# Ubuntu 22.04+ uzerinde kurar.
#
# Kullanim (interaktif):
#   sudo bash install/client/linux/install.sh
#
# Tek satir parametreli:
#   sudo LICENSE_KEY="MTAI-PRO-XXXX" \  # LICENSE_SERVER_URL opsiyonel — bos brakirsaniz \
#   #                                     varsayilan http://licence.mailtrustai.com:3200 kullanilir
#       bash install/client/linux/install.sh
#
# Sirayla yapar:
#   1) Ubuntu kontrolu
#   2) Docker varsa atlanir; yoksa resmi depodan kurulur
#   3) Repo bulunma kontrolu (git'in calistigi dizinden anlasilir)
#   4) Lisans anahtari + lisans sunucusu URL sorulur (interaktif/env var)
#   5) Guvenli .env uretilir (openssl rand)
#   6) docker compose -f docker-compose.customer.yml build + up
#   7) Container saglik kontrolu
# ============================================================
set -Euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# --- Log dosyasi -----------------------------------------------------------
INSTALL_LOG="/tmp/mailtrustai-client-install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal()   { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()      { echo -e "${CYAN}------------------------------------------------------${NC}"; }

# ERR trap - hangi satirda patladi
on_error() {
    local exit_code=$?
    local line=$1
    echo "" >&2
    echo -e "${RED}${BOLD}===== KURULUM BASARISIZ =====${NC}" >&2
    echo -e "${RED}Cikis kodu : ${exit_code}${NC}" >&2
    echo -e "${RED}Satir no   : ${line}${NC}" >&2
    echo -e "${RED}Komut      : ${BASH_COMMAND}${NC}" >&2
    echo -e "${YELLOW}Tam log    : ${INSTALL_LOG}${NC}" >&2
    exit "$exit_code"
}
trap 'on_error $LINENO' ERR

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

# Interactive tespiti
IS_INTERACTIVE=true
[[ ! -t 0 ]] && IS_INTERACTIVE=false

# Banner
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI - Ubuntu Musteri (Client) Kurulumu      ==="
echo "  ===  Customer Docker container'i kurar                   ==="
echo "  ============================================================"
echo -e "${NC}"

# ============================================================
# 1. Ubuntu kontrolu
# ============================================================
step "1/6  Ubuntu kontrol ediliyor..."

if [[ ! -f /etc/lsb-release ]] || ! grep -qi ubuntu /etc/lsb-release 2>/dev/null; then
    fatal "Bu betik yalnizca Ubuntu (22.04 / 24.04 LTS) uzerinde calisir."
fi
UBUNTU_VER=$(grep DISTRIB_RELEASE /etc/lsb-release | cut -d= -f2)
ok "Ubuntu $UBUNTU_VER tespit edildi."

# ============================================================
# 2. Docker kurulum / kontrol
# ============================================================
step "2/6  Docker kontrol ediliyor..."

install_docker() {
    info "Docker Engine kuruluyor (resmi Docker deposu)..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker

    # Bu betik tarafindan kuruldugu marker'i — uninstall buna gore davranir
    touch /var/lib/mailtrustai-client-docker-installed-by-script
    ok "Docker Engine kuruldu (marker: /var/lib/mailtrustai-client-docker-installed-by-script)."
}

if ! command -v docker &>/dev/null; then
    warn "Docker bulunamadi. Otomatik kuruluyor..."
    install_docker
fi

if ! docker info &>/dev/null; then
    fatal "Docker daemon calismiyor. systemctl start docker"
fi

DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    command -v docker-compose &>/dev/null && DOCKER_COMPOSE_CMD="docker-compose" \
        || fatal "docker compose plugin yok."
fi
ok "Docker hazir: $(docker --version)"

# ============================================================
# 3. Yapilandirma sorulari
# ============================================================
step "3/6  Kurulum yapilandirmasi..."
hr

DEFAULT_INSTALL_DIR="/opt/mailtrustai"
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR || INPUT_DIR=""
    INSTALL_DIR="${INPUT_DIR:-${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}}"
else
    INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
fi

# Lisans anahtari
if [[ -z "${LICENSE_KEY:-}" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -rp "  Lisans anahtari (or: MTAI-PRO-XXXX-XXXX): " LICENSE_KEY || LICENSE_KEY=""
    fi
fi
[[ -n "${LICENSE_KEY:-}" ]] || fatal "Lisans anahtari zorunludur. (Non-interactive modda LICENSE_KEY=... olarak gecin.)"

# Lisans sunucusu URL — sabit default mailtrustai.com altyapisina baglanir.
# Override icin LICENSE_SERVER_URL env'den verilebilir veya interaktif soruda
# baska bir URL yazilabilir.
DEFAULT_LICENSE_SERVER_URL="http://licence.mailtrustai.com:3200"
if [[ -z "${LICENSE_SERVER_URL:-}" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -rp "  Lisans sunucusu URL [${DEFAULT_LICENSE_SERVER_URL}]: " LICENSE_SERVER_URL || LICENSE_SERVER_URL=""
    fi
    # Bos kaldiysa default kullan (hem interaktif hem non-interactive)
    LICENSE_SERVER_URL="${LICENSE_SERVER_URL:-$DEFAULT_LICENSE_SERVER_URL}"
fi
LICENSE_SERVER_URL="${LICENSE_SERVER_URL%/}"  # son slash'i temizle

# Port
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Customer port [3000]: " PORT_INPUT || PORT_INPUT=""
    CUSTOMER_PORT="${PORT_INPUT:-${CUSTOMER_PORT:-3000}}"
else
    CUSTOMER_PORT="${CUSTOMER_PORT:-3000}"
fi

# Container hostname
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Container hostname [mailtrustai]: " HN_INPUT || HN_INPUT=""
    CONTAINER_HOSTNAME="${HN_INPUT:-${CONTAINER_HOSTNAME:-mailtrustai}}"
else
    CONTAINER_HOSTNAME="${CONTAINER_HOSTNAME:-mailtrustai}"
fi

hr
info "Secilen yapilandirma:"
info "  INSTALL_DIR        = $INSTALL_DIR"
info "  LICENSE_KEY        = ${LICENSE_KEY:0:8}...$(echo -n "$LICENSE_KEY" | tail -c 4)"
info "  LICENSE_SERVER_URL = $LICENSE_SERVER_URL"
info "  CUSTOMER_PORT      = $CUSTOMER_PORT"
info "  CONTAINER_HOSTNAME = $CONTAINER_HOSTNAME"
info "  Log dosyasi        = $INSTALL_LOG"
hr

# ============================================================
# 4. .env yaz
# ============================================================
step "4/6  .env dosyasi olusturuluyor..."

mkdir -p "$INSTALL_DIR/backups" "$INSTALL_DIR/logs"
chmod 750 "$INSTALL_DIR"

ENV_FILE="$INSTALL_DIR/.env"
TMP_ENV="${ENV_FILE}.tmp.$$"

gen32() { openssl rand -hex 32; }
gen16() { openssl rand -hex 16; }
gen24() { openssl rand -hex 24; }

command -v openssl &>/dev/null || fatal "openssl bulunamadi. apt-get install -y openssl"

# .env mevcut ve dolu mu kontrol — guncelleme modu
SKIP_ENV=false
if [[ -f "$ENV_FILE" ]] && grep -q "^MSA_LICENSE_KEY=.\{4,\}" "$ENV_FILE" 2>/dev/null; then
    SKIP_ENV=true
    ok "Mevcut .env korunuyor (guncelleme modu): $ENV_FILE"
fi

if [[ "$SKIP_ENV" == "false" ]]; then
    LOCAL_ENC_KEY=$(gen32)
    ENC_PASSWORD=$(gen32)
    ENC_SALT=$(gen16)
    LICENSE_SECRET=$(gen32)
    SETUP_TOKEN=$(gen24)

    {
        printf '# ============================================================\n'
        printf '# MailTrustAI Musteri (Client) Yapilandirmasi\n'
        printf '# Olusturulma: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# Log: %s\n' "$INSTALL_LOG"
        printf '# ============================================================\n\n'
        printf '# === Lisans Bilgileri ===\n'
        printf 'MSA_LICENSE_KEY=%s\n'         "$LICENSE_KEY"
        printf 'MSA_LICENSE_REMOTE_URL=%s\n'  "$LICENSE_SERVER_URL"
        printf 'MSA_CENTRAL_SYNC_URL=%s\n'    "$LICENSE_SERVER_URL"
        printf 'MSA_CENTRAL_SYNC_ENABLED=true\n'
        printf 'MSA_HEARTBEAT_INTERVAL_SECONDS=300\n'
        printf 'MSA_POLICY_SYNC_INTERVAL_SECONDS=900\n\n'
        printf '# === Guvenlik Secret lari ===\n'
        printf 'MSA_LOCAL_ENCRYPTION_KEY=%s\n' "$LOCAL_ENC_KEY"
        printf 'MSA_ENC_PASSWORD=%s\n'         "$ENC_PASSWORD"
        printf 'MSA_ENC_SALT=%s\n'             "$ENC_SALT"
        printf 'MSA_LICENSE_SECRET=%s\n\n'     "$LICENSE_SECRET"
        printf '# === Ilk Kurulum ===\n'
        printf '# Tarayicida http://localhost:%s adresini acin, admin e-posta ve sifrenizi olusturun.\n' "$CUSTOMER_PORT"
        printf '\n'
        printf '# === Port & Ortam ===\n'
        printf 'CUSTOMER_PORT=%s\n' "$CUSTOMER_PORT"
        printf 'NODE_ENV=production\n'
        printf 'TRUST_PROXY=1\n\n'
        # === Fingerprint kaynaklari (host'tan okunur) ===
        # Container icindeki fingerprint.js bunlari env'den okur ve hash'ler.
        # /etc/machine-id Linux'ta her zaman var.
        # /sys/class/dmi/id/product_uuid bare-metal/VM'de var (root gerek);
        # container'da Docker Desktop Windows'ta mount edilemiyor (KB: ).
        # Skor modeli: install_id (4) + os_machine_id (4) = 8 zorunlu eşik;
        # system_uuid (3) bonus — yoksa lisans yine geçerli.
        if [[ -r /etc/machine-id ]]; then
            HOST_MID="$(cat /etc/machine-id 2>/dev/null | tr -d '[:space:]')"
            printf '# === Fingerprint (host'\''tan) ===\n'
            printf 'HOST_MACHINE_ID=%s\n' "$HOST_MID"
        fi
        if [[ -r /sys/class/dmi/id/product_uuid ]]; then
            HOST_UUID="$(cat /sys/class/dmi/id/product_uuid 2>/dev/null | tr -d '[:space:]')"
            [[ -n "$HOST_UUID" ]] && printf 'HOST_SYSTEM_UUID=%s\n' "$HOST_UUID"
        fi
        # Hostname — container icinde os.hostname() icin override
        HOST_HN="$(hostname 2>/dev/null | tr -d '[:space:]')"
        [[ -n "$HOST_HN" ]] && printf 'HOST_HOSTNAME=%s\n' "$HOST_HN"
    } > "$TMP_ENV"

    chmod 600 "$TMP_ENV"

    # Dogrulama
    for var in MSA_LICENSE_KEY MSA_LICENSE_REMOTE_URL MSA_LOCAL_ENCRYPTION_KEY \
               MSA_ENC_PASSWORD MSA_ENC_SALT MSA_LICENSE_SECRET CUSTOMER_PORT; do
        grep -E "^${var}=.+" "$TMP_ENV" >/dev/null || { rm -f "$TMP_ENV"; fatal "Tmp .env eksik degisken: $var"; }
    done

    mv -f "$TMP_ENV" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok ".env yazildi: $ENV_FILE ($(stat -c%s "$ENV_FILE") byte)"
fi

# ============================================================
# 5. Compose + image build
# ============================================================
step "5/6  Docker image derleniyor ve container baslatiliyor..."

COMPOSE_SRC="$REPO_ROOT/docker-compose.customer.yml"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.customer.yml"
[[ -f "$COMPOSE_SRC" ]] || fatal "$COMPOSE_SRC bulunamadi. Repo eksik."

# Kaynak ve hedef ayni dosyaysa kopyalamayi atla
if [[ "$(readlink -f "$COMPOSE_SRC")" != "$(readlink -f "$COMPOSE_FILE" 2>/dev/null || echo "")" ]]; then
    cp "$COMPOSE_SRC" "$COMPOSE_FILE"
fi
ok "Compose hazir: $COMPOSE_FILE"

cd "$REPO_ROOT"

info "Image derleniyor (5-15 dakika)..."
$DOCKER_COMPOSE_CMD --env-file "$ENV_FILE" -f docker-compose.customer.yml build --pull \
    || fatal "Docker image build basarisiz. Log: $INSTALL_LOG"
ok "Image derlendi."

info "Container baslatiliyor..."
$DOCKER_COMPOSE_CMD --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans \
    || fatal "docker compose up basarisiz."
ok "Container baslatildi."

# ============================================================
# 6. Saglik kontrolu
# ============================================================
step "6/6  Saglik kontrolu..."

HC_TIMEOUT="${HEALTHCHECK_TIMEOUT:-90}"
ELAPSED=0
HEALTH_OK=false
sleep 15
while [[ $ELAPSED -lt $HC_TIMEOUT ]]; do
    if curl -sf "http://localhost:${CUSTOMER_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
        HEALTH_OK=true
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    info "Bekleniyor... ($ELAPSED/${HC_TIMEOUT}s)"
done

if [[ "$HEALTH_OK" == "true" ]]; then
    ok "Customer calisiyor: http://localhost:${CUSTOMER_PORT}/healthz"
    cat > "$INSTALL_DIR/.install_success" <<MARKER
INSTALL_TIMESTAMP=$(date +%s)
INSTALL_DATE=$(date -Iseconds)
PORT=$CUSTOMER_PORT
LICENSE_SERVER_URL=$LICENSE_SERVER_URL
REPO_PATH=$REPO_ROOT
MARKER
    chmod 600 "$INSTALL_DIR/.install_success"
else
    warn "Saglik kontrolu zaman asimi. Loglar:"
    warn "  sudo docker logs mailtrustai-customer --tail 50"
fi

# ============================================================
# Yonetim scripti (mailtrustai-client-ctl.sh)
# ============================================================
cat > "$INSTALL_DIR/mailtrustai-client-ctl.sh" <<CTLEOF
#!/usr/bin/env bash
# MailTrustAI Musteri yonetim araci
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="\$DIR/.env"
COMPOSE="\$DIR/docker-compose.customer.yml"
DC="docker compose --env-file \$ENV_FILE -f \$COMPOSE"
case "\${1:-help}" in
    start)   \$DC up -d ;;
    stop)    \$DC stop ;;
    restart) \$DC restart ;;
    status)  \$DC ps ;;
    logs)    \$DC logs -f --tail=200 ;;
    update|upgrade)
        REPO=\$(cat "\$DIR/.repo_path" 2>/dev/null || echo '')
        UPD="\$REPO/install/client/update_client_ubuntu.sh"
        if [[ -n "\$REPO" && -f "\$UPD" ]]; then
            exec sudo bash "\$UPD"
        else
            echo "Update scripti bulunamadi: \$UPD"
            exit 1
        fi
        ;;
    backup)
        TS=\$(date +%Y%m%d_%H%M%S)
        BDIR="\$DIR/backups"
        mkdir -p "\$BDIR"
        cp "\$ENV_FILE" "\$BDIR/.env.\$TS"
        echo "Yedek: \$BDIR/.env.\$TS"
        ;;
    version)
        # Kurulu container'in image ve git commit bilgisini goster
        REPO=\$(cat "\$DIR/.repo_path" 2>/dev/null || echo '')
        IMG=\$(docker inspect -f '{{.Config.Image}}' mailtrustai-customer 2>/dev/null || echo 'container-yok')
        SHA=\$(git -C "\$REPO" rev-parse --short HEAD 2>/dev/null || echo 'git-yok')
        BRANCH=\$(git -C "\$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '-')
        CDATE=\$(docker inspect -f '{{.Created}}' "\$IMG" 2>/dev/null | cut -dT -f1 || echo '-')
        echo "image    : \$IMG"
        echo "image_at : \$CDATE"
        echo "git      : \$BRANCH @ \$SHA"
        echo "repo     : \$REPO"
        ;;
    health)
        # JSON formatinda saglik durumu — cron/monitoring icin
        HC=\$(docker inspect -f '{{.State.Health.Status}}' mailtrustai-customer 2>/dev/null || echo 'unknown')
        ST=\$(docker inspect -f '{{.State.Status}}' mailtrustai-customer 2>/dev/null || echo 'absent')
        UP=\$(docker inspect -f '{{.State.StartedAt}}' mailtrustai-customer 2>/dev/null || echo '-')
        HTTP=\$(curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/healthz 2>/dev/null || echo '000')
        OK='true'
        [[ "\$HC" != 'healthy' || "\$HTTP" != '200' ]] && OK='false'
        printf '{"ok":%s,"docker_state":"%s","docker_health":"%s","http_status":"%s","started_at":"%s"}\n' \
            "\$OK" "\$ST" "\$HC" "\$HTTP" "\$UP"
        [[ "\$OK" == 'true' ]] || exit 1
        ;;
    doctor)
        # Tani: docker, container, port, env, license-server erisimi
        echo "=== MailTrustAI Customer Diyagnostik ==="
        echo ""
        echo "[1] Docker servisi"
        if systemctl is-active --quiet docker 2>/dev/null; then echo "  OK  docker aktif"; else echo "  HATA docker aktif degil"; fi
        if docker info >/dev/null 2>&1; then echo "  OK  docker daemon erisilebilir"; else echo "  HATA docker daemon erisilemiyor"; fi
        echo ""
        echo "[2] Container"
        if docker ps --filter name=^mailtrustai-customer\$ --format '{{.Status}}' | grep -q .; then
            echo "  OK  container calisiyor: \$(docker ps --filter name=^mailtrustai-customer\$ --format '{{.Status}}')"
        else
            echo "  HATA container calismiyor"
        fi
        echo ""
        echo "[3] HTTP /healthz"
        HC=\$(curl -sf --max-time 3 http://localhost:3000/healthz 2>/dev/null || echo '')
        if [[ -n "\$HC" ]]; then echo "  OK  \$HC"; else echo "  HATA /healthz cevap vermiyor"; fi
        echo ""
        echo "[4] .env kontrolu"
        if [[ -f "\$ENV_FILE" ]]; then
            for k in MSA_LICENSE_KEY MSA_LICENSE_REMOTE_URL MSA_ENC_PASSWORD MSA_ENC_SALT MSA_LICENSE_SECRET MSA_LOCAL_ENCRYPTION_KEY; do
                if grep -q "^\${k}=." "\$ENV_FILE"; then echo "  OK  \$k tanimli"; else echo "  HATA \$k bos veya yok"; fi
            done
        else
            echo "  HATA .env bulunamadi: \$ENV_FILE"
        fi
        echo ""
        echo "[5] License-server erisimi"
        LSU=\$(grep '^MSA_LICENSE_REMOTE_URL=' "\$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"')
        if [[ -n "\$LSU" ]]; then
            CODE=\$(curl -sf -o /dev/null -w '%{http_code}' --max-time 5 "\$LSU/api/health" 2>/dev/null || echo '000')
            if [[ "\$CODE" == '200' ]]; then echo "  OK  \$LSU erisilebilir (200)"; else echo "  UYARI \$LSU yanit: \$CODE (grace cache devrede olabilir)"; fi
        else
            echo "  UYARI MSA_LICENSE_REMOTE_URL .env'de yok"
        fi
        echo ""
        echo "[6] Disk + bellek"
        df -h "\$DIR" 2>/dev/null | tail -1 | awk '{print "  disk : "\$0}'
        free -h 2>/dev/null | awk '/Mem:/ {print "  ram  : "\$0}'
        echo ""
        echo "=== bitti ==="
        ;;
    help|*)
        echo "Kullanim: \$0 {start|stop|restart|status|logs|update|backup|version|health|doctor}"
        echo ""
        echo "  start    Container'i baslat"
        echo "  stop     Container'i durdur"
        echo "  restart  Yeniden baslat"
        echo "  status   Container durumu (docker compose ps)"
        echo "  logs     Canli loglar (Ctrl+C cikis)"
        echo "  update   Repo pull + image rebuild + restart"
        echo "  backup   .env yedegi al"
        echo "  version  Kurulu image + git commit + branch"
        echo "  health   JSON saglik raporu (cron/monitoring icin, exit 0/1)"
        echo "  doctor   Detayli tani — docker/container/env/license-server"
        ;;
esac
CTLEOF
chmod +x "$INSTALL_DIR/mailtrustai-client-ctl.sh"
echo "$REPO_ROOT" > "$INSTALL_DIR/.repo_path"

# ============================================================
# Ozet
# ============================================================
hr
echo ""
echo -e "${GREEN}${BOLD}"
if [[ "$HEALTH_OK" == "true" ]]; then
    echo "  ============================================================"
    echo "  ===              KURULUM TAMAMLANDI                      ==="
    echo "  ============================================================"
else
    echo "  ============================================================"
    echo "  ===  KURULUM BITTI - SAGLIK KONTROLU EKSIK              ==="
    echo "  ============================================================"
fi
echo -e "${NC}"

if [[ "$HEALTH_OK" == "true" ]] && [[ "$SKIP_ENV" == "false" ]]; then
    SETUP_TOKEN_VAL=$(grep ^MSA_SETUP_TOKEN= "$ENV_FILE" | cut -d= -f2)
    echo -e "  ${BOLD}Ilk Admin Kurulumu:${NC}"
    echo -e "  ${CYAN}http://localhost:${CUSTOMER_PORT}/?setup_token=${SETUP_TOKEN_VAL}${NC}"
    echo ""
fi

echo -e "  ${BOLD}Erisim:${NC}"
echo -e "  ├─ Uygulama  : ${CYAN}http://localhost:${CUSTOMER_PORT}${NC}"
echo -e "  ├─ .env      : ${YELLOW}${ENV_FILE}${NC}"
echo -e "  └─ ctl       : ${YELLOW}${INSTALL_DIR}/mailtrustai-client-ctl.sh${NC}"
echo ""
echo -e "  ${BOLD}Hizli Komutlar:${NC}"
echo -e "  ├─ Durum     : ${CYAN}sudo ${INSTALL_DIR}/mailtrustai-client-ctl.sh status${NC}"
echo -e "  ├─ Loglar    : ${CYAN}sudo ${INSTALL_DIR}/mailtrustai-client-ctl.sh logs${NC}"
echo -e "  ├─ Guncelle  : ${CYAN}sudo ${INSTALL_DIR}/mailtrustai-client-ctl.sh update${NC}"
echo -e "  └─ Yedek     : ${CYAN}sudo ${INSTALL_DIR}/mailtrustai-client-ctl.sh backup${NC}"
echo ""
echo -e "  ${YELLOW}Firewall: ${CUSTOMER_PORT}/tcp portunu acin.${NC}"
echo ""
hr
