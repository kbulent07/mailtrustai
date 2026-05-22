#!/usr/bin/env bash
# ============================================================
# MailTrustAI Client — Linux self-extracting installer build
#
# `makeself` ile `MailTrustAI-Client-Setup-<ver>.run` uretir.
# Cikti tek-dosya, calistirilabilir:
#
#   sudo bash MailTrustAI-Client-Setup-2.0.1.run
#   # veya
#   chmod +x MailTrustAI-Client-Setup-2.0.1.run
#   sudo ./MailTrustAI-Client-Setup-2.0.1.run
#
# Kullanim (build):
#   bash install/client/build-linux-installer.sh
#   bash install/client/build-linux-installer.sh --version 2.0.1
#
# Cikti: dist/MailTrustAI-Client-Setup-<ver>.run
# ============================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# --- Argumanlar ---
VERSION=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        -h|--help)
            echo "Kullanim: $0 [--version X.Y.Z]"
            exit 0
            ;;
        *) echo "Bilinmeyen arguman: $1"; exit 1 ;;
    esac
done

# Surum tespit: arguman > git tag > package.json > '0.0.0-dev'
if [[ -z "$VERSION" ]]; then
    VERSION=$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo '')
fi
if [[ -z "$VERSION" ]]; then
    VERSION=$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo '0.0.0-dev')
fi
echo "[build] surum: $VERSION"

# --- makeself bulunuyor mu? ---
if ! command -v makeself >/dev/null 2>&1; then
    echo "[HATA] makeself bulunamadi. Kurulum:"
    echo "  Ubuntu/Debian:  sudo apt-get install -y makeself"
    echo "  Fedora/RHEL :   sudo dnf install -y makeself"
    exit 1
fi

# --- Payload dizini hazirla ---
PAYLOAD_DIR=$(mktemp -d -t msa-installer-XXXXXX)
trap 'rm -rf "$PAYLOAD_DIR"' EXIT

echo "[build] payload hazirlaniyor: $PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR/install/client" "$PAYLOAD_DIR/install/server"

# Client + server install scriptlerini kopyala (kurulum, guncelleme, kaldirma)
cp "$SCRIPT_DIR/install_client_ubuntu.sh"   "$PAYLOAD_DIR/install/client/"
cp "$SCRIPT_DIR/update_client_ubuntu.sh"    "$PAYLOAD_DIR/install/client/"
cp "$SCRIPT_DIR/uninstall_client_ubuntu.sh" "$PAYLOAD_DIR/install/client/"

# Surum dosyasi (startup.sh okur)
echo "$VERSION" > "$PAYLOAD_DIR/VERSION"

# --- startup.sh — payload icindeki wrapper ---
cat > "$PAYLOAD_DIR/startup.sh" <<'STARTUP'
#!/usr/bin/env bash
# MailTrustAI Linux self-extracting installer — startup wrapper
set -Eeuo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(cat "$THIS_DIR/VERSION" 2>/dev/null || echo 'unknown')"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

[[ $EUID -eq 0 ]] || { echo -e "${RED}sudo gerekli.${NC}\nKullanim: sudo bash MailTrustAI-Client-Setup-${VERSION}.run" >&2; exit 1; }

echo -e "${CYAN}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI Client — Linux Self-Extracting Installer ==="
echo "  ===                 surum: ${VERSION}                    ==="
echo "  ============================================================"
echo -e "${NC}"

# Mod secimi: install / update / uninstall (env veya menu)
MODE="${MSA_INSTALLER_MODE:-}"
if [[ -z "$MODE" ]]; then
    if [[ -t 0 ]]; then
        echo "Yapilacak islem:"
        echo "  1) Kurulum (install)         [default]"
        echo "  2) Guncelleme (update)"
        echo "  3) Kaldirma (uninstall)"
        read -rp "Secim [1]: " sel
        case "${sel:-1}" in
            1|i|install)   MODE=install ;;
            2|u|update)    MODE=update ;;
            3|r|uninstall) MODE=uninstall ;;
            *) echo -e "${RED}Gecersiz secim.${NC}" >&2; exit 1 ;;
        esac
    else
        MODE=install
    fi
fi

# Hedef script
case "$MODE" in
    install)   TARGET="$THIS_DIR/install/client/install_client_ubuntu.sh" ;;
    update)    TARGET="$THIS_DIR/install/client/update_client_ubuntu.sh" ;;
    uninstall) TARGET="$THIS_DIR/install/client/uninstall_client_ubuntu.sh" ;;
    *) echo -e "${RED}Bilinmeyen mod: $MODE${NC}" >&2; exit 1 ;;
esac

# install_client_ubuntu.sh repo'nun icinde calistigini varsayar (git rev-parse).
# Self-extracting durumda repo yok — bootstrap edelim: github'dan klonla.
# Update/uninstall icin /opt/mailtrustai zaten kurulu (orada repo path'i .repo_path'de).

if [[ "$MODE" == "install" ]]; then
    echo -e "${YELLOW}>>> Sistem hazirligi (git/curl/docker kontrolu)...${NC}"
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq git curl ca-certificates >/dev/null 2>&1 || {
        echo -e "${RED}Temel paketler (git/curl) kurulamadi.${NC}" >&2; exit 1;
    }

    # Repo'yu /opt/mailtrustai-source'a klonla (kalici)
    REPO_DEST="${MSA_REPO_DEST:-/opt/mailtrustai-source}"
    REPO_BRANCH="${MSA_REPO_BRANCH:-mainpaketler}"
    if [[ -d "$REPO_DEST/.git" ]]; then
        echo -e "${CYAN}Repo zaten var: $REPO_DEST → fetch + checkout${NC}"
        git -C "$REPO_DEST" fetch --tags --depth=1 origin "$REPO_BRANCH" || true
        git -C "$REPO_DEST" checkout "$REPO_BRANCH" || true
        git -C "$REPO_DEST" reset --hard "origin/$REPO_BRANCH" || true
    else
        echo -e "${CYAN}Repo klonlaniyor: $REPO_DEST (branch=$REPO_BRANCH)${NC}"
        rm -rf "$REPO_DEST"
        git clone --depth=1 --branch "$REPO_BRANCH" \
            "https://github.com/kbulent07/mailtrustai.git" "$REPO_DEST"
    fi

    # Payload icindeki en guncel scriptlerle override et (release'in pack ettigi versiyon)
    cp -f "$THIS_DIR/install/client/"*.sh "$REPO_DEST/install/client/" 2>/dev/null || true

    echo -e "${GREEN}>>> Kurulum scripti tetikleniyor...${NC}"
    cd "$REPO_DEST"
    exec bash "install/client/install_client_ubuntu.sh"
fi

# Update/uninstall: kurulu repo'yu kullan
INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"
REPO_FILE="$INSTALL_DIR/.repo_path"
if [[ -f "$REPO_FILE" ]]; then
    REPO_DEST="$(cat "$REPO_FILE")"
    echo -e "${CYAN}Mevcut kurulum bulundu: $INSTALL_DIR (repo=$REPO_DEST)${NC}"
    cd "$REPO_DEST"
    exec bash "${TARGET/$THIS_DIR/$REPO_DEST}"
else
    echo -e "${RED}Mevcut kurulum bulunamadi ($INSTALL_DIR). Once 'install' ile kurun.${NC}" >&2
    exit 1
fi
STARTUP
chmod +x "$PAYLOAD_DIR/startup.sh"

# --- dist/ olusur ---
DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"
OUT_FILE="$DIST_DIR/MailTrustAI-Client-Setup-${VERSION}.run"

echo "[build] makeself calistiriliyor..."
makeself \
    --notemp \
    --nox11 \
    --noprogress \
    --gzip \
    "$PAYLOAD_DIR" \
    "$OUT_FILE" \
    "MailTrustAI Client v${VERSION}" \
    ./startup.sh

# Cikti ozeti
SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo ""
echo "[build] BASARI"
echo "        dosya : $OUT_FILE"
echo "        boyut : $SIZE"
echo "        surum : $VERSION"
echo ""
echo "Kurulum (musteri tarafinda):"
echo "  chmod +x $(basename "$OUT_FILE")"
echo "  sudo ./$(basename "$OUT_FILE")"
echo ""
echo "Otomasyon (lisans parametreli — URL opsiyonel, default mailtrustai.com):"
echo "  sudo LICENSE_KEY=MTAI-... ./$(basename "$OUT_FILE")"
echo ""
echo "Farkli license-server:"
echo "  sudo LICENSE_KEY=MTAI-... LICENSE_SERVER_URL=https://baska.sirket.com \\"
echo "    ./$(basename "$OUT_FILE")"
