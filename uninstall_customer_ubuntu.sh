#!/usr/bin/env bash
# ==============================================================================
#  MailTrustAI Müşteri — Kaldırma Scripti — v2.0 (3-tier)
#  Kullanım: sudo ./uninstall_customer_ubuntu.sh [--purge-data]
# ==============================================================================
set -euo pipefail

readonly RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[UYARI]${NC} $*"; }
err()  { echo -e "${RED}[HATA]${NC} $*" >&2; }
step() { echo -e "\n${CYAN}▶${NC} $*"; }

[[ $EUID -eq 0 ]] || { err "sudo gerekir."; exit 1; }

APP_DIR="${APP_DIR:-/opt/mailtrustai-customer}"
COMPOSE_FILE="docker-compose.customer.yml"
ENV_FILE=".env.docker"

PURGE_DATA=false
KEEP_REPO=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge-data) PURGE_DATA=true; shift ;;
        --keep-repo)  KEEP_REPO=true;  shift ;;
        --app-dir)    APP_DIR="$2";    shift 2 ;;
        -h|--help)
            cat <<HELP
sudo ./uninstall_customer_ubuntu.sh [SEÇENEKLER]
  --purge-data   Volume'ları sil — IMAP credential + tarama geçmişi KAYBOLUR
  --keep-repo    Repo klasörünü silme
  --app-dir <p>  Kurulum dizini (default: /opt/mailtrustai-customer)
HELP
            exit 0 ;;
        *) warn "Bilinmeyen: $1"; shift ;;
    esac
done

echo "Kaldırılacak: $APP_DIR"
if [[ "$PURGE_DATA" == "true" ]]; then
    warn "DİKKAT: Volume'lar silinecek — tüm ayar/IMAP/tarama verisi KAYBOLACAK."
fi
read -r -p "Devam edilsin mi? [e/H]: " ans
[[ "$ans" =~ ^[eE]$ ]] || { echo "İptal."; exit 0; }

step "1) Systemd servisini durdur"
systemctl stop mailtrustai-customer.service 2>/dev/null || true
systemctl disable mailtrustai-customer.service 2>/dev/null || true
rm -f /etc/systemd/system/mailtrustai-customer.service
systemctl daemon-reload
log "Systemd kaldırıldı."

step "2) Docker container'ı durdur"
if [[ -d "$APP_DIR" && -f "$APP_DIR/$COMPOSE_FILE" ]]; then
    cd "$APP_DIR"
    if [[ "$PURGE_DATA" == "true" ]]; then
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
        log "Container + volume'lar silindi."
    else
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true
        log "Container silindi (volume'lar korundu)."
    fi
fi

step "3) Customer image'ını sil"
docker rmi -f mailtrustai-customer:latest 2>/dev/null || true
log "Image silindi."

if [[ "$KEEP_REPO" == "false" && -d "$APP_DIR" ]]; then
    step "4) Repo klasörünü sil"
    rm -rf "$APP_DIR"
    log "$APP_DIR kaldırıldı."
elif [[ -d "$APP_DIR" ]]; then
    warn "Repo korundu: $APP_DIR"
fi

echo ""
log "Müşteri kurulumu kaldırıldı."
