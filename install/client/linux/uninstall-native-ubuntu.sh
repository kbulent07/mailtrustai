#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri NATIVE Kaldirma Betigi
#
# systemd servisini durdurur/kaldirir. --purge ile veriler de silinir.
#
# Kullanim:
#   sudo bash install/client/linux/uninstall-native-ubuntu.sh
#   sudo bash .../uninstall-native-ubuntu.sh --purge          # her seyi sil
#   sudo INSTALL_DIR=/opt/mailtrustai bash .../uninstall-native-ubuntu.sh
#
# Ortam degiskenleri (non-interactive):
#   PURGE=1          -> veriler + kurulum dizini silinir (GERI ALINAMAZ)
#   KEEP_BACKUPS=1   -> purge'da backups/ korunur
#   REMOVE_USER=1    -> servis kullanicisi 'mailtrustai' silinir
# ============================================================
set -Euo pipefail

SERVICE_NAME="mailtrustai"
SERVICE_USER="mailtrustai"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd || echo /opt/mailtrustai)}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

PURGE="${PURGE:-0}"
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        --keep-backups) KEEP_BACKUPS=1 ;;
        --remove-user)  REMOVE_USER=1 ;;
    esac
done
KEEP_BACKUPS="${KEEP_BACKUPS:-0}"
REMOVE_USER="${REMOVE_USER:-0}"

echo ""
echo -e "${RED}${BOLD}  === MailTrustAI - Ubuntu NATIVE Kaldirma === ${NC}"
info "Kurulum: $INSTALL_DIR"
[[ "$PURGE" == "1" ]] && warn "PURGE MODU: veriler kalici silinecek!"

IS_INTERACTIVE=true; [[ ! -t 0 ]] && IS_INTERACTIVE=false
if [[ "$PURGE" == "1" && "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Tum veriler silinecek. Devam icin 'EVET SIL' yazin: " CONFIRM || CONFIRM=""
    [[ "$CONFIRM" == "EVET SIL" ]] || { info "Iptal edildi."; exit 0; }
fi

# --- Servisi durdur/kaldir ---
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; then
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "systemd servisi kaldirildi: ${SERVICE_NAME}"
else
    warn "Servis bulunamadi: ${SERVICE_NAME} (zaten kaldirilmis olabilir)."
fi

# --- SOFT: .env yedegi ---
if [[ "$PURGE" != "1" && -f "$INSTALL_DIR/.env" ]]; then
    mkdir -p "$INSTALL_DIR/backups"
    cp "$INSTALL_DIR/.env" "$INSTALL_DIR/backups/.env.pre-uninstall.$(date +%Y%m%d_%H%M%S)"
    ok "Env yedegi alindi (veriler korunuyor)."
fi

# --- PURGE: dizini sil ---
if [[ "$PURGE" == "1" ]]; then
    if [[ "$KEEP_BACKUPS" == "1" && -d "$INSTALL_DIR/backups" ]]; then
        find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name backups -exec rm -rf {} + 2>/dev/null || true
        ok "Kurulum silindi, yedekler korundu: $INSTALL_DIR/backups"
    else
        rm -rf "$INSTALL_DIR"
        ok "Kurulum dizini silindi: $INSTALL_DIR"
    fi
    if [[ "$REMOVE_USER" == "1" ]] && id "$SERVICE_USER" &>/dev/null; then
        userdel "$SERVICE_USER" 2>/dev/null || true
        ok "Servis kullanicisi silindi: $SERVICE_USER"
    fi
fi

echo ""
ok "Kaldirma tamamlandi."
[[ "$PURGE" != "1" ]] && info "Veriler korundu: $INSTALL_DIR (yeniden kurmak icin install-native-ubuntu.sh)"
echo -e "${CYAN}Not: Node.js sistemde birakildi (baska uygulamalar kullanabilir).${NC}"
