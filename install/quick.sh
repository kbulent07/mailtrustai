#!/usr/bin/env bash
# ============================================================
# MailTrustAI SUNUCU — Tek satir kurulum (curl | bash bootstrap)
# ============================================================
# Hicbir on-gereksinim olmadan calistirilabilir. Sirayla:
#   1) git + docker (yoksa kurar)
#   2) Repo'yu /opt/mailtrustai-source altina klonlar / gunceller
#   3) install/server/install.sh'i calistirir (license-server + dealer + MariaDB)
#      Kurulum dosyalari: /opt/mailtrustai/
#
# KULLANIM (en basit):
#   curl -fsSL https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/quick.sh | sudo bash
#
# Sunucu adresini onceden vermek icin:
#   curl -fsSL .../install/quick.sh | sudo SERVER_HOST=license.firma.com bash
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
REPO_DIR="${REPO_DIR:-/opt/mailtrustai-source}"   # kaynak kod
# INSTALL_DIR: install.sh'e gecilir (default /opt/mailtrustai)
INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"

# ─── Renkli cikti ───────────────────────────────────────────
c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'
c_cyan='\033[0;36m'; c_bold='\033[1m'; c_reset='\033[0m'
info()  { printf "${c_green}[OK]${c_reset}  %s\n" "$*"; }
step()  { printf "\n${c_bold}>>> %s${c_reset}\n" "$*"; }
warn()  { printf "${c_yellow}[UYARI]${c_reset}  %s\n" "$*"; }
fatal() { printf "${c_red}[HATA]${c_reset}  %s\n" "$*" >&2; exit 1; }

# ─── Root kontrolu ──────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || fatal "Bu betik root gerektirir:
  curl -fsSL <url>/install/quick.sh | sudo bash"

printf '\n'
printf '╔══════════════════════════════════════════════════════════╗\n'
printf '║   MailTrustAI Sunucu - Hizli Kurulum Bootstrap           ║\n'
printf '╚══════════════════════════════════════════════════════════╝\n\n'
printf "  Repo    : %s\n" "$REPO_DIR"
printf "  Kurulum : %s\n" "$INSTALL_DIR"
printf "  Branch  : %s\n\n" "$BRANCH"

# ─── 1) git ─────────────────────────────────────────────────
step "1/3  Onkosullar kontrol ediliyor..."
if ! command -v git >/dev/null 2>&1; then
    info "git kuruluyor..."
    apt-get update -qq && apt-get install -y -qq git || fatal "git kurulamadi"
fi
info "git: $(git --version)"

# ─── 2) Docker ──────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    info "Docker kuruluyor (resmi script)..."
    curl -fsSL https://get.docker.com | sh || fatal "Docker kurulamadi"
    systemctl enable --now docker 2>/dev/null || true
fi

if ! docker info >/dev/null 2>&1; then
    fatal "Docker daemon calısmiyor. Baslatin: systemctl start docker"
fi
info "Docker: $(docker --version)"

# Docker compose plugin
if ! docker compose version >/dev/null 2>&1; then
    warn "docker compose plugin bulunamadi — kurulmaya calisiliyor..."
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || \
        warn "docker-compose-plugin kurulamadi; install scripti tekrar deneyecek"
fi

# ─── 3) Repo klonla / guncelle ──────────────────────────────
step "2/3  Repo klonlaniyor / guncelleniyor..."
if [[ -d "$REPO_DIR/.git" ]]; then
    info "Mevcut repo guncelleniyor: $REPO_DIR"
    git -C "$REPO_DIR" fetch origin "$BRANCH" --quiet
    # --quiet: "Already on 'branch'" mesajini bastirır
    git -C "$REPO_DIR" checkout --quiet "$BRANCH" 2>/dev/null || true
    git -C "$REPO_DIR" pull --ff-only origin "$BRANCH" --quiet \
        || fatal "git pull basarisiz (divergent history?). Manuel cozun: git -C $REPO_DIR status"
    info "Repo guncellendi: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
else
    info "Repo klonlaniyor -> $REPO_DIR (branch: $BRANCH)"
    git clone -b "$BRANCH" --quiet "$REPO_URL" "$REPO_DIR" \
        || fatal "git clone basarisiz. Internet baglantisini kontrol edin."
    info "Repo klonlandi: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
fi

# ─── 4) Asil kurulum scriptini calistir ─────────────────────
step "3/3  Sunucu kurulumu baslatiliyor..."
printf '\n'
cd "$REPO_DIR"
exec bash install/server/install.sh "$@"
