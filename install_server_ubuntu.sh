#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu Sunucu TAM KURULUM Scripti (Docker)
#  Sürüm   : 1.0  (2026-05)
#  Hedef OS: Ubuntu 22.04 / 24.04 LTS  (x86_64 / arm64)
#
#  Bu script TÜM panelleri ve özellikleri etkin şekilde kurar:
#    ✓ Müşteri arayüzü      → /
#    ✓ Admin / Keygen paneli → /keygen.html  (lisans üretimi)
#    ✓ Bayi portalı         → /bayi.html
#    ✓ IMAP izleme + AI analiz + tehdit istihbaratı
#    ✓ Otomatik SSL yenileme (opsiyonel, --domain ile)
#    ✓ Host nginx tespiti — varsa Docker nginx çakışmasını önler
#
#  Kullanım:
#     chmod +x install_server_ubuntu.sh
#     sudo ./install_server_ubuntu.sh
#
#  Domain + SSL ile non-interactive:
#     sudo ./install_server_ubuntu.sh --domain mail.sirket.com --email admin@sirket.com --auto-ssl
# ==============================================================================

set -euo pipefail

# ── Renkler ──────────────────────────────────────────────────────────────────
readonly RED='\033[0;31m'    GREEN='\033[0;32m'    YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'   CYAN='\033[0;36m'     BOLD='\033[1m'   NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_error() { echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step()  { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

trap 'log_error "Satır $LINENO: hata. Kurulum durduruldu."; exit 1' ERR

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
readonly COMPOSE_DOCKER_NGINX="docker-compose.prod.yml"
readonly COMPOSE_HOST_NGINX="docker-compose.prod.host-nginx.yml"
readonly SERVICE_NAME="mailtrustai"
readonly NGINX_SITE_NAME="mailtrustai"

# Çalışma zamanı değişkenleri
COMPOSE_FILE="$COMPOSE_DOCKER_NGINX"
USE_HOST_NGINX=false
SSL_DOMAIN=""
SSL_EMAIL=""
SSL_AUTO=false
SSL_STAGING=false

# ── CLI parametreleri ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)       SSL_DOMAIN="$2"; shift 2 ;;
        --email)        SSL_EMAIL="$2";  shift 2 ;;
        --auto-ssl)     SSL_AUTO=true;   shift ;;
        --ssl-staging)  SSL_STAGING=true; shift ;;
        --host-nginx)   USE_HOST_NGINX=true; shift ;;
        --docker-nginx) USE_HOST_NGINX=false; shift ;;
        -h|--help)
            cat <<HELP
Kullanım: sudo ./install_server_ubuntu.sh [SEÇENEKLER]

Tüm panellerle (admin/keygen + bayi + müşteri) tam sunucu kurulumu.

SEÇENEKLER:
  --domain <ad>      SSL için domain    (örn: mail.sirket.com)
  --email <adres>    Let's Encrypt için e-posta
  --auto-ssl         Sorma, otomatik SSL kur (--domain + --email gerekli)
  --ssl-staging      Let's Encrypt test sunucusu (rate-limit testleri için)
  --host-nginx       Host'taki nginx'i reverse proxy olarak kullan
  --docker-nginx     Docker nginx kullan (varsayılan, host nginx yoksa)
  -h, --help         Bu yardımı göster

ÖRNEKLER:
  sudo ./install_server_ubuntu.sh
  sudo ./install_server_ubuntu.sh --domain mail.sirket.com --email admin@sirket.com --auto-ssl
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
║   MailTrustAI — Ubuntu TAM Kurulum  (Docker, tüm paneller)   ║
║   AI Destekli E-Posta Güvenlik Platformu                     ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Ön kontroller ────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || { log_error "Root yetkisi gerekli: sudo ./install_server_ubuntu.sh"; exit 1; }
[[ -f /etc/os-release ]] || { log_error "İşletim sistemi tespit edilemedi."; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || log_warn "Ubuntu için yazılmıştır (tespit: ${ID:-bilinmiyor}); devam ediliyor…"
log_ok "Sistem: ${PRETTY_NAME:-Ubuntu}"

ARCH="$(dpkg --print-architecture)"
case "$ARCH" in amd64|arm64) log_ok "Mimari: $ARCH" ;; *) log_error "Desteklenmeyen mimari: $ARCH"; exit 1 ;; esac

export DEBIAN_FRONTEND=noninteractive

# ── SSL otomasyon fonksiyonları ──────────────────────────────────────────────
setup_ssl_host_nginx() {
    local domain="$1" email="$2"
    log_step "Let's Encrypt SSL (HOST nginx + auto-renewal)"
    apt-get install -y -qq certbot python3-certbot-nginx
    local extra=(); $SSL_STAGING && extra+=(--staging)
    certbot --nginx --non-interactive --agree-tos --redirect \
        --domain "$domain" --email "$email" "${extra[@]}" 2>&1 | tail -5
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "SSL kuruldu. Otomatik yenileme: certbot.timer (sudo systemctl status certbot.timer)"
}

setup_ssl_docker_nginx() {
    local domain="$1" email="$2"
    log_step "Let's Encrypt SSL (DOCKER nginx + auto-renewal)"
    apt-get install -y -qq certbot
    mkdir -p "$APP_DIR/nginx/certs"

    local extra=(); $SSL_STAGING && extra+=(--staging)

    # --standalone modu: certbot kendi geçici HTTP sunucusunu başlatır.
    # nginx port 80'i bırakması için geçici durdurulur.
    log_info "Docker nginx geçici durduruluyor (port 80 certbot'a bırakılıyor)…"
    docker compose -f "$COMPOSE_FILE" stop nginx 2>/dev/null || true

    log_info "Sertifika alınıyor (standalone): $domain"
    certbot certonly --standalone \
        --non-interactive --agree-tos \
        --domain "$domain" --email "$email" \
        "${extra[@]}" 2>&1 | tail -10 || true

    # Nginx'i hata olsa da yeniden başlat
    log_info "Docker nginx yeniden başlatılıyor…"
    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" start nginx 2>/dev/null \
        || docker compose -f "$COMPOSE_FILE" up -d nginx 2>/dev/null || true

    # Sertifika dosyası yoksa hata ver ve devam et (SSL olmadan çalışır)
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

    cp -L "/etc/letsencrypt/live/$domain/fullchain.pem" "$APP_DIR/nginx/certs/"
    cp -L "/etc/letsencrypt/live/$domain/privkey.pem"   "$APP_DIR/nginx/certs/"
    chmod 644 "$APP_DIR/nginx/certs/fullchain.pem"
    chmod 640 "$APP_DIR/nginx/certs/privkey.pem"

    # nginx.conf'taki HTTPS bloğunun yorumunu kaldır
    local conf="$APP_DIR/nginx/nginx.conf"
    if grep -q "# HTTPS Sunucusu" "$conf"; then
        python3 - "$conf" "$domain" <<'PYEOF'
import re, sys
p, domain = sys.argv[1], sys.argv[2]
src = open(p, encoding='utf-8').read()
start = src.find("# ── HTTPS Sunucusu")
if start != -1:
    lines = src[start:].split("\n")
    out = []; in_block = False; depth = 0
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
src = src.replace("server_name _;", f"server_name {domain};", 2)
open(p, 'w', encoding='utf-8').write(src)
PYEOF
    fi

    # Renewal deploy hook: Docker nginx'i reload et
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    cat > "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh" <<HOOK
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$APP_DIR"
COMPOSE_FILE="$COMPOSE_FILE"
TARGET_DOMAIN="$domain"
case " \${RENEWED_DOMAINS:-} " in *" \${TARGET_DOMAIN} "*) ;; *) exit 0 ;; esac
cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/fullchain.pem" "\$APP_DIR/nginx/certs/fullchain.pem"
cp -fL "/etc/letsencrypt/live/\${TARGET_DOMAIN}/privkey.pem"   "\$APP_DIR/nginx/certs/privkey.pem"
chmod 644 "\$APP_DIR/nginx/certs/fullchain.pem"
chmod 640 "\$APP_DIR/nginx/certs/privkey.pem"
cd "\$APP_DIR" && docker compose -f "\$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null \\
    || docker compose -f "\$COMPOSE_FILE" restart nginx
logger -t mailtrustai-ssl "Sertifika yenilendi: \$TARGET_DOMAIN"
HOOK
    chmod +x "/etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh"
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true

    cd "$APP_DIR"
    docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload 2>/dev/null \
        || docker compose -f "$COMPOSE_FILE" restart nginx
    log_ok "SSL kuruldu + Docker nginx reload edildi. Auto-renewal aktif."
}

setup_ssl() {
    local domain="$1" email="$2"
    [[ -z "$domain" || -z "$email" ]] && { log_warn "SSL atlandı (domain/e-posta eksik)."; return 0; }
    if $USE_HOST_NGINX; then
        setup_ssl_host_nginx "$domain" "$email"
    else
        setup_ssl_docker_nginx "$domain" "$email"
    fi
}

# ── 1) Sistem paketleri ──────────────────────────────────────────────────────
log_step "[1/9] Sistem paketleri"
apt-get update -qq
apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    git jq openssl ufw rsync iproute2 python3
log_ok "Sistem paketleri kuruldu."

# ── 2) Docker Engine + Compose v2 ────────────────────────────────────────────
log_step "[2/9] Docker Engine"
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    apt-get remove -y -qq "$pkg" 2>/dev/null || true
done
if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
    log_ok "Docker $(docker --version | awk '{print $3}' | tr -d ',') kuruldu."
else
    log_ok "Docker zaten kurulu: $(docker --version)"
fi
systemctl enable --now docker
docker compose version >/dev/null 2>&1 || { log_error "Docker Compose plugin yok."; exit 1; }
log_ok "Docker Compose: $(docker compose version --short)"

# ── 3) Proje deposu ──────────────────────────────────────────────────────────
log_step "[3/9] Proje deposu hazırlanıyor: $APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
    if [[ -d "$APP_DIR" && -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then
        log_warn "$APP_DIR boş değil — git klonu atlanıyor, mevcut dosyalar kullanılacak."
    else
        mkdir -p "$APP_DIR"
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
        log_ok "Repo klonlandı."
    fi
else
    git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
    log_ok "Repo güncellendi (origin/$REPO_BRANCH)."
fi
cd "$APP_DIR"
for cf in "$COMPOSE_DOCKER_NGINX" "$COMPOSE_HOST_NGINX"; do
    [[ -f "$cf" ]] || { log_error "$cf bulunamadı."; exit 1; }
done

# ── 3.5) Host nginx tespiti ──────────────────────────────────────────────────
log_step "[3.5/9] Mevcut nginx kontrolü"
HOST_NGINX_ACTIVE=false
if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    HOST_NGINX_ACTIVE=true
    log_warn "Host nginx ÇALIŞIYOR — port çakışmasını önlemek için reverse-proxy modu önerilir."
fi

# Kullanıcı CLI'dan zorlamadıysa interaktif sor (sadece nginx varsa)
if $HOST_NGINX_ACTIVE && [[ "$USE_HOST_NGINX" == "false" ]] && [[ -t 0 ]]; then
    echo ""
    echo -e "${BOLD}Çalışma modu:${NC}"
    echo "  1) HOST nginx (önerilen)  — Mevcut nginx reverse proxy yapar"
    echo "  2) DOCKER nginx           — Docker stack içine nginx (farklı portlarda)"
    read -rp "Seçim [1/2, varsayılan 1]: " mode_choice
    mode_choice="${mode_choice:-1}"
    [[ "$mode_choice" == "1" ]] && USE_HOST_NGINX=true
fi

if $USE_HOST_NGINX; then
    COMPOSE_FILE="$COMPOSE_HOST_NGINX"
    log_ok "Mod: HOST nginx — app yalnız 127.0.0.1:${HTTP_PORT}'a bağlanacak."
else
    COMPOSE_FILE="$COMPOSE_DOCKER_NGINX"
    log_ok "Mod: DOCKER nginx — portlar: ${HTTP_PORT} (HTTP), ${HTTPS_PORT} (HTTPS)."
fi

# ── 4) Veri / log dizinleri ──────────────────────────────────────────────────
log_step "[4/9] Veri ve log dizinleri"
mkdir -p data logs nginx/certs nginx/webroot
chown -R "${APP_UID}:${APP_GID}" data logs
chmod 750 data logs
log_ok "Dizinler hazırlandı (sahip: ${APP_UID}:${APP_GID})."

# ── 5) .env oluşturma ────────────────────────────────────────────────────────
log_step "[5/9] .env dosyası"
SETUP_TOKEN=""
if [[ -f .env ]]; then
    log_warn ".env mevcut — değerler korunacak."
    SETUP_TOKEN="$(grep -E '^MSA_SETUP_TOKEN=' .env | head -n1 | cut -d= -f2- || true)"
else
    [[ -f .env.example ]] || { log_error ".env.example yok."; exit 1; }
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
    sed -i "s|^MSA_CUSTOMER_ONLY=.*|MSA_CUSTOMER_ONLY=false|"                           .env
    sed -i "s|^NODE_ENV=.*|NODE_ENV=production|"                                        .env

    chmod 600 .env
    chown root:root .env
    log_ok ".env oluşturuldu — TÜM paneller açık (admin/keygen, bayi, müşteri)."
    log_warn "MSA_LICENSE_SECRET değerini güvenli bir yere yedekleyin."
fi

# Eski initial_creds.json varsa temizle
[[ -f data/initial_creds.json ]] && { rm -f data/initial_creds.json; log_info "Eski initial_creds.json silindi."; }

# ── 6) UFW + (opsiyonel) host nginx site config ──────────────────────────────
log_step "[6/9] Güvenlik duvarı ve nginx"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null

if $USE_HOST_NGINX; then
    ufw allow 80/tcp  >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    log_ok "UFW: SSH + 80 + 443 (host nginx için)"
    log_info "Docker portu ${HTTP_PORT} dışa açılmadı — yalnız loopback."

    NGINX_SITE_FILE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
    if [[ ! -f "$NGINX_SITE_FILE" ]]; then
        cat > "$NGINX_SITE_FILE" <<NGINX_CONF
# MailTrustAI — host nginx reverse proxy (install_server_ubuntu.sh tarafından üretildi)
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }

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
        client_max_body_size 60M;
    }
}
NGINX_CONF
        log_ok "Host nginx site: $NGINX_SITE_FILE"
    fi
    ln -sf "$NGINX_SITE_FILE" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx && log_ok "Host nginx reload edildi."
else
    ufw allow "${HTTP_PORT}/tcp"  >/dev/null
    ufw allow "${HTTPS_PORT}/tcp" >/dev/null
    log_ok "UFW: SSH + ${HTTP_PORT}/tcp + ${HTTPS_PORT}/tcp"
fi
log_info "UFW etkinleştirmek için: sudo ufw enable"

# ── 7) systemd servisi ───────────────────────────────────────────────────────
log_step "[7/9] systemd servisi"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=MailTrustAI Full Docker Stack
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

# ── 8) Docker imajı + servis başlatma ────────────────────────────────────────
log_step "[8/9] Docker imajı derleniyor ve başlatılıyor"
log_info "Ilk derleme birkac dakika surebilir (native npm build)…"
docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
log_ok "Servis çalışıyor."

# ── 9) Sağlık kontrolü ───────────────────────────────────────────────────────
log_step "[9/9] Sağlık kontrolü"
HEALTH_URL="http://127.0.0.1:${HTTP_PORT}/api/health"
HEALTHY=false
for i in $(seq 1 30); do
    HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "$HEALTH_URL" 2>/dev/null || echo "000")"
    if [[ "$HTTP_CODE" == "200" ]]; then
        log_ok "Uygulama sağlıklı (HTTP 200)."
        HEALTHY=true
        break
    fi
    sleep 2
done
$HEALTHY || log_warn "Sağlık kontrolü zaman aşımı. Loglar: docker compose -f $COMPOSE_FILE logs --tail=80"

# Panellerin gerçekten açık olduğunu doğrula (tüm paneller modu)
for panel in /keygen.html /bayi.html /; do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${HTTP_PORT}${panel}" 2>/dev/null || echo "000")"
    if [[ "$CODE" == "200" ]]; then
        log_ok "Panel açık: ${panel}  (HTTP $CODE)"
    else
        log_warn "Panel beklenmedik durum: ${panel} → HTTP $CODE"
    fi
done

# ── (Opsiyonel) SSL kurulumu ────────────────────────────────────────────────
if [[ -n "$SSL_DOMAIN" && -n "$SSL_EMAIL" ]]; then
    if $SSL_AUTO; then
        setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || log_warn "SSL kurulumu başarısız."
    else
        echo ""
        read -rp "SSL sertifikası şimdi alınsın mı? (domain=$SSL_DOMAIN) [E/h]: " ssl_choice
        [[ ! "$ssl_choice" =~ ^[Hh]$ ]] && setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || true
    fi
elif [[ -t 0 ]]; then
    echo ""
    log_step "Let's Encrypt SSL (opsiyonel)"
    read -rp "Şimdi SSL sertifikası alınsın mı? [e/H]: " want_ssl
    if [[ "$want_ssl" =~ ^[Ee]$ ]]; then
        read -rp "  Domain: " SSL_DOMAIN
        read -rp "  E-posta: " SSL_EMAIL
        [[ -n "$SSL_DOMAIN" && -n "$SSL_EMAIL" ]] && setup_ssl "$SSL_DOMAIN" "$SSL_EMAIL" || log_warn "Eksik bilgi → SSL atlandı."
    fi
fi

# ── Özet ─────────────────────────────────────────────────────────────────────
IP="$(hostname -I | awk '{print $1}')"

if $USE_HOST_NGINX; then
    BASE_URL="http://${SSL_DOMAIN:-$IP}"
    [[ -n "$SSL_DOMAIN" ]] && BASE_URL="https://${SSL_DOMAIN}"
else
    BASE_URL="http://${IP}:${HTTP_PORT}"
fi

echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          ✓ Kurulum Başarıyla Tamamlandı!                     ║
║            (admin/keygen + bayi + müşteri = hepsi aktif)     ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "${BOLD}TÜM PANELLER:${NC}"
echo "  🏠 Müşteri Yönetimi  : ${BASE_URL}/"
echo "  🛡️  Admin / Keygen   : ${BASE_URL}/keygen.html"
echo "  🤝 Bayi Portalı      : ${BASE_URL}/bayi.html"

if [[ -n "$SETUP_TOKEN" ]]; then
    echo ""
    echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${YELLOW}║       İLK KURULUM — TARAYICIDAN ŞİFRE BELİRLEME             ║${NC}"
    echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Aşağıdaki URL'lerden tarayıcı ile bağlanıp ADMIN + MÜŞTERİ"
    echo "  şifrelerini KENDİNİZ belirleyin (formlar otomatik gösterilir):"
    echo ""
    echo -e "  Admin paneli   : ${GREEN}${BASE_URL}/keygen.html?setup_token=${SETUP_TOKEN}${NC}"
    echo -e "  Müşteri paneli : ${GREEN}${BASE_URL}/?setup_token=${SETUP_TOKEN}${NC}"
    echo ""
    echo -e "  Setup Token: ${YELLOW}${SETUP_TOKEN}${NC}"
    echo ""
    echo "  Her iki şifre belirlendikten sonra:"
    echo "    sudo sed -i 's|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=|' ${APP_DIR}/.env"
    echo "    sudo systemctl reload ${SERVICE_NAME}"
fi

echo ""
echo -e "${BOLD}Yönetim:${NC}"
echo "  Durum    : sudo systemctl status ${SERVICE_NAME}"
echo "  Loglar   : cd ${APP_DIR} && docker compose -f ${COMPOSE_FILE} logs -f"
echo "  Yenile   : sudo systemctl reload ${SERVICE_NAME}"
echo "  Durdur   : sudo systemctl stop ${SERVICE_NAME}"
echo "  Başlat   : sudo systemctl start ${SERVICE_NAME}"

echo ""
echo -e "${BOLD}Önemli Dosyalar:${NC}"
echo "  Proje    : ${APP_DIR}"
echo "  .env     : ${APP_DIR}/.env  (chmod 600 — yedekleyin!)"
if $USE_HOST_NGINX; then
    echo "  Nginx    : /etc/nginx/sites-available/${NGINX_SITE_NAME}"
else
    echo "  Nginx    : ${APP_DIR}/nginx/nginx.conf"
    echo "  SSL      : ${APP_DIR}/nginx/certs/"
fi
echo "  Veri     : docker volume mailtrustai_data"
echo "  Loglar   : docker volume mailtrustai_logs"

if [[ -z "$SSL_DOMAIN" ]]; then
    echo ""
    echo -e "${BOLD}${YELLOW}İPUCU:${NC} Domain + Let's Encrypt SSL için:"
    echo "  sudo ./install_server_ubuntu.sh --domain mail.sirket.com --email admin@sirket.com --auto-ssl"
fi

echo ""
