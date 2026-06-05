#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri (Client) NATIVE Kurulum Betigi
#
# DOCKER YOK. Uygulama dogrudan host uzerinde Node.js 22 ile
# bir systemd servisi (mailtrustai) olarak calisir.
#
# Sirayla yapar:
#   1) Ubuntu kontrolu
#   2) Node.js 22 (yoksa NodeSource'tan) + git + build araclari
#   3) Repo'yu INSTALL_DIR'e klonlar/gunceller (branch: mainpaketler)
#   4) npm install --omit=dev  (workspace + native moduller)
#   5) Musteri agacini temizler (keygen/bayi/license-server kodu silinir)
#   6) check-customer-package ile guvenlik dogrulamasi
#   7) Guvenli .env uretir (openssl rand)
#   8) systemd servisi kurar + baslatir
#   9) Saglik kontrolu (/healthz)
#
# Kullanim (interaktif):
#   sudo bash install/client/linux/install-native-ubuntu.sh
#
# Tek satir (non-interactive):
#   sudo LICENSE_KEY="MTAI-PRO-XXXX" \
#        bash install/client/linux/install-native-ubuntu.sh
#   # LICENSE_SERVER_URL bos brakilirsa http://licence.mailtrustai.com:3200
# ============================================================
set -Euo pipefail

REPO_URL="https://github.com/kbulent07/mailtrustai.git"
BRANCH="mainpaketler"
SERVICE_NAME="mailtrustai"
SERVICE_USER="mailtrustai"
NODE_MAJOR=22

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Script repo icinden calistirildiysa repo kokunu bul (3 ust dizin)
SRC_REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd || echo "")"

INSTALL_LOG="/tmp/mailtrustai-native-install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()    { echo -e "${CYAN}------------------------------------------------------${NC}"; }

on_error() {
    local exit_code=$?; local line=$1
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

IS_INTERACTIVE=true
[[ ! -t 0 ]] && IS_INTERACTIVE=false

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI - Ubuntu Musteri NATIVE Kurulumu        ==="
echo "  ===  Docker YOK — systemd + Node.js 22                   ==="
echo "  ============================================================"
echo -e "${NC}"
info "Log dosyasi: $INSTALL_LOG"

# ============================================================
# 1. Ubuntu kontrolu
# ============================================================
step "1/9  Ubuntu kontrol ediliyor..."
if [[ ! -f /etc/os-release ]] || ! grep -qiE 'ubuntu|debian' /etc/os-release; then
    warn "Bu betik Ubuntu/Debian icin tasarlandi. Devam ediliyor ama desteklenmeyebilir."
fi
. /etc/os-release 2>/dev/null || true
ok "Dagitim: ${PRETTY_NAME:-bilinmiyor}"

# ============================================================
# 2. Bagimliliklar: Node.js 22 + git + build araclari
# ============================================================
step "2/9  Bagimliliklar kontrol ediliyor (Node.js ${NODE_MAJOR}, git, build araclari)..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git openssl build-essential python3

need_node=true
if command -v node &>/dev/null; then
    cur_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [[ "$cur_major" =~ ^[0-9]+$ ]] && (( cur_major >= NODE_MAJOR )); then
        need_node=false
        ok "Node.js mevcut: $(node --version)"
    else
        warn "Node.js $(node --version) < ${NODE_MAJOR}. NodeSource'tan ${NODE_MAJOR}.x kurulacak."
    fi
fi

if [[ "$need_node" == "true" ]]; then
    info "NodeSource deposu ekleniyor ve Node.js ${NODE_MAJOR}.x kuruluyor..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y -qq nodejs
    ok "Node.js kuruldu: $(node --version)"
fi
command -v npm &>/dev/null || fatal "npm bulunamadi (Node.js kurulumu eksik)."

# ============================================================
# 3. Yapilandirma sorulari
# ============================================================
step "3/9  Kurulum yapilandirmasi..."
hr

DEFAULT_INSTALL_DIR="/opt/mailtrustai"
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR || INPUT_DIR=""
    INSTALL_DIR="${INPUT_DIR:-${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}}"
else
    INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
fi

if [[ -z "${LICENSE_KEY:-}" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -rp "  Lisans anahtari (or: MTAI-PRO-XXXX-XXXX): " LICENSE_KEY || LICENSE_KEY=""
    fi
fi
[[ -n "${LICENSE_KEY:-}" ]] || fatal "Lisans anahtari zorunludur. (Non-interactive: LICENSE_KEY=... gecin.)"

DEFAULT_LICENSE_SERVER_URL="http://licence.mailtrustai.com:3200"
if [[ -z "${LICENSE_SERVER_URL:-}" ]]; then
    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -rp "  Lisans sunucusu URL [${DEFAULT_LICENSE_SERVER_URL}]: " LICENSE_SERVER_URL || LICENSE_SERVER_URL=""
    fi
    LICENSE_SERVER_URL="${LICENSE_SERVER_URL:-$DEFAULT_LICENSE_SERVER_URL}"
fi
LICENSE_SERVER_URL="${LICENSE_SERVER_URL%/}"

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Uygulama port [3000]: " PORT_INPUT || PORT_INPUT=""
    CUSTOMER_PORT="${PORT_INPUT:-${CUSTOMER_PORT:-3000}}"
else
    CUSTOMER_PORT="${CUSTOMER_PORT:-3000}"
fi

hr
info "Secilen yapilandirma:"
info "  INSTALL_DIR        = $INSTALL_DIR"
info "  LICENSE_KEY        = ${LICENSE_KEY:0:8}...$(echo -n "$LICENSE_KEY" | tail -c 4)"
info "  LICENSE_SERVER_URL = $LICENSE_SERVER_URL"
info "  CUSTOMER_PORT      = $CUSTOMER_PORT"
info "  SERVICE            = ${SERVICE_NAME}.service (kullanici: ${SERVICE_USER})"
hr

# ============================================================
# 4. Repo'yu INSTALL_DIR'e klonla / guncelle
# ============================================================
step "4/9  Kaynak kod hazirlaniyor: $INSTALL_DIR ($BRANCH)"

if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Mevcut repo guncelleniyor..."
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout -q "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
elif [[ -n "$SRC_REPO_ROOT" && -d "$SRC_REPO_ROOT/.git" && "$(readlink -f "$SRC_REPO_ROOT")" == "$(readlink -f "$INSTALL_DIR" 2>/dev/null || echo '')" ]]; then
    info "Script zaten kurulum dizininden calisiyor — yerinde kullanilacak."
else
    info "Klonlaniyor: $REPO_URL ($BRANCH)..."
    mkdir -p "$INSTALL_DIR"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
ok "Kaynak hazir: $(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"

mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/backups"

# ============================================================
# 5. npm install (workspace + native moduller)
# ============================================================
step "5/9  Bagimliliklar yukleniyor (npm install --omit=dev)..."
info "Native moduller (better-sqlite3, bcrypt) icin prebuilt binari indirilir; yoksa kaynaktan derlenir."
npm install --omit=dev --no-audit --no-fund --prefix "$INSTALL_DIR"
ok "node_modules hazir."

# Workspace symlink garantisi: node_modules/@mailtrustai/<pkg> -> packages/<pkg>
mkdir -p "$INSTALL_DIR/node_modules/@mailtrustai"
for p in "$INSTALL_DIR"/packages/*/; do
    [[ -d "$p" ]] || continue
    name="$(basename "$p")"
    ln -sfn "$p" "$INSTALL_DIR/node_modules/@mailtrustai/$name"
done

# ============================================================
# 6. Musteri agacini temizle (keygen/bayi/license-server SIL)
# ============================================================
step "6/9  Musteri-disi kod temizleniyor (guvenlik)..."
node "$INSTALL_DIR/scripts/strip-customer-tree.js"

# license-core silindi → olasi dangling symlink'i temizle
[[ -L "$INSTALL_DIR/node_modules/@mailtrustai/license-core" ]] && rm -f "$INSTALL_DIR/node_modules/@mailtrustai/license-core" || true

# ============================================================
# 7. Guvenlik dogrulamasi
# ============================================================
step "7/9  Guvenlik dogrulamasi (check-customer-package)..."
MSA_CUSTOMER_BUILD=1 node "$INSTALL_DIR/scripts/check-customer-package.js" --scope=image \
    || fatal "GUVENLIK KONTROLU BASARISIZ — musteri agacinda yasak kod kaldi. Kurulum durduruldu."
ok "Guvenlik kontrolu basarili — musteri paketinde yasak kod yok."

# ============================================================
# 8. .env + servis kullanicisi + systemd
# ============================================================
step "8/9  .env, servis kullanicisi ve systemd servisi..."

# Servis kullanicisi (sistem, login yok)
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    ok "Servis kullanicisi olusturuldu: $SERVICE_USER"
else
    info "Servis kullanicisi zaten var: $SERVICE_USER"
fi

ENV_FILE="$INSTALL_DIR/.env"
gen32() { openssl rand -hex 32; }
gen16() { openssl rand -hex 16; }

SKIP_ENV=false
if [[ -f "$ENV_FILE" ]] && grep -q "^MSA_LICENSE_KEY=.\{4,\}" "$ENV_FILE" 2>/dev/null; then
    SKIP_ENV=true
    ok "Mevcut .env korunuyor (guncelleme modu): $ENV_FILE"
fi

if [[ "$SKIP_ENV" == "false" ]]; then
    LOCAL_ENC_KEY=$(gen32); ENC_PASSWORD=$(gen32); ENC_SALT=$(gen16); LICENSE_SECRET=$(gen32)
    TMP_ENV="${ENV_FILE}.tmp.$$"
    {
        printf '# ============================================================\n'
        printf '# MailTrustAI Musteri (NATIVE) Yapilandirmasi\n'
        printf '# Olusturulma: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# ============================================================\n\n'
        printf '# === Lisans Bilgileri ===\n'
        printf 'MSA_LICENSE_KEY=%s\n'          "$LICENSE_KEY"
        printf 'MSA_LICENSE_REMOTE_URL=%s\n'   "$LICENSE_SERVER_URL"
        printf 'MSA_CENTRAL_SYNC_URL=%s\n'     "$LICENSE_SERVER_URL"
        printf 'MSA_CENTRAL_SYNC_ENABLED=true\n'
        printf 'MSA_HEARTBEAT_INTERVAL_SECONDS=300\n'
        printf 'MSA_POLICY_SYNC_INTERVAL_SECONDS=900\n\n'
        printf '# === Guvenlik Secret lari (degistirmeyin) ===\n'
        printf 'MSA_LOCAL_ENCRYPTION_KEY=%s\n' "$LOCAL_ENC_KEY"
        printf 'MSA_ENC_PASSWORD=%s\n'         "$ENC_PASSWORD"
        printf 'MSA_ENC_SALT=%s\n'             "$ENC_SALT"
        printf 'MSA_LICENSE_SECRET=%s\n\n'     "$LICENSE_SECRET"
        printf '# === Port & Ortam ===\n'
        printf 'PORT=%s\n'              "$CUSTOMER_PORT"
        printf 'CUSTOMER_PORT=%s\n'     "$CUSTOMER_PORT"
        printf 'NODE_ENV=production\n'
        printf 'MSA_CUSTOMER_ONLY=true\n'
        printf 'TRUST_PROXY=1\n'
        printf 'DATA_DIR=%s/data\n'     "$INSTALL_DIR"
        printf 'LOG_DIR=%s/logs\n\n'    "$INSTALL_DIR"
        printf '# === Ilk Kurulum ===\n'
        printf '# Tarayicida http://localhost:%s adresini acin, admin e-posta + sifrenizi olusturun.\n\n' "$CUSTOMER_PORT"
        printf '# === Fingerprint (host tan) ===\n'
        if [[ -r /etc/machine-id ]]; then
            printf 'HOST_MACHINE_ID=%s\n' "$(tr -d '[:space:]' < /etc/machine-id)"
        fi
        if [[ -r /sys/class/dmi/id/product_uuid ]]; then
            HOST_UUID="$(tr -d '[:space:]' < /sys/class/dmi/id/product_uuid 2>/dev/null || echo '')"
            [[ -n "$HOST_UUID" ]] && printf 'HOST_SYSTEM_UUID=%s\n' "$HOST_UUID"
        fi
        printf 'HOST_HOSTNAME=%s\n' "$(hostname 2>/dev/null | tr -d '[:space:]')"
    } > "$TMP_ENV"
    for var in MSA_LICENSE_KEY MSA_LICENSE_REMOTE_URL MSA_LOCAL_ENCRYPTION_KEY \
               MSA_ENC_PASSWORD MSA_ENC_SALT MSA_LICENSE_SECRET PORT; do
        grep -E "^${var}=.+" "$TMP_ENV" >/dev/null || { rm -f "$TMP_ENV"; fatal "Tmp .env eksik degisken: $var"; }
    done
    mv -f "$TMP_ENV" "$ENV_FILE"
    ok ".env yazildi: $ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# Dosya sahipligi servis kullanicisina
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/backups"
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
# Uygulama dosyalari okunabilir olsun (servis kullanicisi calistiracak)
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null || true

NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=MailTrustAI Customer (native)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} --use-system-ca apps/customer/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
# Guvenlik sertlestirme
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/logs ${INSTALL_DIR}/backups
StandardOutput=append:${INSTALL_DIR}/logs/service.log
StandardError=append:${INSTALL_DIR}/logs/service.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
ok "systemd servisi etkin: ${SERVICE_NAME}.service"

# Firewall
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -qi active; then
    ufw allow "${CUSTOMER_PORT}/tcp" >/dev/null 2>&1 || true
    ok "ufw: ${CUSTOMER_PORT}/tcp acildi."
fi

# ============================================================
# 9. Saglik kontrolu
# ============================================================
step "9/9  Saglik kontrolu (max 60s)..."
ELAPSED=0; HEALTH_OK=false; sleep 5
while [[ $ELAPSED -lt 60 ]]; do
    if curl -sf "http://localhost:${CUSTOMER_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then
        HEALTH_OK=true; break
    fi
    sleep 5; ELAPSED=$((ELAPSED + 5)); info "Bekleniyor... ($ELAPSED/60s)"
done

# ============================================================
# Yonetim scripti
# ============================================================
CTL="$INSTALL_DIR/mailtrustai-native-ctl.sh"
cat > "$CTL" <<CTLEOF
#!/usr/bin/env bash
# MailTrustAI Musteri (NATIVE) yonetim araci
SVC="${SERVICE_NAME}"
DIR="${INSTALL_DIR}"
PORT="${CUSTOMER_PORT}"
case "\${1:-help}" in
    start)   systemctl start  "\$SVC" ;;
    stop)    systemctl stop   "\$SVC" ;;
    restart) systemctl restart "\$SVC" ;;
    status)  systemctl status "\$SVC" --no-pager ;;
    logs)    journalctl -u "\$SVC" -f -n 200 ;;
    update)  exec sudo bash "\$DIR/install/client/linux/update-native-ubuntu.sh" ;;
    backup)
        TS=\$(date +%Y%m%d_%H%M%S); B="\$DIR/backups"; mkdir -p "\$B"
        cp "\$DIR/.env" "\$B/.env.\$TS"
        tar czf "\$B/data-\$TS.tar.gz" -C "\$DIR" data 2>/dev/null || true
        echo "Yedek: \$B/.env.\$TS , \$B/data-\$TS.tar.gz" ;;
    version)
        echo "git    : \$(git -C "\$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null) @ \$(git -C "\$DIR" rev-parse --short HEAD 2>/dev/null)"
        echo "node   : \$(node --version)"
        echo "active : \$(systemctl is-active "\$SVC")" ;;
    health)
        HTTP=\$(curl -sf -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:\$PORT/healthz" 2>/dev/null || echo '000')
        ACT=\$(systemctl is-active "\$SVC" 2>/dev/null || echo 'inactive')
        OK='true'; [[ "\$HTTP" != '200' || "\$ACT" != 'active' ]] && OK='false'
        printf '{"ok":%s,"service":"%s","http_status":"%s"}\n' "\$OK" "\$ACT" "\$HTTP"
        [[ "\$OK" == 'true' ]] || exit 1 ;;
    doctor)
        echo "=== MailTrustAI Customer (native) Diyagnostik ==="
        echo "[1] systemd : \$(systemctl is-active "\$SVC")  (enabled: \$(systemctl is-enabled "\$SVC" 2>/dev/null))"
        echo "[2] node    : \$(node --version 2>/dev/null)"
        HC=\$(curl -sf --max-time 3 "http://localhost:\$PORT/healthz" 2>/dev/null || echo '')
        echo "[3] /healthz: \${HC:-CEVAP YOK}"
        echo "[4] .env    : \$([[ -f "\$DIR/.env" ]] && echo var || echo YOK)"
        LSU=\$(grep '^MSA_LICENSE_REMOTE_URL=' "\$DIR/.env" 2>/dev/null | cut -d= -f2-)
        if [[ -n "\$LSU" ]]; then
            C=\$(curl -sf -o /dev/null -w '%{http_code}' --max-time 5 "\$LSU/api/health" 2>/dev/null || echo '000')
            echo "[5] license-server (\$LSU): \$C"
        fi
        echo "=== bitti ===" ;;
    *)
        echo "Kullanim: \$0 {start|stop|restart|status|logs|update|backup|version|health|doctor}" ;;
esac
CTLEOF
chmod +x "$CTL"

# ============================================================
# Ozet
# ============================================================
hr
echo ""
echo -e "${GREEN}${BOLD}"
if [[ "$HEALTH_OK" == "true" ]]; then
    echo "  ============================================================"
    echo "  ===          NATIVE KURULUM TAMAMLANDI                   ==="
    echo "  ============================================================"
else
    echo "  ============================================================"
    echo "  ===  KURULUM BITTI - SAGLIK KONTROLU EKSIK               ==="
    echo "  ============================================================"
fi
echo -e "${NC}"

if [[ "$HEALTH_OK" == "true" && "$SKIP_ENV" == "false" ]]; then
    echo -e "  ${BOLD}Ilk Admin Kurulumu:${NC} ${CYAN}http://localhost:${CUSTOMER_PORT}${NC}"
    echo -e "  Tarayicida acin, e-posta + sifrenizi dogrudan olusturun."
    echo ""
fi
echo -e "  ${BOLD}Erisim:${NC}"
echo -e "  |- Uygulama : ${CYAN}http://localhost:${CUSTOMER_PORT}${NC}"
echo -e "  |- Servis   : ${YELLOW}systemctl status ${SERVICE_NAME}${NC}"
echo -e "  |- .env     : ${YELLOW}${ENV_FILE}${NC}"
echo -e "  \`- ctl      : ${YELLOW}${CTL}${NC}"
echo ""
echo -e "  ${BOLD}Hizli Komutlar:${NC}"
echo -e "  |- Durum    : ${CYAN}sudo ${CTL} status${NC}"
echo -e "  |- Loglar   : ${CYAN}sudo ${CTL} logs${NC}"
echo -e "  |- Guncelle : ${CYAN}sudo ${CTL} update${NC}"
echo -e "  \`- Yedek    : ${CYAN}sudo ${CTL} backup${NC}"
echo ""
if [[ "$HEALTH_OK" != "true" ]]; then
    warn "Saglik kontrolu eksik. Loglar: journalctl -u ${SERVICE_NAME} -n 80"
fi
hr
