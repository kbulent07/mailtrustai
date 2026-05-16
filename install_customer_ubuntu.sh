#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu MÜŞTERİ Kurulum Scripti (Docker)
#  Sürüm   : 1.0  (2026-05)
#  Hedef OS: Ubuntu 22.04 / 24.04 LTS  (x86_64 / arm64)
#
#  Bu script bir MÜŞTERİ kurulumu yapar:
#    - /keygen.html ve /bayi.html paneller KAPALI
#    - /api/dealer/* ve lisans-üretici API'leri KAPALI
#    - Yalnız müşteri yönetim paneli (index.html) açık
#
#  Kullanım:
#     chmod +x install_customer_ubuntu.sh
#     sudo ./install_customer_ubuntu.sh
# ==============================================================================

set -euo pipefail

# ── Renkler ──────────────────────────────────────────────────────────────────
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

log_info()   { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()     { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()   { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_error()  { echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step()   { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

trap 'log_error "Satır $LINENO: hata. Kurulum durduruldu."; exit 1' ERR

# ── SSL otomasyon fonksiyonları ──────────────────────────────────────────────
# Hem HOST nginx hem DOCKER nginx mod'ları için Let's Encrypt sertifikası alır
# ve otomatik yenilemeyi kurar.
# - HOST nginx: 'certbot --nginx' kullanır; certbot.timer otomatik yenileme yapar.
# - DOCKER nginx: 'certbot certonly --webroot' + deploy-hook ile Docker nginx'i reload eder.

setup_ssl_host_nginx() {
    local domain="$1" email="$2" staging="$3"
    log_step "Let's Encrypt SSL kurulumu (HOST nginx)"

    apt-get install -y -qq certbot python3-certbot-nginx
    log_ok "certbot + python3-certbot-nginx kuruldu."

    local extra_args=()
    if [[ "$staging" == "true" ]]; then
        extra_args+=(--staging)
        log_warn "STAGING modunda — sertifika tarayıcılarda güvenilir görünmeyecek."
    fi

    log_info "Sertifika alınıyor: $domain (e-posta: $email)"
    if certbot --nginx \
        --non-interactive --agree-tos \
        --redirect \
        --domain "$domain" \
        --email "$email" \
        "${extra_args[@]}" 2>&1 | tail -8; then
        log_ok "SSL sertifikası alındı ve nginx config güncellendi."
    else
        log_warn "certbot --nginx başarısız. Manuel deneyin:"
        log_warn "  sudo certbot --nginx -d $domain --email $email"
        return 1
    fi

    # certbot.timer Ubuntu 20.04+ varsayılan etkin; ek garanti:
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "Otomatik yenileme aktif (certbot.timer)."
    log_info "Yenileme durumu görmek için: sudo systemctl status certbot.timer"
    log_info "Manuel test için: sudo certbot renew --dry-run"
}

setup_ssl_docker_nginx() {
    local domain="$1" email="$2" staging="$3"
    log_step "Let's Encrypt SSL kurulumu (DOCKER nginx)"

    apt-get install -y -qq certbot
    log_ok "certbot kuruldu."

    mkdir -p "$APP_DIR/nginx/certs"

    local extra_args=()
    if [[ "$staging" == "true" ]]; then
        extra_args+=(--staging)
        log_warn "STAGING modu."
    fi

    # --standalone modu: certbot kendi geçici HTTP sunucusunu başlatır.
    # nginx port 80'i bırakması için geçici durdurulur.
    log_info "Docker nginx geçici durduruluyor (port 80 certbot'a bırakılıyor)…"
    docker compose -f "$COMPOSE_FILE" stop nginx 2>/dev/null || true

    log_info "Sertifika alınıyor (standalone): $domain"
    certbot certonly --standalone \
        --non-interactive --agree-tos \
        --domain "$domain" --email "$email" \
        "${extra_args[@]}" 2>&1 | tail -10 || true

    # Nginx'i hata olsa da yeniden başlat
    log_info "Docker nginx yeniden başlatılıyor…"
    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" start nginx 2>/dev/null \
        || docker compose -f "$COMPOSE_FILE" up -d nginx 2>/dev/null || true

    # Sertifika dosyası yoksa hata ver ve devam et
    if [[ ! -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
        log_error "SSL sertifikası alınamadı. Kurulum HTTP ile devam ediyor."
        log_warn "Kontrol listesi:"
        log_warn "  1) '$domain' bu sunucunun genel IP'sine A kaydıyla işaret ediyor mu?"
        log_warn "     → nslookup $domain"
        log_warn "  2) Port 80 (TCP gelen) bulut güvenlik grubunda/firewall'da açık mı?"
        log_warn ""
        log_warn "SSL'i daha sonra elle eklemek için:"
        log_warn "  sudo docker compose -f $APP_DIR/$COMPOSE_FILE stop nginx"
        log_warn "  sudo certbot certonly --standalone -d $domain --email $email"
        log_warn "  sudo cp -L /etc/letsencrypt/live/$domain/fullchain.pem $APP_DIR/nginx/certs/"
        log_warn "  sudo cp -L /etc/letsencrypt/live/$domain/privkey.pem   $APP_DIR/nginx/certs/"
        log_warn "  sudo docker compose -f $APP_DIR/$COMPOSE_FILE start nginx"
        return 0
    fi

    # Sertifikaları Docker nginx volume'una kopyala
    cp -L "/etc/letsencrypt/live/$domain/fullchain.pem" "$APP_DIR/nginx/certs/"
    cp -L "/etc/letsencrypt/live/$domain/privkey.pem"   "$APP_DIR/nginx/certs/"
    chmod 644 "$APP_DIR/nginx/certs/fullchain.pem"
    chmod 640 "$APP_DIR/nginx/certs/privkey.pem"
    log_ok "Sertifikalar Docker nginx volume'una kopyalandı."

    # Docker nginx.conf'unu HTTPS açacak şekilde güncelle (yorum bloğunu kaldır + domain ikame)
    local conf="$APP_DIR/nginx/nginx.conf"
    if grep -q "# HTTPS Sunucusu" "$conf"; then
        log_info "nginx.conf güncelleniyor: HTTPS bloğu aktif ediliyor..."
        # Sadece HTTPS server bloğundaki "# " önek yorumunu kaldır
        # Pattern: '#     ... satırları'
        python3 - <<PYEOF
import re, sys
p = "$conf"
with open(p, 'r', encoding='utf-8') as f:
    src = f.read()

# Belirli marker'lar arasındaki yorumları kaldır
start = src.find("# ── HTTPS Sunucusu")
if start == -1:
    sys.exit(0)
# Bloğun sonu — son '# }' satırı
# Daha basit: '#     server {' ten sonra her satırın başındaki '# ' veya '#' temizle, '# }' kapanışına kadar
end = src.find("\n}\n", start)
# Yorum bloğunu satır satır işle
lines = src[start:].split("\n")
out_lines = []
in_block = False
brace_depth = 0
for ln in lines:
    if not in_block:
        if "server {" in ln and ln.lstrip().startswith("#"):
            in_block = True
            brace_depth = 1
            out_lines.append(re.sub(r"^(\s*)#\s?", r"\1", ln))
            continue
        out_lines.append(ln)
    else:
        # Yorumu kaldır
        new = re.sub(r"^(\s*)#\s?", r"\1", ln)
        # { ve } sayımı
        brace_depth += new.count("{") - new.count("}")
        out_lines.append(new)
        if brace_depth <= 0:
            in_block = False

new_block = "\n".join(out_lines)
result = src[:start] + new_block

# Domain ikamesi
result = result.replace("server_name _;", "server_name $domain;", 2)  # http ve https blokları

with open(p, 'w', encoding='utf-8') as f:
    f.write(result)
PYEOF
        log_ok "nginx.conf HTTPS için güncellendi (server_name: $domain)."
    fi

    # Renewal deploy hook: cert yenilendiğinde Docker nginx'i reload et
    local hook_dir="/etc/letsencrypt/renewal-hooks/deploy"
    local hook_file="$hook_dir/mailtrustai-customer.sh"
    mkdir -p "$hook_dir"
    cat > "$hook_file" <<HOOK
#!/usr/bin/env bash
# MailTrustAI — Let's Encrypt deploy hook (otomatik yenileme sonrası)
# install_customer_ubuntu.sh tarafından oluşturuldu.
set -euo pipefail

APP_DIR="$APP_DIR"
COMPOSE_FILE="$COMPOSE_FILE"
TARGET_DOMAIN="$domain"

# certbot yalnız hedef domain için reload yapsın
case " \${RENEWED_DOMAINS:-} " in
    *" \${TARGET_DOMAIN} "*) ;;
    *) exit 0 ;;
esac

cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/fullchain.pem" "\$APP_DIR/nginx/certs/fullchain.pem"
cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/privkey.pem"   "\$APP_DIR/nginx/certs/privkey.pem"
chmod 644 "\$APP_DIR/nginx/certs/fullchain.pem"
chmod 640 "\$APP_DIR/nginx/certs/privkey.pem"

# Docker nginx'i reload et (down/up değil — kesinti olmasın)
if command -v docker >/dev/null 2>&1; then
    cd "\$APP_DIR"
    docker compose -f "\$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || \\
        docker compose -f "\$COMPOSE_FILE" restart nginx
fi

logger -t mailtrustai-ssl "Sertifika yenilendi ve Docker nginx reload edildi: \$TARGET_DOMAIN"
HOOK
    chmod +x "$hook_file"
    log_ok "Yenileme hook'u kuruldu: $hook_file"

    # certbot.timer'ı aktif et (Ubuntu 20.04+ varsayılan zaten)
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "Otomatik yenileme aktif (certbot.timer)."

    # Docker nginx'i HTTPS yeni config ile reload et
    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null \
        || docker compose -f "$COMPOSE_FILE" restart nginx
    log_ok "Docker nginx reload edildi — HTTPS aktif."
}

setup_ssl() {
    local domain="$1" email="$2"
    if [[ -z "$domain" || -z "$email" ]]; then
        log_warn "SSL atlandı (domain veya e-posta eksik)."
        return 0
    fi

    # 80 portuna ulaşılabilir mi (Let's Encrypt için zorunlu)?
    if ! ss -ltn 2>/dev/null | grep -qE ':80\s' && ! command -v nginx >/dev/null 2>&1; then
        log_warn "Port 80 dinlenmiyor görünüyor — ACME challenge başarısız olabilir."
    fi

    if $USE_HOST_NGINX; then
        setup_ssl_host_nginx "$domain" "$email" "$SSL_STAGING"
    else
        setup_ssl_docker_nginx "$domain" "$email" "$SSL_STAGING"
    fi
}

# ── Sabitler ─────────────────────────────────────────────────────────────────
# Script bir git reposunun içinden çalıştırılıyorsa (ör. /opt/mailtrustai/app)
# APP_DIR otomatik olarak o reponun köküne ayarlanır; aksi halde varsayılan kullanılır.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_GIT_ROOT="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
APP_DIR="${_GIT_ROOT:-/opt/mailtrustai}"
readonly APP_DIR
readonly REPO_URL="https://github.com/kbulent07/mailtrustai.git"
readonly REPO_BRANCH="main"
readonly APP_UID=1001
readonly APP_GID=1001
readonly HTTP_PORT=3000
readonly HTTPS_PORT=4443
readonly COMPOSE_FILE_DEFAULT="docker-compose.customer.yml"
readonly COMPOSE_FILE_HOST_NGINX="docker-compose.customer.host-nginx.yml"
readonly SERVICE_NAME="mailtrustai-customer"
readonly NGINX_SITE_NAME="mailtrustai-customer"

# Bu iki değişken host nginx tespitinden sonra doldurulur:
COMPOSE_FILE="$COMPOSE_FILE_DEFAULT"
USE_HOST_NGINX=false

# ── CLI parametreleri (opsiyonel SSL otomasyonu) ────────────────────────────
SSL_DOMAIN=""
SSL_EMAIL=""
SSL_AUTO=false   # --auto-ssl: domain & email verilmişse soru sormadan SSL kur
SSL_STAGING=false  # --ssl-staging: Let's Encrypt staging (test) kullan
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)      SSL_DOMAIN="$2"; shift 2 ;;
        --email)       SSL_EMAIL="$2";  shift 2 ;;
        --auto-ssl)    SSL_AUTO=true;   shift ;;
        --ssl-staging) SSL_STAGING=true; shift ;;
        -h|--help)
            sed -n '2,17p' "$0"
            cat <<'HELP'

CLI Parametreleri:
  --domain <ad>      SSL için domain (örn: mailtrustai.sirketiniz.com)
  --email  <adres>   Let's Encrypt için e-posta (yenileme uyarıları için)
  --auto-ssl         Domain & email verilmişse soru sormadan SSL kur
  --ssl-staging      Let's Encrypt'in test sunucusunu kullan (rate-limit testleri için)
HELP
            exit 0
            ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

# ── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — MÜŞTERİ Kurulum Scripti  (Ubuntu / Docker)   ║
║   (keygen ve bayi panelleri devre dışı)                      ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Ön kontroller ────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    log_error "Bu script root yetkisiyle çalıştırılmalıdır. Kullanım: sudo ./install_customer_ubuntu.sh"
    exit 1
fi

if [[ ! -f /etc/os-release ]]; then
    log_error "İşletim sistemi tespit edilemedi."
    exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
    log_warn "Bu script Ubuntu için yazılmıştır (tespit: ${ID:-bilinmiyor}). Devam ediliyor…"
fi
log_ok "Sistem: ${PRETTY_NAME:-Ubuntu}"

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
    amd64|arm64) log_ok "Mimari: $ARCH" ;;
    *) log_error "Desteklenmeyen mimari: $ARCH"; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive

# ── Adım 1: Sistem paketleri ─────────────────────────────────────────────────
log_step "[1/9] Sistem paketleri güncelleniyor"
apt-get update -qq
apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    git jq openssl ufw rsync \
    iproute2 python3
log_ok "Sistem paketleri kuruldu."

# ── Adım 2: Docker Engine ────────────────────────────────────────────────────
log_step "[2/9] Docker Engine kuruluyor"

for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    apt-get remove -y -qq "$pkg" 2>/dev/null || true
done

if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu \
$(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
    log_ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') kuruldu."
else
    log_ok "Docker zaten kurulu: $(docker --version)"
fi

systemctl enable --now docker
docker compose version >/dev/null 2>&1 \
    || { log_error "Docker Compose plugin bulunamadı."; exit 1; }
log_ok "Docker Compose: $(docker compose version --short)"

# ── Adım 3: Proje dizini ─────────────────────────────────────────────────────
log_step "[3/9] Proje dizini hazırlanıyor: $APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
    if [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
        log_warn "$APP_DIR boş değil — git klonu atlanıyor, mevcut dosyalar kullanılacak."
    else
        log_info "GitHub'dan klonlanıyor: $REPO_URL ($REPO_BRANCH)"
        mkdir -p "$APP_DIR"
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
    fi
else
    log_info "Mevcut depo güncelleniyor…"
    git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
fi

cd "$APP_DIR"

# Her iki compose dosyası da deponun içinde olmalı
for cf in "$COMPOSE_FILE_DEFAULT" "$COMPOSE_FILE_HOST_NGINX"; do
    if [[ ! -f "$cf" ]]; then
        log_error "$cf bulunamadı; depodaki güncel sürümü kullandığınızdan emin olun."
        exit 1
    fi
done
log_ok "Proje dosyaları hazır."

# ── Host nginx tespiti ──────────────────────────────────────────────────────
log_step "[3.1/9] Mevcut nginx servisi kontrol ediliyor"
HOST_NGINX_PRESENT=false
HOST_NGINX_ACTIVE=false

if command -v nginx >/dev/null 2>&1; then
    HOST_NGINX_PRESENT=true
    if systemctl is-active --quiet nginx 2>/dev/null; then
        HOST_NGINX_ACTIVE=true
        log_warn "Host üzerinde nginx servisi ÇALIŞIYOR — Docker nginx ile çakışmaması için"
        log_warn "host nginx'i reverse-proxy olarak kullanmanız önerilir."
    else
        log_info "nginx kurulu ama aktif değil."
    fi
else
    log_info "Host'ta nginx kurulu değil — Docker nginx kullanılacak."
fi

if $HOST_NGINX_PRESENT; then
    echo ""
    echo -e "${BOLD}Kurulum modu seçimi:${NC}"
    echo "  1) HOST nginx (önerilen) — Docker nginx kurulmaz, mevcut nginx reverse proxy yapar"
    echo "  2) DOCKER nginx          — Docker stack içine nginx eklenir, host nginx ile farklı portlarda çalışır"
    if $HOST_NGINX_ACTIVE; then
        echo "  Varsayılan: 1 (host nginx aktif)"
        DEFAULT_CHOICE=1
    else
        echo "  Varsayılan: 2 (host nginx pasif)"
        DEFAULT_CHOICE=2
    fi
    read -rp "Seçim [1/2, varsayılan ${DEFAULT_CHOICE}]: " mode_choice
    mode_choice="${mode_choice:-$DEFAULT_CHOICE}"

    case "$mode_choice" in
        1)
            USE_HOST_NGINX=true
            COMPOSE_FILE="$COMPOSE_FILE_HOST_NGINX"
            log_ok "Mod: HOST nginx — app yalnız 127.0.0.1:${HTTP_PORT}'a bağlanacak."
            ;;
        *)
            USE_HOST_NGINX=false
            COMPOSE_FILE="$COMPOSE_FILE_DEFAULT"
            log_ok "Mod: DOCKER nginx — port ${HTTP_PORT}/${HTTPS_PORT} dış IP'lere açılacak."
            ;;
    esac
else
    USE_HOST_NGINX=false
    COMPOSE_FILE="$COMPOSE_FILE_DEFAULT"
fi

# ── Adım 4: Dizin yapısı ─────────────────────────────────────────────────────
log_step "[4/9] Veri ve log dizinleri oluşturuluyor"
mkdir -p data logs nginx/certs nginx/webroot
chown -R "${APP_UID}:${APP_GID}" data logs
chmod 750 data logs
log_ok "Dizinler hazırlandı."

# ── Adım 5: .env oluşturma ───────────────────────────────────────────────────
log_step "[5/9] .env dosyası hazırlanıyor"

SETUP_TOKEN=""

if [[ -f .env ]]; then
    log_warn ".env zaten mevcut — mevcut değerler korunacak."
    SETUP_TOKEN="$(grep -E '^MSA_SETUP_TOKEN=' .env | head -n1 | cut -d= -f2- || true)"

    # MSA_CUSTOMER_ONLY mutlaka true olsun
    if grep -q '^MSA_CUSTOMER_ONLY=' .env; then
        sed -i 's|^MSA_CUSTOMER_ONLY=.*|MSA_CUSTOMER_ONLY=true|' .env
    else
        echo 'MSA_CUSTOMER_ONLY=true' >> .env
    fi
else
    [[ -f .env.example ]] || { log_error ".env.example bulunamadı."; exit 1; }

    ENC_PASSWORD="$(openssl rand -hex 32)"
    ENC_SALT="$(openssl rand -hex 16)"
    LICENSE_SECRET="$(openssl rand -hex 32)"
    ADMIN_TOKEN_SECRET="$(openssl rand -hex 32)"
    SETUP_TOKEN="$(openssl rand -hex 24)"

    cp .env.example .env
    sed -i "s|^MSA_ENC_PASSWORD=.*|MSA_ENC_PASSWORD=${ENC_PASSWORD}|"                   .env
    sed -i "s|^MSA_ENC_SALT=.*|MSA_ENC_SALT=${ENC_SALT}|"                               .env
    sed -i "s|^MSA_LICENSE_SECRET=.*|MSA_LICENSE_SECRET=${LICENSE_SECRET}|"             .env
    sed -i "s|^MSA_ADMIN_TOKEN_SECRET=.*|MSA_ADMIN_TOKEN_SECRET=${ADMIN_TOKEN_SECRET}|" .env
    sed -i "s|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=${SETUP_TOKEN}|"                      .env
    sed -i "s|^MSA_CUSTOMER_ONLY=.*|MSA_CUSTOMER_ONLY=true|"                            .env
    sed -i "s|^NODE_ENV=.*|NODE_ENV=production|"                                        .env

    chmod 600 .env
    chown root:root .env
    log_ok ".env oluşturuldu (MÜŞTERİ modu)."
    log_warn "ÖNEMLİ: MSA_LICENSE_SECRET değerini güvenli yedekleyin."
fi

# Eski sürümlerden kalan initial_creds.json varsa temizle
[[ -f data/initial_creds.json ]] && { rm -f data/initial_creds.json; log_info "Eski initial_creds.json silindi."; }

# ── Adım 6: UFW + (opsiyonel) host nginx site config ─────────────────────────
log_step "[6/9] Güvenlik duvarı ve nginx yapılandırması"
ufw allow OpenSSH                       >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null

if $USE_HOST_NGINX; then
    # Docker uygulaması yalnız loopback'te dinler; dışa 3000/4443 açma.
    # Host nginx zaten 80/443'ten dinliyor — UFW'da bu portların açık olduğunu varsayıyoruz.
    ufw allow 80/tcp  >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    log_ok "UFW kuralları: SSH, 80/tcp, 443/tcp (host nginx için)"
    log_info "Docker uygulama portu (${HTTP_PORT}) dışa AÇILMADI — loopback'te dinliyor."

    # Host nginx site config oluştur
    NGINX_SITE_FILE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
    if [[ ! -f "$NGINX_SITE_FILE" ]]; then
        log_info "Host nginx site konfigürasyonu yazılıyor: $NGINX_SITE_FILE"
        cat > "$NGINX_SITE_FILE" <<NGINX_CONF
# ============================================================
# MailTrustAI — Host nginx reverse proxy (otomatik oluşturuldu)
# Bu dosya install_customer_ubuntu.sh tarafından yazıldı.
# Alan adınızı kullanmak için 'server_name _' satırını değiştirin.
# ============================================================

# HTTP (Let's Encrypt sonrasında 443'e yönlendirilebilir)
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Let's Encrypt ACME-challenge için
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass         http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           \$http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass         http://127.0.0.1:${HTTP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout    120s;
        proxy_read_timeout    120s;
        client_max_body_size  60M;
    }
}

# HTTPS (SSL sertifikası kurduktan sonra yorumdan çıkarın)
# server {
#     listen 443 ssl;
#     listen [::]:443 ssl;
#     http2 on;
#     server_name your.domain.com;
#
#     ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;
#     ssl_protocols       TLSv1.2 TLSv1.3;
#     ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
#     ssl_prefer_server_ciphers off;
#
#     add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
#     add_header X-Frame-Options           SAMEORIGIN always;
#     add_header X-Content-Type-Options    nosniff   always;
#
#     client_max_body_size 60M;
#
#     location /ws {
#         proxy_pass         http://127.0.0.1:${HTTP_PORT};
#         proxy_http_version 1.1;
#         proxy_set_header   Upgrade    \$http_upgrade;
#         proxy_set_header   Connection "upgrade";
#         proxy_set_header   Host       \$host;
#         proxy_set_header   X-Real-IP  \$remote_addr;
#         proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
#         proxy_set_header   X-Forwarded-Proto \$scheme;
#         proxy_read_timeout 86400s;
#     }
#
#     location / {
#         proxy_pass         http://127.0.0.1:${HTTP_PORT};
#         proxy_http_version 1.1;
#         proxy_set_header   Host              \$host;
#         proxy_set_header   X-Real-IP         \$remote_addr;
#         proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
#         proxy_set_header   X-Forwarded-Proto \$scheme;
#     }
# }
NGINX_CONF
        log_ok "Host nginx site yazıldı: $NGINX_SITE_FILE"
    else
        log_info "Mevcut site konfigürasyonu korundu: $NGINX_SITE_FILE"
    fi

    # Site'ı etkinleştir
    ln -sf "$NGINX_SITE_FILE" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

    # Nginx'i test et ve reload et
    if nginx -t >/dev/null 2>&1; then
        if $HOST_NGINX_ACTIVE; then
            systemctl reload nginx
            log_ok "Host nginx reload edildi."
        else
            systemctl enable --now nginx >/dev/null 2>&1 || true
            log_ok "Host nginx başlatıldı."
        fi
    else
        log_warn "nginx -t başarısız! Lütfen elle düzeltin:"
        log_warn "  sudo nginx -t  (hatayı görmek için)"
    fi
else
    ufw allow "${HTTP_PORT}/tcp"            >/dev/null
    ufw allow "${HTTPS_PORT}/tcp"           >/dev/null
    log_ok "UFW kuralları: SSH, ${HTTP_PORT}/tcp, ${HTTPS_PORT}/tcp"
fi

log_info "UFW kapalı kalacak — etkinleştirmek için: sudo ufw enable"

# ── Adım 7: systemd servisi ──────────────────────────────────────────────────
log_step "[7/9] systemd servisi oluşturuluyor"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=MailTrustAI Customer Docker Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose -f ${COMPOSE_FILE} up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f ${COMPOSE_FILE} down
ExecReload=/usr/bin/docker compose -f ${COMPOSE_FILE} restart
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service" >/dev/null
log_ok "systemd servisi etkin: ${SERVICE_NAME}.service"

# ── Adım 8: Docker imajını derle + çalıştır ──────────────────────────────────
log_step "[8/9] Docker imajı derleniyor ve başlatılıyor"
log_info "Ilk derleme birkac dakika surebilir (native npm build)…"
docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
log_ok "Konteyner çalışıyor."

# ── Adım 9: Sağlık kontrolü ──────────────────────────────────────────────────
log_step "[9/9] Sağlık kontrolü"
HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/api/health"
for i in $(seq 1 30); do
    HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "$HEALTH_URL" 2>/dev/null || echo "000")"
    if [[ "$HTTP_CODE" == "200" ]]; then
        log_ok "Sağlık kontrolü BAŞARILI — uygulama hazır."
        break
    fi
    sleep 2
    if [[ $i -eq 30 ]]; then
        log_warn "Sağlık kontrolü zaman aşımı (HTTP $HTTP_CODE)."
        log_warn "Loglar: cd $APP_DIR && docker compose -f $COMPOSE_FILE logs --tail=80"
    fi
done

# ── (Opsiyonel) SSL kurulumu ────────────────────────────────────────────────
# --domain ve --email verilmişse otomatik kur; verilmemişse interaktif sor.
if [[ -n "$SSL_DOMAIN" && -n "$SSL_EMAIL" ]]; then
    if $SSL_AUTO; then
        setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || log_warn "SSL kurulumu başarısız oldu."
    else
        echo ""
        read -rp "SSL sertifikası şimdi alınsın mı? (domain=$SSL_DOMAIN) [E/h]: " ssl_choice
        [[ ! "$ssl_choice" =~ ^[Hh]$ ]] && {
            setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || log_warn "SSL kurulumu başarısız oldu."
        }
    fi
elif [[ -t 0 ]] && ! $SSL_AUTO; then
    echo ""
    log_step "SSL Sertifikası (Let's Encrypt)"
    read -rp "Şimdi otomatik SSL sertifikası alınsın mı? [e/H]: " want_ssl
    if [[ "$want_ssl" =~ ^[Ee]$ ]]; then
        read -rp "  Domain (örn: mailtrustai.sirketiniz.com): " SSL_DOMAIN
        read -rp "  E-posta (yenileme uyarıları için):       " SSL_EMAIL
        if [[ -n "$SSL_DOMAIN" && -n "$SSL_EMAIL" ]]; then
            setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || log_warn "SSL kurulumu başarısız oldu."
        else
            log_warn "Domain veya e-posta boş — SSL atlandı."
        fi
    else
        log_info "SSL atlandı. Daha sonra için: sudo certbot --nginx -d <domain>"
    fi
fi

# Verify customer-mode is active
KEYGEN_CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${HTTP_PORT}/keygen.html" 2>/dev/null || echo "000")"
if [[ "$KEYGEN_CODE" == "404" ]]; then
    log_ok "MÜŞTERİ modu doğrulandı: /keygen.html → 404"
else
    log_warn "MÜŞTERİ modu beklenen şekilde çalışmıyor — /keygen.html → $KEYGEN_CODE (404 olmalıydı)"
fi

# ── Özet ─────────────────────────────────────────────────────────────────────
IP="$(hostname -I | awk '{print $1}')"

echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          Müşteri Kurulumu Başarıyla Tamamlandı!              ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

if $USE_HOST_NGINX; then
    PUBLIC_PORT_LABEL="80"
    PUBLIC_URL="http://${IP}/"
    SETUP_URL="http://${IP}/?setup_token=${SETUP_TOKEN}"
    echo -e "${BOLD}Çalışma Modu:${NC} HOST nginx (reverse proxy)"
    echo -e "${BOLD}Erişim Adresleri:${NC}"
    echo "  Müşteri Yönetimi : ${PUBLIC_URL}"
    echo "  HTTPS            : SSL sertifikası sonrası nginx config'inin HTTPS server bloğunu yorum'dan çıkarın"
    echo "  Loopback (debug) : http://127.0.0.1:${HTTP_PORT}/"
else
    PUBLIC_PORT_LABEL="${HTTP_PORT}"
    PUBLIC_URL="http://${IP}:${HTTP_PORT}/"
    SETUP_URL="http://${IP}:${HTTP_PORT}/?setup_token=${SETUP_TOKEN}"
    echo -e "${BOLD}Çalışma Modu:${NC} Docker nginx"
    echo -e "${BOLD}Erişim Adresleri:${NC}"
    echo "  Müşteri Yönetimi : ${PUBLIC_URL}"
    echo "  HTTPS            : https://${IP}:${HTTPS_PORT}/  (SSL kurulduktan sonra)"
fi

echo ""
echo -e "${BOLD}KAPALI panel/uç noktalar (404):${NC}"
echo "  /keygen.html          (lisans üretici)"
echo "  /bayi.html            (bayi portalı)"
echo "  /api/dealer/*         (bayi API)"
echo "  /api/license/generate, /trial, /revoke, /unrevoke, /batch …"

if [[ -n "$SETUP_TOKEN" ]]; then
    echo ""
    echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${YELLOW}║          İLK KURULUM — UZAKTAN ŞİFRE BELİRLEME              ║${NC}"
    echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Aşağıdaki URL'ye tarayıcıdan bağlanıp müşteri yönetim şifresini"
    echo "  KENDİNİZ belirleyin:"
    echo ""
    echo -e "  ${GREEN}${SETUP_URL}${NC}"
    echo ""
    echo -e "  Setup Token: ${SETUP_TOKEN}"
    echo ""
    echo "  Şifre belirlendikten sonra:"
    echo "    1) ${APP_DIR}/.env içindeki MSA_SETUP_TOKEN satırını boşaltın"
    echo "    2) sudo systemctl reload ${SERVICE_NAME}"
fi

echo ""
echo -e "${BOLD}Yönetim Komutları:${NC}"
echo "  Durum   : sudo systemctl status ${SERVICE_NAME}"
echo "  Loglar  : cd ${APP_DIR} && docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Yenile  : sudo systemctl reload ${SERVICE_NAME}"
echo "  Durdur  : sudo systemctl stop ${SERVICE_NAME}"

echo ""
echo -e "${BOLD}Önemli Dosyalar:${NC}"
echo "  Uygulama : ${APP_DIR}"
echo "  .env     : ${APP_DIR}/.env  (chmod 600)"
if $USE_HOST_NGINX; then
    echo "  Nginx    : /etc/nginx/sites-available/${NGINX_SITE_NAME}  (HOST nginx)"
    echo ""
    echo -e "${BOLD}HOST nginx ile çalışıyor:${NC}"
    echo "  - Docker app yalnız 127.0.0.1:${HTTP_PORT}'a bağlı; dışarıdan doğrudan erişilemez"
    echo "  - Domain için: sudo nano /etc/nginx/sites-available/${NGINX_SITE_NAME}"
    echo "    server_name _; satırını domain adınıza değiştirin → sudo systemctl reload nginx"
    echo "  - SSL için: sudo certbot --nginx -d your.domain.com"
else
    echo "  Nginx    : ${APP_DIR}/nginx/nginx.conf  (DOCKER nginx)"
    echo "  SSL      : ${APP_DIR}/nginx/certs/"
fi
echo ""
