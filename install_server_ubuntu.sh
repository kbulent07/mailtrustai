#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Sunucu (Kurucu/Satıcı) Kurulum Scripti — v2.0 (3-tier)
#  Hedef OS: Ubuntu 22.04 / 24.04 LTS
#
#  Kurulan servisler (TEK Docker network'te):
#    - MariaDB       (yönetim DB,        port 3306 internal)
#    - license-server (lisans API,        port 3200)
#    - dealer panel   (bayi paneli,       port 3100)
#
#  Müşteri bu sunucuya KURULMAZ — `install_customer_ubuntu.sh` ayrı host'ta.
#
#  Kullanım:
#     chmod +x install_server_ubuntu.sh
#     sudo ./install_server_ubuntu.sh
#
#  Sessiz mod (CI):
#     sudo ./install_server_ubuntu.sh --yes --first-dealer-id bayi-01 \
#          --first-dealer-name "Bayi A" --first-dealer-email bayi@a.com
# ==============================================================================
set -euo pipefail

# ── Renkler ──
readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn() { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_error(){ echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
trap 'log_error "Satır $LINENO: hata. Kurulum durduruldu."; exit 1' ERR

# ── Sabitler ──
readonly REPO_URL="https://github.com/kbulent07/mailtrustai.git"
readonly REPO_BRANCH="${MSA_BRANCH:-mainpaketler}"
readonly APP_DIR="${APP_DIR:-/opt/mailtrustai}"
readonly COMPOSE_FILE="docker-compose.server.yml"
readonly ENV_FILE=".env.docker"

# ── CLI parametreleri ──
ASSUME_YES=false
FIRST_DEALER_ID=""
FIRST_DEALER_NAME=""
FIRST_DEALER_EMAIL=""
FIRST_DEALER_PASSWORD=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes|-y)              ASSUME_YES=true;            shift ;;
        --first-dealer-id)     FIRST_DEALER_ID="$2";       shift 2 ;;
        --first-dealer-name)   FIRST_DEALER_NAME="$2";     shift 2 ;;
        --first-dealer-email)  FIRST_DEALER_EMAIL="$2";    shift 2 ;;
        --first-dealer-pass)   FIRST_DEALER_PASSWORD="$2"; shift 2 ;;
        --branch)              REPO_BRANCH="$2";           shift 2 ;;
        --app-dir)             APP_DIR="$2";               shift 2 ;;
        -h|--help)
            cat <<HELP
Kullanım: sudo ./install_server_ubuntu.sh [SEÇENEKLER]

SEÇENEKLER:
  --yes, -y                  Onay sorma (CI modu)
  --first-dealer-id <id>     İlk bayi ID (örn: bayi-01)
  --first-dealer-name <ad>   İlk bayi adı
  --first-dealer-email <e>   İlk bayi e-posta
  --first-dealer-pass <pw>   İlk bayi parolası (8+ karakter)
  --branch <name>            Git branch (default: mainpaketler)
  --app-dir <path>           Kurulum dizini (default: /opt/mailtrustai)
  -h, --help                 Bu yardımı göster
HELP
            exit 0 ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

# ── Banner ──
echo -e "${BOLD}${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — Sunucu Kurulumu (3-Tier)                    ║
║   MariaDB + License-Server + Dealer Panel                   ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Root kontrol ──
if [[ $EUID -ne 0 ]]; then
    log_error "Bu script sudo/root yetkisi gerektirir."
    exit 1
fi

# ── 1) Docker + Git kurulu mu? ──
log_step "1/8 Docker + Git kontrolü"
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
    log_ok "Docker kuruldu: $(docker --version)"
else
    log_ok "Docker mevcut: $(docker --version)"
fi
if ! docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose plugin bulunamadı. Manuel kurun: docker-compose-plugin"
    exit 1
fi
command -v git >/dev/null 2>&1 || apt-get install -y -qq git
command -v openssl >/dev/null 2>&1 || apt-get install -y -qq openssl

# ── 2) Repo clone / pull ──
log_step "2/8 Repo: $APP_DIR (branch: $REPO_BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
    log_info "Mevcut repo güncelleniyor..."
    git -C "$APP_DIR" fetch --quiet origin
    git -C "$APP_DIR" checkout --quiet "$REPO_BRANCH"
    git -C "$APP_DIR" pull --quiet origin "$REPO_BRANCH"
else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --quiet --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
log_ok "Repo hazır: $(git -C "$APP_DIR" rev-parse --short HEAD)"

# ── 3) .env.docker üret ──
log_step "3/8 Secret env üretimi"
if [[ -f "$ENV_FILE" ]]; then
    if [[ "$ASSUME_YES" == "true" ]]; then
        log_warn "$ENV_FILE mevcut — KORUNUYOR (mevcut secret'lar)."
    else
        read -r -p "$ENV_FILE mevcut. Yeniden üretilsin mi? (mevcut bayi/lisans verisi DOKUNULMAZ ama DB password değişirse erişim kaybolur) [e/H]: " ans
        if [[ "$ans" =~ ^[eE]$ ]]; then
            mv "$ENV_FILE" "${ENV_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
            log_warn "Eski env yedeklendi."
        fi
    fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
    rand32() { openssl rand -hex 32; }
    rand24() { openssl rand -hex 24; }
    cat > "$ENV_FILE" <<EOF
# Auto-generated by install_server_ubuntu.sh on $(date -Iseconds)
# !!! BU DOSYAYI ASLA GIT'E EKLEMEYIN — secret içerir !!!

# === Sunucu secret'ları (KALICI — değiştirme) ===
LICENSE_SIGNING_SECRET=$(rand32)
DEALER_API_SECRET=$(rand32)
DEALER_SESSION_SECRET=$(rand32)

# === MariaDB ===
MARIADB_DATABASE=mailtrustai_license
MARIADB_USER=mailtrustai
MARIADB_PASSWORD=$(rand24)
MARIADB_ROOT_PASSWORD=$(rand24)

# === Port mapping ===
LICENSE_SERVER_PORT=3200
DEALER_PORT=3100

# === Grace + heartbeat ===
DEFAULT_GRACE_DAYS=7
HEARTBEAT_ONLINE_THRESHOLD_SECONDS=300
HEARTBEAT_STALE_THRESHOLD_SECONDS=1800
CUSTOMER_SYNC_MAX_PAYLOAD_BYTES=16384
DEALER_SESSION_TTL_MINUTES=480
EOF
    chmod 600 "$ENV_FILE"
    log_ok "$ENV_FILE üretildi (mode 600)"
    log_warn "ÖNEMLİ: $APP_DIR/$ENV_FILE dosyasını parola yöneticisi/vault'a kopyalayın."
else
    log_ok "$ENV_FILE korundu."
fi

# ── 4) Image build ──
log_step "4/8 Docker image'ları build"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull
log_ok "Image'lar build edildi."

# ── 5) Stack'i ayağa kaldır ──
log_step "5/8 Stack'i başlat"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
log_ok "Container'lar başlatıldı."

# ── 6) Healthcheck bekle ──
log_step "6/8 Servisler healthy olana kadar bekleniyor (max 120 sn)"
WAIT=0
while [[ $WAIT -lt 120 ]]; do
    HEALTHY=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
              | grep -c '"Health":"healthy"' || echo 0)
    if [[ $HEALTHY -ge 3 ]]; then
        log_ok "Tüm 3 servis healthy."
        break
    fi
    sleep 3; WAIT=$((WAIT+3))
    echo -n "."
done
echo ""
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

# ── 7) İlk bayi (opsiyonel) ──
log_step "7/8 İlk bayi"
if [[ "$ASSUME_YES" == "false" && -z "$FIRST_DEALER_ID" ]]; then
    read -r -p "İlk bayi oluşturalım mı? [E/h]: " ans
    if [[ ! "$ans" =~ ^[hH]$ ]]; then
        read -r -p "  Bayi ID (örn: bayi-01): " FIRST_DEALER_ID
        read -r -p "  Bayi adı: " FIRST_DEALER_NAME
        read -r -p "  E-posta: " FIRST_DEALER_EMAIL
        read -r -s -p "  Parola (8+ karakter): " FIRST_DEALER_PASSWORD; echo ""
    fi
fi

if [[ -n "$FIRST_DEALER_ID" ]]; then
    docker exec mailtrustai-license-server \
        node apps/license-server/bin/bootstrap.js create-dealer \
        --id "$FIRST_DEALER_ID" \
        --name "${FIRST_DEALER_NAME:-$FIRST_DEALER_ID}" \
        --email "${FIRST_DEALER_EMAIL:-}"
    if [[ -n "$FIRST_DEALER_PASSWORD" ]]; then
        docker exec mailtrustai-license-server \
            node apps/license-server/bin/bootstrap.js set-dealer-password \
            --id "$FIRST_DEALER_ID" --password "$FIRST_DEALER_PASSWORD"
        log_ok "Bayi $FIRST_DEALER_ID oluşturuldu ve parolası set edildi."
    else
        log_warn "Parola atlandı — manuel set edin:"
        echo "  docker exec mailtrustai-license-server \\"
        echo "    node apps/license-server/bin/bootstrap.js set-dealer-password \\"
        echo "    --id $FIRST_DEALER_ID --password 'GUCLU_PAROLA'"
    fi
fi

# ── 8) Systemd auto-start ──
log_step "8/8 Systemd auto-start"
cat > /etc/systemd/system/mailtrustai-server.service <<UNIT
[Unit]
Description=MailTrustAI Server Stack (3-tier)
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
systemctl enable mailtrustai-server.service >/dev/null 2>&1
log_ok "Systemd: mailtrustai-server.service etkin (sistem başlangıcında auto-start)."

# ── Özet ──
echo -e "\n${BOLD}${GREEN}════════════════════ KURULUM TAMAM ════════════════════${NC}\n"
echo "Servisler:"
echo "  License-Server : http://$(hostname -I | awk '{print $1}'):3200/healthz"
echo "  Dealer Panel   : http://$(hostname -I | awk '{print $1}'):3100"
echo ""
echo "ÜRETİM İÇİN MUTLAKA:"
echo "  1. Reverse proxy + TLS sertifika (Caddy / nginx / Traefik)"
echo "  2. UFW: sadece 80/443 dış; 3100/3200 yalnız iç"
echo "  3. $APP_DIR/$ENV_FILE dosyasını vault'a yedekle"
echo ""
echo "Müşteri tarafına vermek için lisans key:"
echo "  docker exec mailtrustai-license-server \\"
echo "    node apps/license-server/bin/bootstrap.js list-dealers"
echo ""
echo "Bayi paneli kullanıcı: ${FIRST_DEALER_ID:-<bootstrap.js ile oluştur>}"
echo "Sunucu URL (müşteriye verilecek): https://license.<domaininiz>.com"
echo ""
echo "Logları izle: docker compose -f $COMPOSE_FILE logs -f"
echo "Durdur     : docker compose -f $COMPOSE_FILE down"
echo "Tekrar başlat: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d"
