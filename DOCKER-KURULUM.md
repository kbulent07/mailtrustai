# MailTrustAI — Docker Kurulum Kılavuzu

> **Versiyon:** 1.0 · **Güncelleme:** 2026-05  
> Bu kılavuz MailTrustAI'ı Docker ile hem **Linux** hem **Windows** ortamında
> nasıl kuracağınızı ve çalıştıracağınızı adım adım anlatır.

---

## İçindekiler

1. [Docker Dosya Yapısı](#1-docker-dosya-yapısı)
2. [Linux Kurulumu](#2-linux-kurulumu)
   - 2.1 [Docker Engine Kurulumu (Ubuntu/Debian)](#21-docker-engine-kurulumu-ubuntudebian)
   - 2.2 [Docker Engine Kurulumu (RHEL/AlmaLinux)](#22-docker-engine-kurulumu-rhelalmalinux)
   - 2.3 [Geliştirme Ortamı Başlatma](#23-geliştirme-ortamı-başlatma)
   - 2.4 [Üretim Ortamı Başlatma (Nginx + SSL)](#24-üretim-ortamı-başlatma-nginx--ssl)
   - 2.5 [Systemd ile Otomatik Başlatma](#25-systemd-ile-otomatik-başlatma)
3. [Windows Kurulumu](#3-windows-kurulumu)
   - 3.1 [Docker Desktop Kurulumu](#31-docker-desktop-kurulumu)
   - 3.2 [Geliştirme Ortamı Başlatma](#32-geliştirme-ortamı-başlatma)
   - 3.3 [Üretim Ortamı Başlatma (Nginx + SSL)](#33-üretim-ortamı-başlatma-nginx--ssl)
   - 3.4 [Windows Servis Olarak Çalıştırma](#34-windows-servis-olarak-çalıştırma)
4. [Ortam Değişkenleri (.env)](#4-ortam-değişkenleri-env)
5. [SSL Sertifikası Yapılandırması](#5-ssl-sertifikası-yapılandırması)
6. [Veri Yönetimi ve Yedekleme](#6-veri-yönetimi-ve-yedekleme)
7. [Güncelleme](#7-güncelleme)
8. [Yararlı Komutlar](#8-yararlı-komutlar)
9. [Sorun Giderme](#9-sorun-giderme)

---

## 1. Docker Dosya Yapısı

```
mailtrustai/
├── Dockerfile                  # Ana imaj tanımı (Node.js 20 Alpine)
├── .dockerignore               # İmajdan hariç tutulan dosyalar
├── docker-compose.yml          # Geliştirme ortamı
├── docker-compose.prod.yml     # Üretim ortamı (Nginx + SSL)
├── nginx/
│   ├── nginx.conf              # Nginx ters proxy yapılandırması
│   └── certs/                  # SSL sertifikaları buraya yerleştirilir
│       ├── fullchain.pem       # (git'te yok — kendiniz ekleyin)
│       └── privkey.pem         # (git'te yok — kendiniz ekleyin)
├── data/                       # Uygulama verileri (volume ile bağlı)
└── logs/                       # Log dosyaları (volume ile bağlı)
```

### İmaj Mimarisi

```
┌─────────────────────────────────────────────┐
│  Aşama 1: builder (node:20-alpine)          │
│  python3 + make + g++ → better-sqlite3      │
│  npm ci --omit=dev                          │
└──────────────────┬──────────────────────────┘
                   │ COPY node_modules
┌──────────────────▼──────────────────────────┐
│  Aşama 2: runner (node:20-alpine)           │
│  tini (PID 1) + non-root kullanıcı          │
│  VOLUME /app/data  VOLUME /app/logs         │
│  EXPOSE 3000                                │
│  HEALTHCHECK GET /api/health                │
└─────────────────────────────────────────────┘
```

---

## 2. Linux Kurulumu

### 2.1 Docker Engine Kurulumu (Ubuntu/Debian)

```bash
# Eski Docker sürümlerini kaldır
sudo apt remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Gerekli paketleri yükle
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

# Docker GPG anahtarını ekle
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker deposunu ekle
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker Engine + Compose Plugin'i yükle
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin

# Docker'ı başlat ve otomatik başlatmayı etkinleştir
sudo systemctl enable --now docker

# Mevcut kullanıcıyı docker grubuna ekle (sudo gerektirmemesi için)
sudo usermod -aG docker $USER
newgrp docker   # veya yeniden giriş yap

# Kurulum doğrulama
docker --version
docker compose version
docker run --rm hello-world
```

---

### 2.2 Docker Engine Kurulumu (RHEL/AlmaLinux)

```bash
# Eski sürümleri kaldır
sudo dnf remove -y docker docker-client docker-client-latest \
                   docker-common docker-latest docker-engine 2>/dev/null || true

# Docker deposunu ekle
sudo dnf config-manager --add-repo \
  https://download.docker.com/linux/centos/docker-ce.repo

# Docker Engine + Compose Plugin'i yükle
sudo dnf install -y docker-ce docker-ce-cli containerd.io \
                    docker-buildx-plugin docker-compose-plugin

# Servisi başlat
sudo systemctl enable --now docker

# Kullanıcıyı docker grubuna ekle
sudo usermod -aG docker $USER
newgrp docker

# Doğrulama
docker --version
docker compose version
```

---

### 2.3 Geliştirme Ortamı Başlatma

```bash
# 1. Repoyu klonla (veya mevcut klasörüne geç)
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai

# 2. Ortam dosyasını oluştur
cp .env.example .env
nano .env          # zorunlu değişkenleri doldur (bkz. Bölüm 4)

# 3. Veri ve log dizinlerini oluştur
mkdir -p data logs

# 4. İmajı derle ve başlat (arka planda)
docker compose up --build -d

# 5. Başlatma loglarını izle
docker compose logs -f

# 6. Sağlık kontrolü
curl http://localhost:3000/api/health
# Beklenen çıktı: {"status":"ok","uptime":...,"version":"1.0.0",...}
```

Uygulama `http://localhost:3000` adresinde çalışır.

**Geliştirme ortamı durdurmak için:**
```bash
docker compose down
```

---

### 2.4 Üretim Ortamı Başlatma (Nginx + SSL)

#### Adım 1 — SSL Sertifikası Edinme

```bash
# certbot yükle
sudo apt install -y certbot   # Ubuntu/Debian
# sudo dnf install -y certbot # RHEL/AlmaLinux

# Standalone mod ile sertifika al (80 portu boş olmalı)
sudo certbot certonly --standalone -d mailtrustai.sirketiniz.com

# Sertifika dosyalarını nginx/certs/ dizinine kopyala
mkdir -p nginx/certs
sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/mailtrustai.sirketiniz.com/privkey.pem  nginx/certs/
sudo chown $USER:$USER nginx/certs/*.pem
chmod 600 nginx/certs/privkey.pem
```

#### Adım 2 — Nginx Yapılandırması

`nginx/nginx.conf` dosyasındaki `server_name` satırını düzenle:
```nginx
server_name mailtrustai.sirketiniz.com;
```

#### Adım 3 — Üretim Stack'ini Başlat

```bash
# Üretim ortamını başlat
docker compose -f docker-compose.prod.yml up -d --build

# Çalışan servisleri doğrula
docker compose -f docker-compose.prod.yml ps

# Beklenen çıktı:
# NAME                 STATUS          PORTS
# mailtrustai-app      Up (healthy)    3000/tcp
# mailtrustai-nginx    Up (healthy)    0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp

# HTTPS sağlık kontrolü
curl https://mailtrustai.sirketiniz.com/api/health
```

#### Adım 4 — Let's Encrypt Otomatik Yenileme

```bash
# Yenileme + nginx reload scripti oluştur
sudo tee /usr/local/bin/mailtrustai-certrenew.sh << 'EOF'
#!/bin/bash
DOMAIN="mailtrustai.sirketiniz.com"
APP_DIR="/opt/mailtrustai"
certbot renew --quiet
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/nginx/certs/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem  $APP_DIR/nginx/certs/
chmod 600 $APP_DIR/nginx/certs/privkey.pem
docker compose -f $APP_DIR/docker-compose.prod.yml exec nginx nginx -s reload
EOF
sudo chmod +x /usr/local/bin/mailtrustai-certrenew.sh

# Crontab'a ekle (her gün gece 03:00)
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/mailtrustai-certrenew.sh >> /var/log/certrenew.log 2>&1") | crontab -
```

---

### 2.5 Systemd ile Otomatik Başlatma

Sunucu yeniden başladığında Docker Compose stack'inin otomatik olarak başlaması için:

```bash
# Uygulama dizinini /opt'a taşı (önerilen)
sudo mv ~/mailtrustai /opt/mailtrustai
cd /opt/mailtrustai

# Systemd servis dosyası oluştur
sudo tee /etc/systemd/system/mailtrustai.service << 'EOF'
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

# Servisi etkinleştir
sudo systemctl daemon-reload
sudo systemctl enable mailtrustai.service
sudo systemctl start  mailtrustai.service

# Durum kontrolü
sudo systemctl status mailtrustai.service
```

---

## 3. Windows Kurulumu

### 3.1 Docker Desktop Kurulumu

#### Sistem Gereksinimleri

| Bileşen | Gereksinim |
|---|---|
| İşletim Sistemi | Windows 10 Pro/Enterprise (21H2+) veya Windows 11 |
| Mimari | 64-bit (x86-64) |
| RAM | En az 4 GB (8 GB önerilen) |
| Sanallaştırma | BIOS'ta VT-x / AMD-V etkin |
| WSL 2 | Windows Subsystem for Linux 2 (önerilen backend) |

#### WSL 2 Kurulumu

PowerShell'i **Yönetici** olarak açın:

```powershell
# WSL 2'yi etkinleştir
wsl --install

# Bilgisayarı yeniden başlat, ardından WSL sürümünü doğrula
wsl --version

# Ubuntu dağıtımını kur (isteğe bağlı, Docker için gerekli değil)
wsl --install -d Ubuntu
```

#### Docker Desktop İndirme ve Kurma

1. [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop) adresine gidin
2. **Docker Desktop for Windows** sürümünü indirin
3. İndirilen `Docker Desktop Installer.exe` dosyasını yönetici olarak çalıştırın
4. Kurulum sırasında **"Use WSL 2 instead of Hyper-V"** seçeneğini işaretli bırakın
5. Kurulum tamamlandıktan sonra bilgisayarı yeniden başlatın

#### Docker Desktop Doğrulama

PowerShell veya Command Prompt:
```powershell
docker --version
docker compose version
docker run --rm hello-world
```

---

### 3.2 Geliştirme Ortamı Başlatma

PowerShell veya Windows Terminal'i açın:

```powershell
# 1. Repoyu klonla
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai

# 2. Ortam dosyasını oluştur
Copy-Item .env.example .env
notepad .env    # zorunlu değişkenleri doldur (bkz. Bölüm 4)

# 3. Veri ve log dizinlerini oluştur
New-Item -ItemType Directory -Force -Path data, logs

# 4. İmajı derle ve başlat
docker compose up --build -d

# 5. Logları izle
docker compose logs -f

# 6. Sağlık kontrolü
Invoke-RestMethod http://localhost:3000/api/health
```

Tarayıcıdan `http://localhost:3000` adresine gidin.

**Durdurmak için:**
```powershell
docker compose down
```

---

### 3.3 Üretim Ortamı Başlatma (Nginx + SSL)

Windows'ta üretim ortamı için iki seçenek vardır:

#### Seçenek A — WSL 2 içinde (Önerilen)

WSL 2 terminali açın ve Linux bölümündeki [2.4](#24-üretim-ortamı-başlatma-nginx--ssl) adımlarını uygulayın. WSL 2 içindeki Docker, Docker Desktop'ın aynı motorunu kullanır.

#### Seçenek B — Windows PowerShell ile

```powershell
# 1. SSL sertifikasını hazırla
# win-acme ile Let's Encrypt sertifikası al:
# https://www.win-acme.com/ adresinden wacs.exe'yi indirin

# Sertifika klasörünü oluştur
New-Item -ItemType Directory -Force -Path nginx\certs

# win-acme ile sertifika al
.\wacs.exe --target manual --host mailtrustai.sirketiniz.com `
           --installation none `
           --store pemfiles `
           --pemfilespath .\nginx\certs\

# win-acme PEM dosyalarını oluşturur:
# nginx\certs\mailtrustai.sirketiniz.com-chain.pem → fullchain.pem olarak yeniden adlandır
# nginx\certs\mailtrustai.sirketiniz.com-key.pem   → privkey.pem olarak yeniden adlandır
Rename-Item nginx\certs\mailtrustai.sirketiniz.com-chain.pem fullchain.pem
Rename-Item nginx\certs\mailtrustai.sirketiniz.com-key.pem   privkey.pem

# 2. nginx.conf içindeki server_name'i güncelle
(Get-Content nginx\nginx.conf) -replace 'server_name _;', `
  'server_name mailtrustai.sirketiniz.com;' | Set-Content nginx\nginx.conf

# 3. Üretim stack'ini başlat
docker compose -f docker-compose.prod.yml up -d --build

# 4. Durum kontrolü
docker compose -f docker-compose.prod.yml ps

# 5. HTTPS testi
Invoke-RestMethod https://mailtrustai.sirketiniz.com/api/health
```

#### Windows Güvenlik Duvarı Ayarları

```powershell
# 80 ve 443 portlarını aç (Yönetici PowerShell)
New-NetFirewallRule -DisplayName "MailTrustAI HTTP" `
  -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "MailTrustAI HTTPS" `
  -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

---

### 3.4 Windows Servis Olarak Çalıştırma

Sunucu yeniden başladığında Docker Compose'un otomatik çalışması için **Windows Görev Zamanlayıcısı** kullanabilirsiniz.

#### Yöntem A — Task Scheduler (GUI)

1. `taskschd.msc` açın
2. **Temel Görev Oluştur** → Ad: `MailTrustAI Docker`
3. Tetikleyici: **Bilgisayar Başlangıcında**
4. Eylem: **Program Başlat**
   - Program: `"C:\Program Files\Docker\Docker\Docker Desktop.exe"`  
     *(Docker Desktop açık değilse önce başlatmak için)*
5. İkinci bir görev oluşturun:
   - Program: `powershell.exe`
   - Bağımsız değişkenler: `-NonInteractive -Command "docker compose -f C:\mailtrustai\docker-compose.prod.yml up -d"`
   - Tetikleyici: Bilgisayar başlangıcında + **60 saniye gecikme** (Docker Desktop'ın hazır olması için)

#### Yöntem B — PowerShell Script + Task Scheduler

```powershell
# Başlatma scripti oluştur
$scriptPath = "C:\mailtrustai\start-mailtrustai.ps1"
Set-Content $scriptPath @'
# Docker Desktop hazır olana kadar bekle
$maxWait = 120
$waited = 0
while (-not (docker info 2>$null)) {
    Start-Sleep -Seconds 5
    $waited += 5
    if ($waited -ge $maxWait) { exit 1 }
}
# Stack'i başlat
Set-Location "C:\mailtrustai"
docker compose -f docker-compose.prod.yml up -d --remove-orphans
'@

# Görevi kaydet
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File $scriptPath"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask -TaskName "MailTrustAI" `
  -Action $action -Trigger $trigger -Principal $principal `
  -Description "MailTrustAI Docker Stack otomatik başlatma" -Force

# Görevi hemen çalıştır (test için)
Start-ScheduledTask -TaskName "MailTrustAI"
```

---

## 4. Ortam Değişkenleri (.env)

`.env.example` dosyasını `.env` olarak kopyalayın ve aşağıdaki değişkenleri doldurun:

```dotenv
# ── Temel ─────────────────────────────────────────────────
PORT=3000
NODE_ENV=production          # development | production

# ── Şifreleme (zorunlu — rastgele güçlü değer girin) ──────
MSA_ENC_PASSWORD=guclu-sifre-buraya-yazin
MSA_ENC_SALT=rastgele-tuz-degeri

# ── Lisans ────────────────────────────────────────────────
MSA_LICENSE_SECRET=lisans-imza-anahtari
# Online lisans kontrolü için (isteğe bağlı):
MSA_LICENSE_REMOTE_URL=https://license.sirketiniz.com/api/license/check

# ── Kurtarma E-postası ───────────────────────────────────
MSA_RECOVERY_EMAIL=admin@sirketiniz.com

# ── VirusTotal API (isteğe bağlı) ────────────────────────
VIRUSTOTAL_API_KEY=

# ── OpenAI API (isteğe bağlı) ────────────────────────────
OPENAI_API_KEY=
```

> ⚠️ **Güvenlik:** `.env` dosyası `.gitignore`'a dahildir ve asla Git'e eklenmez.
> `MSA_ENC_PASSWORD` ve `MSA_ENC_SALT` üretim ortamında en az 32 karakter olmalıdır.

---

## 5. SSL Sertifikası Yapılandırması

SSL sertifika dosyaları `nginx/certs/` dizinine yerleştirilmelidir:

```
nginx/certs/
├── fullchain.pem    # Sertifika zinciri (sertifika + ara CA)
└── privkey.pem      # Özel anahtar
```

### Let's Encrypt (Linux)

```bash
# İlk kez
sudo certbot certonly --standalone -d alan-adiniz.com
sudo cp /etc/letsencrypt/live/alan-adiniz.com/fullchain.pem nginx/certs/
sudo cp /etc/letsencrypt/live/alan-adiniz.com/privkey.pem  nginx/certs/
sudo chown $USER:$USER nginx/certs/*.pem
```

### Kurumsal / Satın Alınan Sertifika

Sağlayıcınızdan aldığınız dosyaları doğrudan kopyalayın:
```bash
cp /path/to/certificate-chain.pem nginx/certs/fullchain.pem
cp /path/to/private-key.pem       nginx/certs/privkey.pem
```

### Self-Signed (Geliştirme / Test)

```bash
# Linux/macOS veya WSL 2
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/privkey.pem \
  -out    nginx/certs/fullchain.pem \
  -subj "/C=TR/ST=Istanbul/L=Istanbul/O=MailTrustAI/CN=localhost"

# Windows (PowerShell)
$cert = New-SelfSignedCertificate -DnsName "localhost" `
  -CertStoreLocation "cert:\LocalMachine\My" `
  -NotAfter (Get-Date).AddYears(1)
# Ardından .pfx → .pem dönüşümü için openssl kullanın
```

---

## 6. Veri Yönetimi ve Yedekleme

### Veri Dizini

| Ortam | Volume Türü | Konum |
|---|---|---|
| Geliştirme | Host bind mount | `./data/` (proje klasörü) |
| Üretim (Linux) | Docker named volume | `mailtrustai_data` |
| Üretim (Windows) | Docker named volume | Docker Desktop tarafından yönetilir |

### Kritik Dosyalar

```
data/
├── credentials.enc          # Şifreli IMAP hesapları
├── settings.json            # Tüm uygulama ayarları + API anahtarları
├── msa.db                   # SQLite: bayi, lisans veritabanı
├── scan-history.json        # Tarama geçmişi
└── domain-lists.json        # Güvenilir/engellenen listeler
```

### Yedekleme Komutları

**Linux — Named Volume Yedeği:**
```bash
# Yedek al
docker run --rm \
  -v mailtrustai_data:/source \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/mailtrustai-$(date +%Y%m%d-%H%M).tar.gz -C /source .

# Geri yükle
docker compose -f docker-compose.prod.yml down
docker run --rm \
  -v mailtrustai_data:/target \
  -v $(pwd)/backups:/backup \
  alpine sh -c "rm -rf /target/* && tar xzf /backup/mailtrustai-TARIH.tar.gz -C /target"
docker compose -f docker-compose.prod.yml up -d
```

**Windows — Named Volume Yedeği (PowerShell):**
```powershell
# Yedek klasörü
New-Item -ItemType Directory -Force -Path backups
$date = Get-Date -Format "yyyyMMdd-HHmm"

# Yedek al
docker run --rm `
  -v mailtrustai_data:/source `
  -v "${PWD}/backups:/backup" `
  alpine tar czf /backup/mailtrustai-$date.tar.gz -C /source .

# Geri yükle
docker compose -f docker-compose.prod.yml down
docker run --rm `
  -v mailtrustai_data:/target `
  -v "${PWD}/backups:/backup" `
  alpine sh -c "rm -rf /target/* && tar xzf /backup/mailtrustai-TARIH.tar.gz -C /target"
docker compose -f docker-compose.prod.yml up -d
```

### Otomatik Yedekleme (Linux Crontab)

```bash
# Her gece 02:00'da yedek al, 30 günden eski yedekleri sil
(crontab -l 2>/dev/null; cat << 'EOF'
0 2 * * * cd /opt/mailtrustai && \
  docker run --rm \
    -v mailtrustai_data:/source \
    -v /opt/mailtrustai/backups:/backup \
    alpine tar czf /backup/mailtrustai-$(date +\%Y\%m\%d).tar.gz -C /source . && \
  find /opt/mailtrustai/backups -name "*.tar.gz" -mtime +30 -delete
EOF
) | crontab -
```

---

## 7. Güncelleme

### Linux

```bash
cd /opt/mailtrustai

# 1. Yeni kodu çek
git pull

# 2. Sadece uygulama konteynerini yeniden derle (nginx çalışmaya devam eder)
docker compose -f docker-compose.prod.yml up -d --build --no-deps mailtrustai

# 3. Eski imajları temizle
docker image prune -f

# 4. Güncellemeyi doğrula
curl https://mailtrustai.sirketiniz.com/api/health
```

### Windows (PowerShell)

```powershell
Set-Location C:\mailtrustai

# 1. Kodu güncelle
git pull

# 2. Yeniden derle
docker compose -f docker-compose.prod.yml up -d --build --no-deps mailtrustai

# 3. Temizle
docker image prune -f

# 4. Doğrula
Invoke-RestMethod https://mailtrustai.sirketiniz.com/api/health
```

---

## 8. Yararlı Komutlar

### Genel Komutlar (Linux ve Windows)

```bash
# ── Durum ────────────────────────────────────────────────
docker compose ps                            # Servis durumu
docker compose -f docker-compose.prod.yml ps # Üretim servis durumu
docker stats                                  # Canlı kaynak kullanımı

# ── Loglar ───────────────────────────────────────────────
docker compose logs -f                        # Canlı log izleme
docker compose logs -f mailtrustai            # Sadece uygulama logu
docker compose logs --tail=100 mailtrustai    # Son 100 satır

# ── Shell Erişimi ─────────────────────────────────────────
docker compose exec mailtrustai sh            # Konteynere bağlan

# ── Başlat / Durdur ──────────────────────────────────────
docker compose up -d                          # Başlat (arka planda)
docker compose down                           # Durdur (veri korunur)
docker compose restart mailtrustai            # Sadece uygulamayı yeniden başlat

# ── İmaj ─────────────────────────────────────────────────
docker build -t mailtrustai:latest .          # İmajı manuel derle
docker images mailtrustai                     # İmaj listesi ve boyutlar
docker image prune -f                         # Kullanılmayan imajları sil

# ── Volume ───────────────────────────────────────────────
docker volume ls                              # Volume listesi
docker volume inspect mailtrustai_data        # Volume detayları
```

### Sağlık Kontrolü

```bash
# Linux
curl -s http://localhost:3000/api/health | python3 -m json.tool

# Windows PowerShell
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json

# Beklenen yanıt:
# {
#   "status": "ok",
#   "uptime": 3600,
#   "version": "1.0.0",
#   "timestamp": "2026-05-08T12:00:00.000Z"
# }
```

---

## 9. Sorun Giderme

### `better-sqlite3` derleme hatası

**Hata:**
```
Error: Could not locate the bindings file
gyp ERR! build error
```

**Çözüm:** İmajı önbellek olmadan yeniden derleyin:
```bash
docker compose build --no-cache
docker compose up -d
```

---

### Port zaten kullanımda

**Hata:**
```
Error response from daemon: Ports are not available: bind: address already in use
```

**Linux Çözümü:**
```bash
# Portu kim kullanıyor?
sudo ss -tulpn | grep :3000
sudo ss -tulpn | grep :80

# Varsa durdurun veya docker-compose.yml'de portu değiştirin:
# ports: - "3001:3000"
```

**Windows Çözümü (PowerShell):**
```powershell
# Portu kim kullanıyor?
netstat -ano | findstr :3000
netstat -ano | findstr :80
# PID'yi bulun, ardından:
tasklist | findstr <PID>
Stop-Process -Id <PID> -Force
```

---

### Konteyner sürekli yeniden başlıyor

```bash
# Hata nedenini görmek için logları incele
docker compose logs --tail=50 mailtrustai

# Healthcheck durumunu kontrol et
docker inspect mailtrustai-app --format='{{json .State.Health}}' | python3 -m json.tool
```

Yaygın nedenler:
- `.env` dosyası eksik veya yanlış yapılandırılmış
- `data/` dizinine yazma izni yok
- `MSA_ENC_PASSWORD` değiştirilmiş (şifreli verileri bozar)

---

### Volume izin hatası (Linux)

**Hata:**
```
EACCES: permission denied, open '/app/data/settings.json'
```

**Çözüm:** Host dizin sahipliğini düzelt (UID 1001 = mailtrustai kullanıcısı):
```bash
sudo chown -R 1001:1001 ./data ./logs
docker compose restart mailtrustai
```

---

### Windows'ta WSL 2 Backend Hatası

**Hata:** `Docker Desktop requires WSL 2 to be enabled`

**Çözüm:**
```powershell
# Yönetici PowerShell
wsl --install
wsl --set-default-version 2
# Bilgisayarı yeniden başlatın
```

---

### Nginx 502 Bad Gateway

Nginx başladı ama uygulama henüz hazır değil:
```bash
# Uygulama sağlık durumunu kontrol et
docker compose -f docker-compose.prod.yml ps

# Uygulama loglarını incele
docker compose -f docker-compose.prod.yml logs mailtrustai

# Nginx loglarını incele
docker compose -f docker-compose.prod.yml logs nginx
```

Genellikle uygulama 30-60 saniye içinde hazır olur. `healthcheck` yapılandırması sayesinde nginx yalnızca uygulama `healthy` durumuna geçince başlar.

---

### Docker Desktop Windows'ta Yavaş

WSL 2 backend kullanırken projeyi WSL 2 dosya sistemine taşımak performansı artırır:

```powershell
# WSL 2 terminalini aç
wsl

# Proje dosyalarını WSL dosya sistemine taşı
cp -r /mnt/c/mailtrustai ~/mailtrustai
cd ~/mailtrustai

# Buradan docker compose komutlarını çalıştır
docker compose up --build -d
```

---

> 💡 **İpucu:** Docker loglarına her zaman `docker compose logs -f` komutuyla göz atın.
> Sorunların %90'ı log çıktısında açıkça görünür.
