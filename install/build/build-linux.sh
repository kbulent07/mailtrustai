#!/usr/bin/env bash
# ============================================================
# MailTrustAI Client — Linux self-extracting installer build
#
# `makeself` ile HER IKI varyant icin .run uretir:
#   dist/MailTrustAI-Client-Docker-Setup-<ver>.run   (Docker tabanli)
#   dist/MailTrustAI-Client-Native-Setup-<ver>.run   (Docker'siz, systemd)
#
# Calistirma (musteri):
#   sudo ./MailTrustAI-Client-Native-Setup-2.0.0.run
#
# Kullanim (build):
#   bash install/build/build-linux.sh
#   bash install/build/build-linux.sh --version 2.0.1
#   bash install/build/build-linux.sh --variant native   # tek varyant
# ============================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VERSION=""
ONLY_VARIANT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --variant) ONLY_VARIANT="$2"; shift 2 ;;
        -h|--help) echo "Kullanim: $0 [--version X.Y.Z] [--variant docker|native]"; exit 0 ;;
        *) echo "Bilinmeyen arguman: $1"; exit 1 ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    VERSION=$(git -C "$REPO_ROOT" describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo '')
fi
if [[ -z "$VERSION" ]]; then
    VERSION=$(node -p "require('$REPO_ROOT/package.json').version" 2>/dev/null || echo '0.0.0-dev')
fi
echo "[build] surum: $VERSION"

if ! command -v makeself >/dev/null 2>&1; then
    echo "[HATA] makeself bulunamadi. Kurulum:"
    echo "  Ubuntu/Debian:  sudo apt-get install -y makeself"
    echo "  Fedora/RHEL :   sudo dnf install -y makeself"
    exit 1
fi

DIST_DIR="$REPO_ROOT/dist"
mkdir -p "$DIST_DIR"

VARIANTS=(docker native)
[[ -n "$ONLY_VARIANT" ]] && VARIANTS=("$ONLY_VARIANT")

build_variant() {
    local variant="$1"
    local label_cap; label_cap="$(tr '[:lower:]' '[:upper:]' <<<"${variant:0:1}")${variant:1}"
    echo ""
    echo "[build] === varyant: $variant ==="

    local payload; payload=$(mktemp -d -t "msa-installer-$variant-XXXXXX")
    trap 'rm -rf "$payload"' RETURN
    mkdir -p "$payload/install/client/linux"

    # Varyanta ait scriptleri kopyala
    for op in install update uninstall; do
        local src="$REPO_ROOT/install/client/linux/${op}-${variant}-ubuntu.sh"
        [[ -f "$src" ]] || { echo "[HATA] bulunamadi: $src"; return 1; }
        cp "$src" "$payload/install/client/linux/"
    done
    # strip + check scriptleri (native'in icinde gerekli; docker'da zararsiz)
    mkdir -p "$payload/scripts"
    cp "$REPO_ROOT/scripts/strip-customer-tree.js"     "$payload/scripts/" 2>/dev/null || true
    cp "$REPO_ROOT/scripts/check-customer-package.js"  "$payload/scripts/" 2>/dev/null || true

    echo "$VERSION"  > "$payload/VERSION"
    echo "$variant"  > "$payload/VARIANT"

    cat > "$payload/startup.sh" <<'STARTUP'
#!/usr/bin/env bash
# MailTrustAI Linux self-extracting installer — startup wrapper
set -Eeuo pipefail
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="$(cat "$THIS_DIR/VERSION" 2>/dev/null || echo 'unknown')"
VARIANT="$(cat "$THIS_DIR/VARIANT" 2>/dev/null || echo 'docker')"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
[[ $EUID -eq 0 ]] || { echo -e "${RED}sudo gerekli.${NC}" >&2; exit 1; }

echo -e "${CYAN}${BOLD}"
echo "  ============================================================"
echo "  ===  MailTrustAI Client — Linux Installer ($VARIANT)"
echo "  ===                 surum: ${VERSION}"
echo "  ============================================================"
echo -e "${NC}"

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

REPO_BRANCH="${MSA_REPO_BRANCH:-mainpaketler}"
SCRIPT_NAME="${MODE}-${VARIANT}-ubuntu.sh"

if [[ "$MODE" == "install" ]]; then
    echo -e "${YELLOW}>>> Sistem hazirligi (git/curl)...${NC}"
    apt-get update -qq >/dev/null 2>&1 || true
    apt-get install -y -qq git curl ca-certificates >/dev/null 2>&1 || {
        echo -e "${RED}Temel paketler kurulamadi.${NC}" >&2; exit 1; }

    # Native: repo dogrudan /opt/mailtrustai'a klonlanir (install scripti yapar).
    # Docker: repo /opt/mailtrustai-source'a klonlanir.
    if [[ "$VARIANT" == "native" ]]; then
        REPO_DEST="${INSTALL_DIR:-/opt/mailtrustai}"
    else
        REPO_DEST="${MSA_REPO_DEST:-/opt/mailtrustai-source}"
    fi

    if [[ -d "$REPO_DEST/.git" ]]; then
        git -C "$REPO_DEST" fetch --depth=1 origin "$REPO_BRANCH" || true
        git -C "$REPO_DEST" checkout "$REPO_BRANCH" || true
        git -C "$REPO_DEST" reset --hard "origin/$REPO_BRANCH" || true
    else
        rm -rf "$REPO_DEST"
        git clone --depth=1 --branch "$REPO_BRANCH" \
            "https://github.com/kbulent07/mailtrustai.git" "$REPO_DEST"
    fi

    # Payload'daki guncel scriptleri override et
    cp -f "$THIS_DIR/install/client/linux/"*.sh "$REPO_DEST/install/client/linux/" 2>/dev/null || true

    echo -e "${GREEN}>>> Kurulum scripti tetikleniyor: $SCRIPT_NAME${NC}"
    cd "$REPO_DEST"
    exec bash "install/client/linux/$SCRIPT_NAME"
fi

# Update/uninstall: kurulu repo'yu kullan
INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"
REPO_FILE="$INSTALL_DIR/.repo_path"
if [[ "$VARIANT" == "native" || ! -f "$REPO_FILE" ]]; then
    REPO_DEST="$INSTALL_DIR"
else
    REPO_DEST="$(cat "$REPO_FILE")"
fi
if [[ -d "$REPO_DEST" ]]; then
    cd "$REPO_DEST"
    exec bash "install/client/linux/$SCRIPT_NAME"
else
    echo -e "${RED}Mevcut kurulum bulunamadi. Once 'install' ile kurun.${NC}" >&2
    exit 1
fi
STARTUP
    chmod +x "$payload/startup.sh"

    local out="$DIST_DIR/MailTrustAI-Client-${label_cap}-Setup-${VERSION}.run"
    echo "[build] makeself ($variant)..."
    makeself --notemp --nox11 --noprogress --gzip \
        "$payload" "$out" "MailTrustAI Client ${label_cap} v${VERSION}" ./startup.sh

    local size; size=$(du -h "$out" | cut -f1)
    echo "[build] OK -> $out ($size)"
}

for v in "${VARIANTS[@]}"; do
    build_variant "$v"
done

echo ""
echo "[build] BASARI — dist/ icindeki .run dosyalari:"
ls -1 "$DIST_DIR"/*.run 2>/dev/null || true
echo ""
echo "Kurulum (musteri):"
echo "  sudo ./MailTrustAI-Client-Native-Setup-${VERSION}.run     # Docker'siz"
echo "  sudo ./MailTrustAI-Client-Docker-Setup-${VERSION}.run     # Docker"
echo ""
echo "Otomasyon: sudo LICENSE_KEY=MTAI-... ./MailTrustAI-Client-Native-Setup-${VERSION}.run"
