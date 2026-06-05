#!/usr/bin/env bash
# ============================================================
# MailTrustAI Customer -- Ubuntu/Linux Docker Geri Yukleme
#
# Kullanim (yedek dizini belirt):
#   bash scripts/backup/restore-customer-ubuntu.sh /opt/mailtrustai/backups/2026-05-24_152000
#
# Kullanim (secim menusu — arguman verilmezse):
#   bash scripts/backup/restore-customer-ubuntu.sh
#   -> $INSTALL_DIR/backups/ taranir, tarihli klasorler listelenir, secim yapilir
#
# Farkli kurulum dizini:
#   INSTALL_DIR=/opt/baska bash scripts/backup/restore-customer-ubuntu.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'

ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
info()  { echo -e "${CYAN}[BILGI]${NC} $*"; }
warn()  { echo -e "${YELLOW}[UYARI]${NC} $*"; }
fatal() { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }

INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.customer.yml"

echo "==========================================================="
echo " MailTrustAI Customer -- Geri Yukleme"
echo "==========================================================="

# --- Yedek dizini belirlenmemisse listele ve sec ----------------
if [[ -n "${1:-}" ]]; then
    BACKUP_DIR="$1"
else
    BACKUPS_ROOT="$INSTALL_DIR/backups"

    if [[ ! -d "$BACKUPS_ROOT" ]]; then
        fatal "Yedek klasoru bulunamadi: $BACKUPS_ROOT
  Once yedek alin: bash scripts/backup/backup-customer-ubuntu.sh"
    fi

    # .env ve customer-data.tar.gz iceren tarihli klasorleri bul
    mapfile -t CANDIDATES < <(
        find "$BACKUPS_ROOT" -mindepth 1 -maxdepth 1 -type d \
            -exec sh -c '[ -f "$1/.env" ] && [ -f "$1/customer-data.tar.gz" ]' _ {} \; \
            -print | sort -r
    )

    if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
        fatal "Gecerli yedek bulunamadi: $BACKUPS_ROOT
  Gecerli yedek = .env + customer-data.tar.gz iceren klasor."
    fi

    echo ""
    echo -e "${CYAN} Mevcut yedekler (en yeni ustte):${NC}"
    echo ""
    for i in "${!CANDIDATES[@]}"; do
        SIZE=$(du -sh "${CANDIDATES[$i]}/customer-data.tar.gz" 2>/dev/null | cut -f1)
        printf "  [%d] %-30s  (%s)\n" $((i+1)) "$(basename "${CANDIDATES[$i]}")" "$SIZE"
    done
    echo ""
    read -rp "  Geri yuklenecek yedegi secin [1-${#CANDIDATES[@]}] (iptal: Enter): " CHOICE || CHOICE=""

    if [[ -z "$CHOICE" ]]; then
        echo " Iptal edildi."
        exit 0
    fi

    if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || \
       [[ $CHOICE -lt 1 ]] || [[ $CHOICE -gt ${#CANDIDATES[@]} ]]; then
        fatal "Gecersiz secim: $CHOICE"
    fi

    BACKUP_DIR="${CANDIDATES[$((CHOICE-1))]}"
    echo ""
    info "Secilen yedek: $BACKUP_DIR"
fi

# --- Tam yola cevir ---------------------------------------------
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

# --- Yedek icerigini dogrula ------------------------------------
[[ -f "$BACKUP_DIR/.env" ]] \
    || fatal ".env bulunamadi: $BACKUP_DIR/.env"
[[ -f "$BACKUP_DIR/customer-data.tar.gz" ]] \
    || fatal "customer-data.tar.gz bulunamadi: $BACKUP_DIR/customer-data.tar.gz"

[[ -f "$COMPOSE_FILE" ]] \
    || fatal "Compose dosyasi bulunamadi: $COMPOSE_FILE
  Once taze kurulum yapin: bash install/client/linux/install-docker-ubuntu.sh"

echo ""
echo " Kaynak : $BACKUP_DIR"
echo " Hedef  : $INSTALL_DIR"
echo ""
read -rp " Geri yukleme baslasin mi? Mevcut veri SILINECEK. [e/H]: " CONFIRM || CONFIRM="H"
if [[ ! "${CONFIRM,,}" =~ ^[ey] ]]; then
    echo " Iptal edildi."
    exit 0
fi

echo ""

# --- 1) Container durdur ----------------------------------------
echo " [1/4] Container durduruluyor..."
DOCKER_COMPOSE="docker compose"
docker compose version &>/dev/null 2>&1 || DOCKER_COMPOSE="docker-compose"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^mailtrustai-customer$'; then
    $DOCKER_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down 2>/dev/null || true
    ok "Container durduruldu."
else
    echo "  Container zaten calismiyor."
fi

# --- 2) .env yedekle + geri yukle ------------------------------
echo " [2/4] .env geri yukleniyor..."
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$INSTALL_DIR/backups"
if [[ -f "$ENV_FILE" ]]; then
    cp "$ENV_FILE" "$INSTALL_DIR/backups/.env.before-restore-$STAMP"
    echo "  Mevcut .env yedeklendi: .env.before-restore-$STAMP"
fi
cp "$BACKUP_DIR/.env" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok ".env geri yuklendi."

# --- 3) Volume temizle + geri yukle ----------------------------
echo " [3/4] Volume geri yukleniyor..."
VOLUME="mailtrustai-customer_customer-data"
docker volume create "$VOLUME" >/dev/null

docker run --rm -v "${VOLUME}:/data" alpine \
    sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null || true"

docker run --rm \
    -v "${VOLUME}:/data" \
    -v "${BACKUP_DIR}:/backup:ro" \
    alpine \
    sh -c "cd /data && tar xzf /backup/customer-data.tar.gz" \
    || fatal "Volume geri yuklenemedi."

ok "Volume geri yuklendi."

# --- 4) Container baslat ----------------------------------------
echo " [4/4] Container baslatiliyor..."
$DOCKER_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
sleep 8
$DOCKER_COMPOSE --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo ""
echo "==========================================================="
ok "Geri yukleme tamam."
echo " Uygulama: http://localhost:3000"
echo "==========================================================="
