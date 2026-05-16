#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu MÜŞTERİ Kurulum Kaldırma Scripti
#  Sürüm   : 1.0  (2026-05)
#
#  Bu script install_customer_ubuntu.sh tarafından yapılan kurulumu kaldırır:
#    - mailtrustai-customer.service systemd birimi
#    - docker-compose.customer.yml ile başlatılan konteynerler
#    - Firewall kuralları (3000/tcp, 4443/tcp)
#    - İsteğe bağlı: /opt/mailtrustai dizini ve veritabanı
#
#  Kullanım:
#     sudo ./uninstall_customer_ubuntu.sh           # interaktif
#     sudo ./uninstall_customer_ubuntu.sh --purge   # onay sormadan TÜM veriyi sil
#     sudo ./uninstall_customer_ubuntu.sh --keep    # onay sormadan veriyi koru
# ==============================================================================

set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly NC='\033[0m'

log_info() { echo -e "[INFO]  $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn() { echo -e "${YELLOW}[UYARI]${NC} $*"; }
log_err()  { echo -e "${RED}[HATA]${NC}  $*" >&2; }
log_step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

# Mod parsing
MODE="ask"   # ask | purge | keep
for arg in "$@"; do
    case "$arg" in
        --purge) MODE="purge" ;;
        --keep)  MODE="keep"  ;;
        -h|--help)
            sed -n '2,17p' "$0"
            exit 0
            ;;
        *) log_warn "Bilinmeyen argüman: $arg" ;;
    esac
done

readonly APP_DIR="/opt/mailtrustai"
readonly COMPOSE_FILES=("docker-compose.customer.yml" "docker-compose.customer.host-nginx.yml")
readonly SERVICE_NAME="mailtrustai-customer"
readonly NGINX_SITE_NAME="mailtrustai-customer"
readonly HTTP_PORT=3000
readonly HTTPS_PORT=4443

# ── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${RED}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — MÜŞTERİ Kurulum Kaldırma Scripti             ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── Ön kontrol ───────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    log_err "Bu script root yetkisiyle çalıştırılmalıdır. (sudo)"
    exit 1
fi

if [[ "$MODE" == "ask" ]]; then
    echo -e "${YELLOW}Bu işlem MailTrustAI müşteri kurulumunu durduracak ve sistemden kaldıracak.${NC}"
    read -rp "Devam edilsin mi? [e/H]: " confirm
    [[ "$confirm" =~ ^[Ee]$ ]] || { log_info "İptal edildi."; exit 0; }
fi

# ── 1) Docker konteynerleri durdur ───────────────────────────────────────────
log_step "[1/5] Docker konteynerleri durduruluyor"

if [[ -d "$APP_DIR" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    cd "$APP_DIR"
    for cf in "${COMPOSE_FILES[@]}"; do
        if [[ -f "$cf" ]]; then
            docker compose -f "$cf" down --remove-orphans 2>/dev/null \
                && log_ok "$cf: down" \
                || log_warn "$cf: down hata verdi"
        fi
    done
else
    log_info "Docker veya $APP_DIR bulunamadı, konteyner temizliği atlanıyor."
fi

# Ortada kalan konteyneri zorla temizle
if command -v docker >/dev/null 2>&1; then
    for c in mailtrustai-customer mailtrustai-customer-nginx; do
        if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
            docker rm -f "$c" >/dev/null 2>&1 || true
            log_info "Konteyner zorla silindi: $c"
        fi
    done
fi

# ── 2) systemd servisi ───────────────────────────────────────────────────────
log_step "[2/5] systemd servisi kaldırılıyor"

if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    systemctl stop "${SERVICE_NAME}.service"    2>/dev/null || true
    systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    log_ok "${SERVICE_NAME}.service kaldırıldı."
else
    log_info "${SERVICE_NAME}.service bulunamadı."
fi

# ── 3) UFW kuralları ─────────────────────────────────────────────────────────
log_step "[3/5] UFW kuralları kaldırılıyor"

if command -v ufw >/dev/null 2>&1; then
    ufw delete allow "${HTTP_PORT}/tcp"  2>/dev/null || true
    ufw delete allow "${HTTPS_PORT}/tcp" 2>/dev/null || true
    log_ok "UFW: ${HTTP_PORT}/tcp ve ${HTTPS_PORT}/tcp kuralları kaldırıldı."
    log_info "SSH, 80, 443 korundu (başka servisler kullanıyor olabilir)."
else
    log_info "UFW kurulu değil, atlanıyor."
fi

# Host nginx site config'i (varsa) kaldır
if [[ -L "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}" ]] \
   || [[ -f "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}" ]]; then
    rm -f "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
    log_ok "Host nginx site (sites-enabled) kaldırıldı."
fi
if [[ -f "/etc/nginx/sites-available/${NGINX_SITE_NAME}" ]]; then
    rm -f "/etc/nginx/sites-available/${NGINX_SITE_NAME}"
    log_ok "Host nginx site (sites-available) kaldırıldı."
fi
if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx
        log_info "Host nginx reload edildi."
    fi
fi

# Let's Encrypt renewal deploy hook'u (Docker nginx modunda yazılan)
if [[ -f /etc/letsencrypt/renewal-hooks/deploy/mailtrustai-customer.sh ]]; then
    rm -f /etc/letsencrypt/renewal-hooks/deploy/mailtrustai-customer.sh
    log_ok "Let's Encrypt yenileme hook'u kaldırıldı."
fi

# ── 4) Veri / dizin / volume / imaj ──────────────────────────────────────────
log_step "[4/5] Veri, dizin ve Docker imajı"

if [[ "$MODE" == "ask" ]]; then
    echo ""
    echo -e "${YELLOW}Aşağıdaki kalıcı veriler silinsin mi? (GERİ ALINAMAZ)${NC}"
    echo "  - $APP_DIR  (uygulama dizini, .env, nginx config, SSL sertif.)"
    echo "  - Docker volume: mailtrustai_data   (customer local veri cache)"
    echo "  - Docker volume: mailtrustai_logs"
    echo "  - Docker imajı: mailtrustai-customer-mailtrustai"
    echo ""
    read -rp "Silinsin mi? [e/H]: " purge_choice
    if [[ "$purge_choice" =~ ^[Ee]$ ]]; then
        MODE="purge"
    else
        MODE="keep"
    fi
fi

if [[ "$MODE" == "purge" ]]; then
    if [[ -d "$APP_DIR" ]]; then
        rm -rf "$APP_DIR"
        log_ok "Uygulama dizini silindi: $APP_DIR"
    fi

    if command -v docker >/dev/null 2>&1; then
        # Volume'lar (compose project'in altında ya da bare)
        for vol in mailtrustai_data mailtrustai_logs \
                   mailtrustai-customer_mailtrustai_data \
                   mailtrustai-customer_mailtrustai_logs \
                   mailtrustai_mailtrustai_data \
                   mailtrustai_mailtrustai_logs; do
            if docker volume ls -q | grep -qx "$vol"; then
                docker volume rm "$vol" >/dev/null 2>&1 || true
                log_info "Volume silindi: $vol"
            fi
        done

        # Build edilmiş imajları temizle (mailtrustai-* prefix'i)
        IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^mailtrustai' || true)
        if [[ -n "$IMAGES" ]]; then
            echo "$IMAGES" | xargs -r docker rmi -f >/dev/null 2>&1 || true
            log_info "Docker imajları temizlendi."
        fi
    fi

    log_ok "Tüm müşteri kurulumu verileri kaldırıldı."
else
    log_info "Veriler KORUNDU."
    log_info "  - $APP_DIR/ ve veritabanı yerinde."
    log_info "  - Yeniden kurmak isterseniz install_customer_ubuntu.sh çalıştırın."
fi

# ── 5) Docker Engine (opsiyonel uyarı) ───────────────────────────────────────
log_step "[5/5] Docker Engine"
log_info "Docker Engine, başka konteynerleri etkileyebileceğinden otomatik kaldırılmaz."
log_info "Tamamen kaldırmak isterseniz:"
log_info "  sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
log_info "  sudo rm -rf /var/lib/docker /var/lib/containerd /etc/docker"

echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          Müşteri Kurulumu Kaldırma İşlemi Tamamlandı         ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"
