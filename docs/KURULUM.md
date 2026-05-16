# MailTrustAI — Kurulum ve Yapılandırma Kılavuzu

> **Versiyon:** 1.0 · **Güncelleme:** 2026-05

---

## İçindekiler

1. [Sistem Gereksinimleri](#1-sistem-gereksinimleri)
2. [Linux Kurulumu (Ubuntu / Debian)](#2-linux-kurulumu-ubuntu--debian)
3. [Linux Kurulumu (RHEL / CentOS / AlmaLinux)](#3-linux-kurulumu-rhel--centos--almalinux)
4. [Windows Kurulumu](#4-windows-kurulumu)
5. [Ortam Değişkenleri (.env)](#5-ortam-değişkenleri-env)
6. [İlk Yapılandırma](#6-i̇lk-yapılandırma)
7. [Nginx Reverse Proxy (Linux)](#7-nginx-reverse-proxy-linux)
8. [IIS Reverse Proxy (Windows)](#8-iis-reverse-proxy-windows)
9. [SSL / TLS Sertifikası](#9-ssl--tls-sertifikası)
10. [Online Lisans Sunucusu Altyapısı](#10-online-lisans-sunucusu-altyapısı)
11. [Güncelleme Prosedürü](#11-güncelleme-prosedürü)
12. [Sorun Giderme](#12-sorun-giderme)
13. [Docker ile Kurulum](#13-docker-ile-kurulum)

---

## 1. Sistem Gereksinimleri

| Bileşen | Minimum | Önerilen |
|---|---|---|
| CPU | 2 vCore | 4 vCore |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB | 50 GB |
| Node.js | v18 LTS | v20 LTS veya v22 LTS |
| İşletim Sistemi | Ubuntu 20.04 / Windows Server 2019 | Ubuntu 22.04 / Windows Server 2022 |
| İnternet | IMAP/SMTP portları açık | — |

**Açık olması gereken portlar (uygulama sunucusu):**

| Port | Yön | Açıklama |
|---|---|---|
| 3000 (veya PORT) | Gelen | MailTrustAI web arayüzü |
| 80 / 443 | Gelen | Nginx/IIS reverse proxy |
| 993 | Giden | IMAP SSL (posta sunucusuna) |
| 465 / 587 | Giden | SMTP (rapor gönderimi) |

---

## 2. Linux Kurulumu (Ubuntu / Debian)

### 2.1 Sistem Güncelleme

```bash
sudo apt update && sudo apt upgrade -y
```

### 2.2 Node.js Kurulumu (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x olmalı
npm --version
```

### 2.3 Bağımlılıklar

```bash
# better-sqlite3 için derleme araçları
sudo apt install -y build-essential python3 git curl
```

### 2.4 Uygulama Kullanıcısı Oluşturma (Güvenlik)

```bash
sudo useradd -r -m -d /opt/mailtrustai -s /bin/bash mailtrustai
sudo su - mailtrustai
```

### 2.5 Proje Dosyalarını Kopyalama

```bash
# Eğer Git ile klonluyorsanız:
git clone https://github.com/sirketiniz/mailtrustai.git /opt/mailtrustai/app

# Eğer ZIP/dosya transferi ile kuruyorsanız:
# scp veya rsync ile dosyaları /opt/mailtrustai/app klasörüne kopyalayın
mkdir -p /opt/mailtrustai/app
# ... dosyaları buraya kopyalayın ...
```

### 2.6 Bağımlılıkları Yükleme

```bash
cd /opt/mailtrustai/app
npm install --production
```

### 2.7 Data Klasörü ve İzinler

```bash
mkdir -p /opt/mailtrustai/app/data
chmod 750 /opt/mailtrustai/app/data
```

### 2.8 Ortam Değişkenleri (.env)

```bash
cp /opt/mailtrustai/app/.env.example /opt/mailtrustai/app/.env
# (örnek dosya yoksa aşağıdaki Bölüm 5'e bakın ve elle oluşturun)
nano /opt/mailtrustai/app/.env
```

> **Bölüm 5'teki tüm değişkenleri doldurun.**

### 2.9 PM2 ile Süreç Yönetimi (Önerilen)

```bash
# PM2'yi global olarak yükle
sudo npm install -g pm2

# Uygulamayı başlat
cd /opt/mailtrustai/app
pm2 start server.js --name mailtrustai --env production

# Sistem yeniden başladığında otomatik çalıştır
pm2 startup systemd -u mailtrustai --hp /opt/mailtrustai
# (Çıktıdaki sudo komutunu kopyalayıp çalıştırın)

pm2 save
```

**PM2 Yönetim Komutları:**

```bash
pm2 status                  # Durum göster
pm2 logs mailtrustai        # Canlı log
pm2 restart mailtrustai     # Yeniden başlat
pm2 stop mailtrustai        # Durdur
pm2 delete mailtrustai      # PM2'den sil
```

### 2.10 Systemd ile Servis (PM2 Alternatifi)

```bash
sudo nano /etc/systemd/system/mailtrustai.service
```

```ini
[Unit]
Description=MailTrustAI Email Security Platform
After=network.target

[Service]
Type=simple
User=mailtrustai
WorkingDirectory=/opt/mailtrustai/app
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=mailtrustai
EnvironmentFile=/opt/mailtrustai/app/.env
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable mailtrustai
sudo systemctl start mailtrustai
sudo systemctl status mailtrustai
```

**Log görüntüleme:**

```bash
sudo journalctl -u mailtrustai -f
```

### 2.11 Güvenlik Duvarı (ufw)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 3000 portunu dışarıya açmayın — nginx üzerinden erişim sağlayın
sudo ufw enable
sudo ufw status
```

---

## 3. Linux Kurulumu (RHEL / CentOS / AlmaLinux)

### 3.1 Sistem Güncelleme

```bash
sudo dnf update -y
```

### 3.2 Node.js Kurulumu

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
sudo dnf install -y gcc-c++ make python3 git
```

### 3.3 Kullanıcı ve Dizin

```bash
sudo useradd -r -m -d /opt/mailtrustai -s /bin/bash mailtrustai
sudo mkdir -p /opt/mailtrustai/app
sudo chown -R mailtrustai:mailtrustai /opt/mailtrustai
```

### 3.4 Bağımlılıklar ve PM2

```bash
sudo su - mailtrustai
cd /opt/mailtrustai/app
npm install --production

sudo npm install -g pm2
pm2 start server.js --name mailtrustai --env production
pm2 startup systemd -u mailtrustai --hp /opt/mailtrustai
pm2 save
```

### 3.5 SELinux Ayarı (Gerekirse)

```bash
# Node.js'in 3000 portunu dinlemesine izin ver
sudo semanage port -a -t http_port_t -p tcp 3000

# Nginx'in proxy bağlantısına izin ver
sudo setsebool -P httpd_can_network_connect 1
```

### 3.6 Güvenlik Duvarı (firewalld)

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 4. Windows Kurulumu

### 4.1 Node.js Kurulumu

1. [https://nodejs.org](https://nodejs.org) adresinden **Node.js 20 LTS** indirin
2. Kurucuyu çalıştırın — "Add to PATH" seçeneğini işaretleyin
3. Kurulum sırasında **"Automatically install necessary tools"** seçeneğini işaretleyin (build tools)
4. Doğrulama:

```powershell
node --version   # v20.x.x
npm --version
```

### 4.2 Proje Dosyaları

```powershell
# Hedef klasör oluştur
New-Item -ItemType Directory -Force -Path "C:\MailTrustAI"

# Dosyaları buraya kopyalayın veya:
# git clone https://github.com/sirketiniz/mailtrustai.git C:\MailTrustAI
```

### 4.3 Bağımlılıkları Yükleme

```powershell
cd C:\MailTrustAI
npm install --production
```

> **Not:** `better-sqlite3` native modülü derleme gerektirir.
> Hata alırsanız: `npm install --global windows-build-tools` (yönetici olarak)
> veya Visual Studio Build Tools kurulu olduğundan emin olun.

### 4.4 Ortam Değişkenleri (.env)

```powershell
# .env dosyası oluştur
Copy-Item .env.example .env
notepad .env
```

> **Bölüm 5'teki tüm değişkenleri doldurun.**

### 4.5 Manuel Başlatma (Test)

```powershell
cd C:\MailTrustAI
node server.js
# Tarayıcıda: http://localhost:3000
```

### 4.6 Windows Servisi Olarak Kurulum (PM2)

```powershell
# PM2 ve PM2 Windows servisi yükle (Yönetici olarak)
npm install -g pm2
npm install -g pm2-windows-startup

# Servisi yapılandır
cd C:\MailTrustAI
pm2 start server.js --name mailtrustai
pm2-startup install
pm2 save
```

### 4.7 Windows Servisi Olarak Kurulum (NSSM — Alternatif)

```powershell
# NSSM indirme: https://nssm.cc/download
# nssm.exe'yi C:\Windows\System32'ye kopyalayın

nssm install MailTrustAI "C:\Program Files\nodejs\node.exe" "C:\MailTrustAI\server.js"
nssm set MailTrustAI AppDirectory "C:\MailTrustAI"
nssm set MailTrustAI AppEnvironmentExtra NODE_ENV=production
nssm set MailTrustAI DisplayName "MailTrustAI Email Security"
nssm set MailTrustAI Description "MailTrustAI yapay zeka destekli e-posta güvenlik platformu"
nssm set MailTrustAI Start SERVICE_AUTO_START
nssm set MailTrustAI AppStdout "C:\MailTrustAI\logs\stdout.log"
nssm set MailTrustAI AppStderr "C:\MailTrustAI\logs\stderr.log"

nssm start MailTrustAI
```

**Servis yönetimi:**

```powershell
nssm start MailTrustAI
nssm stop MailTrustAI
nssm restart MailTrustAI
nssm status MailTrustAI
```

### 4.8 Windows Güvenlik Duvarı

```powershell
# Yönetici olarak çalıştırın
New-NetFirewallRule -DisplayName "MailTrustAI HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "MailTrustAI HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
# Port 3000'i dışarıya açmayın (IIS üzerinden yönlendirme kullanın)
```

---

## 5. Ortam Değişkenleri (.env)

Proje kök dizininde `.env` dosyası oluşturun:

```env
# ============================================================
# MailTrustAI — Ortam Değişkenleri
# ============================================================

# ── Sunucu ──────────────────────────────────────────────────
PORT=3000
NODE_ENV=production

# ── Güvenlik (ZORUNLU — Production'da boş bırakılamaz) ──────

# IMAP kimlik bilgisi şifreleme anahtarı (en az 32 karakter)
MSA_ENC_PASSWORD=GUCLU_RASTGELE_SIFRE_BURAYA_YAZIN_MIN32KARAKTER

# IMAP şifreleme tuzu (en az 16 karakter)
MSA_ENC_SALT=RASTGELE_TUZ_BURAYA_YAZIN

# Lisans anahtarı HMAC sırrı (en az 32 karakter)
# Tüm kurulumlarınızda AYNI değeri kullanın
MSA_LICENSE_SECRET=LISANS_HMAC_SIRRI_BURAYA_YAZIN_MIN32KARAKTER

# ── Admin ────────────────────────────────────────────────────
# Admin şifresi sıfırlama e-postası (güvenlik için zorunlu)
MSA_RECOVERY_EMAIL=admin@sirketiniz.com

# ── Online Lisans Doğrulama (İsteğe Bağlı) ──────────────────
# Kendi lisans sunucunuzun URL'i (Bölüm 10'a bakın)
# Tanımlanmazsa offline modda çalışır
MSA_LICENSE_REMOTE_URL=https://license.sirketiniz.com/api/license/check

# Lisans yenileme aralığı (ms) — varsayılan: 6 saat
MSA_LICENSE_REFRESH_MS=21600000

# Sunucu erişilemezse tolerans süresi (ms) — varsayılan: 72 saat
MSA_LICENSE_GRACE_MS=259200000
```

**Güvenli rastgele değer üretme:**

```bash
# Linux
openssl rand -hex 32

# Node.js (her platformda)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# PowerShell (Windows)
[System.Web.Security.Membership]::GeneratePassword(48, 8)
```

> ⚠️ **Kritik:** `MSA_LICENSE_SECRET` tüm kurulumlarınızda **aynı** olmalıdır.
> Farklı olursa ürettiğiniz lisans anahtarları doğrulanamaz.

---

## 6. İlk Yapılandırma

### 6.1 Kurulum Scripti Çıktısından URL'yi Okuma

Kurulum scripti (`install_server_ubuntu.sh` / `install_ubuntu.sh` / `install_customer_ubuntu.sh`) başarıyla tamamlandığında terminalin **en altında** şuna benzer bir blok çıkar:

```
╔══════════════════════════════════════════════════════════════╗
║       İLK KURULUM — TARAYICIDAN ŞİFRE BELİRLEME             ║
╚══════════════════════════════════════════════════════════════╝

  Admin paneli   : http://1.2.3.4/keygen.html?setup_token=abc123...
  Müşteri paneli : http://1.2.3.4/?setup_token=abc123...

  Setup Token: abc123...

  Her iki şifre belirlendikten sonra:
    sudo sed -i 's|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=|' /opt/mailtrustai/app/.env
    sudo systemctl reload mailtrustai
```

> **Bu URL'yi kopyalayıp tarayıcıya yapıştırın.** Token URL'de olduğu sürece ilk kurulum formu internet üzerinden erişimde de gösterilir.

---

### 6.2 Token'ı Kaçırdıysanız — Elle Okuma / Yenileme

Script çıktısı kaydırıldıysa veya oturum kapandıysa token'ı `.env` dosyasından okuyun:

```bash
sudo grep MSA_SETUP_TOKEN /opt/mailtrustai/app/.env
# → MSA_SETUP_TOKEN=abc123def456...
```

Ardından tarayıcıda şu URL'yi kullanın:

```
http://<SUNUCU_IP_VEYA_DOMAIN>/?setup_token=<TOKEN_BURAYA>
```

**Token boşsa** (daha önce temizlendiyse) yeni bir tane üretin:

```bash
NEW_TOKEN=$(openssl rand -hex 24)
sudo sed -i "s|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=${NEW_TOKEN}|" /opt/mailtrustai/app/.env
sudo systemctl restart mailtrustai   # veya: docker compose ... restart
echo "Yeni token: $NEW_TOKEN"
```

---

### 6.3 Adım Adım İlk Kurulum Akışı

#### Adım 1 — Müşteri Admin Hesabı Oluşturma

1. Tarayıcıda şu adresi açın:
   ```
   http://<IP>/?setup_token=<TOKEN>
   ```
2. "İlk Kurulum" formu açılır — **Admin E-postası** ve **Şifre** girin (en az 6 karakter)
3. **✨ Admin Hesabını Oluştur** butonuna basın
4. Başarılıysa doğrudan müşteri paneline yönlendirilirsiniz

#### Adım 2 — Admin (Keygen) Paneli Şifresi

1. Tarayıcıda şu adresi açın:
   ```
   http://<IP>/keygen.html?setup_token=<TOKEN>
   ```
2. "Admin Şifre Belirle" formu açılır — şifrenizi girin
3. Kaydedin

#### Adım 3 — Lisans Oluşturma ve Ekleme

1. Admin (keygen) panelinde → **Lisans Üret** → Uygun plan seçin
2. Oluşturulan `MSA-...` kodunu kopyalayın
3. Müşteri panelinde → sağ üst **🔑 Lisans** butonuna tıklayın → kodu yapıştırın

#### Adım 4 — Setup Token'ı Devre Dışı Bırakın ⚠️

Her iki şifre belirlendikten sonra token'ı **mutlaka** temizleyin — aksi halde herkes ilk kurulum formunu açabilir:

```bash
sudo sed -i 's|^MSA_SETUP_TOKEN=.*|MSA_SETUP_TOKEN=|' /opt/mailtrustai/app/.env
sudo systemctl reload mailtrustai
# veya Docker için:
# sudo docker compose -f /opt/mailtrustai/app/docker-compose.prod.yml restart
```

---

### 6.4 Güvenlik Notu

| Durum | Risk |
|---|---|
| `MSA_SETUP_TOKEN` dolu + port 80/443 açık | ⚠️ Herkes ilk kurulum yapabilir — kurulumdan sonra **hemen temizleyin** |
| `MSA_SETUP_TOKEN` boş | ✅ İlk kurulum yalnızca `localhost`'tan yapılabilir |
| Şifreler belirlendi + token temizlendi | ✅ Normal çalışma modu |

---

## 7. Nginx Reverse Proxy (Linux)

### 7.1 Nginx Kurulumu

```bash
# Ubuntu/Debian
sudo apt install -y nginx

# RHEL/AlmaLinux
sudo dnf install -y nginx
```

### 7.2 Site Yapılandırması

```bash
sudo nano /etc/nginx/sites-available/mailtrustai
```

```nginx
# HTTP → HTTPS yönlendirme
server {
    listen 80;
    server_name mailtrustai.sirketiniz.com;
    return 301 https://$host$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name mailtrustai.sirketiniz.com;

    # SSL sertifikaları (Bölüm 9'a bakın)
    ssl_certificate     /etc/letsencrypt/live/mailtrustai.sirketiniz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mailtrustai.sirketiniz.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    # Güvenlik başlıkları
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    # Yükleme limiti (e-posta .eml/.msg dosyaları için)
    client_max_body_size 60M;

    # WebSocket desteği
    location /ws {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 86400;
    }

    # API ve statik dosyalar
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mailtrustai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. IIS Reverse Proxy (Windows)

### 8.1 Gereksinimler

1. **IIS** → Windows Özellikler → Internet Information Services ✓
2. **URL Rewrite Module:** [https://www.iis.net/downloads/microsoft/url-rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
3. **Application Request Routing (ARR):** [https://www.iis.net/downloads/microsoft/application-request-routing](https://www.iis.net/downloads/microsoft/application-request-routing)

### 8.2 ARR Proxy Aktifleştirme

IIS Manager → Sunucu Düzeyi → **Application Request Routing Cache** → **Server Proxy Settings** → **Enable proxy** ✓

### 8.3 web.config

`C:\inetpub\wwwroot\mailtrustai\web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <!-- WebSocket -->
                <rule name="MailTrustAI WebSocket" stopProcessing="true">
                    <match url="^ws(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/ws{R:1}" />
                </rule>
                <!-- HTTP trafiği -->
                <rule name="MailTrustAI Proxy" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:3000/{R:1}" />
                </rule>
            </rules>
        </rewrite>
        <security>
            <requestFiltering>
                <!-- 60MB yükleme limiti -->
                <requestLimits maxAllowedContentLength="62914560" />
            </requestFiltering>
        </security>
    </system.webServer>
</configuration>
```

---

## 9. SSL / TLS Sertifikası

### 9.1 Linux — Let's Encrypt (Ücretsiz)

```bash
sudo apt install -y certbot python3-certbot-nginx

# Sertifika al
sudo certbot --nginx -d mailtrustai.sirketiniz.com

# Otomatik yenileme (her 90 günde bir)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### 9.2 Windows — Let's Encrypt (win-acme)

1. [https://www.win-acme.com](https://www.win-acme.com) adresinden **win-acme** indirin
2. Yönetici olarak çalıştırın:

```powershell
wacs.exe --target iis --host mailtrustai.sirketiniz.com --installation iis --store pemfiles --pemfilespath C:\ssl\mailtrustai
```

### 9.3 Kurumsal / Ücretli Sertifika

Elinizde PEM formatında sertifika varsa nginx yapılandırmasında:

```nginx
ssl_certificate     /etc/ssl/mailtrustai/fullchain.pem;
ssl_certificate_key /etc/ssl/mailtrustai/privkey.pem;
```

---

## 10. Online Lisans Sunucusu Altyapısı

### 10.1 Mimari Genel Bakış

```
Müşteri Sunucusu (MailTrustAI)
        │
        │  POST /api/license/check
        │  { key: "MSA-PRO-T2-M-..." }
        ▼
license.sirketiniz.com  ←──── Siz yönetirsiniz
  (Merkezi Lisans Sunucusu)
        │
        ├── { valid: true }   → Lisans aktif
        └── { valid: false }  → Lisans iptal / geçersiz
```

**Güvenlik katmanları (otomatik):**
- Uzak sunucuya erişilemezse **72 saatlik grace period** (önbellekten devam)
- Önbellek **HMAC imzalı** (müşteri tarafında değiştirilemez)
- Grace period dolduktan sonra lisans engellenir

### 10.2 Altyapı Gereksinimleri

| Bileşen | Seçenek |
|---|---|
| Sunucu | VPS (1 vCore / 512 MB RAM yeterli), shared hosting çalışmaz |
| İşletim Sistemi | Ubuntu 22.04 LTS önerilir |
| Runtime | Node.js 20 LTS |
| Web Sunucu | Nginx + SSL (Let's Encrypt) |
| Domain | `license.sirketiniz.com` (veya subdomain) |
| Veritabanı | MariaDB (onerilen) - license/dealer/central policy verileri |
| Uptime | Kritik değil — 72 saatlik grace period sayesinde geçici kesintiler sorunsuz |

### 10.3 Lisans Sunucusu Kurulumu

**Adım 1 — Sunucuya Node.js kur (Ubuntu):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential
sudo npm install -g pm2
```

**Adım 2 — Lisans sunucusu dosyalarını kopyala:**

```bash
mkdir -p /opt/license-server
cd /opt/license-server

# docs/license-server-example.js dosyasını bu dizine kopyalayın
cp /path/to/mailtrustai/docs/license-server-example.js server.js
npm init -y
npm install express
```

**Adım 3 — `.env` dosyası:**

```bash
cat > /opt/license-server/.env << 'EOF'
PORT=4000
NODE_ENV=production

# MailTrustAI kurulumlarındaki MSA_LICENSE_SECRET ile AYNI olmalı
MSA_LICENSE_SECRET=LISANS_HMAC_SIRRI_BURAYA_YAZIN_MIN32KARAKTER

# Admin endpoint koruma şifresi (ayrı, güçlü bir şifre)
ADMIN_SECRET=ADMIN_PANELI_ICIN_GUCLU_SIFRE
EOF
```

**Adım 4 — PM2 ile başlat:**

```bash
cd /opt/license-server
pm2 start server.js --name license-server --env production
pm2 startup
pm2 save
```

**Adım 5 — Nginx yapılandırması:**

```bash
sudo nano /etc/nginx/sites-available/license-server
```

```nginx
server {
    listen 80;
    server_name license.sirketiniz.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name license.sirketiniz.com;

    ssl_certificate     /etc/letsencrypt/live/license.sirketiniz.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/license.sirketiniz.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Yalnızca /api/license/check herkese açık
    # /api/admin/* güçlü şifre ile korumalı
    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 15s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/license-server /etc/nginx/sites-enabled/
sudo certbot --nginx -d license.sirketiniz.com
sudo nginx -t && sudo systemctl reload nginx
```

### 10.4 MailTrustAI'ı Lisans Sunucusuna Bağlama

Her müşteri kurulumunun `.env` dosyasına ekleyin:

```env
MSA_LICENSE_REMOTE_URL=https://license.sirketiniz.com/api/license/check
MSA_LICENSE_SECRET=LISANS_HMAC_SIRRI_BURAYA_YAZIN_MIN32KARAKTER
```

Uygulamayı yeniden başlatın:

```bash
pm2 restart mailtrustai
```

### 10.5 Lisans Yönetimi (Admin API)

**Lisans iptal etme:**

```bash
curl -X POST https://license.sirketiniz.com/api/admin/revoke \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: ADMIN_SIFRENIZ" \
  -d '{"key": "MSA-PRO-T2-M-DIRECT-20260505-XXXXXXXX", "reason": "Ödeme alınmadı"}'
```

**İptal kaldırma:**

```bash
curl -X DELETE https://license.sirketiniz.com/api/admin/revoke/MSA-PRO-T2-M-DIRECT-20260505-XXXXXXXX \
  -H "x-admin-secret: ADMIN_SIFRENIZ"
```

**İptal listesini görüntüleme:**

```bash
curl https://license.sirketiniz.com/api/admin/revoked \
  -H "x-admin-secret: ADMIN_SIFRENIZ"
```

### 10.6 Lisans Sunucusu Geliştirme (İsteğe Bağlı)

Merkezi lisans sunucusu için varsayilan ve onerilen veritabani MariaDB'dir:

```bash
npm install mysql2
```

Lisans ve central-sync endpoint'lerini `apps/license-server/db.js` uzerinden MariaDB'ye baglayin.
Ayrıca şu özellikler eklenebilir:

- **Aktivasyon sayısı sınırı** — bir lisans kaç cihazda kullanılabilir
- **IP kısıtlaması** — lisansı belirli IP aralığına bağlama
- **Kullanım istatistikleri** — hangi lisanslar aktif, ne zaman kontrol etti
- **E-posta bildirimi** — sona erme öncesi müşteriye hatırlatma

---

## 11. Güncelleme Prosedürü

```bash
# 1. Yedek al
cp -r /opt/mailtrustai/app/data /opt/mailtrustai/data-backup-$(date +%Y%m%d)

# 2. Uygulamayı durdur
pm2 stop mailtrustai

# 3. Yeni dosyaları kopyala (data/ klasörüne dokunma)
rsync -av --exclude='data/' --exclude='.env' --exclude='node_modules/' \
  /path/to/new-version/ /opt/mailtrustai/app/

# 4. Bağımlılıkları güncelle
cd /opt/mailtrustai/app
npm install --production

# 5. Başlat
pm2 start mailtrustai
pm2 logs mailtrustai --lines 50
```

---

## 12. Sorun Giderme

### "MSA_ENC_PASSWORD / MSA_ENC_SALT zorunludur" hatası

`.env` dosyasında bu değişkenlerin tanımlı ve boş olmadığını kontrol edin.

### "MSA_LICENSE_SECRET tanımlı değil" hatası

`NODE_ENV=production` ile `.env`'de `MSA_LICENSE_SECRET` tanımlı olmalı.

### Port 3000 zaten kullanımda

```bash
# Linux
lsof -i :3000
kill -9 <PID>

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### better-sqlite3 derleme hatası (Windows)

```powershell
# Yönetici olarak:
npm install --global --production windows-build-tools
# Sonra:
npm install
```

### IMAP bağlantısı kurulamıyor

- Posta sunucusunun 993 portuna erişilebildiğini kontrol edin: `telnet mail.sirket.com 993`
- SSL sertifikası hatası için: arayüzde "SSL/TLS gerektirir" seçeneğini kapatıp test edin
- Güvenlik duvarı kurallarını kontrol edin

### Lisans geçersiz sayılıyor (Remote URL yapılandırıldıysa)

- Lisans sunucusunun erişilebilir olduğunu doğrulayın: `curl https://license.sirketiniz.com/api/license/check -X POST -H "Content-Type: application/json" -d '{"key":"test"}'`
- `MSA_LICENSE_SECRET` her iki sunucuda da aynı mı?
- Grace period süresi: `data/license-remote-cache.json` dosyasını inceleyin

---

## Veri Dizini Yapısı

```
data/
├── credentials.enc          # Şifreli IMAP kimlik bilgileri
├── settings.json            # Uygulama ayarları (API key, raporlama)
├── scan-history.json        # Tarama geçmişi
├── domain-lists.json        # Güvenilir / engellenen listesi
├── revoked-licenses.json    # İptal edilen lisanslar (offline)
├── license-remote-cache.json # Uzak lisans önbelleği (HMAC imzalı)
├── daily-scans.json         # Günlük tarama sayaçları
├── scan-mailbox-state.json  # Merkezi raporlama kutusu durumu
├── auto-monitor-state.json  # IMAP otomatik izleme durumu
└── msa.db                   # Customer local cache/storage (bayi/lisans merkezi DB degil)
```

> ⚠️ **Yedekleme:** `data/` klasörünü düzenli olarak yedekleyin.
> `credentials.enc` ve `settings.json` kritik dosyalardır.

---

## 13. Docker ile Kurulum

Docker, MailTrustAI'ı tüm bağımlılıklarıyla birlikte izole bir kapsayıcı içinde çalıştırmanızı sağlar. Linux, Windows ve macOS'ta aynı şekilde çalışır.

### 13.1 Gereksinimler

| Bileşen | Minimum Versiyon |
|---|---|
| Docker Engine | 24.x |
| Docker Compose (plugin) | v2.20+ |
| RAM | 512 MB serbest bellek |
| Disk | 2 GB (imaj + veri) |

```bash
# Docker kurulumu (Ubuntu)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # yeniden giriş gerekir
docker --version
docker compose version
```

---

### 13.2 Geliştirme Ortamı (Hızlı Başlangıç)

```bash
# 1. Repoyu klonla
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai

# 2. Ortam dosyasını oluştur
cp .env.example .env
nano .env    # zorunlu değişkenleri doldur (bkz. Bölüm 5)

# 3. Veri dizinini hazırla
mkdir -p data logs

# 4. İmajı oluştur ve başlat
docker compose up --build -d

# 5. Logları izle
docker compose logs -f

# 6. Sağlık kontrolü
curl http://localhost:3000/api/health
```

Uygulama `http://localhost:3000` adresinde erişilebilir olacaktır.

---

### 13.3 Üretim Ortamı (Nginx + SSL)

#### 13.3.1 SSL Sertifikası Hazırlama

**Seçenek A — Let's Encrypt (Önerilen):**
```bash
# certbot ile sertifika al (henüz nginx çalışmıyorsa standalone mod)
sudo apt install certbot
sudo certbot certonly --standalone -d mailtrustai.sirketiniz.com

# Nginx sertifika dizinine kopyala
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/privkey.pem  nginx/certs/
sudo chown $USER:$USER nginx/certs/*
```

**Seçenek B — Kurumsal / Satın Alınan Sertifika:**
```bash
mkdir -p nginx/certs
cp /path/to/fullchain.pem nginx/certs/fullchain.pem
cp /path/to/privkey.pem  nginx/certs/privkey.pem
```

#### 13.3.2 Nginx Yapılandırması

`nginx/nginx.conf` dosyasında `server_name` satırını kendi alan adınızla güncelleyin:

```nginx
server_name mailtrustai.sirketiniz.com;
```

#### 13.3.3 Üretim Stack'ini Başlatma

```bash
# Üretim ortamını başlat (nginx + uygulama)
docker compose -f docker-compose.prod.yml up -d --build

# Durumu kontrol et
docker compose -f docker-compose.prod.yml ps

# Sağlık kontrolü (nginx üzerinden)
curl https://mailtrustai.sirketiniz.com/api/health
```

---

### 13.4 SSL Sertifikası Otomatik Yenileme

```bash
# Crontab'a ekle (her gün gece 3'te kontrol)
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/fullchain.pem \
     /path/to/mailtrustai/nginx/certs/fullchain.pem && \
  cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/privkey.pem \
     /path/to/mailtrustai/nginx/certs/privkey.pem && \
  docker compose -f /path/to/mailtrustai/docker-compose.prod.yml exec nginx \
     nginx -s reload") | crontab -
```

---

### 13.5 Veri Yönetimi

#### Volume Yapısı

| Volume | İçerik |
|---|---|
| `mailtrustai_data` | Tüm `data/` içeriği (DB, ayarlar, kimlik bilgileri) |
| `mailtrustai_logs` | Uygulama log dosyaları |

**Geliştirme ortamında** bu dizinler doğrudan host üzerindeki `./data/` ve `./logs/` klasörlerine bağlanır.

**Üretim ortamında** Docker named volume kullanılır.

#### Veri Yedeği (Üretim)

```bash
# data volume'unu yedekle
docker run --rm \
  -v mailtrustai_data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/mailtrustai-data-$(date +%Y%m%d).tar.gz -C /data .

# Geri yükle
docker run --rm \
  -v mailtrustai_data:/data \
  -v $(pwd)/backups:/backups \
  alpine tar xzf /backups/mailtrustai-data-20260508.tar.gz -C /data
```

---

### 13.6 Güncelleme (Docker)

```bash
cd /path/to/mailtrustai

# Yeni kodu çek
git pull

# İmajı yeniden derle ve servisi yeniden başlat (sıfır kesinti)
docker compose -f docker-compose.prod.yml up -d --build --no-deps mailtrustai

# Eski imajları temizle
docker image prune -f
```

---

### 13.7 Yararlı Komutlar

```bash
# Konteyner logları (canlı)
docker compose logs -f mailtrustai

# Konteynere bağlan (shell)
docker compose exec mailtrustai sh

# Konteyner istatistikleri
docker stats mailtrustai-app

# Servisi durdur
docker compose down

# Servisi durdur ve volumeleri sil (DİKKAT: veri silinir)
docker compose down -v

# İmajı manuel oluştur
docker build -t mailtrustai:latest .

# Imaj boyutunu kontrol et
docker images mailtrustai
```

---

### 13.8 Docker Sorun Giderme

**`better-sqlite3` derleme hatası:**
```
Error: Could not locate the bindings file
```
Çözüm: `Dockerfile`'da `python3 make g++` paketlerinin kurulduğundan emin olun. İmajı `--no-cache` ile yeniden derleyin:
```bash
docker compose build --no-cache
```

**Port zaten kullanımda:**
```
Error: bind: address already in use
```
Çözüm:
```bash
# Hangi işlem 3000 portunu kullanıyor?
sudo lsof -i :3000
# docker-compose.yml'de port değiştir: "3001:3000"
```

**Konteyner sürekli yeniden başlıyor:**
```bash
# Son logları incele
docker compose logs --tail=50 mailtrustai
# Sağlık kontrolü başarısız mı?
docker inspect mailtrustai-app | grep -A5 Health
```

**Volume izin hatası:**
```
EACCES: permission denied, open '/app/data/settings.json'
```
Çözüm: Geliştirme ortamında host dizin sahipliğini kontrol edin:
```bash
sudo chown -R 1001:1001 ./data ./logs
```

---

*MailTrustAI © 2026 — Tüm hakları saklıdır*
