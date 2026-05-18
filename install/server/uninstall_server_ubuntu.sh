#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Kaldırma Betiği
#
# Kaldırır: license-server + dealer panel + MariaDB konteynerları
#
# Kullanım:
#   sudo bash install/server/uninstall_server_ubuntu.sh
#
# Davranış:
#   • Konteynerler her zaman durdurulur ve kaldırılır.
#   • MariaDB verileri silinsin mi? → ayrıca sorulur.
#   • "Evet, sil" seçilirse tüm kurulum (volume, image, dizin) silinir.
# ============================================================
set -euo pipefail

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

# ─── Kurulum dizinini bul ────────────────────────────────────
DEFAULT_INSTALL_DIR="/opt/mailtrustai"
read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR
INSTALL_DIR="${INPUT_DIR:-$DEFAULT_INSTALL_DIR}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.server.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    COMPOSE_FILE="$REPO_ROOT/docker-compose.server.yml"
fi

[[ -f "$COMPOSE_FILE" ]] || fatal "docker-compose.server.yml bulunamadı. Kurulum dizinini kontrol edin."

# ─── MariaDB verileri silinsin mi? ───────────────────────────
echo ""
echo -e "${YELLOW}  Konteynerler (license-server, dealer, MariaDB) durdurulacak ve kaldırılacak.${NC}"
echo ""
read -rp "  MariaDB verileri (lisans DB) SİLİNSİN mi? [e/H]: " DEL_DB
DEL_DB="${DEL_DB:-H}"

DELETE_DATA=false
if [[ "${DEL_DB,,}" == "e" || "${DEL_DB,,}" == "y" || "${DEL_DB,,}" == "evet" || "${DEL_DB,,}" == "yes" ]]; then
    echo ""
    echo -e "${RED}  ⚠  UYARI: MariaDB verileri, license-server verileri ve kurulum dizini${NC}"
    echo -e "${RED}     kalıcı olarak silinecek. Bu işlem GERİ ALINAMAZ!${NC}"
    echo ""
    read -rp "  Emin misiniz? Onaylamak için 'EVET SİL' yazın: " CONFIRM
    if [[ "$CONFIRM" == "EVET SİL" ]]; then
        DELETE_DATA=true
    else
        info "Veri silme iptal edildi. Yalnızca konteynerler kaldırılacak."
    fi
fi

# ─── Compose komut tespiti ──────────────────────────────────
DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    command -v docker-compose &>/dev/null && DOCKER_COMPOSE_CMD="docker-compose"
fi

# ─── .env belirle ───────────────────────────────────────────
ENV_ARGS=""
[[ -f "$ENV_FILE" ]] && ENV_ARGS="--env-file $ENV_FILE"

# ─── Konteynerları durdur ve kaldır ─────────────────────────
hr
info "Servisler durduruluyor ve kaldırılıyor..."

if [[ "$DELETE_DATA" == "true" ]]; then
    $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
    ok "Konteynerler ve Docker volume'ları kaldırıldı."
else
    $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
    ok "Konteynerler kaldırıldı. MariaDB verileri korundu."
fi

# ─── Tam temizlik (veri silme onaylandıysa) ─────────────────
if [[ "$DELETE_DATA" == "true" ]]; then

    info "Docker image'lar siliniyor..."
    docker rmi mailtrustai-license-server:latest 2>/dev/null || true
    docker rmi mailtrustai-dealer:latest 2>/dev/null || true
    ok "Image'lar silindi."

    info "Kullanılmayan Docker ağları temizleniyor..."
    docker network prune -f 2>/dev/null || true

    info "Kullanılmayan Docker volume'ları temizleniyor..."
    docker volume prune -f 2>/dev/null || true

    if [[ -d "$INSTALL_DIR" ]]; then
        if [[ -d "$INSTALL_DIR/backups" ]] && compgen -G "$INSTALL_DIR/backups/*" > /dev/null 2>&1; then
            echo ""
            warn "Yedek dosyaları mevcut! Silmeden önce incelemeniz önerilir:"
            ls -lh "$INSTALL_DIR/backups/" 2>/dev/null || true
            echo ""
            read -rp "  Yedekleri de sil? [e/H]: " DEL_BKUP
            if [[ "${DEL_BKUP,,}" == "e" || "${DEL_BKUP,,}" == "y" ]]; then
                rm -rf "$INSTALL_DIR"
                ok "Kurulum dizini tamamen silindi: $INSTALL_DIR"
            else
                rm -rf "$INSTALL_DIR"/{docker-compose.server.yml,.env,mailtrustai-ctl.sh,.repo_path,logs} 2>/dev/null || true
                ok "Kurulum dosyaları silindi. Yedekler korundu: $INSTALL_DIR/backups/"
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
