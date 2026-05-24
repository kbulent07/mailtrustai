#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri (Client) Kaldirma Betigi
#
# Iki mod:
#   1) SOFT (ayarlar kalsin): container kapanir, .env korunur ve yedeklenir
#   2) FULL (tum izleri sil): container + volume + .env + kurulum dizini
#      + bu betik tarafindan kurulan Docker (marker varsa) tamamen silinir
#
# Kullanim (interaktif menu):
#   sudo bash install/client/uninstall_client_ubuntu.sh
#
# Otomasyon:
#   sudo MODE=soft bash install/client/uninstall_client_ubuntu.sh
#   sudo MODE=full UNATTENDED=true bash install/client/uninstall_client_ubuntu.sh
# ============================================================
set -Euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()    { echo -e "${CYAN}------------------------------------------------------${NC}"; }

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

IS_INTERACTIVE=true
[[ ! -t 0 ]] || [[ "${UNATTENDED:-false}" == "true" ]] && IS_INTERACTIVE=false

INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"

echo ""
echo -e "${RED}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI - Ubuntu Musteri Kaldirma               ==="
echo "  ============================================================"
echo -e "${NC}"

# ============================================================
# Mod secimi
# ============================================================
MODE="${MODE:-}"
if [[ -z "$MODE" ]]; then
    if [[ "$IS_INTERACTIVE" == "false" ]]; then
        fatal "Non-interactive modda MODE=soft veya MODE=full belirtin."
    fi
    echo ""
    echo "  Kaldirma modu seciniz:"
    echo ""
    echo -e "  ${GREEN}1) SOFT${NC} - Ayarlar korunsun"
    echo "     - Container durdurulur ve kaldirilir"
    echo "     - .env DOKUNULMAZ ve yedeklenir"
    echo "     - Volume'lar (lisans verisi) DOKUNULMAZ"
    echo "     - Docker / sistem paketleri kalir"
    echo ""
    echo -e "  ${RED}2) FULL${NC} - Tum izleri sil"
    echo "     - Container + volume + .env + kurulum dizini silinir"
    echo "     - Eger Docker bu betik tarafindan kurulduysa o da silinir"
    echo "     - (Onceden manuel kurulu Docker kalir)"
    echo "     - Hicbir iz kalmaz"
    echo ""
    read -rp "  Seciminiz [1=soft / 2=full, varsayilan 1]: " CHOICE || CHOICE="1"
    case "${CHOICE:-1}" in
        2|full|FULL) MODE="full" ;;
        *)           MODE="soft" ;;
    esac
fi

case "$MODE" in
    soft|full) ;;
    *) fatal "Gecersiz MODE: $MODE (soft veya full olmali)" ;;
esac

info "Secilen mod: $MODE"

if [[ "$MODE" == "full" && "$IS_INTERACTIVE" == "true" ]]; then
    echo ""
    echo -e "${RED}${BOLD}  ! UYARI: FULL purge — GERI ALINAMAZ!${NC}"
    echo -e "${RED}  Tum lisans verileri, container'lar, .env, ayarlar silinecek.${NC}"
    if [[ -f /var/lib/mailtrustai-client-docker-installed-by-script ]]; then
        echo -e "${RED}  Docker da bu betik tarafindan kurulmustu — o da kaldirilacak.${NC}"
    fi
    echo ""
    read -rp "  Onaylamak icin 'EVET SIL' yazin: " CONFIRM || CONFIRM=""
    [[ "$CONFIRM" == "EVET SIL" ]] || fatal "Iptal edildi."
fi

# ============================================================
# Compose dosyasini bul
# ============================================================
COMPOSE_FILE="$INSTALL_DIR/docker-compose.customer.yml"
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$COMPOSE_FILE" ]]; then
    COMPOSE_FILE="$REPO_ROOT/docker-compose.customer.yml"
fi

DOCKER_COMPOSE_CMD="docker compose"
docker compose version &>/dev/null 2>&1 || DOCKER_COMPOSE_CMD="docker-compose"

DOCKER_OK=false
command -v docker &>/dev/null && docker info &>/dev/null && DOCKER_OK=true

# ============================================================
# SOFT MOD — sadece container durdur, ayarlar kalsin
# ============================================================
if [[ "$MODE" == "soft" ]]; then
    step "SOFT: Container durduruluyor..."

    # .env yedegi (kullanici daha sonra erisebilsin)
    if [[ -f "$ENV_FILE" ]]; then
        TS=$(date +%Y%m%d_%H%M%S)
        BACKUP_DIR="$INSTALL_DIR/backups"
        mkdir -p "$BACKUP_DIR"
        cp "$ENV_FILE" "$BACKUP_DIR/.env.pre-uninstall.$TS"
        ok ".env yedegi: $BACKUP_DIR/.env.pre-uninstall.$TS"
    fi

    if [[ "$DOCKER_OK" == "true" && -f "$COMPOSE_FILE" ]]; then
        ENV_ARGS=""
        [[ -f "$ENV_FILE" ]] && ENV_ARGS="--env-file $ENV_FILE"
        $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
        ok "Container kaldirildi. Volume'lar korundu."
    fi

    hr
    echo -e "${GREEN}${BOLD}  ===== SOFT KALDIRMA TAMAMLANDI =====${NC}"
    echo ""
    info "Korunan:"
    info "  - $ENV_FILE ($([[ -f "$ENV_FILE" ]] && stat -c%s "$ENV_FILE" || echo "?") byte)"
    info "  - Volume'lar (mailtrustai-customer_customer-data, customer-logs)"
    info "  - Docker ve sistem paketleri"
    echo ""
    info "Yeniden kurmak icin: sudo bash $SCRIPT_DIR/install_client_ubuntu.sh"
    info "                      (mevcut .env korunur, secret'lar dokunulmaz)"
    echo ""
    exit 0
fi

# ============================================================
# FULL MOD — tum izleri sil
# ============================================================
step "FULL: Tum container'lar ve volume'lar siliniyor..."

if [[ "$DOCKER_OK" == "true" ]]; then
    if [[ -f "$COMPOSE_FILE" ]]; then
        ENV_ARGS=""
        [[ -f "$ENV_FILE" ]] && ENV_ARGS="--env-file $ENV_FILE"
        $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
    fi
    # Container'lari force sil
    docker rm -f mailtrustai-customer 2>/dev/null || true
    # Volume'lari sil
    docker volume rm mailtrustai-customer_customer-data 2>/dev/null || true
    docker volume rm mailtrustai-customer_customer-logs 2>/dev/null || true
    # Image'i sil
    docker rmi mailtrustai-customer:latest 2>/dev/null || true
    ok "Container/volume/image silindi."
else
    warn "Docker calismadigi icin docker temizligi atlandi."
fi

step "FULL: Kurulum dizini siliniyor..."
if [[ -d "$INSTALL_DIR" ]]; then
    rm -rf "$INSTALL_DIR"
    ok "Silindi: $INSTALL_DIR"
fi

# Bu betik tarafindan kurulan Docker'i kaldir (marker varsa)
if [[ -f /var/lib/mailtrustai-client-docker-installed-by-script ]]; then
    step "FULL: Bu betik tarafindan kurulan Docker kaldiriliyor..."
    warn "Sistemde baska Docker kullanan uygulamalar varsa onlar etkilenecek!"

    if [[ "$IS_INTERACTIVE" == "true" ]]; then
        read -rp "  Docker'i da kaldir? [E/h]: " RMDOCKER || RMDOCKER="E"
    else
        RMDOCKER="E"
    fi

    if [[ "${RMDOCKER,,}" == "e" || -z "${RMDOCKER:-}" || "${RMDOCKER,,}" == "y" ]]; then
        systemctl stop docker docker.socket 2>/dev/null || true
        apt-get purge -y docker-ce docker-ce-cli containerd.io \
            docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
        apt-get autoremove -y --purge 2>/dev/null || true
        rm -rf /var/lib/docker /var/lib/containerd 2>/dev/null || true
        rm -f /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.gpg 2>/dev/null || true
        rm -f /var/lib/mailtrustai-client-docker-installed-by-script
        ok "Docker tamamen kaldirildi (apt purge + /var/lib/docker)."
    else
        info "Docker korundu (kullanici reddetti)."
    fi
fi

hr
echo -e "${GREEN}${BOLD}"
echo "  ============================================================"
echo "  ===              FULL KALDIRMA TAMAMLANDI                ==="
echo "  ===              Hicbir iz kalmadi                       ==="
echo "  ============================================================"
echo -e "${NC}"
