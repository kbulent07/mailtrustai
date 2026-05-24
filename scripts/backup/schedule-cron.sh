#!/usr/bin/env bash
# ============================================================
# MailTrustAI — Haftalık Otomatik Yedek Cron Kurulumu
#
# Her Pazar 02:00'de yedek alır; sabit klasörün ÜZERİNE YAZAR.
# Önceki haftalık yedek silinir, yenisi oluşturulur.
#
# Kullanım:
#   # Müşteri sunucusunda (customer):
#   bash scripts/setup-cron-backup.sh customer
#
#   # Server sunucusunda (server):
#   sudo bash scripts/setup-cron-backup.sh server
#
#   # Her ikisi (tek makinede çalışıyorsa):
#   sudo bash scripts/setup-cron-backup.sh all
#
#   # Mevcut cron girişlerini görmek için:
#   bash scripts/setup-cron-backup.sh show
#
#   # Cron girişlerini kaldırmak için:
#   bash scripts/setup-cron-backup.sh remove
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-show}"

# Haftalık yedek hedef klasörleri (sabit isim, üzerine yazılır)
CUSTOMER_WEEKLY_DIR="${REPO_ROOT}/backups/auto-weekly"
SERVER_WEEKLY_DIR="${REPO_ROOT}/backups/server-auto-weekly"

# Cron ifadesini: Her Pazar 02:00
CRON_SCHEDULE="0 2 * * 0"

CRON_TAG_CUSTOMER="# mailtrustai-customer-weekly-backup"
CRON_TAG_SERVER="# mailtrustai-server-weekly-backup"

CRON_LINE_CUSTOMER="${CRON_SCHEDULE} bash '${REPO_ROOT}/scripts/backup/backup-customer-ubuntu.sh' '${CUSTOMER_WEEKLY_DIR}' >> '${REPO_ROOT}/logs/backup-customer.log' 2>&1 ${CRON_TAG_CUSTOMER}"
CRON_LINE_SERVER="${CRON_SCHEDULE} bash '${REPO_ROOT}/scripts/backup/backup-server-ubuntu.sh' '${SERVER_WEEKLY_DIR}' >> '${REPO_ROOT}/logs/backup-server.log' 2>&1 ${CRON_TAG_SERVER}"

# Log klasörünü oluştur
mkdir -p "${REPO_ROOT}/logs"

show_cron() {
    echo "Mevcut MailTrustAI cron girişleri:"
    crontab -l 2>/dev/null | grep -E "mailtrustai.*backup" || echo "  (hiç giriş yok)"
}

add_cron() {
    local line="$1"
    local tag="$2"
    # Aynı tag'li eski girişi önce temizle
    local tmp
    tmp="$(crontab -l 2>/dev/null | grep -v "${tag}" || true)"
    # Yeni satırı ekle
    printf '%s\n%s\n' "${tmp}" "${line}" | crontab -
    echo " ✓ Cron eklendi: ${line}"
}

remove_cron() {
    local tmp
    tmp="$(crontab -l 2>/dev/null | grep -vE "mailtrustai.*backup" || true)"
    printf '%s\n' "${tmp}" | crontab -
    echo " ✓ Tüm MailTrustAI backup cron girişleri kaldırıldı."
}

case "${MODE}" in
    customer)
        echo "Müşteri haftalık yedek cron'u kuruluyor..."
        add_cron "${CRON_LINE_CUSTOMER}" "${CRON_TAG_CUSTOMER}"
        show_cron
        ;;
    server)
        echo "Server haftalık yedek cron'u kuruluyor..."
        add_cron "${CRON_LINE_SERVER}" "${CRON_TAG_SERVER}"
        show_cron
        ;;
    all)
        echo "Customer + Server haftalık yedek cron'ları kuruluyor..."
        add_cron "${CRON_LINE_CUSTOMER}" "${CRON_TAG_CUSTOMER}"
        add_cron "${CRON_LINE_SERVER}" "${CRON_TAG_SERVER}"
        show_cron
        ;;
    remove)
        remove_cron
        ;;
    show|*)
        show_cron
        echo ""
        echo "Kurulum için: bash scripts/setup-cron-backup.sh [customer|server|all]"
        ;;
esac

echo ""
echo "Haftalık yedek hedefleri:"
echo "  Customer: ${CUSTOMER_WEEKLY_DIR}"
echo "  Server  : ${SERVER_WEEKLY_DIR}"
echo "  Loglar  : ${REPO_ROOT}/logs/"
echo ""
echo "NOT: Uygulama kapalıyken cron çalışmaz (sistem cron'u — her zaman çalışır)."
