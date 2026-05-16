#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI — Ubuntu Kurulum Kaldırma Scripti  (Tüm sürümler)
#  Sürüm   : 2.0  (2026-05)
#
#  Bu script şu kurulum türlerini kaldırır:
#    1. install_ubuntu.sh           → mailtrustai.service          (prod)
#    2. install_customer_ubuntu.sh  → mailtrustai-customer.service (customer)
#
#  Her ikisi de aynı /opt/mailtrustai dizinini paylaşır.
#
#  Kullanım:
#     sudo ./uninstall_ubuntu.sh           # interaktif
#     sudo ./uninstall_ubuntu.sh --purge   # onay sormadan TÜM veriyi sil
#     sudo ./uninstall_ubuntu.sh --keep    # onay sormadan veriyi koru
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
MODE="ask"
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
readonly HTTP_PORT=3000
readonly HTTPS_PORT=4443

# Her iki kurulumu da kapsayan servis/compose çiftleri
declare -A INSTALLS=(
    ["mailtrustai"]="docker-compose.prod.yml"
    ["mailtrustai-customer"]="docker-compose.customer.yml"
)

# Tüm bilinen compose dosyaları (host-nginx varyantları dahil)
EXTRA_COMPOSE_FILES=(
    "docker-compose.yml"
    "docker-compose.prod.host-nginx.yml"
    "docker-compose.customer.host-nginx.yml"
)

# Host nginx site config'i adları (install scriptlerinin yazdığı)
NGINX_SITES=("mailtrustai" "mailtrustai-customer")

# ── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${RED}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║   MailTrustAI — Kaldırma Scripti  (tüm kurulum sürümleri)    ║
╚══════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

if [[ $EUID -ne 0 ]]; then
    log_err "Bu script root yetkisiyle çalıştırılmalıdır. (sudo)"
    exit 1
fi

if [[ "$MODE" == "ask" ]]; then
    echo -e "${YELLOW}Bu işlem MailTrustAI kurulumunu durduracak ve sistemden kaldıracak.${NC}"
    read -rp "Devam edilsin mi? [e/H]: " confirm
    [[ "$confirm" =~ ^[Ee]$ ]] || { log_info "İptal edildi."; exit 0; }
fi

# ── 1) Docker konteynerleri durdur ───────────────────────────────────────────
log_step "[1/5] Docker konteynerleri durduruluyor"

if [[ -d "$APP_DIR" ]] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    cd "$APP_DIR"
    for compose in "${INSTALLS[@]}" "${EXTRA_COMPOSE_FILES[@]}"; do
        if [[ -f "$compose" ]]; then
            docker compose -f "$compose" down --remove-orphans 2>/dev/null \
                && log_ok "$compose: down" \
                || log_warn "$compose: down hata verdi"
        fi
    done
else
    log_info "Docker veya $APP_DIR bulunamadı — konteyner adımı atlanıyor."
fi

# Bilinen container isimleri — zorla temizle
if command -v docker >/dev/null 2>&1; then
    for c in mailtrustai-app mailtrustai-nginx mailtrustai-dev \
             mailtrustai-customer mailtrustai-customer-nginx; do
        if docker ps -a --format '{{.Names}}' | grep -qx "$c" 2>/dev/null; then
            docker rm -f "$c" >/dev/null 2>&1 || true
            log_info "Konteyner zorla silindi: $c"
        fi
    done
fi

# ── 2) systemd servisleri ────────────────────────────────────────────────────
log_step "[2/5] systemd servisleri kaldırılıyor"

services_removed=0
for svc in "${!INSTALLS[@]}"; do
    unit="/etc/systemd/system/${svc}.service"
    if [[ -f "$unit" ]]; then
        systemctl stop "${svc}.service"    2>/dev/null || true
        systemctl disable "${svc}.service" 2>/dev/null || true
        rm -f "$unit"
        log_ok "${svc}.service kaldırıldı."
        services_removed=$((services_removed+1))
    fi
done

if [[ $services_removed -gt 0 ]]; then
    systemctl daemon-reload
else
    log_info "Aktif MailTrustAI servisi bulunamadı."
fi

# ── 3) UFW kuralları ─────────────────────────────────────────────────────────
log_step "[3/5] UFW kuralları"

if command -v ufw >/dev/null 2>&1; then
    ufw delete allow "${HTTP_PORT}/tcp"  2>/dev/null || true
    ufw delete allow "${HTTPS_PORT}/tcp" 2>/dev/null || true
    log_ok "UFW: ${HTTP_PORT}/tcp ve ${HTTPS_PORT}/tcp kuralları kaldırıldı."
    log_info "SSH, 80, 443 korundu (başka servisler kullanıyor olabilir)."
else
    log_info "UFW kurulu değil."
fi

# Host nginx site config'lerini temizle (install script'lerinin yazdıkları)
sites_removed=0
for site in "${NGINX_SITES[@]}"; do
    [[ -L "/etc/nginx/sites-enabled/$site" ]] || [[ -f "/etc/nginx/sites-enabled/$site" ]] && {
        rm -f "/etc/nginx/sites-enabled/$site"
        sites_removed=$((sites_removed+1))
    }
    if [[ -f "/etc/nginx/sites-available/$site" ]]; then
        rm -f "/etc/nginx/sites-available/$site"
        sites_removed=$((sites_removed+1))
    fi
done
if [[ $sites_removed -gt 0 ]]; then
    log_ok "Host nginx site konfigürasyonları kaldırıldı."
    if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
        nginx -t >/dev/null 2>&1 && systemctl reload nginx && log_info "Host nginx reload edildi."
    fi
fi

# Let's Encrypt renewal deploy hook'ları (install scriptlerinin yazdığı)
for hook in /etc/letsencrypt/renewal-hooks/deploy/mailtrustai.sh \
            /etc/letsencrypt/renewal-hooks/deploy/mailtrustai-customer.sh; do
    if [[ -f "$hook" ]]; then
        rm -f "$hook"
        log_ok "Let's Encrypt hook kaldırıldı: $(basename "$hook")"
    fi
done

# ── 4) Veri / dizin / volume / imaj ──────────────────────────────────────────
log_step "[4/5] Veri ve Docker artıfaktları"

if [[ "$MODE" == "ask" ]]; then
    echo ""
    echo -e "${YELLOW}Aşağıdaki kalıcı veriler silinsin mi? (GERİ ALINAMAZ)${NC}"
    echo "  - $APP_DIR (uygulama dizini, .env, nginx config, SSL sertif.)"
    echo "  - Docker volume: mailtrustai_data, mailtrustai_logs (uygulama verisi + log)"
    echo "  - Docker imajları (mailtrustai-* prefix'li)"
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
        # Bilinen volume isimleri (bare ve compose-prefixed)
        for vol in mailtrustai_data mailtrustai_logs \
                   mailtrustai_mailtrustai_data mailtrustai_mailtrustai_logs \
                   mailtrustai-customer_mailtrustai_data mailtrustai-customer_mailtrustai_logs; do
            if docker volume ls -q 2>/dev/null | grep -qx "$vol"; then
                docker volume rm "$vol" >/dev/null 2>&1 || true
                log_info "Volume silindi: $vol"
            fi
        done

        # mailtrustai-* prefix'li imajları temizle
        IMAGES="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^mailtrustai' || true)"
        if [[ -n "$IMAGES" ]]; then
            echo "$IMAGES" | xargs -r docker rmi -f >/dev/null 2>&1 || true
            log_info "Docker imajları temizlendi."
        fi
    fi

    log_ok "Tüm veriler kaldırıldı."
else
    log_info "Veriler KORUNDU."
    log_info "  - $APP_DIR/ ve veritabanı yerinde."
    log_info "  - Yeniden kurmak için install_ubuntu.sh veya install_customer_ubuntu.sh çalıştırın."
fi

# ── 5) Docker Engine (opsiyonel) ─────────────────────────────────────────────
log_step "[5/5] Docker Engine"
log_info "Docker Engine başka konteynerleri etkileyebileceğinden otomatik kaldırılmaz."
log_info "Tamamen kaldırmak isterseniz:"
log_info "  sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
log_info "  sudo rm -rf /var/lib/docker /var/lib/containerd /etc/docker"

echo ""
echo -e "${BOLD}${GREEN}"
cat <<'DONE'
╔══════════════════════════════════════════════════════════════╗
║          Kaldırma İşlemi Başarıyla Tamamlandı                ║
╚══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"
