#!/bin/bash
# ==============================================================================
# MailTrustAI - Ubuntu 24.04 Kaldırma Scripti
# ==============================================================================
# Bu betik MailTrustAI projesini ve isteğe bağlı olarak verilerini sistemden kaldırır.
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}=================================================${NC}"
echo -e "${RED}   MailTrustAI - Sistemden Kaldırma Scripti      ${NC}"
echo -e "${RED}=================================================${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}HATA: Lütfen bu betiği root yetkileriyle (sudo) çalıştırın.${NC}"
  exit 1
fi

APP_DIR="/opt/mailtrustai"

echo -e "\n${YELLOW}UYARI: Bu işlem MailTrustAI uygulamasını durduracak ve sunucudan silecektir.${NC}"
read -p "Devam etmek istiyor musunuz? (e/h): " confirm
if [[ "$confirm" != "e" && "$confirm" != "E" ]]; then
    echo "Kaldırma işlemi iptal edildi."
    exit 0
fi

echo -e "\n${YELLOW}[1/4] Docker servisleri durduruluyor ve siliniyor...${NC}"
if [ -d "$APP_DIR" ]; then
    cd $APP_DIR
    if [ -f "docker-compose.prod.yml" ]; then
        docker compose -f docker-compose.prod.yml down --rmi all 2>/dev/null || true
    fi
    if [ -f "docker-compose.yml" ]; then
        docker compose down --rmi all 2>/dev/null || true
    fi
else
    echo "Proje dizini bulunamadı ($APP_DIR), Docker temizliği atlanıyor."
fi

# Ortada kalan imajlar varsa zorla temizle
docker rmi mailtrustai-app 2>/dev/null || true

echo -e "\n${YELLOW}[2/4] Systemd otomatik başlama servisi kaldırılıyor...${NC}"
if [ -f "/etc/systemd/system/mailtrustai.service" ]; then
    systemctl stop mailtrustai.service 2>/dev/null || true
    systemctl disable mailtrustai.service 2>/dev/null || true
    rm /etc/systemd/system/mailtrustai.service
    systemctl daemon-reload
    echo "Servis başarıyla silindi."
else
    echo "Systemd servisi zaten kurulu değil."
fi

echo -e "\n${YELLOW}[3/4] Güvenlik duvarı (UFW) portları kapatılıyor...${NC}"
ufw delete allow 3000/tcp 2>/dev/null || true
# 80 ve 443 portları sunucudaki başka web siteleri için gerekli olabileceğinden
# kullanıcının inisiyatifine bırakılması daha güvenlidir.
echo "3000 portu kapatıldı. (80 ve 443 portlarına dokunulmadı)"

echo -e "\n${YELLOW}[4/4] Uygulama verileri ve klasörleri...${NC}"
read -p "Tüm veritabanı (SQLite), loglar ve proje klasörü (/opt/mailtrustai) SİLİNSİN Mİ? Bu işlem geri alınamaz! (e/h): " delete_data
if [[ "$delete_data" == "e" || "$delete_data" == "E" ]]; then
    echo "Klasör siliniyor: $APP_DIR"
    rm -rf $APP_DIR
    # Docker volume'lerini de sil
    docker volume rm mailtrustai_data mailtrustai_logs 2>/dev/null || true
    echo "Tüm veriler temizlendi."
else
    echo "Veriler korundu. ($APP_DIR dizininde)"
fi

echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN} Kaldırma işlemi başarıyla tamamlandı! ${NC}"
echo -e "${GREEN}=================================================${NC}"
