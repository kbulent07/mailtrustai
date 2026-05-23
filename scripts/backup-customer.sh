#!/usr/bin/env bash
# ============================================================
# MailTrustAI Customer — Yedek Alma Scripti
#
# Yeni bir kurulum / rebuild / Docker upgrade öncesi çalıştır.
# Backups klasörüne tarihli .tar.gz arşivler bırakır + .env.docker
# kopyasını AYRI tutar (en kritik dosya).
#
# Kullanım:
#   bash scripts/backup-customer.sh
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_DIR="${REPO_ROOT}/backups/${TS}"
mkdir -p "${BACKUP_DIR}"

# Windows Git Bash icin path conversion (cygpath varsa Windows yoluna cevir).
# Docker Desktop Windows volume mount'larinda gerekli.
if command -v cygpath >/dev/null 2>&1; then
    BACKUP_DIR_DOCKER="$(cygpath -w "${BACKUP_DIR}")"
    export MSYS_NO_PATHCONV=1
else
    BACKUP_DIR_DOCKER="${BACKUP_DIR}"
fi

echo "═══════════════════════════════════════════════════════════"
echo " MailTrustAI Customer Yedek — ${TS}"
echo " Hedef: ${BACKUP_DIR}"
echo "═══════════════════════════════════════════════════════════"

# ─── 1) .env.docker (EN KRİTİK — anahtarlar burada) ────────────
if [[ -f "${REPO_ROOT}/.env.docker" ]]; then
    cp "${REPO_ROOT}/.env.docker" "${BACKUP_DIR}/.env.docker"
    chmod 600 "${BACKUP_DIR}/.env.docker"
    echo " ✓ .env.docker kopyalandi (600 perms)"
else
    echo " ✗ HATA: .env.docker bulunamadi! Devam edilmiyor."
    exit 1
fi

# ─── 2) customer-data volume (msa.db, settings, *.enc) ─────────
VOLUME_NAME="mailtrustai-customer_customer-data"
if docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
    docker run --rm \
        -v "${VOLUME_NAME}:/data:ro" \
        -v "${BACKUP_DIR_DOCKER}:/backup" \
        alpine \
        sh -c "cd /data && tar czf /backup/customer-data.tar.gz ."
    SIZE=$(du -h "${BACKUP_DIR}/customer-data.tar.gz" | cut -f1)
    echo " ✓ customer-data.tar.gz olusturuldu (${SIZE})"
else
    echo " ⚠ Volume ${VOLUME_NAME} bulunamadi — atlandi."
fi

# ─── 3) customer-logs volume (opsiyonel) ───────────────────────
LOG_VOLUME="mailtrustai-customer_customer-logs"
if docker volume inspect "${LOG_VOLUME}" >/dev/null 2>&1; then
    docker run --rm \
        -v "${LOG_VOLUME}:/logs:ro" \
        -v "${BACKUP_DIR_DOCKER}:/backup" \
        alpine \
        sh -c "cd /logs && tar czf /backup/customer-logs.tar.gz . 2>/dev/null || true"
    if [[ -f "${BACKUP_DIR}/customer-logs.tar.gz" ]]; then
        SIZE=$(du -h "${BACKUP_DIR}/customer-logs.tar.gz" | cut -f1)
        echo " ✓ customer-logs.tar.gz olusturuldu (${SIZE})"
    fi
fi

# ─── 4) Yedek metadata (geri yukleme rehberi) ──────────────────
cat > "${BACKUP_DIR}/README.txt" <<EOF
MailTrustAI Customer Yedek — ${TS}
================================================================

Bu klasor SU 3 dosyayi icerir:
  - .env.docker             → AES sifreleme anahtarlari (KRITIK)
  - customer-data.tar.gz    → msa.db, settings.json, *.enc dosyalari
  - customer-logs.tar.gz    → Uygulama loglari (opsiyonel)

GERI YUKLEME (yeni kurulum sonrasi):
------------------------------------
1) Container'i durdur:
   docker compose --env-file .env.docker -f docker-compose.customer.yml down

2) .env.docker'i geri koy:
   cp ${BACKUP_DIR}/.env.docker /path/to/repo/.env.docker
   chmod 600 /path/to/repo/.env.docker

3) Volume'u geri yukle:
   docker volume create mailtrustai-customer_customer-data
   docker run --rm \\
     -v mailtrustai-customer_customer-data:/data \\
     -v ${BACKUP_DIR}:/backup:ro \\
     alpine \\
     sh -c "cd /data && tar xzf /backup/customer-data.tar.gz"

4) Container'i baslat:
   docker compose --env-file .env.docker -f docker-compose.customer.yml up -d

NOT: .env.docker ve customer-data.tar.gz HER ZAMAN BIRLIKTE
saklanmalidir. Sadece volume'u kurtarip .env.docker'i kaybedersen
tum .enc dosyalari (license-cache, central-policy, credentials)
acilamaz hale gelir.
================================================================
EOF

# ─── 5) Eski yedekleri raporla ─────────────────────────────────
echo ""
echo "Mevcut yedekler:"
ls -lhd "${REPO_ROOT}/backups/"*/ 2>/dev/null | tail -10 || echo " (henuz yedek yok)"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " ✓ Yedekleme tamam: ${BACKUP_DIR}"
echo "═══════════════════════════════════════════════════════════"
