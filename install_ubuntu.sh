#!/bin/bash
# ==============================================================================
# MailTrustAI - Ubuntu 24.04 Otomatik Kurulum Scripti (Docker Tabanlı)
# ==============================================================================
# Bu betik MailTrustAI projesi için Ubuntu 24.04 üzerinde gerekli bağımlılıkları,
# Docker'ı ve uygulama ortamını otomatik olarak hazırlar.
# ==============================================================================

set -e

# Renk tanımlamaları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}   MailTrustAI - Ubuntu 24.04 Kurulum Scripti    ${NC}"
echo -e "${GREEN}=================================================${NC}"

# 1. Root kontrolü
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}HATA: Lütfen bu betiği root yetkileriyle (sudo) çalıştırın.${NC}"
  echo "Kullanım: sudo ./install_ubuntu.sh"
  exit 1
fi

echo -e "\n${YELLOW}[1/7] Sistem güncelleniyor ve temel paketler kuruluyor...${NC}"
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release ufw git jq openssl

echo -e "\n${YELLOW}[2/7] Docker ve Docker Compose yükleniyor...${NC}"
# Eski Docker paketlerini temizle
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Docker GPG anahtarını ekle
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
chmod a+r /etc/apt/keyrings/docker.gpg

# Docker reposunu ekle
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker'ı kur
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo -e "\n${YELLOW}[3/7] Güvenlik duvarı (UFW) kuralları ekleniyor...${NC}"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow OpenSSH
echo "Not: Güvenlik duvarı kuralları eklendi ancak UFW otomatik olarak aktifleştirilmedi."
echo "Aktifleştirmek isterseniz 'sudo ufw enable' komutunu kullanabilirsiniz."

echo -e "\n${YELLOW}[4/7] Proje dizini hazırlanıyor (/opt/mailtrustai)...${NC}"
APP_DIR="/opt/mailtrustai"

if [ ! -d "$APP_DIR" ]; then
    echo "Proje GitHub'dan klonlanıyor..."
    git clone https://github.com/kbulent07/mailtrustai.git $APP_DIR
else
    echo "Proje dizini ($APP_DIR) zaten mevcut."
fi

cd $APP_DIR

echo -e "\n${YELLOW}[5/7] Ortam değişkenleri (.env) hazırlanıyor...${NC}"
if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    
    # Güvenlik için rastgele şifreler oluştur
    ENC_PASSWORD=$(openssl rand -hex 32)
    ENC_SALT=$(openssl rand -hex 16)
    LICENSE_SECRET=$(openssl rand -hex 32)
    
    # Sed ile anahtarları yerleştir
    sed -i "s/MSA_ENC_PASSWORD=.*/MSA_ENC_PASSWORD=${ENC_PASSWORD}/" .env
    sed -i "s/MSA_ENC_SALT=.*/MSA_ENC_SALT=${ENC_SALT}/" .env
    sed -i "s/MSA_LICENSE_SECRET=.*/MSA_LICENSE_SECRET=${LICENSE_SECRET}/" .env
    
    echo ".env dosyası oluşturuldu ve güvenli anahtarlar otomatik eklendi."
else
    echo ".env dosyası zaten mevcut veya .env.example bulunamadı. Atlanıyor."
fi

echo -e "\n${YELLOW}[5.1/7] Tek seferlik giriş şifreleri (initial_creds.json) oluşturuluyor...${NC}"
CREDS_FILE="data/initial_creds.json"
if [ ! -f "$CREDS_FILE" ]; then
    ADMIN_INIT_PASS=$(openssl rand -hex 6)
    CUST_INIT_PASS=$(openssl rand -hex 6)
    
    cat << EOF > $CREDS_FILE
{
  "adminPassword": "$ADMIN_INIT_PASS",
  "customerPassword": "$CUST_INIT_PASS"
}
EOF
    echo -e "${GREEN}ÖNEMLİ: İlk giriş için geçici şifreler oluşturuldu:${NC}"
    echo -e "Admin Şifresi: ${YELLOW}$ADMIN_INIT_PASS${NC}"
    echo -e "Müşteri Şifresi: ${YELLOW}$CUST_INIT_PASS${NC}"
    echo "Bu şifreler ilk başarılı girişten sonra güvenlik nedeniyle otomatik olarak silinecektir."
fi

echo -e "\n${YELLOW}[6/7] Dizin izinleri ayarlanıyor...${NC}"
mkdir -p data logs nginx/certs
# Docker konteynerindeki non-root mailtrustai kullanıcısı (UID=1001) için izin ver
chown -R 1001:1001 data logs
chmod 755 data logs

echo -e "\n${YELLOW}[7/7] Systemd servisi oluşturuluyor...${NC}"
cat << 'EOF' > /etc/systemd/system/mailtrustai.service
[Unit]
Description=MailTrustAI Docker Stack
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/mailtrustai
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mailtrustai.service

echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN} Kurulum işlemleri başarıyla tamamlandı! ${NC}"
echo -e "${GREEN}=================================================${NC}"
echo -e "\n${YELLOW}GEREKLİ SONRAKİ ADIMLAR:${NC}"
echo "1. Uygulama ayarlarını kontrol etmek ve eksikleri doldurmak için:"
echo -e "   ${GREEN}nano /opt/mailtrustai/.env${NC}"
echo ""
echo "2. Nginx ayarlarını kendi domaininize göre düzenlemek için:"
echo -e "   ${GREEN}nano /opt/mailtrustai/nginx/nginx.conf${NC}"
echo "   (server_name satırını domaininize göre değiştirin)"
echo ""
echo "3. SSL Sertifikası kurulumu (üretim ortamı için gereklidir):"
echo -e "   ${GREEN}sudo certbot certonly --standalone -d mailtrustai.sirketiniz.com${NC}"
echo -e "   ${GREEN}sudo cp /etc/letsencrypt/live/.../fullchain.pem /opt/mailtrustai/nginx/certs/${NC}"
echo -e "   ${GREEN}sudo cp /etc/letsencrypt/live/.../privkey.pem /opt/mailtrustai/nginx/certs/${NC}"
echo ""
echo "4. Ayarları tamamladıktan sonra servisi başlatmak için:"
echo -e "   ${GREEN}sudo systemctl start mailtrustai.service${NC}"
echo ""
echo "Logları izlemek için:"
echo -e "   ${GREEN}cd /opt/mailtrustai && docker compose -f docker-compose.prod.yml logs -f${NC}"
echo ""
