#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Linux Sunucu Kaldırma Betiği
#
# Kullanım:
#   sudo bash install/server/uninstall.sh [--purge]
#
# --purge  : Tüm verileri (MariaDB, license-server) ve .env'i SİL.
#            GERI ALINAMAZ — dikkatli kullanın!
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

PURGE=false
for arg in "$@"; do
    [[ "$arg" == "--purge" ]] && PURGE=true
done

echo ""
echo -e "${RED}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║       MailTrustAI  —  Sunucu Kaldırma Betiği        ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

if [[ "$PURGE" == "true" ]]; then
    echo -e "${RED}${BOLD}  ⚠  --purge modu: TÜM VERİLER SİLİNECEK (MariaDB, lisans verileri, .env)${NC}"
    echo ""
fi

# ─── Kurulum dizinini bul ────────────────────────────────────
DEFAULT_INSTALL_DIR="/opt/mailtrustai"
read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR
INSTALL_DIR="${INPUT_DIR:-$DEFAULT_INSTALL_DIR}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.server.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
    # Repo root'tan çalışıyorsa
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    COMPOSE_FILE="$REPO_ROOT/docker-compose.server.yml"
fi

[[ -f "$COMPOSE_FILE" ]] || fatal "docker-compose.server.yml bulunamadı. Kurulum dizinini kontrol edin."

# ─── Onay ───────────────────────────────────────────────────
echo ""
if [[ "$PURGE" == "true" ]]; then
    echo -e "${RED}  ÇOK ÖNEMLİ: Bu işlem GERİ ALINAMAZ!${NC}"
    echo -e "${RED}  MariaDB, license-server verileri ve .env dosyası silinecek.${NC}"
    echo ""
    read -rp "  Devam etmek için 'EVET SİL' yazın: " CONFIRM
    [[ "$CONFIRM" == "EVET SİL" ]] || { info "İptal edildi."; exit 0; }
else
    echo -e "${YELLOW}  Konteynerler durdurulacak ve silinecek.${NC}"
    echo -e "${YELLOW}  Veriler (volumes) KORUNACAK. Silmek için: --purge${NC}"
    echo ""
    read -rp "  Devam etmek için Enter'a basın (Ctrl+C ile iptal): " _
fi

# ─── Compose komut tespiti ──────────────────────────────────
DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    command -v docker-compose &>/dev/null && DOCKER_COMPOSE_CMD="docker-compose"
fi

# ─── .env belirle ───────────────────────────────────────────
ENV_ARGS=""
[[ -f "$ENV_FILE" ]] && ENV_ARGS="--env-file $ENV_FILE"

# ─── Konteynerları durdur ───────────────────────────────────
hr
info "Servisler durduruluyor..."
$DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
ok "Konteynerler durduruldu ve kaldırıldı."

# ─── Purge: volumes + dosyalar ──────────────────────────────
if [[ "$PURGE" == "true" ]]; then
    info "Docker volume'ları siliniyor..."
    $DOCKER_COMPOSE_CMD $ENV_ARGS -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    ok "Volume'lar silindi."

    info "Image'lar siliniyor..."
    docker rmi mailtrustai-license-server:latest mailtrustai-dealer:latest 2>/dev/null || true
    ok "Image'lar silindi."

    if [[ -d "$INSTALL_DIR" ]]; then
        info "Kurulum dizini siliniyor: $INSTALL_DIR"
        # Önce yedeği kontrol et
        if [[ -d "$INSTALL_DIR/backups" ]] && compgen -G "$INSTALL_DIR/backups/*" > /dev/null 2>&1; then
            warn "Yedek dosyaları var! Silmeden önce incelemeniz önerilir:"
            ls -lh "$INSTALL_DIR/backups/" 2>/dev/null || true
            read -rp "  Yedekleri de sil? [e/H]: " DEL_BKUP
            [[ "${DEL_BKUP,,}" == "e" || "${DEL_BKUP,,}" == "y" ]] || {
                warn "Yedekler korunuyor. Kurulum dizini tam silinmedi."
                rm -rf "$INSTALL_DIR"/{*.yml,.env,mailtrustai-ctl.sh,.repo_path,logs} 2>/dev/null || true
                ok "Yedekler hariç dizin temizlendi: $INSTALL_DIR/backups/"
                echo ""
                echo -e "${YELLOW}  Yedekler: $INSTALL_DIR/backups/${NC}"
                exit 0
            }
        fi
        rm -rf "$INSTALL_DIR"
        ok "Kurulum dizini silindi: $INSTALL_DIR"
    fi
else
    # Sadece konteyner kaldırma — volume ve dizin korunuyor
    ok "Veriler korundu: $INSTALL_DIR"
    echo ""
    warn "Verileri de silmek için: sudo bash install/server/uninstall.sh --purge"
fi

# ─── Özet ───────────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}  ✓  Kaldırma tamamlandı.${NC}"
echo ""
if [[ "$PURGE" == "false" ]]; then
    echo -e "  Yeniden kurmak için:"
    echo -e "  ${CYAN}  sudo bash install/server/install.sh${NC}"
    echo ""
fi
hr
