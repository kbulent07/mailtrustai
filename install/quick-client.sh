#!/usr/bin/env bash
# ============================================================
# MailTrustAI MUSTERI — Tek satir kurulum (curl | bash bootstrap)
# ============================================================
# Hicbir on-gereksinim olmadan calistirilabilir. Sirayla:
#   1) git + docker (yoksa kurar)
#   2) Repo'yu klonlar / gunceller
#   3) install_client_ubuntu.sh'i calistirir (musteri Docker, port 3000)
#
# KULLANIM (interaktif — lisans/URL sorulur):
#   curl -fsSL https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/quick-client.sh | sudo bash
#
# KULLANIM (parametreli — tam otomatik):
#   curl -fsSL .../install/quick-client.sh | sudo bash -s -- \
#        --license=MTAI-PRO-XXXX-XXXX \
#        [--server=http://license.mailtrustai.com:3200] \  # opsiyonel: default budur
#        [--port=3000]
#
# Env ile de gecilebilir:
#   curl -fsSL .../quick-client.sh | sudo LICENSE_KEY=... bash
#
# Default license-server: http://license.mailtrustai.com:3200
# (MailTrustAI merkezi sunucusu — domain mailtrustai.com altyapisina baglanir)
# ============================================================
set -euo pipefail

# ─── Ayarlar ────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/kbulent07/mailtrustai.git}"
BRANCH="${BRANCH:-mainpaketler}"
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
INSTALL_DIR="${INSTALL_DIR:-${TARGET_HOME:-/root}/mailtrustai}"

# ─── CLI argumanlarini env'e cevir ──────────────────────────
# install_client_ubuntu.sh LICENSE_KEY / LICENSE_SERVER_URL / CUSTOMER_PORT
# env'lerini okuyor; --license= gibi bayraklari bunlara map ediyoruz.
for arg in "$@"; do
    case "$arg" in
        --license=*)  export LICENSE_KEY="${arg#*=}"        ;;
        --server=*)   export LICENSE_SERVER_URL="${arg#*=}" ;;
        --port=*)     export CUSTOMER_PORT="${arg#*=}"      ;;
        *) ;;  # bilinmeyen bayraklari install scriptine de aktaracagiz
    esac
done

# ─── Renkli cikti ───────────────────────────────────────────
c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_reset='\033[0m'
info()  { printf "${c_green}▶ %s${c_reset}\n" "$*"; }
warn()  { printf "${c_yellow}⚠ %s${c_reset}\n" "$*"; }
fatal() { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; exit 1; }

# ─── Root kontrolu ──────────────────────────────────────────
if [[ "$(id -u)" -ne 0 ]]; then
    fatal "Bu betik root gerektirir. Su sekilde calistirin:
  curl -fsSL <url>/install/quick-client.sh | sudo bash"
fi

printf '\n'
printf '╔══════════════════════════════════════════════════════════╗\n'
printf '║   MailTrustAI Musteri - Hizli Kurulum                    ║\n'
printf '╚══════════════════════════════════════════════════════════╝\n\n'

# ─── 1) Onkosullar ──────────────────────────────────────────
info "Onkosullar kontrol ediliyor..."

if ! command -v git >/dev/null 2>&1; then
    info "git kuruluyor..."
    apt-get update -qq && apt-get install -y -qq git || fatal "git kurulamadi"
fi

if ! command -v docker >/dev/null 2>&1; then
    info "Docker kuruluyor (resmi script)..."
    curl -fsSL https://get.docker.com | sh || fatal "Docker kurulamadi"
    systemctl enable --now docker 2>/dev/null || true
fi

if ! docker compose version >/dev/null 2>&1; then
    warn "docker compose plugin bulunamadi — kurulmaya calisiliyor..."
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || \
        warn "docker-compose-plugin kurulamadi; install scripti yine de deneyecek"
fi

# ─── 2) Repo klonla / guncelle ──────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Var olan repo guncelleniyor: $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch origin "$BRANCH" --quiet
    git -C "$INSTALL_DIR" checkout "$BRANCH" --quiet
    git -C "$INSTALL_DIR" pull origin "$BRANCH" --quiet
else
    info "Repo klonlaniyor → $INSTALL_DIR (branch: $BRANCH)"
    git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR" --quiet || fatal "Klonlama basarisiz"
fi

if [[ "$TARGET_USER" != "root" && -n "${TARGET_HOME:-}" ]]; then
    chown -R "$TARGET_USER":"$TARGET_USER" "$INSTALL_DIR" 2>/dev/null || true
fi

# ─── 3) Asil kurulum scriptini calistir ─────────────────────
info "Musteri kurulumu baslatiliyor..."
printf '\n'
cd "$INSTALL_DIR"
exec bash install/client/install_client_ubuntu.sh "$@"
