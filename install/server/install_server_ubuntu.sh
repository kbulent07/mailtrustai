#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Ubuntu Sunucu Kurulum Betiği
#
# Kurar: license-server (port 3200) + dealer panel (3100) + MariaDB
# Gereksinim: Ubuntu 22.04 LTS / 24.04 LTS, Docker 24+, 2 GB RAM
#
# Kullanım (repo kök dizininden):
#   sudo bash install/server/install_server_ubuntu.sh
#
# İlk kurulum : Secret'lar otomatik üretilir ve .env dosyasına yazılır.
# Güncelleme  : Mevcut .env korunur, yalnızca image yeniden derlenir.
# ============================================================
set -Euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Log dosyasi (her calistirma kaydedilir) ────────────────
INSTALL_LOG="/tmp/mailtrustai-install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$INSTALL_LOG") 2>&1

# ─── Renkler ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal()   { echo -e "${RED}[HATA]${NC}  $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}>>> $*${NC}"; }
hr()      { echo -e "${CYAN}------------------------------------------------------${NC}"; }

# ─── ERR trap: hangi satirda patladigini goster ─────────────
on_error() {
    local exit_code=$?
    local line=$1
    echo "" >&2
    echo -e "${RED}${BOLD}===== KURULUM BASARISIZ =====${NC}" >&2
    echo -e "${RED}Cikis kodu : ${exit_code}${NC}" >&2
    echo -e "${RED}Satir no   : ${line}${NC}" >&2
    echo -e "${RED}Komut      : ${BASH_COMMAND}${NC}" >&2
    echo -e "${YELLOW}Tam log    : ${INSTALL_LOG}${NC}" >&2
    echo "" >&2
    exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# ─── Interaktif/non-interactive tespiti ─────────────────────
# stdin TTY degilse (curl|bash, ssh -T vs.) read calismaz.
# Bu durumda kullanicidan sessizce default'lara dusmek yerine
# ortam degiskenlerini bekleriz.
IS_INTERACTIVE=true
if [[ ! -t 0 ]]; then
    IS_INTERACTIVE=false
fi

# openssl rand ile güvenli rastgele değer üretir.
# pipefail ile pipe içinde head kullanmak SIGPIPE riski taşır;
# tüm çıktıyı önce değişkene alıp sonra keserek sorundan kaçınılır.
gen32() {
    openssl rand -hex 32
}

genpass() {
    # Önce tüm base64'ü üret, ardından filtrele — pipefail güvenli
    local raw
    raw=$(openssl rand -base64 36)
    # Özel karakterleri kaldır ve 28 karakter al
    printf '%s' "${raw//[\/+=]/}" | head -c 28
    echo ""
}

# ─── Root kontrolü ──────────────────────────────────────────
[[ $EUID -eq 0 ]] || fatal "Bu betik root (sudo) ile calistirilmalidir."

# ─── Banner ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║   MailTrustAI  —  Sunucu Kurulum Betigi (Ubuntu)    ║"
echo "  ║   license-server + dealer panel + MariaDB            ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. Ubuntu kontrolü ─────────────────────────────────────
step "Ubuntu kontrol ediliyor..."

if [[ ! -f /etc/lsb-release ]] || ! grep -qi ubuntu /etc/lsb-release 2>/dev/null; then
    fatal "Bu betik yalnizca Ubuntu (22.04 / 24.04 LTS) uzerinde calisir."
fi

UBUNTU_VER=$(grep DISTRIB_RELEASE /etc/lsb-release | cut -d= -f2)
info "Ubuntu $UBUNTU_VER tespit edildi."

# ─── 2. Docker kurulum kontrolü ─────────────────────────────
step "Docker kontrol ediliyor..."

install_docker_ubuntu() {
    info "Docker Engine kuruluyor (resmi Docker deposu)..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu \
        $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    systemctl enable --now docker
    ok "Docker Engine kuruldu."
}

if ! command -v docker &>/dev/null; then
    warn "Docker bulunamadi. Ubuntu icin otomatik kurulum yapiliyor..."
    install_docker_ubuntu
fi

if ! docker info &>/dev/null; then
    fatal "Docker daemon calısmiyor. Baslatin: systemctl start docker"
fi

DOCKER_COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    if command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
        warn "Eski docker-compose kullaniliyor. 'docker compose' plugin onerilir."
    else
        fatal "docker compose plugin bulunamadi. Docker 24+ kurun veya compose plugin ekleyin."
    fi
fi

ok "Docker hazir: $(docker --version)"
ok "Compose  : $($DOCKER_COMPOSE_CMD version --short 2>/dev/null || echo 'v1')"

# ─── 3. Yapılandırma ────────────────────────────────────────
step "Kurulum yapilandirmasi..."
hr

DEFAULT_INSTALL_DIR="/opt/mailtrustai"

# Tum read'lerden once stdin durumunu bildir.
if [[ "$IS_INTERACTIVE" == "false" ]]; then
    warn "Stdin TTY degil (non-interactive mod). Ortam degiskenleri kullanilacak:"
    warn "  INSTALL_DIR, SERVER_HOST, LS_PORT, DEALER_PORT_VAR, DB_PORT"
fi

# read komutu non-interactive modda hata vermeden EOF doner.
# `|| true` ile set -e'nin script'i sessizce oldurmesini engelliyoruz.
if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Kurulum dizini [${DEFAULT_INSTALL_DIR}]: " INPUT_DIR || INPUT_DIR=""
else
    INPUT_DIR="${INSTALL_DIR:-}"
fi
INSTALL_DIR="${INPUT_DIR:-${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}}"

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Sunucu domain veya IP (or: license.firma.com ya da 1.2.3.4): " SERVER_HOST_INPUT || SERVER_HOST_INPUT=""
    SERVER_HOST="${SERVER_HOST_INPUT:-${SERVER_HOST:-}}"
else
    SERVER_HOST="${SERVER_HOST:-}"
fi
if [[ -z "${SERVER_HOST:-}" ]]; then
    fatal "Sunucu adresi zorunludur. (Non-interactive modda SERVER_HOST=... olarak gecin.)"
fi

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  License-server port [3200]: " LS_PORT_INPUT || LS_PORT_INPUT=""
    LS_PORT="${LS_PORT_INPUT:-${LS_PORT:-3200}}"
else
    LS_PORT="${LS_PORT:-3200}"
fi

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  Dealer panel port   [3100]: " DEALER_PORT_INPUT || DEALER_PORT_INPUT=""
    DEALER_PORT_VAR="${DEALER_PORT_INPUT:-${DEALER_PORT_VAR:-3100}}"
else
    DEALER_PORT_VAR="${DEALER_PORT_VAR:-3100}"
fi

if [[ "$IS_INTERACTIVE" == "true" ]]; then
    read -rp "  MariaDB dis portu (0 = sadece ic ag) [0]: " DB_PORT_INPUT || DB_PORT_INPUT=""
    DB_PORT="${DB_PORT_INPUT:-${DB_PORT:-0}}"
else
    DB_PORT="${DB_PORT:-0}"
fi

# Secilen ayarlari ekrana yaz (debug + log).
hr
info "Secilen yapilandirma:"
info "  INSTALL_DIR  = $INSTALL_DIR"
info "  SERVER_HOST  = $SERVER_HOST"
info "  LS_PORT      = $LS_PORT"
info "  DEALER_PORT  = $DEALER_PORT_VAR"
info "  DB_PORT      = $DB_PORT (0 = disa kapali)"
info "  Log dosyasi  = $INSTALL_LOG"
hr

ENV_FILE="$INSTALL_DIR/.env"

# ─── 4. Dizin yapısı (ENV kontrolünden önce oluştur) ────────
step "Dizin yapisi olusturuluyor: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/logs" "$INSTALL_DIR/backups"
chmod 750 "$INSTALL_DIR"
ok "Dizin hazir: $INSTALL_DIR"

# ─── 5. İlk kurulum mu, güncelleme mi? ──────────────────────
# Gercek "valid .env" kriteri: tum zorunlu degiskenler dolu olmali.
# Sadece LICENSE_SIGNING_SECRET= anahtarinin varligi yeterli degil
# (= bos satir da grep -q ile gecerdi); deger bos olmamali.
SKIP_ENV=false
env_var_filled() {
    # $1 = degisken adi, $2 = dosya
    # 'VAR=...' formatinda, esitin sagi en az 8 karakter olmali.
    grep -E "^${1}=.{8,}$" "$2" >/dev/null 2>&1
}

if [[ -f "$ENV_FILE" ]] && [[ -s "$ENV_FILE" ]]; then
    if env_var_filled "LICENSE_SIGNING_SECRET" "$ENV_FILE" \
        && env_var_filled "DEALER_API_SECRET" "$ENV_FILE" \
        && env_var_filled "DEALER_SESSION_SECRET" "$ENV_FILE" \
        && env_var_filled "MARIADB_PASSWORD" "$ENV_FILE" \
        && env_var_filled "MARIADB_ROOT_PASSWORD" "$ENV_FILE"; then
        SKIP_ENV=true
        echo ""
        ok "Mevcut yapilandirma korunuyor (guncelleme modu): $ENV_FILE"
        info "Secret'lar degistirilmeyecek — yalnizca image yeniden derlenecek."
    else
        warn ".env mevcut ama icinde EKSIK/BOS zorunlu degisken var — yeniden olusturuluyor."
        cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        info "Yedek: ${ENV_FILE}.bak.*"
    fi
else
    info "Ilk kurulum: Secret'lar otomatik uretilecek."
fi
info "Mod: SKIP_ENV=$SKIP_ENV (false = yeniden yazilacak)"

# ─── 5b. ESKI MARIADB VOLUME KALINTISI KONTROLU ─────────────
# KRITIK: Yeni .env uretiliyorsa (SKIP_ENV=false), eski MariaDB
# volume'unun var olmasi parola uyumsuzluguna yol acar. MariaDB
# volume zaten init edilmisse MARIADB_PASSWORD env var'i YOK SAYAR
# ve eski parolayi kullanmaya devam eder -> Access denied.
if [[ "$SKIP_ENV" == "false" ]] && command -v docker &>/dev/null; then
    MARIA_VOLUME="mailtrustai-server_mariadb-data"
    LS_VOLUME="mailtrustai-server_license-server-data"
    HAS_MARIA_VOL=false
    HAS_LS_VOL=false
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep -q "^${MARIA_VOLUME}$" && HAS_MARIA_VOL=true
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep -q "^${LS_VOLUME}$" && HAS_LS_VOL=true

    if [[ "$HAS_MARIA_VOL" == "true" || "$HAS_LS_VOL" == "true" ]]; then
        echo ""
        warn "============================================================"
        warn "  ESKI VOLUME KALINTISI TESPIT EDILDI"
        warn "============================================================"
        [[ "$HAS_MARIA_VOL" == "true" ]] && warn "  - $MARIA_VOLUME (MariaDB verileri, eski parolayla)"
        [[ "$HAS_LS_VOL" == "true" ]]    && warn "  - $LS_VOLUME (license-server data)"
        warn ""
        warn "  Yeni .env ile uretilen parolalar eski volume icindeki"
        warn "  MariaDB user'i ile uyumsuz olacak -> Access denied hatasi."
        warn ""
        warn "  Devam etmek icin bu volume'lar silinmeli (icindeki lisans"
        warn "  verileri kaybolacak)."
        echo ""

        DEL_VOLS="H"
        if [[ "$IS_INTERACTIVE" == "true" ]]; then
            read -rp "  Eski volume'lari silelim mi? [e/H]: " DEL_VOLS || DEL_VOLS="H"
        else
            # Non-interactive: PURGE_OLD_VOLUMES=true ile override
            DEL_VOLS="${PURGE_OLD_VOLUMES:-H}"
            warn "  Non-interactive mod: PURGE_OLD_VOLUMES=$DEL_VOLS"
        fi

        if [[ "${DEL_VOLS,,}" == "e" || "${DEL_VOLS,,}" == "y" || "${DEL_VOLS,,}" == "evet" || "${DEL_VOLS,,}" == "yes" || "${DEL_VOLS,,}" == "true" ]]; then
            # Once container'lari durdur (volume kullaniyor olabilirler)
            info "Calisan eski container'lar durduruluyor..."
            for c in mailtrustai-mariadb mailtrustai-license-server mailtrustai-dealer; do
                docker rm -f "$c" 2>/dev/null || true
            done
            # Volume'lari sil
            [[ "$HAS_MARIA_VOL" == "true" ]] && {
                docker volume rm "$MARIA_VOLUME" 2>/dev/null && ok "Silindi: $MARIA_VOLUME" \
                    || warn "Silinemedi: $MARIA_VOLUME (kullaniliyor olabilir)"
            }
            [[ "$HAS_LS_VOL" == "true" ]] && {
                docker volume rm "$LS_VOLUME" 2>/dev/null && ok "Silindi: $LS_VOLUME" \
                    || warn "Silinemedi: $LS_VOLUME (kullaniliyor olabilir)"
            }
        else
            fatal "Volume silme reddedildi. Kuruluma devam edilemez. Cozumler:
            1) Bu betigi yeniden calistirip 'e' deyin
            2) Manuel sil: sudo docker volume rm $MARIA_VOLUME $LS_VOLUME
            3) Eski .env'i bulup geri yukleyin (parolalar eslesir): ls $INSTALL_DIR/.env.bak.*"
        fi
    else
        info "Volume kalintisi yok — temiz kurulum."
    fi
fi

# ─── 6. Secret üretimi ve .env yazımı ───────────────────────
if [[ "$SKIP_ENV" == "false" ]]; then
    step "Guvenli secret'lar uretiliyor..."

    # openssl kontrolu — yoksa sessiz cikis yerine net hata.
    if ! command -v openssl &>/dev/null; then
        fatal "openssl bulunamadi. Kurun: apt-get install -y openssl"
    fi

    # Secret uretimi — set -e'nin sessiz cikisini engellemek icin
    # her birinde acik dogrulama yapilir.
    LICENSE_SIGNING_SECRET=$(gen32) || fatal "LICENSE_SIGNING_SECRET uretiminde openssl hatasi"
    DEALER_API_SECRET=$(gen32) || fatal "DEALER_API_SECRET uretiminde openssl hatasi"
    DEALER_SESSION_SECRET=$(gen32) || fatal "DEALER_SESSION_SECRET uretiminde openssl hatasi"
    ADMIN_PANEL_TOKEN=$(gen32) || fatal "ADMIN_PANEL_TOKEN uretiminde openssl hatasi"
    MARIADB_PASSWORD=$(genpass) || fatal "MARIADB_PASSWORD uretiminde openssl hatasi"
    MARIADB_ROOT_PASSWORD=$(genpass) || fatal "MARIADB_ROOT_PASSWORD uretiminde openssl hatasi"

    # Uzunluk dogrulamasi (gen32=64hex, genpass=28chr)
    [[ ${#LICENSE_SIGNING_SECRET} -ge 32 ]] || fatal "LICENSE_SIGNING_SECRET cok kisa: ${#LICENSE_SIGNING_SECRET}"
    [[ ${#DEALER_API_SECRET} -ge 32 ]]      || fatal "DEALER_API_SECRET cok kisa: ${#DEALER_API_SECRET}"
    [[ ${#DEALER_SESSION_SECRET} -ge 32 ]]  || fatal "DEALER_SESSION_SECRET cok kisa"
    [[ ${#ADMIN_PANEL_TOKEN} -ge 32 ]]      || fatal "ADMIN_PANEL_TOKEN cok kisa"
    [[ ${#MARIADB_PASSWORD} -ge 16 ]]       || fatal "MARIADB_PASSWORD cok kisa: ${#MARIADB_PASSWORD}"
    [[ ${#MARIADB_ROOT_PASSWORD} -ge 16 ]]  || fatal "MARIADB_ROOT_PASSWORD cok kisa"
    ok "Secret'lar uretildi (toplam 6 deger, uzunluklar dogrulandi)."

    # MariaDB dis port satiri — compose dosyasi MARIADB_EXPOSE_PORT'u
    # kullanmadigi icin yorum olarak yazilir (kafa karistirmasin).
    if [[ "$DB_PORT" == "0" ]]; then
        DB_PORT_LINE="# MariaDB disariya acik degil (guvenli mod). Dis port icin compose dosyasinda ports: ekleyin."
    else
        DB_PORT_LINE="# MARIADB_EXPOSE_PORT=${DB_PORT}  (su an compose tarafindan kullanilmiyor)"
    fi

    step ".env dosyasi yaziliyor: $ENV_FILE"

    # Atomik yazim: once tmp dosyaya yaz, sonra mv. Yarim yazim olursa
    # eski dosya bozulmaz, validasyon basarisiz olursa tmp temizlenir.
    TMP_ENV="${ENV_FILE}.tmp.$$"
    info "  -> Tmp dosya: $TMP_ENV"

    {
        printf '# ============================================================\n'
        printf '# MailTrustAI Sunucu Yapilandirmasi\n'
        printf '# Olusturulma: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf '# Kurulum log: %s\n' "$INSTALL_LOG"
        printf '#\n'
        printf '# BU DOSYAYI GUVENLI YERDE YEDEKLEYIN!\n'
        printf '# SECRET LARI DEGISTIRMEYIN - Mevcut lisanslar gecersiz olur.\n'
        printf '# ============================================================\n'
        printf '\n'
        printf '# === Core Secretlar (ZORUNLU) ===\n'
        printf 'LICENSE_SIGNING_SECRET=%s\n' "$LICENSE_SIGNING_SECRET"
        printf 'DEALER_API_SECRET=%s\n'      "$DEALER_API_SECRET"
        printf 'DEALER_SESSION_SECRET=%s\n'  "$DEALER_SESSION_SECRET"
        printf '\n'
        printf '# === Admin Panel (bossa /admin uclari 503 doner) ===\n'
        printf 'ADMIN_PANEL_TOKEN=%s\n'      "$ADMIN_PANEL_TOKEN"
        printf '\n'
        printf '# === MariaDB ===\n'
        printf 'MARIADB_DATABASE=mailtrustai_license\n'
        printf 'MARIADB_USER=mailtrustai\n'
        printf 'MARIADB_PASSWORD=%s\n'       "$MARIADB_PASSWORD"
        printf 'MARIADB_ROOT_PASSWORD=%s\n'  "$MARIADB_ROOT_PASSWORD"
        printf '%s\n'                        "$DB_PORT_LINE"
        printf '\n'
        printf '# === Port Mapping (host -> container) ===\n'
        printf 'LICENSE_SERVER_PORT=%s\n'    "$LS_PORT"
        printf 'DEALER_PORT=%s\n'            "$DEALER_PORT_VAR"
        printf '\n'
        printf '# === Servis Parametreleri ===\n'
        printf 'DEFAULT_GRACE_DAYS=7\n'
        printf 'HEARTBEAT_ONLINE_THRESHOLD_SECONDS=300\n'
        printf 'HEARTBEAT_STALE_THRESHOLD_SECONDS=1800\n'
        printf 'CUSTOMER_SYNC_MAX_PAYLOAD_BYTES=16384\n'
        printf 'DEALER_SESSION_TTL_MINUTES=480\n'
        printf 'TRUST_PROXY=1\n'
    } > "$TMP_ENV" || fatal ".env tmp dosyasi yazilamadi: $TMP_ENV (disk dolu? izin?)"

    chmod 600 "$TMP_ENV" || fatal "chmod 600 basarisiz: $TMP_ENV"

    # Tmp dogrulama — kritik degiskenler dolu olarak yazildi mi?
    info "  -> Tmp dosya dogrulanyor..."
    for var in LICENSE_SIGNING_SECRET DEALER_API_SECRET DEALER_SESSION_SECRET \
               MARIADB_PASSWORD MARIADB_ROOT_PASSWORD LICENSE_SERVER_PORT DEALER_PORT; do
        if ! grep -E "^${var}=.+" "$TMP_ENV" >/dev/null; then
            cat "$TMP_ENV" >&2
            rm -f "$TMP_ENV"
            fatal "Tmp .env icinde EKSIK/BOS degisken: $var"
        fi
    done
    TMP_LINES=$(wc -l < "$TMP_ENV")
    info "  -> Tmp dosya OK ($TMP_LINES satir)."

    # Atomik tasima
    mv -f "$TMP_ENV" "$ENV_FILE" || fatal "mv basarisiz: $TMP_ENV -> $ENV_FILE"

    # Son dogrulama
    if [[ ! -f "$ENV_FILE" ]] || [[ ! -s "$ENV_FILE" ]]; then
        fatal ".env tasima sonrasi bulunamadi: $ENV_FILE"
    fi
    chmod 600 "$ENV_FILE" || true
    ENV_SIZE=$(stat -c%s "$ENV_FILE" 2>/dev/null || echo "?")

    echo ""
    echo -e "${GREEN}${BOLD}  ======================================================"
    echo -e "  ===   .env DOSYASI OLUSTURULDU — HEMEN YEDEKLEYIN!  ==="
    echo -e "  ======================================================${NC}"
    echo -e "  Konum  : ${YELLOW}${ENV_FILE}${NC}"
    echo -e "  Boyut  : ${ENV_SIZE} byte"
    echo -e "  Sahibi : $(stat -c '%U:%G  %a' "$ENV_FILE" 2>/dev/null || echo '?')"
    echo -e "  Goster : ${CYAN}cat ${ENV_FILE}${NC}"
    echo ""
else
    ok ".env mevcut ve gecerli: $ENV_FILE"
fi

# ─── 7. Compose dosyasını güncelle ──────────────────────────
step "Compose dosyasi guncelleniyor..."
COMPOSE_SRC="$REPO_ROOT/docker-compose.server.yml"
[[ -f "$COMPOSE_SRC" ]] || fatal "docker-compose.server.yml bulunamadi: $COMPOSE_SRC"
cp "$COMPOSE_SRC" "$INSTALL_DIR/docker-compose.server.yml"
ok "docker-compose.server.yml kopyalandi."

# ─── 8. Image build ─────────────────────────────────────────
step "Docker image'lar derleniyor (bu 3-10 dakika surebilir)..."
cd "$REPO_ROOT"

BUILD_OK=true
# build hatasinda script olmesin — hatayi raporla devam et
set +e
$DOCKER_COMPOSE_CMD \
    --env-file "$ENV_FILE" \
    -f docker-compose.server.yml \
    build --pull
BUILD_EXIT=$?
set -e

if [[ $BUILD_EXIT -ne 0 ]]; then
    warn "Docker build basarisiz oldu (cikis kodu: $BUILD_EXIT)"
    warn "Image'lar derlenemedi. Loglar icin:"
    warn "  cd $REPO_ROOT && $DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f docker-compose.server.yml build"
    BUILD_OK=false
else
    ok "Image'lar derlendi."
fi

# ─── 9. Servisleri başlat ───────────────────────────────────
if [[ "$BUILD_OK" == "true" ]]; then
    step "Servisler baslatiliyor..."
    set +e
    $DOCKER_COMPOSE_CMD \
        --env-file "$ENV_FILE" \
        -f docker-compose.server.yml \
        up -d --remove-orphans
    UP_EXIT=$?
    set -e

    if [[ $UP_EXIT -ne 0 ]]; then
        warn "Servisler baslatılamadi. Hata kodu: $UP_EXIT"
    else
        # ─── 10. Sağlık kontrolü ────────────────────────────────
        step "Saglik kontrolu (60 saniye bekleniyor)..."
        sleep 20

        MAX_WAIT=60
        ELAPSED=0
        while [[ $ELAPSED -lt $MAX_WAIT ]]; do
            LS_STATUS=$(curl -sf "http://localhost:${LS_PORT}/healthz" 2>/dev/null | grep -c '"ok":true' || true)
            if [[ "$LS_STATUS" -ge 1 ]]; then
                ok "License-server calisiyor."
                break
            fi
            sleep 5
            ELAPSED=$((ELAPSED + 5))
            info "Bekleniyor... ($ELAPSED/${MAX_WAIT}s)"
        done
        if [[ $ELAPSED -ge $MAX_WAIT ]]; then
            warn "Saglik kontrolu zaman asimi. Loglari inceleyin:"
            warn "  $DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f $INSTALL_DIR/docker-compose.server.yml logs --tail=30"
        fi
    fi
fi

# ─── 11. Bakım scripti oluştur ──────────────────────────────
cat > "$INSTALL_DIR/mailtrustai-ctl.sh" <<'CTLEOF'
#!/usr/bin/env bash
# MailTrustAI sunucu yonetim araci
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE="$INSTALL_DIR/docker-compose.server.yml"
DC="docker compose --env-file $ENV_FILE -f $COMPOSE"

case "${1:-help}" in
    start)   $DC up -d ;;
    stop)    $DC stop ;;
    restart) $DC restart ;;
    status)  $DC ps ;;
    logs)    $DC logs -f --tail=200 ;;
    update|upgrade)
        # Tam ozellikli upgrade script'ini cagir (git pull + yedek + rebuild + healthcheck)
        REPO=$(cat "$INSTALL_DIR/.repo_path" 2>/dev/null || echo '')
        UPGRADE_SCRIPT="$REPO/install/server/upgrade_server_ubuntu.sh"
        if [[ -n "$REPO" && -f "$UPGRADE_SCRIPT" ]]; then
            exec sudo bash "$UPGRADE_SCRIPT"
        else
            echo "Upgrade script bulunamadi: $UPGRADE_SCRIPT"
            echo "Manuel: cd $REPO && git pull && sudo bash install/server/upgrade_server_ubuntu.sh"
            exit 1
        fi
        ;;
    backup)
        TS=$(date +%Y%m%d_%H%M%S)
        BDIR="$INSTALL_DIR/backups"
        mkdir -p "$BDIR"
        cp "$ENV_FILE" "$BDIR/.env.$TS"
        echo "Yedek olusturuldu: $BDIR/.env.$TS"
        docker run --rm \
            -v mailtrustai-server_mariadb-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/mariadb-$TS.tar.gz" -C /data . \
            && echo "MariaDB yedegi: $BDIR/mariadb-$TS.tar.gz"
        docker run --rm \
            -v mailtrustai-server_license-server-data:/data \
            -v "$BDIR":/backup \
            alpine tar czf "/backup/license-server-data-$TS.tar.gz" -C /data . \
            && echo "License-server verisi yedegi: $BDIR/license-server-data-$TS.tar.gz"
        ;;
    help|*)
        echo "Kullanim: $0 {start|stop|restart|status|logs|upgrade|backup}"
        echo ""
        echo "  start    - Servisleri baslat"
        echo "  stop     - Servisleri durdur"
        echo "  restart  - Servisleri yeniden baslat"
        echo "  status   - Container durumlarini goster"
        echo "  logs     - Tum servislerin loglarini takip et"
        echo "  upgrade  - Yeni surume yukselt (git pull + rebuild)"
        echo "  backup   - .env + MariaDB + license-server verisi yedekle"
        ;;
esac
CTLEOF
chmod +x "$INSTALL_DIR/mailtrustai-ctl.sh"

# Repo yolunu kaydet (update komutu için)
echo "$REPO_ROOT" > "$INSTALL_DIR/.repo_path"

# ─── 12. Özet ───────────────────────────────────────────────
hr
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
if [[ "$BUILD_OK" == "true" ]]; then
echo "  ║          ✓  Kurulum Tamamlandi!                      ║"
else
echo "  ║    ⚠  Kurulum KISMI — Docker build basarisiz!        ║"
fi
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Yapilandirma Dosyasi:${NC}"
echo -e "  ${YELLOW}${ENV_FILE}${NC}   ← SECRET'LARINIZI YEDEKLEYIN"
echo ""

if [[ "$BUILD_OK" == "true" ]]; then
    echo -e "  ${BOLD}Erisim Adresleri:${NC}"
    echo -e "  ├─ License Server API : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/healthz${NC}"
    echo -e "  ├─ Dealer Panel       : ${CYAN}http://${SERVER_HOST}:${DEALER_PORT_VAR}${NC}"
    echo -e "  └─ Admin Panel        : ${CYAN}http://${SERVER_HOST}:${LS_PORT}/admin${NC}"
    echo ""
else
    echo -e "  ${RED}Docker build basarisiz oldu. Adimlar:${NC}"
    echo -e "  1. Hatanin nedenini inceleyin:"
    echo -e "     ${CYAN}cd $REPO_ROOT${NC}"
    echo -e "     ${CYAN}$DOCKER_COMPOSE_CMD --env-file $ENV_FILE -f docker-compose.server.yml build 2>&1 | tail -50${NC}"
    echo -e "  2. Duzeltip yeniden calistirin:"
    echo -e "     ${CYAN}sudo bash install/server/install_server_ubuntu.sh${NC}"
    echo -e "  ${GREEN}Not: .env dosyasi basariyla olusturuldu, bir sonraki calistirmada korunacak.${NC}"
    echo ""
fi

echo -e "  ${BOLD}Onemli Dosyalar:${NC}"
echo -e "  ├─ Yapilandirma : ${YELLOW}${ENV_FILE}${NC}"
echo -e "  ├─ Yonetim araci: ${YELLOW}${INSTALL_DIR}/mailtrustai-ctl.sh${NC}"
echo -e "  └─ Yedekler     : ${YELLOW}${INSTALL_DIR}/backups/${NC}"
echo ""
echo -e "  ${BOLD}Hizli Komutlar:${NC}"
echo -e "  ├─ Durum    : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh status${NC}"
echo -e "  ├─ Loglar   : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh logs${NC}"
echo -e "  ├─ Yedek    : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh backup${NC}"
echo -e "  ├─ Guncelle : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh upgrade${NC}"
echo -e "  └─ Durdur   : ${CYAN}${INSTALL_DIR}/mailtrustai-ctl.sh stop${NC}"
echo ""
echo -e "  ${YELLOW}Firewall: ${LS_PORT}/tcp ve ${DEALER_PORT_VAR}/tcp portlarini acin.${NC}"
echo ""
hr
