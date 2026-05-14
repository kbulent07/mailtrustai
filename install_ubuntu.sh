#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu Otomatik Docker Kurulum Scripti
#  Sürüm   : 2.0  (2026-05)
#  Hedef OS: Ubuntu 22.04 / 24.04 LTS  (x86_64 / arm64)
#
#  Ne yapar?
#    1. Sistem paketlerini günceller (curl, ca-certificates, jq, openssl, ufw…)
#    2. Docker Engine + Compose plugin'ini resmî apt deposundan kurar
#    3. /opt/mailtrustai dizinine projeyi klonlar (varsa pull eder)
#    4. .env dosyasını güçlü rastgele anahtarlarla oluşturur
#    5. data/ ve logs/ dizinlerini doğru sahiplik (UID 1001) ile hazırlar
#    6. data/initial_creds.json üretir (ilk girişten sonra otomatik silinir)
#    7. UFW kurallarını ekler (3000/4443 + SSH)
#    8. systemd servisini etkinleştirir (mailtrustai.service)
#    9. Docker imajını derler ve servisi başlatır
#   10. Sağlık kontrolü yapar
#
#  Kullanım:
#     chmod +x install_ubuntu.sh
#     sudo ./install_ubuntu.sh
# ==============================================================================

set -euo pipefail

# ── Renkler ───────────────────────────────────────────────────────────────────
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
setup_ssl_host_nginx() {
    local domain="$1" email="$2" staging="$3"
    log_step "Let's Encrypt SSL kurulumu (HOST nginx)"
    apt-get install -y -qq certbot python3-certbot-nginx

    local extra_args=()
    [[ "$staging" == "true" ]] && extra_args+=(--staging)

    log_info "Sertifika alınıyor: $domain"
    if certbot --nginx \
        --non-interactive --agree-tos --redirect \
        --domain "$domain" --email "$email" \
        "${extra_args[@]}" 2>&1 | tail -8; then
        log_ok "SSL sertifikası alındı ve nginx config güncellendi."
    else
        log_warn "certbot --nginx başarısız. Manuel: sudo certbot --nginx -d $domain"
        return 1
    fi

    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "Otomatik yenileme aktif (certbot.timer)."
}

setup_ssl_docker_nginx() {
    local domain="$1" email="$2" staging="$3"
    log_step "Let's Encrypt SSL kurulumu (DOCKER nginx)"
    apt-get install -y -qq certbot

    mkdir -p "$APP_DIR/nginx/certs"

    local extra_args=()
    [[ "$staging" == "true" ]] && extra_args+=(--staging)

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

    log_ok "Sertifika alındı: /etc/letsencrypt/live/$domain/"
    cp -L "/etc/letsencrypt/live/$domain/fullchain.pem" "$APP_DIR/nginx/certs/"
    cp -L "/etc/letsencrypt/live/$domain/privkey.pem"   "$APP_DIR/nginx/certs/"
    chmod 644 "$APP_DIR/nginx/certs/fullchain.pem"
    chmod 640 "$APP_DIR/nginx/certs/privkey.pem"

    # nginx.conf'taki HTTPS bloğunun yorumunu kaldır + domain ikamesi
    local conf="$APP_DIR/nginx/nginx.conf"
    if grep -q "# HTTPS Sunucusu" "$conf"; then
        python3 - <<PYEOF
import re
p = "$conf"
src = open(p, encoding='utf-8').read()
start = src.find("# ── HTTPS Sunucusu")
if start != -1:
    lines = src[start:].split("\n")
    out = []
    in_block = False
    depth = 0
    for ln in lines:
        if not in_block:
            if "server {" in ln and ln.lstrip().startswith("#"):
                in_block = True; depth = 1
                out.append(re.sub(r"^(\s*)#\s?", r"\1", ln)); continue
            out.append(ln)
        else:
            new = re.sub(r"^(\s*)#\s?", r"\1", ln)
            depth += new.count("{") - new.count("}")
            out.append(new)
            if depth <= 0: in_block = False
    src = src[:start] + "\n".join(out)
src = src.replace("server_name _;", "server_name $domain;", 2)
open(p, 'w', encoding='utf-8').write(src)
PYEOF
        log_ok "nginx.conf HTTPS için güncellendi."
    fi

    # Deploy hook
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    cat > "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$APP_DIR"
COMPOSE_FILE="$COMPOSE_FILE"
TARGET_DOMAIN="$domain"
case " \${RENEWED_DOMAINS:-} " in
    *" \${TARGET_DOMAIN} "*) ;;
    *) exit 0 ;;
esac
cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/fullchain.pem" "\$APP_DIR/nginx/certs/fullchain.pem"
cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/privkey.pem"   "\$APP_DIR/nginx/certs/privkey.pem"
chmod 644 "\$APP_DIR/nginx/certs/fullchain.pem"
chmod 640 "\$APP_DIR/nginx/certs/privkey.pem"
if command -v docker >/dev/null 2>&1; then
    cd "\$APP_DIR"
    docker compose -f "\$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null || \\
        docker compose -f "\$COMPOSE_FILE" restart nginx
fi
logger -t mailtrustai-ssl "Sertifika yenilendi: \$TARGET_DOMAIN"
HOOK
    chmod +x "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh"
    log_ok "Yenileme hook'u: /etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh"

    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "Otomatik yenileme aktif (certbot.timer)."

    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null \
        || docker compose -f "$COMPOSE_FILE" restart nginx
    log_ok "Docker nginx reload — HTTPS aktif."
}

setup_ssl() {
    local domain="$1" email="$2"
    [[ -z "$domain" || -z "$email" ]] && { log_warn "SSL atlandı (domain/e-posta eksik)."; return 0; }
    if $USE_HOST_NGINX; then
        setup_ssl_host_nginx "$domain" "$email" "$SSL_STAGING"
    else
        setup_ssl_docker_nginx "$domain" "$email" "$SSL_STAGING"
    fi
}

# ── Sabitler ──────────────────────────────────────────────────────────────────
# Script bir git reposunun içinden çalıştırılıyorsa (ör. /opt/mailtrustai/app)
# APP_DIR otomatik olarak o reponun köküne ayarlanır; aksi halde varsayılan kullanılır.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_GIT_ROOT="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
APP_DIR="${_GIT_ROOT:-/opt/mailtrustai}"
readonly APP_DIR
readonly REPO_URL="https://github.com/kbulent07/mailtrustai.git"
readonly REPO_BRANCH="main"
readonly APP_UID=1001           # Dockerfile'da non-root mailtrustai UID
readonly APP_GID=1001
readonly HTTP_PORT=3000         # Dış HTTP portu (Nginx → app:3000)
readonly HTTPS_PORT=4443        # Dış HTTPS portu
readonly COMPOSE_FILE_DEFAULT="docker-compose.prod.yml"
readonly COMPOSE_FILE_HOST_NGINX="docker-compose.prod.host-nginx.yml"
readonly NGINX_SITE_NAME="mailtrustai"

# Host nginx tespiti sonucuna göre doldurulur:
COMPOSE_FILE="$COMPOSE_FILE_DEFAULT"
USE_HOST_NGINX=false

# ── CLI parametreleri (SSL otomasyonu) ───────────────────────────────────────
SSL_DOMAIN=""
SSL_EMAIL=""
SSL_AUTO=false
SSL_STAGING=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)      SSL_DOMAIN="$2"; shift 2 ;;
        --email)       SSL_EMAIL="$2";  shift 2 ;;
        --auto-ssl)    SSL_AUTO=true;   shift ;;
        --ssl-staging) SSL_STAGING=true; shift ;;
        -h|--help)
            cat <<'HELP'
Kullanım: sudo ./install_ubuntu.sh [seçenekler]

Seçenekler:
  --domain <ad>      SSL için domain (örn: mailtrustai.sirketiniz.com)
  --email  <adres>   Let's Encrypt için e-posta
  --auto-ssl         Sorma, otomatik SSL kur (domain+email verilmişse)
  --ssl-staging      Let's Encrypt test sunucusu (rate-limit testleri için)
HELP
            exit 0
            ;;
        *) log_warn "Bilinmeyen argüman: $1"; shift ;;
    esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║       MailTrustAI — Ubuntu Docker Kurulum Scripti v2.0       ║
║       AI Destekli E-Posta Güvenlik Platformu                 ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Ön kontroller ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    log_error "Bu script root yetkisiyle çalıştırılmalıdır. Kullanım: sudo ./install_ubuntu.sh"
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

# Mimari kontrolü (Docker Compose plugin desteği için)
ARCH="$(dpkg --print-architecture)"
case "$ARCH" in
    amd64|arm64) log_ok "Mimari: $ARCH" ;;
    *) log_error "Desteklenmeyen mimari: $ARCH (yalnız amd64/arm64)"; exit 1 ;;
esac

# Non-interactive apt
export DEBIAN_FRONTEND=noninteractive

# ── Adım 1: Sistem paketleri ──────────────────────────────────────────────────
log_step "[1/9] Sistem paketleri güncelleniyor"
apt-get update -qq
apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    git jq openssl ufw rsync \
    iproute2 python3
log_ok "Sistem paketleri kuruldu."

# ── Adım 2: Docker Engine + Compose plugin ────────────────────────────────────
log_step "[2/9] Docker Engine kuruluyor"

# Eski sürümleri kaldır (varsa)
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
log_ok "Docker servisi aktif."

# Docker Compose v2 kontrolü
if ! docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose plugin bulunamadı."
    exit 1
fi
log_ok "Docker Compose: $(docker compose version --short)"

# ── Adım 3: Proje dizini ──────────────────────────────────────────────────────
log_step "[3/9] Proje dizini hazırlanıyor: $APP_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
    if [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
        log_warn "$APP_DIR mevcut ve boş değil — git klonu atlanacak, mevcut dosyalar kullanılacak."
    else
        log_info "GitHub'dan klonlanıyor: $REPO_URL ($REPO_BRANCH)"
        mkdir -p "$APP_DIR"
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
    fi
else
    log_info "Mevcut depo güncelleniyor (git pull)…"
    git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
fi

cd "$APP_DIR"

# Her iki compose dosyası da deponun içinde olmalı
for cf in "$COMPOSE_FILE_DEFAULT" "$COMPOSE_FILE_HOST_NGINX"; do
    [[ -f "$cf" ]] || { log_error "$cf bulunamadı; depodaki güncel sürümü kullandığınızdan emin olun."; exit 1; }
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
    echo "  2) DOCKER nginx          — Docker stack içine nginx eklenir (farklı portlarda)"
    if $HOST_NGINX_ACTIVE; then
        DEFAULT_CHOICE=1
    else
        DEFAULT_CHOICE=2
    fi
    echo "  Varsayılan: ${DEFAULT_CHOICE}"
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
fi

# ── Adım 4: Dizin yapısı + izinler ────────────────────────────────────────────
log_step "[4/9] Veri ve log dizinleri oluşturuluyor"

mkdir -p data logs nginx/certs nginx/webroot

# Konteynerdeki mailtrustai (UID 1001) kullanıcısı için sahiplik
chown -R "${APP_UID}:${APP_GID}" data logs
chmod 750 data logs
log_ok "Dizinler hazırlandı (sahip: ${APP_UID}:${APP_GID})."

# ── Adım 5: .env oluşturma ────────────────────────────────────────────────────
log_step "[5/9] .env dosyası hazırlanıyor"

SETUP_TOKEN=""   # show_summary'de kullanmak için dış kapsama taşı

if [[ -f .env ]]; then
    log_warn ".env zaten mevcut — mevcut değerler korunacak."
    # Mevcut .env'den setup token'ı oku (zaten varsa kullanıcıya tekrar göster)
    SETUP_TOKEN="$(grep -E '^MSA_SETUP_TOKEN=' .env | head -n1 | cut -d= -f2- || true)"
else
    if [[ ! -f .env.example ]]; then
        log_error ".env.example bulunamadı; depo bozuk olabilir."
        exit 1
    fi

    ENC_PASSWORD="$(openssl rand -hex 32)"
    ENC_SALT="$(openssl rand -hex 16)"
    LICENSE_SECRET="$(openssl rand -hex 32)"
    ADMIN_TOKEN_SECRET="$(openssl rand -hex 32)"
    SETUP_TOKEN="$(openssl rand -hex 24)"

    cp .env.example .env

    # macOS/Linux uyumlu sed; örnekteki anahtarları üretilen değerlerle değiştir
    sed -i "s|^MSA_ENC_PASSWORD=.*|MSA_ENC_PASSWORD=${ENC_PASSWORD}|"                   .env
    sed -i "s|^MSA_ENC_SALT=.*|MSA_ENC_SALT=${ENC_SALT}|"                               .env
    sed -i "s|^MSA_LICENSE_SECRET=.*|MSA_LICENSE_SECRET=${LICENSE_SECRET}|"             .env
    sed -i "s|^MSA_ADMIN_TOKEN_SECRET=.*|MSA_ADMIN_TOKEN_SECRET=${ADMIN_TOKEN_SECRET}|" .env
    sed -i "s|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=${SETUP_TOKEN}|"                      .env
    sed -i "s|^NODE_ENV=.*|NODE_ENV=production|"                                        .env

    chmod 600 .env
    chown root:root .env
    log_ok ".env oluşturuldu ve güvenli anahtarlar yerleştirildi."
    log_warn "ÖNEMLİ: MSA_LICENSE_SECRET değerini güvenli bir yere yedekleyin —"
    log_warn "        yeniden kurulumda aynı değer kullanılmazsa kayıtlı şifrelenmiş"
    log_warn "        ayarlar (API key/SMTP) geri okunamaz."
fi

# Eski sürümlerden kalan initial_creds.json varsa temizle —
# artık uzaktan-erişilebilir web-tabanlı setup token akışı kullanıyoruz.
if [[ -f data/initial_creds.json ]]; then
    log_info "Eski data/initial_creds.json siliniyor (yeni setup-token akışına geçildi)."
    rm -f data/initial_creds.json
fi

# ── Adım 6: UFW + (opsiyonel) host nginx site config ─────────────────────────
log_step "[6/9] Güvenlik duvarı ve nginx yapılandırması"

ufw allow OpenSSH                       >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null

if $USE_HOST_NGINX; then
    ufw allow 80/tcp  >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    log_ok "UFW kuralları: SSH, 80/tcp, 443/tcp (host nginx için)"
    log_info "Docker uygulama portu (${HTTP_PORT}) dışa AÇILMADI — yalnız loopback'te."

    NGINX_SITE_FILE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
    if [[ ! -f "$NGINX_SITE_FILE" ]]; then
        log_info "Host nginx site konfigürasyonu yazılıyor: $NGINX_SITE_FILE"
        cat > "$NGINX_SITE_FILE" <<NGINX_CONF
# ============================================================
# MailTrustAI — Host nginx reverse proxy (otomatik oluşturuldu)
# Bu dosya install_ubuntu.sh tarafından yazıldı.
# Alan adınız için 'server_name _' satırını değiştirin.
# ============================================================

server {
    listen 80;
    listen [::]:80;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

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

# HTTPS (SSL kurulduktan sonra yorum'dan çıkarın)
# server {
#     listen 443 ssl;
#     listen [::]:443 ssl;
#     http2 on;
#     server_name your.domain.com;
#     ssl_certificate     /etc/letsencrypt/live/your.domain.com/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/your.domain.com/privkey.pem;
#     ssl_protocols       TLSv1.2 TLSv1.3;
#     ssl_prefer_server_ciphers off;
#     add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
#     client_max_body_size 60M;
#     location /ws {
#         proxy_pass         http://127.0.0.1:${HTTP_PORT};
#         proxy_http_version 1.1;
#         proxy_set_header   Upgrade    \$http_upgrade;
#         proxy_set_header   Connection "upgrade";
#         proxy_set_header   Host       \$host;
#         proxy_set_header   X-Real-IP  \$remote_addr;
#         proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
#         proxy_set_header   X-Forwarded-Proto \$scheme;
#         proxy_read_timeout 86400s;
#     }
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

    ln -sf "$NGINX_SITE_FILE" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

    if nginx -t >/dev/null 2>&1; then
        if $HOST_NGINX_ACTIVE; then
            systemctl reload nginx
            log_ok "Host nginx reload edildi."
        else
            systemctl enable --now nginx >/dev/null 2>&1 || true
            log_ok "Host nginx başlatıldı."
        fi
    else
        log_warn "nginx -t başarısız! Lütfen elle düzeltin: sudo nginx -t"
    fi
else
    ufw allow "${HTTP_PORT}/tcp"            >/dev/null
    ufw allow "${HTTPS_PORT}/tcp"           >/dev/null
    log_ok "UFW kuralları eklendi: SSH, ${HTTP_PORT}/tcp, ${HTTPS_PORT}/tcp"
fi

log_info "UFW şu an kapalı kalacak — etkinleştirmek için:  sudo ufw enable"

# ── Adım 7: systemd servisi ───────────────────────────────────────────────────
log_step "[7/9] systemd servisi oluşturuluyor"

cat > /etc/systemd/system/mailtrustai.service <<UNIT
[Unit]
Description=MailTrustAI Docker Stack
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
systemctl enable mailtrustai.service >/dev/null
log_ok "systemd servisi etkinleştirildi: mailtrustai.service"

# ── Adım 8: Docker imajını derle + çalıştır ───────────────────────────────────
log_step "[8/9] Docker imajı derleniyor ve servis başlatılıyor"
log_info "İlk derleme birkaç dakika sürebilir (better-sqlite3 native derlemesi)…"

docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log_ok "Konteyner çalışıyor."

# ── Adım 9: Sağlık kontrolü ───────────────────────────────────────────────────
log_step "[9/9] Sağlık kontrolü"

log_info "Uygulamanın hazır olması bekleniyor…"
HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/api/health"
for i in $(seq 1 30); do
    HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "$HEALTH_URL" 2>/dev/null || echo "000")"
    if [[ "$HTTP_CODE" == "200" ]]; then
        log_ok "Sağlık kontrolü BAŞARILI (HTTP 200) — uygulama hazır."
        break
    fi
    sleep 2
    if [[ $i -eq 30 ]]; then
        log_warn "Sağlık kontrolü zaman aşımına uğradı (HTTP $HTTP_CODE)."
        log_warn "Logları incelemek için:"
        log_warn "  cd $APP_DIR && docker compose -f $COMPOSE_FILE logs --tail=80"
    fi
done

# ── (Opsiyonel) SSL kurulumu ────────────────────────────────────────────────
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

# ── Özet ──────────────────────────────────────────────────────────────────────
IP="$(hostname -I | awk '{print $1}')"

echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          Kurulum Başarıyla Tamamlandı!                       ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

if $USE_HOST_NGINX; then
    BASE_URL="http://${IP}"
    echo -e "${BOLD}Çalışma Modu:${NC} HOST nginx (reverse proxy)"
    echo -e "${BOLD}Erişim Adresleri:${NC}"
    echo "  Web Arayüzü     : ${BASE_URL}/"
    echo "  Admin / Keygen  : ${BASE_URL}/keygen.html"
    echo "  Bayi Portalı    : ${BASE_URL}/bayi.html"
    echo "  HTTPS           : SSL sertifikası kurduktan sonra (certbot --nginx -d <domain>)"
    echo "  Loopback (debug): http://127.0.0.1:${HTTP_PORT}/"
else
    BASE_URL="http://${IP}:${HTTP_PORT}"
    echo -e "${BOLD}Çalışma Modu:${NC} Docker nginx"
    echo -e "${BOLD}Erişim Adresleri:${NC}"
    echo "  Web Arayüzü     : ${BASE_URL}/"
    echo "  Admin / Keygen  : ${BASE_URL}/keygen.html"
    echo "  Bayi Portalı    : ${BASE_URL}/bayi.html"
    echo "  HTTPS (SSL kurulduktan sonra): https://${IP}:${HTTPS_PORT}/"
fi

if [[ -n "$SETUP_TOKEN" ]]; then
    echo ""
    echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${YELLOW}║          İLK KURULUM — UZAKTAN ŞİFRE BELİRLEME              ║${NC}"
    echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Aşağıdaki URL'lere herhangi bir tarayıcıdan bağlanarak"
    echo "  admin ve müşteri yönetim şifrelerini KENDİNİZ belirleyin:"
    echo ""
    echo -e "  ${BOLD}Admin Paneli:${NC}"
    echo -e "    ${GREEN}${BASE_URL}/keygen.html?setup_token=${SETUP_TOKEN}${NC}"
    echo ""
    echo -e "  ${BOLD}Müşteri Yönetimi:${NC}"
    echo -e "    ${GREEN}${BASE_URL}/?setup_token=${SETUP_TOKEN}${NC}"
    echo ""
    echo -e "  ${YELLOW}Setup Token:${NC} ${SETUP_TOKEN}"
    echo ""
    echo "  Her iki şifre belirlendikten sonra güvenlik için:"
    echo "    1) /opt/mailtrustai/.env içindeki MSA_SETUP_TOKEN satırını boşaltın"
    echo "    2) sudo systemctl reload mailtrustai"
fi

echo ""
echo -e "${BOLD}Yönetim Komutları:${NC}"
echo "  Durum    : sudo systemctl status mailtrustai"
echo "  Loglar   : cd ${APP_DIR} && docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Yenile   : sudo systemctl reload mailtrustai"
echo "  Durdur   : sudo systemctl stop mailtrustai"
echo "  Başlat   : sudo systemctl start mailtrustai"

echo ""
echo -e "${BOLD}Önemli Dosyalar:${NC}"
echo "  Uygulama       : ${APP_DIR}"
echo "  .env           : ${APP_DIR}/.env  (chmod 600)"
if $USE_HOST_NGINX; then
    echo "  Nginx config   : /etc/nginx/sites-available/${NGINX_SITE_NAME}  (HOST nginx)"
    echo "  SSL            : Let's Encrypt için: sudo certbot --nginx -d <your.domain.com>"
else
    echo "  Nginx config   : ${APP_DIR}/nginx/nginx.conf  (DOCKER nginx)"
    echo "  SSL sertif.    : ${APP_DIR}/nginx/certs/"
fi
echo "  Veri (volume)  : docker volume mailtrustai_data"
echo "  Loglar (volume): docker volume mailtrustai_logs"


cat <<'NEXT'

──────────────────────────────────────────────────────────────────
SONRAKİ ADIMLAR (opsiyonel):

1. Alan adı ile yayına almak için:
   sudo nano /opt/mailtrustai/nginx/nginx.conf
   (server_name _ → server_name mailtrustai.sirketiniz.com)
   sudo systemctl reload mailtrustai

2. Let's Encrypt SSL almak için (certbot standalone):
   sudo apt-get install -y certbot
   sudo systemctl stop mailtrustai
   sudo certbot certonly --standalone -d mailtrustai.sirketiniz.com
   sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/fullchain.pem \
           /opt/mailtrustai/nginx/certs/
   sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/privkey.pem \
           /opt/mailtrustai/nginx/certs/
   # nginx.conf içindeki HTTPS server bloğunun yorumunu kaldırın
   sudo systemctl start mailtrustai

3. UFW'yi aktif etmek için (SSH'a hâlâ izin verdiğinden emin olun):
   sudo ufw enable

──────────────────────────────────────────────────────────────────
NEXT
