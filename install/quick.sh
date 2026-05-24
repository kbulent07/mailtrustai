#!/usr/bin/env bash
# ============================================================
# MailTrustAI SUNUCU — Tek satir kurulum (curl | bash bootstrap)
# ============================================================
# Hicbir on-gereksinim olmadan calistirilabilir. Sirayla:
#   1) git + docker (yoksa kurar)
#   2) Repo'yu klonlar / gunceller
#   3) install_server_ubuntu.sh'i calistirir (license-server + dealer + MariaDB)
#
# KULLANIM (en basit):
#   curl -fsSL https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/quick.sh | sudo bash
#
# RESET ile (tam temizlik + yeniden kurulum):
#   curl -fsSL .../install/quick.sh | sudo RESET=true bash
#
# Ozel repo/branch:
#   curl -fsSL .../install/quick.sh | sudo BRANCH=main bash
# ============================================================
set -euo pipefail

# ─── Ayarlar (env ile override edilebilir) ──────────────────
REPO_URL="${REPO_URL:-https://github.com/kbulent07/mailtrustai.git}"
BRANCH="${BRANCH:-mainpaketler}"
TARGET_USER="${SUDO_USER:-$(id -un)}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
INSTALL_DIR="${INSTALL_DIR:-${TARGET_HOME:-/root}/mailtrustai}"

# ─── Renkli cikti ───────────────────────────────────────────
c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_reset='\033[0m'
info()  { printf "${c_green}▶ %s${c_reset}\n" "$*"; }
warn()  { printf "${c_yellow}⚠ %s${c_reset}\n" "$*"; }
fatal() { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; exit 1; }

# ─── Root kontrolu ──────────────────────────────────────────
if [[ "$(id -u)" -ne 0 ]]; then
    fatal "Bu betik root gerektirir. Su sekilde calistirin:
  curl -fsSL <url>/install/quick.sh | sudo bash"
fi

printf '\n'
printf '╔══════════════════════════════════════════════════════════╗\n'
printf '║   MailTrustAI Sunucu - Hizli Kurulum                     ║\n'
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

# Docker compose plugin kontrolu
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

# Sahipligi gercek kullaniciya ver (sudo ile root klonladi)
if [[ "$TARGET_USER" != "root" && -n "${TARGET_HOME:-}" ]]; then
    chown -R "$TARGET_USER":"$TARGET_USER" "$INSTALL_DIR" 2>/dev/null || true
fi

# ─── 3) Asil kurulum scriptini calistir ─────────────────────
info "Sunucu kurulumu baslatiliyor..."
printf '\n'
cd "$INSTALL_DIR"
exec bash install/server/install.sh "$@"
