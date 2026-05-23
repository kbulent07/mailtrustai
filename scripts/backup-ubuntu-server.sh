#!/usr/bin/env bash
# ============================================================
# MailTrustAI Server (license-server + dealer + mariadb) — Yedek
#
# Ubuntu/Linux uretici sunucusu icin. Su 3 seyi yedekler:
#   1) .env.docker                 (LICENSE_SIGNING_SECRET, DB sifreleri, secret'lar)
#   2) MariaDB logical dump (.sql) (mariadb-dump --single-transaction)
#   3) license-server-data volume  (audit log, app state)
#
# Kullanim:
#   sudo bash scripts/backup-ubuntu-server.sh
#
# Varsayilan compose project name: 'mailtrustai-server'. Eski prod
# stack 'mailtrustai' adiyla acilmis ise PROJECT_NAME env'i ile override:
#   PROJECT_NAME=mailtrustai bash scripts/backup-ubuntu-server.sh
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_DIR="${REPO_ROOT}/backups/server-${TS}"
mkdir -p "${BACKUP_DIR}"

# Compose project name'i otomatik tespit et (volume isimleri buna gore)
PROJECT_NAME="${PROJECT_NAME:-}"
if [[ -z "${PROJECT_NAME}" ]]; then
    if docker volume inspect mailtrustai_mariadb-data >/dev/null 2>&1; then
        PROJECT_NAME="mailtrustai"
    elif docker volume inspect mailtrustai-server_mariadb-data >/dev/null 2>&1; then
        PROJECT_NAME="mailtrustai-server"
    else
        echo "HATA: mariadb-data volume bulunamadi. PROJECT_NAME env ile manuel ver."
        exit 1
    fi
fi

MARIADB_VOLUME="${PROJECT_NAME}_mariadb-data"
LICENSE_VOLUME="${PROJECT_NAME}_license-server-data"
MARIADB_CONTAINER="mailtrustai-mariadb"

echo "═══════════════════════════════════════════════════════════"
echo " MailTrustAI Server Yedek — ${TS}"
echo " Project name : ${PROJECT_NAME}"
echo " Hedef        : ${BACKUP_DIR}"
echo "═══════════════════════════════════════════════════════════"

# ─── 1) .env.docker ────────────────────────────────────────────
if [[ ! -f "${REPO_ROOT}/.env.docker" ]]; then
    echo " ✗ .env.docker bulunamadi! Yedek iptal."
    exit 1
fi
cp "${REPO_ROOT}/.env.docker" "${BACKUP_DIR}/.env.docker"
chmod 600 "${BACKUP_DIR}/.env.docker"
echo " ✓ .env.docker kopyalandi"

# .env.docker'den DB credential'lari oku (MariaDB dump icin)
set +u
# shellcheck disable=SC1091
source <(grep -E '^(MARIADB_ROOT_PASSWORD|MARIADB_DATABASE|MARIADB_USER)=' "${REPO_ROOT}/.env.docker")
set -u
MARIADB_DATABASE="${MARIADB_DATABASE:-mailtrustai_license}"

if [[ -z "${MARIADB_ROOT_PASSWORD:-}" ]]; then
    echo " ✗ MARIADB_ROOT_PASSWORD .env.docker'de tanimli degil!"
    exit 1
fi

# ─── 2) MariaDB logical dump (en kritik veri) ──────────────────
if ! docker ps --format '{{.Names}}' | grep -q "^${MARIADB_CONTAINER}$"; then
    echo " ✗ Container ${MARIADB_CONTAINER} calismiyor — dump alinamiyor."
    echo "   docker compose --env-file .env.docker -f docker-compose.server.yml up -d mariadb"
    exit 1
fi

echo " ▶ MariaDB dump aliniyor (single-transaction, routines, triggers, events)..."
docker exec -i "${MARIADB_CONTAINER}" \
    mariadb-dump \
        -uroot -p"${MARIADB_ROOT_PASSWORD}" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        --default-character-set=utf8mb4 \
        --databases "${MARIADB_DATABASE}" \
    > "${BACKUP_DIR}/mariadb-dump.sql" 2> "${BACKUP_DIR}/mariadb-dump.err"

if [[ ! -s "${BACKUP_DIR}/mariadb-dump.sql" ]]; then
    echo " ✗ Dump bos! Hata logu:"
    cat "${BACKUP_DIR}/mariadb-dump.err"
    exit 1
fi
rm -f "${BACKUP_DIR}/mariadb-dump.err"

# Dump'i hemen gzip'le
gzip -9 "${BACKUP_DIR}/mariadb-dump.sql"
SIZE=$(du -h "${BACKUP_DIR}/mariadb-dump.sql.gz" | cut -f1)
echo " ✓ mariadb-dump.sql.gz olusturuldu (${SIZE})"

# ─── 3) license-server-data volume ─────────────────────────────
if docker volume inspect "${LICENSE_VOLUME}" >/dev/null 2>&1; then
    docker run --rm \
        -v "${LICENSE_VOLUME}:/data:ro" \
        -v "${BACKUP_DIR}:/backup" \
        alpine \
        sh -c "cd /data && tar czf /backup/license-server-data.tar.gz ."
    SIZE=$(du -h "${BACKUP_DIR}/license-server-data.tar.gz" | cut -f1)
    echo " ✓ license-server-data.tar.gz olusturuldu (${SIZE})"
else
    echo " ⚠ Volume ${LICENSE_VOLUME} bulunamadi — atlandi."
fi

# ─── 4) README (geri yukleme rehberi) ──────────────────────────
cat > "${BACKUP_DIR}/README.txt" <<EOF
MailTrustAI Server Yedek — ${TS}
Project name: ${PROJECT_NAME}
================================================================

ICERIK:
  - .env.docker                  -> Secret'lar (LICENSE_SIGNING_SECRET KRITIK)
  - mariadb-dump.sql.gz          -> Tum lisans/musteri/bayi/kredi verileri
  - license-server-data.tar.gz   -> Audit log + uygulama state

GERI YUKLEME (musteri-down olmadan):
------------------------------------
1) Stack'i durdur:
   docker compose --env-file .env.docker -f docker-compose.server.yml -p ${PROJECT_NAME} down

2) .env.docker'i geri koy:
   sudo cp ${BACKUP_DIR}/.env.docker ${REPO_ROOT}/.env.docker
   sudo chmod 600 ${REPO_ROOT}/.env.docker

3) Sadece mariadb'yi baslat:
   docker compose --env-file .env.docker -f docker-compose.server.yml -p ${PROJECT_NAME} up -d mariadb
   # healthy bekle (~30s)

4) DB'yi temizle + dump'i geri yukle:
   source <(grep -E '^MARIADB_(ROOT_PASSWORD|DATABASE)=' .env.docker)
   docker exec -i mailtrustai-mariadb mariadb -uroot -p"\$MARIADB_ROOT_PASSWORD" \\
     -e "DROP DATABASE IF EXISTS \$MARIADB_DATABASE; CREATE DATABASE \$MARIADB_DATABASE;"
   gunzip -c ${BACKUP_DIR}/mariadb-dump.sql.gz | \\
     docker exec -i mailtrustai-mariadb mariadb -uroot -p"\$MARIADB_ROOT_PASSWORD"

5) license-server volume'unu geri yukle:
   docker volume rm ${LICENSE_VOLUME} 2>/dev/null || true
   docker volume create ${LICENSE_VOLUME}
   docker run --rm \\
     -v ${LICENSE_VOLUME}:/data \\
     -v ${BACKUP_DIR}:/backup:ro \\
     alpine sh -c "cd /data && tar xzf /backup/license-server-data.tar.gz"

6) Stack'i tam baslat:
   docker compose --env-file .env.docker -f docker-compose.server.yml -p ${PROJECT_NAME} up -d

KRITIK NOT:
LICENSE_SIGNING_SECRET .env.docker'da. Bu secret degisirse tum
musteri lisanslari (HMAC) invalid olur ve musteri uygulamalari
"License signature invalid" hatasi verir. .env.docker mutlaka
DB dump ile BIRLIKTE saklanmalidir.
================================================================
EOF

# ─── 5) Eski yedekleri listele ─────────────────────────────────
echo ""
echo "Mevcut server yedekleri:"
ls -lhd "${REPO_ROOT}/backups/server-"*/ 2>/dev/null | tail -10 || echo " (henuz yedek yok)"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✓ Yedekleme tamam: ${BACKUP_DIR}"
echo "═══════════════════════════════════════════════════════════"
