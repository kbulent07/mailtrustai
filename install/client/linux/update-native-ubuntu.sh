#!/usr/bin/env bash
# ============================================================
# MailTrustAI - Ubuntu Musteri NATIVE Guncelleme Betigi
#
# - .env DOKUNULMAZ (lisans + secret korunur)
# - data/ ve logs/ DOKUNULMAZ
# - git pull + npm install + strip + guvenlik kontrolu + servis restart
#
# Kullanim:
#   sudo bash install/client/linux/update-native-ubuntu.sh
#   sudo INSTALL_DIR=/opt/mailtrustai bash .../update-native-ubuntu.sh
# ============================================================
set -Euo pipefail

SERVICE_NAME="mailtrustai"
SERVICE_USER="mailtrustai"
BRANCH="mainpaketler"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd || echo /opt/mailtrustai)}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}>>> $*${NC}"; }

[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$INSTALL_DIR/backups"
UPGRADE_LOG="$BACKUP_DIR/update-$TS.log"
mkdir -p "$BACKUP_DIR"
exec > >(tee -a "$UPGRADE_LOG") 2>&1

echo ""
echo -e "${CYAN}${BOLD}  === MailTrustAI - Ubuntu NATIVE Guncelleme === ${NC}"
info "Kurulum: $INSTALL_DIR"
info "Log    : $UPGRADE_LOG"

[[ -d "$INSTALL_DIR/.git" ]] || fatal "$INSTALL_DIR bir git repo'su degil. Once install-native-ubuntu.sh calistirin."
[[ -f "$INSTALL_DIR/.env" ]] || fatal ".env bulunamadi: $INSTALL_DIR/.env"

cd "$INSTALL_DIR"

# --- Yedek (.env + data) ---
step "1/6  Yedek aliniyor..."
cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env.$TS"
tar czf "$BACKUP_DIR/data-$TS.tar.gz" -C "$INSTALL_DIR" data 2>/dev/null || true
ok "Yedek: $BACKUP_DIR/.env.$TS"

# --- git pull ---
step "2/6  Kaynak guncelleniyor (git)..."
PREV=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
git fetch --depth 1 origin "$BRANCH"
git checkout -q "$BRANCH"
git reset --hard "origin/$BRANCH"
NEW=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
ok "Surum: $PREV -> $NEW"

# --- npm install ---
step "3/6  Bagimliliklar guncelleniyor..."
npm install --omit=dev --no-audit --no-fund --prefix "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/node_modules/@mailtrustai"
for p in "$INSTALL_DIR"/packages/*/; do
    [[ -d "$p" ]] || continue
    ln -sfn "$p" "$INSTALL_DIR/node_modules/@mailtrustai/$(basename "$p")"
done
ok "node_modules guncel."

# --- strip + guvenlik ---
step "4/6  Musteri agaci temizleniyor + guvenlik kontrolu..."
node "$INSTALL_DIR/scripts/strip-customer-tree.js"
[[ -L "$INSTALL_DIR/node_modules/@mailtrustai/license-core" ]] && rm -f "$INSTALL_DIR/node_modules/@mailtrustai/license-core" || true
MSA_CUSTOMER_BUILD=1 node "$INSTALL_DIR/scripts/check-customer-package.js" --scope=image \
    || fatal "GUVENLIK KONTROLU BASARISIZ — guncelleme durduruldu."
ok "Guvenlik kontrolu basarili."

# --- sahiplik + restart ---
step "5/6  Servis yeniden baslatiliyor..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" 2>/dev/null || true
chmod 600 "$INSTALL_DIR/.env"
systemctl restart "$SERVICE_NAME"
ok "Servis yeniden baslatildi."

# --- saglik ---
step "6/6  Saglik kontrolu..."
PORT=$(grep '^PORT=' "$INSTALL_DIR/.env" | head -1 | cut -d= -f2 | tr -d '[:space:]'); PORT="${PORT:-3000}"
ELAPSED=0; HEALTH_OK=false; sleep 5
while [[ $ELAPSED -lt 60 ]]; do
    if curl -sf "http://localhost:${PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; then HEALTH_OK=true; break; fi
    sleep 5; ELAPSED=$((ELAPSED + 5))
done

echo ""
if [[ "$HEALTH_OK" == "true" ]]; then
    echo -e "${GREEN}${BOLD}  === GUNCELLEME TAMAMLANDI ($PREV -> $NEW) === ${NC}"
    echo -e "  Uygulama: ${CYAN}http://localhost:${PORT}${NC}"
else
    echo -e "${YELLOW}${BOLD}  === GUNCELLEME BITTI - SAGLIK KONTROLU EKSIK === ${NC}"
    warn "Loglar: journalctl -u ${SERVICE_NAME} -n 80"
    echo -e "  Rollback: ${CYAN}cd $INSTALL_DIR && git reset --hard $PREV && systemctl restart $SERVICE_NAME${NC}"
fi
