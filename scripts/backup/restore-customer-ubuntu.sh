#!/usr/bin/env bash
# ============================================================
# MailTrustAI Customer — Yedekten Geri Yukleme
#
# Kullanim:
#   bash scripts/restore-ubuntu-customer.sh backups/2026-05-23_211500
# ============================================================
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Kullanim: $0 <yedek-klasoru>"
    echo "Ornek:   $0 backups/2026-05-23_211500"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$(cd "$1" && pwd)"

if command -v cygpath >/dev/null 2>&1; then
    BACKUP_DIR_DOCKER="$(cygpath -w "${BACKUP_DIR}")"
    export MSYS_NO_PATHCONV=1
else
    BACKUP_DIR_DOCKER="${BACKUP_DIR}"
fi

[[ -f "${BACKUP_DIR}/.env.docker" ]]            || { echo "HATA: ${BACKUP_DIR}/.env.docker yok"; exit 1; }
[[ -f "${BACKUP_DIR}/customer-data.tar.gz" ]]   || { echo "HATA: ${BACKUP_DIR}/customer-data.tar.gz yok"; exit 1; }

echo "═══════════════════════════════════════════════════════════"
echo " Geri Yukleme: ${BACKUP_DIR}"
echo "═══════════════════════════════════════════════════════════"

# ─── 1) Container'i durdur ──────────────────────────────────────
cd "${REPO_ROOT}"
if docker ps --format '{{.Names}}' | grep -q '^mailtrustai-customer$'; then
    echo " ▶ Container durduruluyor..."
    docker compose --env-file .env.docker -f docker-compose.customer.yml down 2>/dev/null || true
fi

# ─── 2) .env.docker geri yukle ──────────────────────────────────
if [[ -f "${REPO_ROOT}/.env.docker" ]]; then
    cp "${REPO_ROOT}/.env.docker" "${REPO_ROOT}/.env.docker.before-restore-$(date +%s)"
    echo " ▶ Mevcut .env.docker once .before-restore-* olarak yedeklendi"
fi
cp "${BACKUP_DIR}/.env.docker" "${REPO_ROOT}/.env.docker"
chmod 600 "${REPO_ROOT}/.env.docker"
echo " ✓ .env.docker geri yuklendi"

# ─── 3) Volume'u temizle + geri yukle ───────────────────────────
VOLUME_NAME="mailtrustai-customer_customer-data"
docker volume create "${VOLUME_NAME}" >/dev/null

echo " ▶ Volume icerigi temizleniyor..."
docker run --rm -v "${VOLUME_NAME}:/data" alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null || true"

echo " ▶ customer-data.tar.gz aciliyor..."
docker run --rm \
    -v "${VOLUME_NAME}:/data" \
    -v "${BACKUP_DIR_DOCKER}:/backup:ro" \
    alpine \
    sh -c "cd /data && tar xzf /backup/customer-data.tar.gz"
echo " ✓ Volume geri yuklendi"

# ─── 4) Container'i baslat ──────────────────────────────────────
echo " ▶ Container baslatiliyor..."
docker compose --env-file .env.docker -f docker-compose.customer.yml up -d

sleep 5
docker compose --env-file .env.docker -f docker-compose.customer.yml ps

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✓ Geri yukleme tamam. http://localhost:3000"
echo "═══════════════════════════════════════════════════════════"
