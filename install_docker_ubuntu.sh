#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Otomatik Ubuntu Docker Kurulum Scripti
#
# Desteklenen sürümler: Ubuntu 20.04, 22.04, 24.04 (LTS)
#
# Kullanım:
#   sudo bash install_docker_ubuntu.sh
#
# Seçenekler (environment değişkenleri):
#   APP_PORT=3000          Dış port (varsayılan: 3000)
#   APP_DIR=/opt/mailtrustai  Kurulum dizini
#   SKIP_DOCKER_INSTALL=1  Docker zaten kuruluysa atla
#
# ============================================================
set -euo pipefail

# ── Renkler ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()    { echo -e "\n${BOLD}${BLUE}▶ $*${NC}"; }
die()     { error "$*"; exit 1; }

# ── Banner ──────────────────────────────────────────────────
echo -e "${BOLD}${BLUE}"
cat << 'BANNER'
  __  __       _ _ _____              _        _    ___
 |  \/  | __ _(_) |_   _| __ _   _ __| |_     / \  |_ _|
 | |\/| |/ _` | | | | || '__| | | / _` \ \   / _ \  | |
 | |  | | (_| | | | | || |  | |_| \__ \ \_\ / ___ \ | |
 |_|  |_|\__,_|_|_| |_||_|   \__,_|___/\___/_/   \_\___|
BANNER
echo -e "${NC}${BOLD}  Ubuntu Docker Kurulum Scripti${NC}"
echo -e "  ─────────────────────────────────────────────\n"

# ── Root kontrolü ────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Bu script root olarak çalıştırılmalıdır: sudo bash $0"

# ── Ubuntu sürüm kontrolü ────────────────────────────────────
step "Ubuntu sürümü kontrol ediliyor"
if ! command -v lsb_release &>/dev/null; then
    die "lsb_release bulunamadı. Ubuntu 20.04/22.04/24.04 gereklidir."
fi

UBUNTU_CODENAME=$(lsb_release -cs 2>/dev/null || echo "unknown")
UBUNTU_VERSION=$(lsb_release -rs 2>/dev/null || echo "0")
DISTRO=$(lsb_release -is 2>/dev/null || echo "unknown")

if [[ "$DISTRO" != "Ubuntu" ]]; then
    die "Bu script yalnızca Ubuntu için tasarlanmıştır. Mevcut: $DISTRO"
fi

# Sürüm sayısı karşılaştırması (major.minor)
MAJOR_VER=$(echo "$UBUNTU_VERSION" | cut -d. -f1)
if (( MAJOR_VER < 20 )); then
    die "Ubuntu 20.04 veya üzeri gereklidir. Mevcut: $UBUNTU_VERSION"
fi

success "Ubuntu $UBUNTU_VERSION ($UBUNTU_CODENAME) — destekleniyor"

# ── Yapılandırma ─────────────────────────────────────────────
APP_PORT="${APP_PORT:-3000}"
APP_DIR="${APP_DIR:-/opt/mailtrustai}"
SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Gerekli araçlar ──────────────────────────────────────────
step "Sistem paketleri güncelleniyor"
apt-get update -qq

for pkg in curl ca-certificates gnupg lsb-release; do
    if ! dpkg -l "$pkg" &>/dev/null; then
        info "$pkg kuruluyor..."
        apt-get install -y -qq "$pkg"
    fi
done
success "Sistem paketleri hazır"

# ── Docker kurulumu ──────────────────────────────────────────
step "Docker kontrol ediliyor"

install_docker() {
    info "Docker Engine kuruluyor (resmi repo)..."

    # Eski Docker sürümlerini kaldır
    apt-get remove -y -qq docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Docker GPG anahtarı
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Repo ekle
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker

    success "Docker kurulumu tamamlandı: $(docker --version)"
}

if [[ "$SKIP_DOCKER_INSTALL" == "1" ]]; then
    if command -v docker &>/dev/null; then
        success "Docker mevcut (atlandı): $(docker --version)"
    else
        die "SKIP_DOCKER_INSTALL=1 ama docker bulunamadı. Önce Docker kurun."
    fi
elif ! command -v docker &>/dev/null; then
    install_docker
else
    success "Docker zaten kurulu: $(docker --version)"
fi

# Docker Compose v2 kontrolü
if ! docker compose version &>/dev/null; then
    info "Docker Compose plugin kuruluyor..."
    apt-get install -y -qq docker-compose-plugin
fi
success "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'hazır')"

# ── Uygulama dizini ──────────────────────────────────────────
step "Uygulama dizini hazırlanıyor: $APP_DIR"

# Script kendi proje dizinindeyse oraya kurulum yapma; APP_DIR farklıysa kopyala
if [[ "$SCRIPT_DIR" == "$APP_DIR" ]]; then
    info "Script zaten hedef dizinde: $APP_DIR"
else
    if [[ ! -f "$SCRIPT_DIR/package.json" ]] || [[ ! -f "$SCRIPT_DIR/server.js" ]]; then
        die "Proje dosyaları bulunamadı: $SCRIPT_DIR — scripti proje kök dizininde çalıştırın."
    fi
    info "Proje dosyaları $APP_DIR dizinine kopyalanıyor..."
    mkdir -p "$APP_DIR"
    # Dizin yoksa veya boşsa kopyala; varsa güncelle
    rsync -a --exclude='.env' --exclude='data/' --exclude='logs/' --exclude='node_modules/' \
        "$SCRIPT_DIR/" "$APP_DIR/"
    success "Dosyalar kopyalandı"
fi

cd "$APP_DIR"

# ── Veri ve log dizinleri ────────────────────────────────────
mkdir -p "$APP_DIR/data" "$APP_DIR/logs" "$APP_DIR/nginx/certs" "$APP_DIR/nginx/webroot"
chmod 755 "$APP_DIR/data" "$APP_DIR/logs"

# ── .env dosyası oluştur ─────────────────────────────────────
step ".env yapılandırma dosyası oluşturuluyor"

generate_secret() {
    # 32 byte → 64 karakter hex
    openssl rand -hex 32
}

if [[ -f "$APP_DIR/.env" ]]; then
    warn ".env dosyası zaten mevcut — mevcut yapılandırma korunuyor."
    warn "Sıfırlamak için: rm $APP_DIR/.env && sudo bash $0"
else
    info "Güvenli rastgele anahtarlar üretiliyor..."

    ENC_PASSWORD=$(generate_secret)
    ENC_SALT=$(generate_secret | head -c 32)
    LICENSE_SECRET=$(generate_secret)
    ADMIN_TOKEN_SECRET=$(generate_secret)

    cat > "$APP_DIR/.env" << EOF
# ============================================================
# MailTrustAI — Ortam Değişkenleri
# Oluşturulma: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

PORT=3000
NODE_ENV=production

# IMAP şifreleme anahtarları (değiştirmeyin — veri kaybolur)
MSA_ENC_PASSWORD=${ENC_PASSWORD}
MSA_ENC_SALT=${ENC_SALT}

# Lisans imzalama anahtarı
MSA_LICENSE_SECRET=${LICENSE_SECRET}

# Admin JWT token anahtarı
MSA_ADMIN_TOKEN_SECRET=${ADMIN_TOKEN_SECRET}

# Admin şifre sıfırlama e-posta adresi (opsiyonel)
# MSA_RECOVERY_EMAIL=admin@sirketiniz.com

# Uzak lisans doğrulama (opsiyonel)
# MSA_LICENSE_REMOTE_URL=
# MSA_LICENSE_REFRESH_MS=21600000
# MSA_LICENSE_GRACE_MS=259200000
EOF

    chmod 600 "$APP_DIR/.env"
    success ".env dosyası oluşturuldu ve güvenli izinler ayarlandı (600)"
fi

# ── İlk şifre dosyası ────────────────────────────────────────
CREDS_FILE="$APP_DIR/data/initial_creds.json"
if [[ ! -f "$CREDS_FILE" ]] && [[ ! -f "$APP_DIR/data/settings.json" ]]; then
    step "İlk giriş şifreleri oluşturuluyor"

    ADMIN_PASS=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9!@#' | head -c 14)
    CUSTOMER_PASS=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9!@#' | head -c 14)

    cat > "$CREDS_FILE" << EOF
{
  "adminPassword": "${ADMIN_PASS}",
  "customerPassword": "${CUSTOMER_PASS}"
}
EOF
    chmod 600 "$CREDS_FILE"

    # Şifreleri göster ve dosyaya kaydet
    CREDS_DISPLAY="$APP_DIR/data/ILK_SIFRELER.txt"
    cat > "$CREDS_DISPLAY" << EOF
MailTrustAI İlk Giriş Bilgileri
================================
Admin Panel URL  : http://$(hostname -I | awk '{print $1}'):${APP_PORT}/keygen.html
Müşteri Panel URL: http://$(hostname -I | awk '{print $1}'):${APP_PORT}/index.html
Bayi Panel URL   : http://$(hostname -I | awk '{print $1}'):${APP_PORT}/bayi.html

Admin Şifresi   : ${ADMIN_PASS}
Müşteri Şifresi : ${CUSTOMER_PASS}

NOT: Bu dosyayı güvenli bir yere not alın.
     İlk başarılı girişten sonra initial_creds.json otomatik silinir.
     Bu dosyayı da ilk girişten sonra silin: rm "$CREDS_DISPLAY"

Oluşturulma: $(date '+%Y-%m-%d %H:%M:%S')
EOF
    chmod 600 "$CREDS_DISPLAY"

    success "İlk şifreler oluşturuldu"
    echo -e "\n${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  İLK GİRİŞ BİLGİLERİ (Güvenli bir yere kaydedin!)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Admin Şifresi   : ${BOLD}${GREEN}${ADMIN_PASS}${NC}"
    echo -e "  Müşteri Şifresi : ${BOLD}${GREEN}${CUSTOMER_PASS}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
fi

# ── Güvenlik duvarı (UFW) ─────────────────────────────────────
step "Güvenlik duvarı yapılandırılıyor"
if command -v ufw &>/dev/null; then
    if ufw status | grep -q "Status: active"; then
        ufw allow "${APP_PORT}/tcp" comment "MailTrustAI HTTP" 2>/dev/null || true
        ufw allow "22/tcp"          comment "SSH"              2>/dev/null || true
        success "UFW: port ${APP_PORT} açıldı"
    else
        info "UFW aktif değil, atlanıyor"
    fi
else
    info "UFW bulunamadı, atlanıyor"
fi

# ── Docker imajı oluştur ve başlat ───────────────────────────
step "Docker imajı derleniyor"

# Hangi compose dosyasını kullanacağız
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
    die "docker-compose.yml bulunamadı: $COMPOSE_FILE"
fi

cd "$APP_DIR"

# Port override — varsayılan değil ise docker-compose.yml değiştir gerekebilir
# Basit çözüm: PORT env değişkeni zaten .env dosyasında var, override edelim
if [[ "$APP_PORT" != "3000" ]]; then
    warn "Özel port: $APP_PORT — docker-compose.yml ports ayarını kontrol edin"
    # docker-compose.yml'daki port mapping'i güncelle
    sed -i "s|\"3000:3000\"|\"${APP_PORT}:3000\"|g" "$COMPOSE_FILE"
fi

info "Docker imajı derleniyor (bu birkaç dakika sürebilir)..."
docker compose -f "$COMPOSE_FILE" build --pull

success "İmaj derlendi"

# ── Konteyneri başlat ────────────────────────────────────────
step "MailTrustAI başlatılıyor"

# Eğer çalışıyorsa yeniden başlat
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" up -d

# Sağlık kontrolü bekleme
info "Uygulama başlatılıyor, lütfen bekleyin..."
MAX_WAIT=60
WAITED=0
while (( WAITED < MAX_WAIT )); do
    sleep 3
    WAITED=$(( WAITED + 3 ))
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        success "Uygulama hazır (${WAITED}s)"
        break
    fi
    echo -n "."
done
echo ""

if [[ "$HTTP_CODE" != "200" ]]; then
    warn "Uygulama ${MAX_WAIT}s içinde yanıt vermedi (HTTP: $HTTP_CODE)"
    warn "Logları kontrol edin: docker compose -f $COMPOSE_FILE logs --tail=50"
fi

# ── Sistem servisi (opsiyonel) ────────────────────────────────
step "Sistem başlangıcında otomatik başlatma ayarlanıyor"

SYSTEMD_FILE="/etc/systemd/system/mailtrustai.service"
cat > "$SYSTEMD_FILE" << SYSTEMD
[Unit]
Description=MailTrustAI Email Security Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose -f ${APP_DIR}/docker-compose.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f ${APP_DIR}/docker-compose.yml down
ExecReload=/usr/bin/docker compose -f ${APP_DIR}/docker-compose.yml restart
TimeoutStartSec=120
TimeoutStopSec=30
Restart=no

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable mailtrustai.service
success "Systemd servisi etkinleştirildi (başlangıçta otomatik başlar)"

# ── Kurulum özeti ─────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')

echo -e "\n${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅ MailTrustAI Kurulumu Başarıyla Tamamlandı!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Kurulum Dizini :${NC} $APP_DIR"
echo -e "  ${BOLD}Docker Compose :${NC} $COMPOSE_FILE"
echo -e "  ${BOLD}Yapılandırma   :${NC} $APP_DIR/.env"
echo -e "  ${BOLD}Veri Dizini    :${NC} $APP_DIR/data"
echo ""
echo -e "  ${BOLD}${CYAN}Erişim Adresleri:${NC}"
echo -e "  ├─ Müşteri Paneli : ${BOLD}http://${SERVER_IP}:${APP_PORT}/${NC}"
echo -e "  ├─ Admin Paneli   : ${BOLD}http://${SERVER_IP}:${APP_PORT}/keygen.html${NC}"
echo -e "  └─ Bayi Paneli    : ${BOLD}http://${SERVER_IP}:${APP_PORT}/bayi.html${NC}"
echo ""
echo -e "  ${BOLD}Yönetim Komutları:${NC}"
echo -e "  ├─ Durum    : docker compose -f $COMPOSE_FILE ps"
echo -e "  ├─ Loglar   : docker compose -f $COMPOSE_FILE logs -f"
echo -e "  ├─ Yeniden  : systemctl restart mailtrustai"
echo -e "  └─ Durdur   : systemctl stop mailtrustai"
echo ""
if [[ -f "$APP_DIR/data/ILK_SIFRELER.txt" ]]; then
    echo -e "  ${BOLD}${YELLOW}İlk giriş bilgileri:${NC} $APP_DIR/data/ILK_SIFRELER.txt"
    echo ""
fi
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
