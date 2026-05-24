#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Kaldirma Betigi
#
# Kaldirir: license-server + dealer panel + MariaDB konteynerlari
#
# Kullanim (interaktif):
#   sudo bash install/server/uninstall_server_ubuntu.sh
#
# Otomasyon (cron / CI):
#   sudo UNATTENDED=true PURGE_DATA=false bash uninstall_server_ubuntu.sh
#   sudo UNATTENDED=true PURGE_DATA=true KEEP_BACKUPS=true bash uninstall_server_ubuntu.sh
#
# Env varsayilanlari:
#   UNATTENDED      = false  (true ise hicbir soru sorulmaz)
#   PURGE_DATA      = false  (true ise volume + dizin de silinir)
#   KEEP_BACKUPS    = true   (PURGE_DATA=true iken backups/ korunsun mu)
#   INSTALL_DIR     = /opt/mailtrustai
#
# Davranis:
#   - Konteynerler her zaman durdurulur ve kaldirilir.
#   - PURGE_DATA=true (veya kullanici "EVET SIL" yazarsa) volume + dizin silinir.
# ============================================================
set -Euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
hr()    { echo -e "${CYAN}$(printf '─%.0s' {1..54})${NC}"; }

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile çalıştırılmalıdır."

echo ""
echo -e "${RED}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║   MailTrustAI  —  Sunucu Kaldırma Betiği (Ubuntu)   ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Otomasyon parametreleri ─────────────────────────────────
IS_INTERACTIVE=true
if [[ ! -t 0 ]] || [[ "${UNATTENDED:-false}" == "true" ]]; then
    IS_INTERACTIVE=false
fi

# ─── Kurulum dizinini bul ────────────────────────────────────
DEFAULT_INSTALL_DIR="/opt/mailtrustai"
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR || INPUT_DIR=""
    INSTALL_DIR="${INPUT_DIR:-${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}}"
else
    INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
    info "Non-interactive mod: INSTALL_DIR=$INSTALL_DIR"
fi
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.server.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    COMPOSE_FILE="$REPO_ROOT/docker-compose.server.yml"
fi

[[ -f "$COMPOSE_FILE" ]] || fatal "docker-compose.server.yml bulunamadı. Kurulum dizinini kontrol edin."

# ─── MariaDB verileri silinsin mi? ───────────────────────────
DELETE_DATA=false

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}  Konteynerler (license-server, dealer, MariaDB) durdurulacak ve kaldirilacak.${NC}"
    echo ""
    read -rp "  MariaDB verileri (lisans DB) SILINSIN mi? [e/H]: " DEL_DB || DEL_DB="H"
    DEL_DB="${DEL_DB:-H}"

    if [[ "${DEL_DB,,}" == "e" || "${DEL_DB,,}" == "y" || "${DEL_DB,,}" == "evet" || "${DEL_DB,,}" == "yes" ]]; then
        echo ""
        echo -e "${RED}  ! UYARI: MariaDB verileri, license-server verileri ve kurulum dizini${NC}"
        echo -e "${RED}    kalici olarak silinecek. Bu islem GERI ALINAMAZ!${NC}"
        echo ""
        read -rp "  Emin misiniz? Onaylamak icin 'EVET SIL' (veya 'EVET SİL') yazin: " CONFIRM || CONFIRM=""
        # ASCII ve Turkce I her ikisini de kabul et (locale uyumlulugu).
        if [[ "$CONFIRM" == "EVET SIL" || "$CONFIRM" == "EVET SİL" ]]; then
            DELETE_DATA=true
        else
            info "Veri silme iptal edildi. Yalnizca konteynerler kaldirilacak."
        fi
    fi
else
    # Non-interactive: PURGE_DATA env var ile yonet
    if [[ "${PURGE_DATA:-false}" == "true" ]]; then
        DELETE_DATA=true
        warn "Non-interactive PURGE_DATA=true: TUM veriler silinecek!"
    else
        info "Non-interactive PURGE_DATA=false: yalnizca konteynerler kaldirilacak."
    fi
fi

# ─── Compose komut tespiti ──────────────────────────────────
DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    command -v docker-compose &>/dev/null && DOCKER_COMPOSE_CMD="docker-compose"
fi

# ─── Docker daemon kontrolü ─────────────────────────────────
# Daemon kapaliysa down komutu uzun timeout'a girer; bunu erken yakala.
DOCKER_OK=true
if ! docker info &>/dev/null; then
    DOCKER_OK=false
    warn "Docker daemon calismiyor. Konteyner down asamasi atlanacak; sadece dosyalar temizlenir."
fi

# ─── .env belirle ───────────────────────────────────────────
ENV_ARGS=""
[[ -f "$ENV_FILE" ]] && ENV_ARGS="--env-file $ENV_FILE"

# ─── Konteynerları durdur ve kaldır ─────────────────────────
hr
info "Servisler durduruluyor ve kaldırılıyor..."

if [[ "$DOCKER_OK" == "true" ]]; then
    if [[ "$DELETE_DATA" == "true" ]]; then
        $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
        ok "Konteynerler ve Docker volume'ları kaldırıldı."
    else
        $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
        ok "Konteynerler kaldırıldı. MariaDB verileri korundu."
    fi
else
    warn "Docker daemon offline — konteyner kaldirma atlandi."
fi

# ─── Tam temizlik (veri silme onaylandıysa) ─────────────────
if [[ "$DELETE_DATA" == "true" ]]; then

    if [[ "$DOCKER_OK" == "true" ]]; then
        info "Docker image'lar siliniyor..."
        docker rmi mailtrustai-license-server:latest 2>/dev/null || true
        docker rmi mailtrustai-dealer:latest 2>/dev/null || true
        ok "Image'lar silindi."

        info "Kullanilmayan Docker aglari temizleniyor..."
        docker network prune -f 2>/dev/null || true

        info "Kullanilmayan Docker volume'lari temizleniyor..."
        docker volume prune -f 2>/dev/null || true
    else
        warn "Docker offline — image/network/volume temizligi atlandi."
    fi

    if [[ -d "$INSTALL_DIR" ]]; then
        HAS_BACKUPS=false
        [[ -d "$INSTALL_DIR/backups" ]] && compgen -G "$INSTALL_DIR/backups/*" > /dev/null 2>&1 && HAS_BACKUPS=true

        if [[ "$HAS_BACKUPS" == "true" ]]; then
            DEL_BKUP="H"  # Default: yedekleri koru
            if [[ "$IS_INTERACTIVE" == "true" ]]; then
                echo ""
                warn "Yedek dosyalari mevcut! Silmeden once incelemeniz onerilir:"
                ls -lh "$INSTALL_DIR/backups/" 2>/dev/null || true
                echo ""
                read -rp "  Yedekleri de sil? [e/H]: " DEL_BKUP || DEL_BKUP="H"
            else
                # Non-interactive: KEEP_BACKUPS=false ile yedekler de silinir
                if [[ "${KEEP_BACKUPS:-true}" == "false" ]]; then
                    DEL_BKUP="e"
                    warn "Non-interactive KEEP_BACKUPS=false: yedekler de silinecek!"
                else
                    info "Non-interactive KEEP_BACKUPS=true: yedekler korunacak."
                fi
            fi

            if [[ "${DEL_BKUP,,}" == "e" || "${DEL_BKUP,,}" == "y" ]]; then
                rm -rf "$INSTALL_DIR"
                ok "Kurulum dizini tamamen silindi: $INSTALL_DIR"
            else
                rm -rf "$INSTALL_DIR"/{docker-compose.server.yml,.env,mailtrustai-ctl.sh,.repo_path,.install_success,logs} 2>/dev/null || true
                ok "Kurulum dosyalari silindi. Yedekler korundu: $INSTALL_DIR/backups/"
            fi
        else
            rm -rf "$INSTALL_DIR"
            ok "Kurulum dizini silindi: $INSTALL_DIR"
        fi
    fi

fi

# ─── Özet ───────────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}  ✓  Kaldırma tamamlandı.${NC}"
echo ""

if [[ "$DELETE_DATA" == "false" ]]; then
    echo -e "  ${YELLOW}  Veriler korundu: $INSTALL_DIR${NC}"
    echo -e "  ${YELLOW}  MariaDB volume'ları silinmedi.${NC}"
    echo ""
    echo -e "  Yeniden kurmak için:"
    echo -e "  ${CYAN}  sudo bash install/server/install_server_ubuntu.sh${NC}"
    echo ""
fi

hr
