#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu 24.04 LTS Otomatik Kurulum Scripti
#  Versiyon : 1.0
#  Tarih    : 2026-05
#
#  Kullanım:
#    chmod +x install.sh
#    sudo ./install.sh
#
#  Ne yapar?
#    1. Sistem paketlerini günceller
#    2. Node.js 20 LTS + derleme araçlarını kurar
#    3. Ayrıcalıksız 'mailtrustai' kullanıcısı oluşturur
#    4. Uygulama dizinini yapılandırır
#    5. npm bağımlılıklarını yükler
#    6. .env dosyasını oluşturur (interaktif)
#    7. PM2 ile süreç yönetimini kurar
#    8. systemd servisini etkinleştirir
#    9. Nginx reverse proxy kurar ve yapılandırır
#   10. Let's Encrypt SSL sertifikası alır (isteğe bağlı)
#   11. UFW güvenlik duvarını yapılandırır
# ==============================================================================

set -euo pipefail

# ── Renkler ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────
log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_error()   { echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step()    { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
log_banner()  {
    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║          MailTrustAI — Ubuntu 24.04 Kurulum Scripti          ║"
    echo "║          AI Destekli E-Posta Güvenlik Platformu              ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Hata yakalayıcı
trap 'log_error "Satır $LINENO'\''da hata oluştu. Kurulum durduruldu."; exit 1' ERR

# ── Sabit değişkenler ─────────────────────────────────────────────────────────
APP_USER="mailtrustai"
APP_DIR="/opt/mailtrustai/app"
DATA_DIR="/opt/mailtrustai/app/data"
LOGS_DIR="/opt/mailtrustai/app/logs"
NODE_VERSION="20"
PM2_SERVICE_NAME="mailtrustai"

# ── Konfigürasyon değişkenleri (interaktif olarak doldurulur) ─────────────────
DOMAIN=""
INSTALL_NGINX=true
INSTALL_SSL=false
APP_PORT=3000

# ── Ön kontroller ─────────────────────────────────────────────────────────────
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Bu script root yetkisiyle çalıştırılmalıdır."
        log_error "Kullanım: sudo ./install.sh"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        log_error "İşletim sistemi tespit edilemedi."
        exit 1
    fi
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        log_warn "Bu script Ubuntu için optimize edilmiştir. (Tespit edilen: $ID)"
        read -rp "Devam etmek istiyor musunuz? [e/H]: " cont
        [[ "$cont" =~ ^[Ee]$ ]] || exit 0
    fi
    if [[ "$VERSION_ID" != "24.04" ]]; then
        log_warn "Ubuntu $VERSION_ID tespit edildi. Script Ubuntu 24.04 için yazılmıştır."
        read -rp "Devam etmek istiyor musunuz? [e/H]: " cont
        [[ "$cont" =~ ^[Ee]$ ]] || exit 0
    fi
    log_ok "İşletim sistemi: $PRETTY_NAME"
}

check_existing() {
    if [[ -d "$APP_DIR" ]]; then
        log_warn "Uygulama dizini zaten mevcut: $APP_DIR"
        log_warn "Bu scripti çalıştırmak mevcut kurulumun üzerine yazar!"
        read -rp "Devam etmek istiyor musunuz? [e/H]: " cont
        [[ "$cont" =~ ^[Ee]$ ]] || exit 0
    fi
}

# ── Interaktif yapılandırma ───────────────────────────────────────────────────
gather_config() {
    log_step "Kurulum Yapılandırması"

    echo ""
    echo -e "${BOLD}Uygulama dosyalarının konumu nereden alınacak?${NC}"
    echo "  1) Mevcut dizin (script ile aynı klasör)"
    echo "  2) Git deposundan klonla"
    read -rp "Seçin [1/2]: " src_choice

    case "$src_choice" in
        2)
            read -rp "Git deposu URL'i: " GIT_REPO
            ;;
        *)
            GIT_REPO=""
            SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            log_info "Kaynak dizin: $SCRIPT_DIR"
            ;;
    esac

    echo ""
    read -rp "Alan adı (örn: mailtrustai.sirketiniz.com) [boş bırakılırsa IP ile erişim]: " DOMAIN

    if [[ -n "$DOMAIN" ]]; then
        read -rp "Nginx reverse proxy kurulsun mu? [E/h]: " nginx_choice
        [[ "$nginx_choice" =~ ^[Hh]$ ]] && INSTALL_NGINX=false || INSTALL_NGINX=true

        if [[ "$INSTALL_NGINX" == true ]]; then
            read -rp "Let's Encrypt SSL sertifikası alınsın mı? [e/H]: " ssl_choice
            [[ "$ssl_choice" =~ ^[Ee]$ ]] && INSTALL_SSL=true || INSTALL_SSL=false
        fi
    else
        INSTALL_NGINX=false
        INSTALL_SSL=false
        log_info "Alan adı girilmedi — Nginx kurulmayacak, uygulamaya port $APP_PORT üzerinden erişilecek."
    fi

    echo ""
    log_info "Yapılandırma özeti:"
    echo "  Uygulama dizini : $APP_DIR"
    echo "  Kullanıcı       : $APP_USER"
    echo "  Alan adı        : ${DOMAIN:-'(yok — IP ile erişim)'}"
    echo "  Nginx           : $INSTALL_NGINX"
    echo "  SSL             : $INSTALL_SSL"
    echo ""
    read -rp "Kuruluma devam edilsin mi? [E/h]: " confirm
    [[ "$confirm" =~ ^[Hh]$ ]] && exit 0
}

# ── Adım 1: Sistem güncelleme ─────────────────────────────────────────────────
step_update_system() {
    log_step "Sistem Güncelleniyor"
    apt-get update -qq
    apt-get upgrade -y -qq
    apt-get install -y -qq \
        curl wget git build-essential python3 make g++ \
        ca-certificates gnupg lsb-release openssl \
        ufw
    log_ok "Sistem paketleri güncellendi."
}

# ── Adım 2: Node.js kurulumu ──────────────────────────────────────────────────
step_install_nodejs() {
    log_step "Node.js ${NODE_VERSION} LTS Kuruluyor"

    if command -v node &>/dev/null; then
        CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ "$CURRENT_NODE" -ge "$NODE_VERSION" ]]; then
            log_ok "Node.js $(node --version) zaten kurulu — atlanıyor."
            return
        fi
        log_warn "Eski Node.js sürümü tespit edildi (v$CURRENT_NODE). Güncelleniyor..."
    fi

    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] \
https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list

    apt-get update -qq
    apt-get install -y -qq nodejs

    log_ok "Node.js $(node --version) kuruldu."
    log_ok "npm $(npm --version) kuruldu."
}

# ── Adım 3: Kullanıcı oluşturma ───────────────────────────────────────────────
step_create_user() {
    log_step "Sistem Kullanıcısı Oluşturuluyor: $APP_USER"

    if id "$APP_USER" &>/dev/null; then
        log_ok "Kullanıcı '$APP_USER' zaten mevcut — atlanıyor."
    else
        useradd --system \
                --create-home \
                --home-dir /opt/mailtrustai \
                --shell /bin/bash \
                --comment "MailTrustAI Service User" \
                "$APP_USER"
        log_ok "Kullanıcı '$APP_USER' oluşturuldu."
    fi
}

# ── Adım 4: Uygulama dosyalarını kopyalama ────────────────────────────────────
step_deploy_files() {
    log_step "Uygulama Dosyaları Konumlandırılıyor"

    mkdir -p "$APP_DIR"

    if [[ -n "${GIT_REPO:-}" ]]; then
        # Git'ten klonla
        if [[ -d "$APP_DIR/.git" ]]; then
            log_info "Mevcut git deposu güncelleniyor..."
            sudo -u "$APP_USER" git -C "$APP_DIR" pull
        else
            log_info "Git deposu klonlanıyor: $GIT_REPO"
            sudo -u "$APP_USER" git clone "$GIT_REPO" "$APP_DIR"
        fi
    else
        # Mevcut dizinden kopyala
        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        log_info "Dosyalar kopyalanıyor: $SCRIPT_DIR → $APP_DIR"
        rsync -a --exclude='node_modules/' \
                 --exclude='.env' \
                 --exclude='data/' \
                 --exclude='logs/' \
                 --exclude='.git/' \
                 --exclude='*.sh' \
                 "$SCRIPT_DIR/" "$APP_DIR/"
    fi

    # Veri ve log dizinleri
    mkdir -p "$DATA_DIR" "$LOGS_DIR"

    # İzinler
    chown -R "$APP_USER:$APP_USER" /opt/mailtrustai
    chmod 750 "$DATA_DIR"

    log_ok "Uygulama dosyaları hazırlandı: $APP_DIR"
}

# ── Adım 5: npm bağımlılıkları ────────────────────────────────────────────────
step_install_deps() {
    log_step "npm Bağımlılıkları Yükleniyor"
    log_info "better-sqlite3 native modülü derleniyor — bu birkaç dakika sürebilir..."

    sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install --production --silent"

    log_ok "npm bağımlılıkları yüklendi."
}

# ── Adım 6: .env dosyası oluşturma ───────────────────────────────────────────
step_create_env() {
    log_step ".env Dosyası Oluşturuluyor"

    ENV_FILE="$APP_DIR/.env"

    if [[ -f "$ENV_FILE" ]]; then
        log_warn ".env dosyası zaten mevcut — üzerine yazılmayacak."
        log_info "Mevcut .env kullanılıyor: $ENV_FILE"
        return
    fi

    # Güvenli rastgele değerler üret
    log_info "Güvenli rastgele anahtarlar üretiliyor..."
    ENC_PASS=$(openssl rand -hex 32)
    ENC_SALT=$(openssl rand -hex 16)
    LIC_SECRET=$(openssl rand -hex 32)
    ADMIN_TOKEN_SECRET=$(openssl rand -hex 32)

    echo ""
    log_info "Birkaç bilgiye ihtiyacımız var:"

    read -rp "Admin kurtarma e-posta adresi: " RECOVERY_EMAIL
    read -rp "Online lisans sunucusu URL'i (boş bırakın = offline mod): " LICENSE_REMOTE_URL

    cat > "$ENV_FILE" << EOF
# ============================================================
# MailTrustAI — Ortam Değişkenleri
# Oluşturulma: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# ── Sunucu ──────────────────────────────────────────────────
PORT=${APP_PORT}
NODE_ENV=production

# ── Güvenlik (Otomatik üretildi — değiştirmeyin!) ───────────
MSA_ENC_PASSWORD=${ENC_PASS}
MSA_ENC_SALT=${ENC_SALT}
MSA_LICENSE_SECRET=${LIC_SECRET}
MSA_ADMIN_TOKEN_SECRET=${ADMIN_TOKEN_SECRET}

# ── Admin ────────────────────────────────────────────────────
MSA_RECOVERY_EMAIL=${RECOVERY_EMAIL}

# ── Online Lisans Doğrulama (İsteğe Bağlı) ──────────────────
MSA_LICENSE_REMOTE_URL=${LICENSE_REMOTE_URL}
MSA_LICENSE_REFRESH_MS=21600000
MSA_LICENSE_GRACE_MS=259200000
EOF

    chmod 600 "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE"

    log_ok ".env dosyası oluşturuldu: $ENV_FILE"
    log_warn "ÖNEMLİ: MSA_LICENSE_SECRET değerini not edin — tüm kurulumlarınızda aynı olmalıdır!"
    echo ""
    echo -e "  ${BOLD}MSA_LICENSE_SECRET=${LIC_SECRET}${NC}"
    echo ""
}

# ── Adım 7: PM2 kurulumu ve servis oluşturma ─────────────────────────────────
step_setup_pm2() {
    log_step "PM2 Süreç Yöneticisi Kuruluyor"

    # PM2'yi global kur
    if ! command -v pm2 &>/dev/null; then
        npm install -g pm2 --silent
        log_ok "PM2 kuruldu: $(pm2 --version)"
    else
        log_ok "PM2 zaten kurulu: $(pm2 --version)"
    fi

    # ecosystem.config.js oluştur
    cat > "$APP_DIR/ecosystem.config.js" << 'ECOSYSTEM'
module.exports = {
  apps: [{
    name        : 'mailtrustai',
    script      : 'server.js',
    interpreter : 'node',
    interpreter_args: '--use-system-ca',
    cwd         : '/opt/mailtrustai/app',
    instances   : 1,
    exec_mode   : 'fork',
    env_production: {
      NODE_ENV  : 'production',
    },
    // Loglama
    out_file    : '/opt/mailtrustai/app/logs/pm2-out.log',
    error_file  : '/opt/mailtrustai/app/logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs  : true,
    // Otomatik yeniden başlatma
    watch       : false,
    max_memory_restart: '512M',
    restart_delay: 5000,
    max_restarts : 10,
    min_uptime  : '10s',
  }]
};
ECOSYSTEM

    chown "$APP_USER:$APP_USER" "$APP_DIR/ecosystem.config.js"

    # Uygulamayı mailtrustai kullanıcısı olarak başlat
    log_info "Uygulama PM2 ile başlatılıyor..."
    sudo -u "$APP_USER" bash -c "
        cd '$APP_DIR'
        pm2 delete '$PM2_SERVICE_NAME' 2>/dev/null || true
        pm2 start ecosystem.config.js --env production
        pm2 save
    "

    # systemd startup script üret
    local startup_cmd
    startup_cmd=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp /opt/mailtrustai 2>&1 | grep "sudo env")

    if [[ -n "$startup_cmd" ]]; then
        log_info "systemd startup komutu çalıştırılıyor..."
        eval "$startup_cmd"
    else
        # Fallback: manuel systemd servisi
        _create_systemd_service
    fi

    log_ok "PM2 servisi kuruldu ve etkinleştirildi."
}

# PM2 startup başarısız olursa fallback systemd servisi
_create_systemd_service() {
    log_info "systemd servis dosyası oluşturuluyor..."

    cat > /etc/systemd/system/pm2-mailtrustai.service << EOF
[Unit]
Description=PM2 process manager — MailTrustAI
Documentation=https://pm2.keymetrics.io/
After=network.target

[Service]
Type=forking
User=${APP_USER}
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Environment=PATH=$(which node | xargs dirname):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PM2_HOME=/opt/mailtrustai/.pm2
PIDFile=/opt/mailtrustai/.pm2/pm2.pid
Restart=on-failure

ExecStart=$(which pm2) resurrect
ExecReload=$(which pm2) reload all
ExecStop=$(which pm2) kill

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable pm2-mailtrustai
    systemctl start pm2-mailtrustai
}

# ── Adım 8: Nginx kurulumu ────────────────────────────────────────────────────
step_setup_nginx() {
    [[ "$INSTALL_NGINX" == false ]] && return

    log_step "Nginx Kuruluyor ve Yapılandırılıyor"

    apt-get install -y -qq nginx

    # Mevcut default siteyi devre dışı bırak
    rm -f /etc/nginx/sites-enabled/default

    # MailTrustAI site konfigürasyonu oluştur
    local nginx_conf="/etc/nginx/sites-available/mailtrustai"

    cat > "$nginx_conf" << NGINXCONF
# ============================================================
# MailTrustAI — Nginx Site Yapılandırması
# Alan adı: ${DOMAIN}
# Oluşturulma: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# HTTP → HTTPS yönlendirme
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Let's Encrypt ACME doğrulama
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS sunucu
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    # SSL sertifikaları
    # Let's Encrypt kurulduktan sonra otomatik doldurulur
    # ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    # Geçici self-signed (SSL kurulana kadar)
    ssl_certificate     /etc/ssl/certs/mailtrustai-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/mailtrustai-selfsigned.key;

    # Modern SSL
    ssl_protocols              TLSv1.2 TLSv1.3;
    ssl_ciphers                ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers  off;
    ssl_session_cache          shared:SSL:10m;
    ssl_session_timeout        10m;

    # Güvenlik başlıkları
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options           SAMEORIGIN always;
    add_header X-Content-Type-Options    nosniff    always;
    add_header X-XSS-Protection          "1; mode=block" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    # 60MB yükleme limiti (EML dosyaları için)
    client_max_body_size 60M;

    # WebSocket desteği
    location /ws {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       \$host;
        proxy_set_header   X-Real-IP  \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }

    # API ve uygulama
    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout    120s;
        proxy_read_timeout    120s;
    }

    # Statik dosya önbelleği
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        add_header Cache-Control "public, max-age=604800, immutable";
    }
}
NGINXCONF

    # Self-signed sertifika oluştur (Let's Encrypt kurulana kadar)
    if [[ ! -f /etc/ssl/certs/mailtrustai-selfsigned.crt ]]; then
        log_info "Geçici self-signed SSL sertifikası oluşturuluyor..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout /etc/ssl/private/mailtrustai-selfsigned.key \
            -out    /etc/ssl/certs/mailtrustai-selfsigned.crt \
            -subj "/C=TR/ST=Istanbul/L=Istanbul/O=MailTrustAI/CN=${DOMAIN}" \
            2>/dev/null
        log_ok "Self-signed sertifika oluşturuldu."
    fi

    # Certbot webroot dizini
    mkdir -p /var/www/certbot

    # Siteyi etkinleştir
    ln -sf "$nginx_conf" /etc/nginx/sites-enabled/mailtrustai

    # Konfigürasyonu test et ve yükle
    nginx -t
    systemctl enable nginx
    systemctl restart nginx

    log_ok "Nginx yapılandırıldı ve başlatıldı."
}

# ── Adım 9: Let's Encrypt SSL ─────────────────────────────────────────────────
step_setup_ssl() {
    [[ "$INSTALL_SSL" == false ]] && return
    [[ -z "$DOMAIN" ]] && return

    log_step "Let's Encrypt SSL Sertifikası Alınıyor"

    # certbot kur
    apt-get install -y -qq certbot python3-certbot-nginx

    log_info "Sertifika alınıyor: $DOMAIN"
    certbot --nginx \
            --non-interactive \
            --agree-tos \
            --redirect \
            --domain "$DOMAIN" \
            --email "${RECOVERY_EMAIL:-admin@${DOMAIN}}" \
            2>&1 | tail -5

    # Otomatik yenileme zamanlayıcısını etkinleştir
    systemctl enable certbot.timer
    systemctl start certbot.timer

    # Nginx konfigürasyonundaki sertifika yollarını güncelle (certbot bunu otomatik yapar)
    log_ok "SSL sertifikası kuruldu. Otomatik yenileme etkinleştirildi."
}

# ── Adım 10: UFW güvenlik duvarı ──────────────────────────────────────────────
step_setup_firewall() {
    log_step "UFW Güvenlik Duvarı Yapılandırılıyor"

    # SSH'ı koru (erişimi kesmemek için)
    ufw allow ssh 2>/dev/null || true
    ufw allow 80/tcp
    ufw allow 443/tcp

    if [[ "$INSTALL_NGINX" == false ]]; then
        # Nginx yoksa uygulama portunu doğrudan aç
        ufw allow "${APP_PORT}/tcp"
        log_info "Port $APP_PORT dışarıya açıldı (Nginx yok)."
    else
        log_info "Port 3000 dışarıya açılmadı — Nginx üzerinden erişim sağlanacak."
    fi

    # UFW'yi etkinleştir (--force ile interaktif onay atla)
    ufw --force enable
    log_ok "Güvenlik duvarı yapılandırıldı."
    ufw status
}

# ── Adım 11: Sağlık kontrolü ─────────────────────────────────────────────────
step_health_check() {
    log_step "Sağlık Kontrolü"

    log_info "Uygulama başlaması için 5 saniye bekleniyor..."
    sleep 5

    local health_url="http://127.0.0.1:${APP_PORT}/api/health"
    local http_code

    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$health_url" 2>/dev/null || echo "000")

    if [[ "$http_code" == "200" ]]; then
        log_ok "Uygulama sağlık kontrolü BAŞARILI (HTTP $http_code)"
    else
        log_warn "Sağlık kontrolü yanıt vermedi (HTTP $http_code). Logları inceleyin:"
        log_warn "  sudo -u $APP_USER pm2 logs $PM2_SERVICE_NAME --lines 30"
    fi
}

# ── Son bilgi ekranı ──────────────────────────────────────────────────────────
show_summary() {
    local ip
    ip=$(hostname -I | awk '{print $1}')

    echo ""
    echo -e "${BOLD}${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Kurulum Başarıyla Tamamlandı!                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    echo -e "${BOLD}Erişim Adresleri:${NC}"
    if [[ "$INSTALL_NGINX" == true && -n "$DOMAIN" ]]; then
        echo "  Web Arayüzü  : https://${DOMAIN}"
        echo "  Admin Paneli : https://${DOMAIN}/keygen.html"
        echo "  Bayi Portalı : https://${DOMAIN}/bayi.html"
    else
        echo "  Web Arayüzü  : http://${ip}:${APP_PORT}"
        echo "  Admin Paneli : http://${ip}:${APP_PORT}/keygen.html"
        echo "  Bayi Portalı : http://${ip}:${APP_PORT}/bayi.html"
    fi

    echo ""
    echo -e "${BOLD}Yönetim Komutları:${NC}"
    echo "  Durum      : sudo -u $APP_USER pm2 status"
    echo "  Canlı log  : sudo -u $APP_USER pm2 logs $PM2_SERVICE_NAME"
    echo "  Yeniden başlat: sudo -u $APP_USER pm2 restart $PM2_SERVICE_NAME"
    echo "  Durdur     : sudo -u $APP_USER pm2 stop $PM2_SERVICE_NAME"

    echo ""
    echo -e "${BOLD}Önemli Dosyalar:${NC}"
    echo "  Uygulama   : $APP_DIR"
    echo "  Veri       : $DATA_DIR"
    echo "  Loglar     : $LOGS_DIR"
    echo "  .env       : $APP_DIR/.env"

    echo ""
    echo -e "${BOLD}${YELLOW}İlk Kurulum Adımları:${NC}"
    echo "  1. Admin paneline gidin: /keygen.html"
    echo "  2. 'Admin Şifre Sıfırla' ile $APP_DIR/.env içindeki"
    echo "     MSA_RECOVERY_EMAIL adresine doğrulama kodu gönderin."
    echo "  3. Lisans anahtarı oluşturun."
    echo "  4. Ana arayüze gidin ve lisansı etkinleştirin."
    echo ""

    if [[ "$INSTALL_SSL" == false && "$INSTALL_NGINX" == true && -n "$DOMAIN" ]]; then
        echo -e "${YELLOW}NOT: Self-signed sertifika kullanılıyor.${NC}"
        echo "Let's Encrypt sertifikası almak için:"
        echo "  sudo certbot --nginx -d ${DOMAIN}"
        echo ""
    fi
}

# ── Ana akış ─────────────────────────────────────────────────────────────────
main() {
    log_banner
    check_root
    check_os
    check_existing
    gather_config

    step_update_system
    step_install_nodejs
    step_create_user
    step_deploy_files
    step_install_deps
    step_create_env
    step_setup_pm2
    step_setup_nginx
    step_setup_ssl
    step_setup_firewall
    step_health_check
    show_summary
}

main "$@"
