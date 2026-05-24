#!/usr/bin/env bash
# ============================================================
# MailTrustAI Server — Yedekten Geri Yukleme
#
# Kullanim:
#   sudo bash scripts/restore-ubuntu-server.sh backups/server-2026-05-23_220000
# ============================================================
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Kullanim: $0 <yedek-klasoru>"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$(cd "$1" && pwd)"

[[ -f "${BACKUP_DIR}/.env.docker" ]]               || { echo "HATA: .env.docker yok"; exit 1; }
[[ -f "${BACKUP_DIR}/mariadb-dump.sql.gz" ]]       || { echo "HATA: mariadb-dump.sql.gz yok"; exit 1; }

# Project name'i tespit et
PROJECT_NAME="${PROJECT_NAME:-}"
if [[ -z "${PROJECT_NAME}" ]]; then
    if docker volume inspect mailtrustai_mariadb-data >/dev/null 2>&1; then
        PROJECT_NAME="mailtrustai"
    else
        PROJECT_NAME="mailtrustai-server"
    fi
fi

MARIADB_CONTAINER="mailtrustai-mariadb"
LICENSE_VOLUME="${PROJECT_NAME}_license-server-data"

echo "═══════════════════════════════════════════════════════════"
echo " Server Geri Yukleme: ${BACKUP_DIR}"
echo " Project: ${PROJECT_NAME}"
echo "═══════════════════════════════════════════════════════════"

cd "${REPO_ROOT}"

# ─── 1) Stack'i durdur ─────────────────────────────────────────
echo " ▶ Stack durduruluyor..."
docker compose --env-file .env.docker -f docker-compose.server.yml -p "${PROJECT_NAME}" down 2>/dev/null || true

# ─── 2) .env.docker geri yukle ─────────────────────────────────
if [[ -f "${REPO_ROOT}/.env.docker" ]]; then
    cp "${REPO_ROOT}/.env.docker" "${REPO_ROOT}/.env.docker.before-restore-$(date +%s)"
    echo " ▶ Mevcut .env.docker .before-restore-* olarak yedeklendi"
fi
cp "${BACKUP_DIR}/.env.docker" "${REPO_ROOT}/.env.docker"
chmod 600 "${REPO_ROOT}/.env.docker"
echo " ✓ .env.docker geri yuklendi"

# ─── 3) Sadece mariadb'yi baslat ───────────────────────────────
echo " ▶ MariaDB baslatiliyor..."
docker compose --env-file .env.docker -f docker-compose.server.yml -p "${PROJECT_NAME}" up -d mariadb

# Healthy bekle
echo " ▶ MariaDB healthy bekleniyor..."
for i in {1..30}; do
    status=$(docker inspect -f '{{.State.Health.Status}}' "${MARIADB_CONTAINER}" 2>/dev/null || echo "starting")
    if [[ "${status}" == "healthy" ]]; then
        echo " ✓ MariaDB healthy"
        break
    fi
    sleep 2
done

# ─── 4) DB'yi drop + recreate + restore ────────────────────────
set +u
source <(grep -E '^MARIADB_(ROOT_PASSWORD|DATABASE)=' "${REPO_ROOT}/.env.docker")
set -u
MARIADB_DATABASE="${MARIADB_DATABASE:-mailtrustai_license}"

echo " ▶ Database temizleniyor: ${MARIADB_DATABASE}..."
docker exec -i "${MARIADB_CONTAINER}" \
    mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" \
    -e "DROP DATABASE IF EXISTS \`${MARIADB_DATABASE}\`; CREATE DATABASE \`${MARIADB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo " ▶ Dump geri yukleniyor..."
gunzip -c "${BACKUP_DIR}/mariadb-dump.sql.gz" | \
    docker exec -i "${MARIADB_CONTAINER}" \
    mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}"
echo " ✓ MariaDB restore tamam"

# ─── 5) license-server-data volume restore ─────────────────────
if [[ -f "${BACKUP_DIR}/license-server-data.tar.gz" ]]; then
    echo " ▶ license-server-data volume restore..."
    docker volume create "${LICENSE_VOLUME}" >/dev/null
    docker run --rm -v "${LICENSE_VOLUME}:/data" alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null || true"
    docker run --rm \
        -v "${LICENSE_VOLUME}:/data" \
        -v "${BACKUP_DIR}:/backup:ro" \
        alpine \
        sh -c "cd /data && tar xzf /backup/license-server-data.tar.gz"
    echo " ✓ license-server-data restore tamam"
fi

# ─── 6) Stack'i tam baslat ─────────────────────────────────────
echo " ▶ Tum stack baslatiliyor..."
docker compose --env-file .env.docker -f docker-compose.server.yml -p "${PROJECT_NAME}" up -d

sleep 5
docker compose --env-file .env.docker -f docker-compose.server.yml -p "${PROJECT_NAME}" ps

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✓ Server geri yukleme tamam."
echo "═══════════════════════════════════════════════════════════"
