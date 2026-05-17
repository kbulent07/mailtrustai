#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Müşteri (Customer) Kurulum Scripti — v2.0 (3-tier)
#  Hedef OS: Ubuntu 22.04 / 24.04 LTS
#
#  Müşteri host'unda SADECE customer container'ı çalışır.
#  Bayi/license-server kodu image'a fiziksel olarak GİRMEZ (Dockerfile'da silinir).
#
#  Kullanım (interaktif):
#     chmod +x install_customer_ubuntu.sh
#     sudo ./install_customer_ubuntu.sh
#
#  Kullanım (sessiz):
#     sudo ./install_customer_ubuntu.sh --yes \
#          --license-key "MTAI-PRO-..." \
#          --remote-url "https://license.bayiniz.com"
# ==============================================================================
set -euo pipefail

readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn() { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_error(){ echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
trap 'log_error "Satır $LINENO: hata."; exit 1' ERR

readonly REPO_URL="https://github.com/kbulent07/mailtrustai.git"
REPO_BRANCH="${MSA_BRANCH:-mainpaketler}"
APP_DIR="${APP_DIR:-/opt/mailtrustai-customer}"
readonly COMPOSE_FILE="docker-compose.customer.yml"
readonly ENV_FILE=".env.docker"

ASSUME_YES=false
LICENSE_KEY=""
REMOTE_URL=""
CUSTOMER_PORT=3000

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes|-y)         ASSUME_YES=true;     shift ;;
        --license-key)    LICENSE_KEY="$2";    shift 2 ;;
        --remote-url)     REMOTE_URL="$2";     shift 2 ;;
        --port)           CUSTOMER_PORT="$2";  shift 2 ;;
        --branch)         REPO_BRANCH="$2";    shift 2 ;;
        --app-dir)        APP_DIR="$2";        shift 2 ;;
        -h|--help)
            cat <<HELP
Kullanım: sudo ./install_customer_ubuntu.sh [SEÇENEKLER]

SEÇENEKLER:
  --yes, -y                Onay sorma (sessiz mod)
  --license-key <KEY>      Bayiden aldığınız lisans (MTAI-PRO-...)
  --remote-url <URL>       Bayi/satıcı license-server URL'i
                           (default: https://license.mailtrustai.com)
  --port <PORT>            Customer panel dış port (default: 3000)
  --branch <name>          Git branch (default: mainpaketler)
  --app-dir <path>         Kurulum dizini (default: /opt/mailtrustai-customer)
  -h, --help               Bu yardımı göster

ÖNCEDEN HAZIR OLMASI GEREKEN:
  - Bayi/satıcının verdiği lisans key (MTAI-PRO-...)
  - Bayi/satıcının license-server URL'i (örn: https://license.mailtrustai.com)
HELP
            exit 0 ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

echo -e "${BOLD}${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — Müşteri Kurulumu                            ║
║   Customer (mail tarama + AI analiz)                        ║
║   Bayi/Lisans Sunucusu AYRI host'tadır.                     ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

[[ $EUID -eq 0 ]] || { log_error "sudo/root gerekir."; exit 1; }

# ── Lisans key ve URL etkileşimli sorma ──
if [[ -z "$LICENSE_KEY" && "$ASSUME_YES" == "false" ]]; then
    read -r -p "Bayi/satıcıdan aldığınız lisans key (MTAI-...): " LICENSE_KEY
fi
if [[ -z "$REMOTE_URL" && "$ASSUME_YES" == "false" ]]; then
    read -r -p "Bayi sunucusu URL'i (default: https://license.mailtrustai.com): " REMOTE_URL
    REMOTE_URL="${REMOTE_URL:-https://license.mailtrustai.com}"
fi
[[ -n "$LICENSE_KEY" ]] || { log_error "--license-key zorunlu"; exit 1; }
[[ -n "$REMOTE_URL" ]] || { log_error "--remote-url zorunlu"; exit 1; }
if [[ ! "$REMOTE_URL" =~ ^https?:// ]]; then
    log_error "Remote URL http:// veya https:// ile başlamalı."
    exit 1
fi

# ── 1) Docker + Git ──
log_step "1/6 Docker + Git kontrolü"
if ! command -v docker >/dev/null 2>&1; then
    log_info "Docker kurulu değil, kuruluyor..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
                          docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
    log_ok "Docker kuruldu."
else
    log_ok "Docker mevcut: $(docker --version)"
fi
command -v git >/dev/null 2>&1 || apt-get install -y -qq git
command -v openssl >/dev/null 2>&1 || apt-get install -y -qq openssl

# ── 2) Repo ──
log_step "2/6 Repo: $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch --quiet origin
    git -C "$APP_DIR" checkout --quiet "$REPO_BRANCH"
    git -C "$APP_DIR" pull --quiet origin "$REPO_BRANCH"
else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --quiet --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
log_ok "Repo hazır: $(git -C "$APP_DIR" rev-parse --short HEAD)"

# ── 3) Müşteri .env.docker ──
log_step "3/6 .env.docker üretimi"
if [[ -f "$ENV_FILE" ]]; then
    if [[ "$ASSUME_YES" == "false" ]]; then
        read -r -p "$ENV_FILE mevcut. Yeniden üretilsin mi? [e/H]: " ans
        if [[ "$ans" =~ ^[eE]$ ]]; then
            mv "$ENV_FILE" "${ENV_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
        fi
    else
        log_warn "$ENV_FILE mevcut — KORUNUYOR."
    fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
    rand32() { openssl rand -hex 32; }
    SETUP_TOKEN=$(openssl rand -hex 24)
    cat > "$ENV_FILE" <<EOF
# Auto-generated by install_customer_ubuntu.sh on $(date -Iseconds)
# Müşteri tarafı .env — sunucu secret'ları (LICENSE_SIGNING_SECRET vs) BURADA YOK.

# === Bayiden alınan lisans bilgileri ===
MSA_LICENSE_KEY=$LICENSE_KEY
MSA_LICENSE_REMOTE_URL=$REMOTE_URL
MSA_CENTRAL_SYNC_URL=$REMOTE_URL
MSA_CENTRAL_SYNC_ENABLED=true

# === Heartbeat / policy sync ===
MSA_HEARTBEAT_INTERVAL_SECONDS=300
MSA_POLICY_SYNC_INTERVAL_SECONDS=900

# === Lokal şifreleme (AES-256-GCM cache) ===
MSA_LOCAL_ENCRYPTION_KEY=$(rand32)

# === IMAP credential şifrelemesi (zorunlu) ===
MSA_ENC_PASSWORD=$(rand32)
MSA_ENC_SALT=$(rand32)

# === Legacy license HMAC (geriye dönük uyumluluk) ===
MSA_LICENSE_SECRET=$(rand32)

# === İlk admin kullanıcı oluşturma için (sadece ilk açılışta gerekli) ===
# Tarayıcıdan: http://<host>:$CUSTOMER_PORT/?setup_token=BU_DEGER
# Admin oluşturulduktan sonra .env'den silinebilir.
MSA_SETUP_TOKEN=$SETUP_TOKEN

# === Port ===
CUSTOMER_PORT=$CUSTOMER_PORT
EOF
    chmod 600 "$ENV_FILE"
    log_ok "$ENV_FILE üretildi."
    SETUP_TOKEN_OUT="$SETUP_TOKEN"
else
    SETUP_TOKEN_OUT=$(grep -E "^MSA_SETUP_TOKEN=" "$ENV_FILE" | cut -d= -f2- || echo "(eski .env içinde)")
fi

# ── 4) Build + up ──
log_step "4/6 Docker image build"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull
log_ok "Image build edildi."

log_step "5/6 Container'i başlat"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
sleep 8
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

# ── 6) Systemd ──
log_step "6/6 Systemd auto-start"
cat > /etc/systemd/system/mailtrustai-customer.service <<UNIT
[Unit]
Description=MailTrustAI Customer
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d --remove-orphans
ExecStop=/usr/bin/docker compose --env-file $ENV_FILE -f $COMPOSE_FILE down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mailtrustai-customer.service >/dev/null 2>&1
log_ok "Systemd kuruldu."

# ── Özet ──
HOST_IP=$(hostname -I | awk '{print $1}')
echo -e "\n${BOLD}${GREEN}════════════════════ KURULUM TAMAM ════════════════════${NC}\n"
echo "Müşteri panel: http://$HOST_IP:$CUSTOMER_PORT"
echo ""
echo "İLK GİRİŞ:"
echo "  Tarayıcıdan: http://$HOST_IP:$CUSTOMER_PORT/?setup_token=$SETUP_TOKEN_OUT"
echo "  (e-posta + şifre belirle, admin kullanıcı oluştur)"
echo ""
echo "Sonraki girişler: http://$HOST_IP:$CUSTOMER_PORT (setup_token gerekmez)"
echo ""
echo "Logları izle: docker compose -f $APP_DIR/$COMPOSE_FILE logs -f"
echo "Durdur     : sudo systemctl stop mailtrustai-customer"
echo "Başlat     : sudo systemctl start mailtrustai-customer"
echo ""
echo "GÜVENLİK:"
echo "  - $APP_DIR/$ENV_FILE içinde MSA_LICENSE_KEY ve şifreleme anahtarları var"
echo "  - Setup tamamlanınca MSA_SETUP_TOKEN env'ini silebilirsiniz"
echo "  - Üretimde TLS reverse proxy (Caddy/nginx) önerilir"
