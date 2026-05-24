#!/usr/bin/env bash
# ============================================================
# MailTrustAI Customer -- Ubuntu/Linux Docker Yedek Scripti
#
# Kullanim:
#   bash scripts/backup/backup-customer-ubuntu.sh
#       -> $INSTALL_DIR/backups/YYYY-MM-DD_HHMMSS/ altina yeni yedek
#
#   bash scripts/backup/backup-customer-ubuntu.sh /opt/mailtrustai/backups/auto-weekly
#       -> Belirtilen klasore UZERINE YAZAR (haftalik zamanlayici modu)
#
#   INSTALL_DIR=/opt/baska bash scripts/backup/backup-customer-ubuntu.sh
#       -> Farkli kurulum dizini
# ============================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/mailtrustai}"
TS="$(date +%Y-%m-%d_%H%M%S)"

# 1. arguman verilmisse hedef dizin (haftalik uzerine yazma modu)
if [[ -n "${1:-}" ]]; then
    if [[ "${1}" = /* ]]; then
        BACKUP_DIR="${1}"
    else
        BACKUP_DIR="${INSTALL_DIR}/${1}"
    fi
    [[ -d "${BACKUP_DIR}" ]] && rm -rf "${BACKUP_DIR}"
    MODE_LABEL="HAFTALIK (uzerine yaz)"
else
    BACKUP_DIR="${INSTALL_DIR}/backups/${TS}"
    MODE_LABEL="ZAMANLI"
fi
mkdir -p "${BACKUP_DIR}"

echo "==========================================================="
echo " MailTrustAI Customer Yedek [${MODE_LABEL}] -- ${TS}"
echo " Kaynak : ${INSTALL_DIR}"
echo " Hedef  : ${BACKUP_DIR}"
echo "==========================================================="

# --- 1) .env (EN KRITIK -- lisans + AES secret'lari) -----------
ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
    echo " HATA: .env bulunamadi: ${ENV_FILE}"
    echo " Kurulum dizinini INSTALL_DIR env degiskeni ile belirtin."
    exit 1
fi
cp "${ENV_FILE}" "${BACKUP_DIR}/.env"
chmod 600 "${BACKUP_DIR}/.env"
echo " [OK] .env kopyalandi (600 perms)"

# --- 2) customer-data volume (msa.db, settings, *.enc) ---------
DATA_VOLUME="mailtrustai-customer_customer-data"
if docker volume inspect "${DATA_VOLUME}" >/dev/null 2>&1; then
    docker run --rm \
        -v "${DATA_VOLUME}:/data:ro" \
        -v "${BACKUP_DIR}:/backup" \
        alpine \
        sh -c "cd /data && tar czf /backup/customer-data.tar.gz ."
    SIZE="$(du -h "${BACKUP_DIR}/customer-data.tar.gz" | cut -f1)"
    echo " [OK] customer-data.tar.gz olusturuldu (${SIZE})"
else
    echo " UYARI: Volume ${DATA_VOLUME} bulunamadi -- atlandi."
fi

# --- 3) customer-logs volume (opsiyonel) -----------------------
LOG_VOLUME="mailtrustai-customer_customer-logs"
if docker volume inspect "${LOG_VOLUME}" >/dev/null 2>&1; then
    docker run --rm \
        -v "${LOG_VOLUME}:/logs:ro" \
        -v "${BACKUP_DIR}:/backup" \
        alpine \
        sh -c "cd /logs && tar czf /backup/customer-logs.tar.gz . 2>/dev/null || true"
    if [[ -f "${BACKUP_DIR}/customer-logs.tar.gz" ]]; then
        SIZE="$(du -h "${BACKUP_DIR}/customer-logs.tar.gz" | cut -f1)"
        echo " [OK] customer-logs.tar.gz olusturuldu (${SIZE})"
    fi
fi

# --- 4) README.txt ---------------------------------------------
cat > "${BACKUP_DIR}/README.txt" <<EOF
MailTrustAI Customer Yedek -- ${TS}
================================================================

Dosyalar:
  .env                  -> Lisans + AES secret'lari (KRITIK)
  customer-data.tar.gz  -> msa.db, settings.json, *.enc
  customer-logs.tar.gz  -> Uygulama loglari (opsiyonel)

GERI YUKLEME:
  sudo bash scripts/backup/restore-customer-ubuntu.sh ${BACKUP_DIR}

NOT: .env ve customer-data.tar.gz HER ZAMAN BIRLIKTE saklanmalidir.
     Yalniz biri kurtulursa eski sifrelenmis dosyalar acilamaz.

DIKKAT: Bu yedek \$INSTALL_DIR/backups/ icindedir.
  Tam kaldirma oncesi bu klasoru baska bir yere KOPYALAYIN,
  aksi halde yedek de silinir.
  Ornek: cp -r /opt/mailtrustai/backups /home/kullanici/mailtrustai-yedek
================================================================
EOF

# --- 5) Son yedekleri listele ----------------------------------
echo ""
echo "Son yedekler:"
ls -1dt "${INSTALL_DIR}/backups/"*/ 2>/dev/null | head -5 | sed 's|.*/||;s|/||' \
    | while read -r d; do echo "  $d"; done || echo "  (henuz yedek yok)"

echo ""
echo "==========================================================="
echo " [OK] Yedekleme tamam: ${BACKUP_DIR}"
echo "==========================================================="
