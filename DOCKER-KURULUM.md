# MailTrustAI — Docker Kurulum Kılavuzu (3-Tier)

> **Versiyon:** 2.0 · **Mimari:** 3-Tier (Sunucu + Müşteri ayrı host'lar)

MailTrustAI 3 ayrı bileşene sahiptir ve **ÜRETİMDE iki farklı host'a kurulur**:

```
┌──────────────────────────────────────┐       ┌──────────────────────────────────┐
│   KURUCU / SATICI SUNUCUSU           │       │   MÜŞTERİ HOST'U                 │
│   (Sizin sunucunuz)                  │       │   (Müşteri yerinde)              │
│                                      │       │                                  │
│   docker-compose.server.yml          │       │   docker-compose.customer.yml    │
│                                      │       │                                  │
│   ┌────────────┐  ┌────────────┐    │  HTTPS │   ┌────────────────────────┐    │
│   │  MariaDB   │◄─┤ license-   │◄───┼────────┼───┤ customer (mail tarama) │    │
│   │ (yönetim)  │  │  server    │    │ 3200   │   │ portu: 3000            │    │
│   └────────────┘  │  3200      │    │        │   │                        │    │
│                   └─────┬──────┘    │        │   │ - Heartbeat (5 dk)     │    │
│                         │           │        │   │ - Policy sync (15 dk)  │    │
│                   ┌─────▼──────┐    │        │   │ - Lisans validate      │    │
│                   │  dealer    │    │        │   └────────────────────────┘    │
│                   │  3100      │    │        │                                  │
│                   └────────────┘    │        │                                  │
└──────────────────────────────────────┘       └──────────────────────────────────┘

      ↑ İNTERNET (HTTPS, sertifika)                ↑ Müşteri kuruluşu IMAP/SMTP
        - Bayi paneli (https://dealer...)            - IMAP/SMTP'lerine erişir
        - Müşteri lisans API'leri                    - Tarama sonuçları LOKAL kalır
        - Bayi auth                                  - Sunucuya SADECE telemetri
```

| Katman | Nerede çalışır | Veri |
|--------|----------------|------|
| **license-server + dealer + mariadb** | Sizin sunucunuz (1 adet) | Lisans kayıtları, bayi/customer hesapları, audit log |
| **customer** | Her müşteri host'u (N adet) | IMAP credential, mail tarama sonuçları (LOKAL, dışarı çıkmaz) |

> ⚠️ **GÜVENLİK İLKESİ:** Müşteri imajına `license-server`, `dealer` veya `license-core` paketi **fiziksel olarak girmez**. Dockerfile build sırasında bu dizinleri siler ve `scripts/check-customer-package.js` ile doğrulanır.

---

## İçindekiler

1. [Dosya Yapısı](#1-dosya-yapısı)
2. [Sunucu Kurulumu (Kurucu/Satıcı tarafı)](#2-sunucu-kurulumu)
   - 2.1 [Ön Hazırlık](#21-ön-hazırlık)
   - 2.2 [Secret Üretimi (.env.docker)](#22-secret-üretimi)
   - 2.3 [Stack'i Başlatma](#23-stacki-başlatma)
   - 2.4 [İlk Bayi Oluşturma](#24-i̇lk-bayi-oluşturma)
   - 2.4a [Admin Paneli (Merkezi Yönetim)](#24a-admin-paneli-merkezi-yönetim)
   - 2.5 [TLS / Reverse Proxy](#25-tls--reverse-proxy)
3. [Müşteri Kurulumu (Customer host)](#3-müşteri-kurulumu)
   - 3.1 [Lisans Anahtarı Edinme](#31-lisans-anahtarı-edinme)
   - 3.2 [Müşteri Stack'i](#32-müşteri-stacki)
4. [Geliştirme Ortamı (Yerel)](#4-geliştirme-ortamı-yerel)
5. [Test Çalıştırma (Docker'da)](#5-test-çalıştırma)
6. [Operasyon: Loglar, Yedek, Güncelleme](#6-operasyon)
7. [Sorun Giderme](#7-sorun-giderme)

---

## 1. Dosya Yapısı

```
mailtrustai/
├── docker-compose.server.yml      # 🟦 KURUCU/SATICI SUNUCUSU — siz kurun
├── docker-compose.customer.yml    # 🟩 MÜŞTERİ HOST'U — müşteri kurar
├── docker-compose.test.yml        # ⚙️  Test runner (CI / dahili)
├── docker-compose.yml             # 🛠️  Dev master (server + customer aynı host)
├── Dockerfile.test                # Test image (dev deps + native rebuild)
├── .env.docker.example            # Tüm secret env'lerin template'i
├── .dockerignore                  # node_modules/data/logs exclude
│
├── apps/
│   ├── customer/Dockerfile        # Müşteri image (3000) — sunucu kodu YOK
│   ├── dealer/Dockerfile          # Bayi panel image (3100)
│   └── license-server/Dockerfile  # Lisans server image (3200)
│
├── packages/                      # Paylaşımlı paketler
├── data/                          # Runtime — volume mount edilir (host'ta)
└── logs/
```

---

## 2. Sunucu Kurulumu

> Bu adımlar **SİZİN sunucunuzda** (bir kez) yapılır. Tüm bayiler ve müşteriler bu merkezi sunucuya bağlanır.

### 2.1 Ön Hazırlık

#### Linux (Ubuntu/Debian)
```bash
# Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# Repo clone
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai
git checkout mainpaketler
```

#### Windows (Docker Desktop kurulu)
```powershell
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai
git checkout mainpaketler
```

### 2.2 Secret Üretimi

```bash
# Template'i kopyala
cp .env.docker.example .env.docker

# Secret değerlerini üret (Linux/macOS)
echo "LICENSE_SIGNING_SECRET=$(openssl rand -hex 32)" >> .env.docker
echo "DEALER_API_SECRET=$(openssl rand -hex 32)"      >> .env.docker
echo "DEALER_SESSION_SECRET=$(openssl rand -hex 32)"  >> .env.docker
echo "ADMIN_PANEL_TOKEN=$(openssl rand -hex 32)"      >> .env.docker
echo "MARIADB_PASSWORD=$(openssl rand -hex 24)"       >> .env.docker
echo "MARIADB_ROOT_PASSWORD=$(openssl rand -hex 24)"  >> .env.docker
# Sonra .env.docker'ı düzenle, alternatif olarak sadece üretilenleri tutmak için
# eski örnek satırları sil.
```

PowerShell (Windows):
```powershell
function rand32 { [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower() }
@"
LICENSE_SIGNING_SECRET=$(rand32)
DEALER_API_SECRET=$(rand32)
DEALER_SESSION_SECRET=$(rand32)
ADMIN_PANEL_TOKEN=$(rand32)
MARIADB_PASSWORD=$(rand32)
MARIADB_ROOT_PASSWORD=$(rand32)
"@ | Out-File -Encoding utf8 .env.docker.secrets
# .env.docker.example içeriğini .env.docker'a kopyala, sonra üstteki satırları ekle.
```

> 🔒 **VAULT KURALI:** `LICENSE_SIGNING_SECRET` bir kez üretilir, **asla değiştirilmez** (mevcut lisansların imzaları bozulur). Bu değeri parola yöneticisinde / vault'ta saklayın.
>
> 🔒 **`ADMIN_PANEL_TOKEN`** — Merkezi yönetim paneline (`/admin`) giriş için kullanılan bearer token. Sadece size ait olmalı; bayilere verilmez. Üretimde **IP kısıtlaması** ile birlikte kullanın (bkz. §2.5).

### 2.3 Stack'i Başlatma

```bash
# Build + ayağa kaldır
npm run up:server
#    ↑ Bu, şu komutun kısaltması:
# docker compose --env-file .env.docker -f docker-compose.server.yml up -d --build

# Sağlık kontrolü
docker compose -f docker-compose.server.yml ps
# Beklenen:
# mailtrustai-mariadb         Up (healthy)
# mailtrustai-license-server  Up (healthy)
# mailtrustai-dealer          Up (healthy)

# Test endpoint
curl http://localhost:3200/healthz
# {"ok":true,"service":"license-server",...}
curl http://localhost:3100/healthz
```

### 2.4 İlk Bayi Oluşturma

**İlk bayi** CLI ile oluşturulur (admin paneli henüz erişilebilir değilken):

```bash
# Bayi kaydı oluştur (container içinde)
docker exec mailtrustai-license-server \
  node apps/license-server/bin/bootstrap.js create-dealer \
  --id bayi-01 --name "Bayi A" --email bayi@cwenerji.com

# Parolasını belirle (en az 8 karakter)
docker exec mailtrustai-license-server \
  node apps/license-server/bin/bootstrap.js set-dealer-password \
  --id bayi-01 --password "G%c1%uP@rolaXyz!2026"

# Listele
docker exec mailtrustai-license-server \
  node apps/license-server/bin/bootstrap.js list-dealers
```

Bayi panel'e giriş: `http://<sunucu>:3100` — kullanıcı `bayi-01`, parola yukarıdaki.

**Sonraki bayiler** Admin Panelden de oluşturulabilir (bkz. §2.4a).

### 2.4a Admin Paneli (Merkezi Yönetim)

Admin paneli, license-server'ın `/admin` path'inde barındırılır:

```
http(s)://license.mailtrustai.com/admin
```

Giriş: `.env.docker`'da tanımladığınız `ADMIN_PANEL_TOKEN` değeri.

Panel sekmeleri:

| Sekme | İçerik |
|-------|--------|
| 📊 Özet | Toplam bayi, lisans, müşteri, aktif lisans sayıları |
| 🏪 Bayiler | Bayi listesi, yeni bayi ekle, parola değiştir, sil |
| 🔑 Lisans Üret | Seçili bayi için müşteri + lisans oluştur, key kopyala |
| ⚙️ Yönet | Tüm lisanslar — filtrele, iptal et, yenile, etiketle, grace override |
| 📜 Audit Log | Tüm sistem olayları (actor/action/target) |

> ⚠️ **ÜRETİMDE:** Admin paneline mutlaka IP kısıtlaması uygulayın. Proxy konfigürasyonunuzda `allow <ofis/VPN IP>` satırını ekleyin (bkz. §2.5).

### 2.5 TLS / Reverse Proxy

Üretimde **mutlaka HTTPS arkasında** olmalı. Aşağıdaki domain şemasını öneriyoruz:

| Subdomain | Yönlenir | Kim kullanır |
|-----------|----------|--------------|
| `license.mailtrustai.com` | localhost:3200 | Müşteri customer container'ları (lisans/heartbeat) |
| `bayi.mailtrustai.com`    | localhost:3100 | Bayi/satıcı (panel arayüzü) |
| `mailtrustai.com`         | landing/optional | Genel sayfa |

**DNS:** Her subdomain için **A kaydı** → sunucunuzun public IP'sine.

#### Caddy (otomatik SSL — önerilen)

```bash
sudo apt install -y caddy
sudo cp /opt/mailtrustai/deploy/Caddyfile.example /etc/caddy/Caddyfile
# Caddyfile içinde domain'leri istediğiniz gibi düzenleyin (default: mailtrustai.com)
sudo systemctl reload caddy
```

Caddy otomatik Let's Encrypt sertifika alır, yeniler. Detay: `deploy/Caddyfile.example`.

> 🔐 **Admin panel IP kısıtlaması (Caddyfile):** `Caddyfile.example` içindeki `@notTrusted` bloğuna ofis/VPN IP'nizi ekleyin:
> ```
> not remote_ip 127.0.0.1/8 ::1 203.0.113.10/32   # ← kendi IP'niz
> ```

#### Nginx (manuel SSL)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /opt/mailtrustai/deploy/nginx-server.conf.example /etc/nginx/sites-available/mailtrustai
sudo ln -s /etc/nginx/sites-available/mailtrustai /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d license.mailtrustai.com -d bayi.mailtrustai.com
```

> 🔐 **Admin panel IP kısıtlaması (nginx):** `nginx-server.conf.example` içindeki `/admin` location bloğuna ofis/VPN IP'nizi ekleyin:
> ```nginx
> location /admin {
>     allow 203.0.113.10;   # ← kendi ofis/VPN IP'niz
>     allow 127.0.0.1;
>     deny  all;
>     ...
> }
> ```

#### Firewall (UFW)

```bash
sudo ufw allow 22,80,443/tcp
sudo ufw deny 3100,3200/tcp   # localhost-only; reverse proxy ile erişilir
sudo ufw enable
```

> Bu URL'ler müşteri host'unun `MSA_LICENSE_REMOTE_URL` env'inde kullanılır.

---

## 3. Müşteri Kurulumu

> Bu adımlar **MÜŞTERİ'nin host'unda** (her müşteri için ayrı ayrı) yapılır.

### 3.1 Lisans Anahtarı Edinme

Bayi paneline gir (sunucudaki `bayi.mailtrustai.com`), müşteri için lisans oluştur:

Bayi paneli 5 sekmeden oluşur:

| Sekme | İşlev |
|-------|-------|
| 📊 Özet | Toplam / aktif / süresi dolmuş / online müşteri sayıları + son müşteriler |
| 👤 Müşteriler | Müşteri listesi, durum filtresi, lisans uzat / iptal et |
| 🔑 Lisans Üret | Yeni müşteri kaydı + lisans oluştur → key panoya kopyala |
| ⚙️ Lisans Yönet | Tüm lisanslar — sorgula, uzat, iptal et |
| 📜 Log | Son sistem olayları (bayi kapsamı) |

**Lisans oluşturma adımları (Lisans Üret sekmesi):**

1. `customerId` (benzersiz), `Şirket Adı`, `E-posta`, `Plan` (`demo` / `pro` / `enterprise`), `Geçerlilik (gün)` gir
2. **Oluştur** → Sistem `MTAI-PRO-XXXX-XXXX` formatında bir **license key** üretir
3. 📋 ile kopyala → müşteriye ilet (e-posta, parola yöneticisi, vs.)

### 3.2 Müşteri Stack'i

#### Linux (müşteri sunucusu)
```bash
# Repo clone (müşteri de bu repo'yu kullanır — ama image'a sadece customer kodu girer)
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai
git checkout mainpaketler

# Env hazırla
cp .env.docker.example .env.docker
# .env.docker dosyasında DOLDUR:
#   MSA_LICENSE_KEY=MTAI-PRO-XXXX-XXXX           ← bayiden gelen
#   MSA_LICENSE_REMOTE_URL=https://license.mailtrustai.com
#   MSA_CENTRAL_SYNC_URL=https://license.mailtrustai.com
#   MSA_LOCAL_ENCRYPTION_KEY=$(openssl rand -hex 32)  ← lokal şifreleme için
```

> **Müşteri tarafında ÜRETİLMEMESİ gereken env'ler:** `LICENSE_SIGNING_SECRET`, `DEALER_API_SECRET`, `DEALER_SESSION_SECRET`, `MARIADB_*`. Bu değerleri müşteri host'unda bulundurmayın — sunucuda kalır.

```bash
# Build + ayağa kaldır (SADECE customer)
npm run up:customer
#    ↑ docker compose --env-file .env.docker -f docker-compose.customer.yml up -d --build

# Doğrula
docker compose -f docker-compose.customer.yml ps
# mailtrustai-customer  Up (healthy)

curl http://localhost:3000/healthz
# {"ok":true,"service":"customer",...}

# Lisans aktivasyon durumu
curl http://localhost:3000/api/customer/license/status
```

Müşteri paneli: `http://<musteri-host>:3000`

İlk açılış adımları (panel arayüzünden):
1. Yönetici hesabı oluştur (ilk açılışta zorunlu)
2. IMAP hesabı tanımla (mail tarama hedefi)
3. Lisans aktivasyonu otomatik gerçekleşir (env'deki `MSA_LICENSE_KEY` kullanılır)

#### Windows (müşteri Docker Desktop)
```powershell
git clone https://github.com/kbulent07/mailtrustai.git
cd mailtrustai
git checkout mainpaketler
Copy-Item .env.docker.example .env.docker
notepad .env.docker  # MSA_LICENSE_KEY ve MSA_LICENSE_REMOTE_URL doldur
npm run up:customer
```

### Müşteri Image — Güvenlik Doğrulaması

Build sırasında otomatik kontrol var; manuel test:
```bash
docker run --rm mailtrustai-customer:latest sh -c \
  "ls apps/ packages/ 2>/dev/null; echo '---'; \
   test ! -d apps/dealer && echo 'OK: dealer yok' || echo 'HATA: dealer var'; \
   test ! -d apps/license-server && echo 'OK: license-server yok' || echo 'HATA: license-server var'; \
   test ! -d packages/license-core && echo 'OK: license-core yok' || echo 'HATA: license-core var'"
```

Beklenen çıktı: 3 satır da `OK:` ile başlar.

---

## 4. Geliştirme Ortamı (Yerel)

Yerel makinede TÜM 4 servisi tek host'ta ayağa kaldırmak için:

```bash
cp .env.docker.example .env.docker
# Secret'ları üret (yukarıdaki bash/PowerShell)

# Sadece sunucu tarafı:
docker compose --env-file .env.docker up -d --build

# Sunucu + customer (e2e dev):
docker compose --env-file .env.docker --profile dev up -d --build
```

> `customer` servisi `profiles: ["dev"]` arkasında — production'da yanlışlıkla `docker compose up` deyince kalkmaz, sadece `--profile dev` ile.

Erişim:
- License-server: `http://localhost:3200`
- Dealer panel:   `http://localhost:3100`
- Customer (dev): `http://localhost:3000`

---

## 5. Test Çalıştırma

**Testler ZORUNLU olarak Docker'da çalışır** — host platformuna (Windows/Linux/macOS) bağımlı değil:

```bash
# İlk kez (image build)
npm run test:docker:build

# Tüm test suite (123 test, ~3 sn)
npm run test:docker

# Belirli bir test dosyası
docker compose -f docker-compose.test.yml run --rm test \
    node --test tests/security/hardening.test.js

# Image'ı sıfırdan build + test
npm run test:docker:rebuild
```

CI/CD pipeline'da aynı komut kullanılır.

---

## 6. Operasyon

### Logları İzleme
```bash
# Sunucu
npm run logs:server
# docker compose -f docker-compose.server.yml logs -f --tail=200

# Müşteri
npm run logs:customer
```

### Yedekleme

#### Sunucu (MariaDB + license-server data)
```bash
# MariaDB dump
docker exec mailtrustai-mariadb \
  mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --all-databases \
  > backups/mariadb-$(date +%Y%m%d-%H%M).sql

# Veya volume tar
docker run --rm \
  -v mailtrustai-server_mariadb-data:/source \
  -v "$(pwd)/backups:/backup" \
  alpine tar czf /backup/mariadb-$(date +%Y%m%d).tar.gz -C /source .
```

#### Müşteri (lokal cache + ayarlar)
```bash
docker run --rm \
  -v mailtrustai-customer_customer-data:/source \
  -v "$(pwd)/backups:/backup" \
  alpine tar czf /backup/customer-$(date +%Y%m%d).tar.gz -C /source .
```

### Güncelleme

#### Sunucu tarafı
```bash
cd /opt/mailtrustai
git pull
npm run down:server
npm run up:server   # build + up (cache kullanır)
```

#### Müşteri tarafı
```bash
cd /opt/mailtrustai
git pull
npm run down:customer
npm run up:customer
```

### Stack'i Durdurma
```bash
npm run down:server          # veri korunur (volume kalır)
npm run down:customer

# Volume'larla birlikte sil (DİKKAT — veri kaybı):
docker compose -f docker-compose.server.yml --env-file .env.docker down -v
```

---

## 7. Sorun Giderme

| Belirti | Olası Sebep | Çözüm |
|---------|-------------|-------|
| `MARIADB_ROOT_PASSWORD zorunlu` | `--env-file .env.docker` unutuldu | `npm run up:server` kullan veya `--env-file` ekle |
| `invalid ELF header` | `node_modules` host'tan kopyalanmış | `.dockerignore`'a `node_modules/**` ekli mi? `--no-cache` ile rebuild |
| `license-server unhealthy` | DB'ye bağlanamıyor | `docker logs mailtrustai-license-server`, MariaDB password kontrol |
| customer "license not found" | `MSA_LICENSE_KEY` boş / hatalı | `.env.docker` dosyasına bayiden gelen key'i yapıştır, customer restart |
| customer'da `/api/dealer/*` 404 | **Beklenen davranış** | Müşteri image'inde dealer kodu yok (HARD-GATE) |
| Port çakışması (3000/3100/3200) | Başka bir uygulama | `.env.docker`'da `CUSTOMER_PORT=`, `DEALER_PORT=`, `LICENSE_SERVER_PORT=` değiştir |
| `LICENSE_SIGNING_SECRET zorunlu` | Sunucuda secret eksik | `.env.docker`'a 32-byte hex ekle, restart |
| dealer panel `gecersiz kimlik` | Yanlış parola | CLI ile yeni parola: `bootstrap.js set-dealer-password ...` |
| Customer log'unda `central /api... 401` | `MSA_LICENSE_REMOTE_URL` yanlış | URL'i ve `MSA_LICENSE_KEY`'i kontrol et |
| `bootstrap.js: dealer bulunamadı` | Dealer henüz oluşturulmamış | Önce `create-dealer` çalıştır |
| Admin panel `401 Yetkisiz` | `ADMIN_PANEL_TOKEN` boş ya da hatalı | `.env.docker`'da `ADMIN_PANEL_TOKEN=` değeri doldu mu? Restart gerekir |
| Admin panel `403 Erişim reddedildi` | IP kısıtlaması devreye girdi | Caddy/nginx proxy config'e ofis/VPN IP'nizi ekleyin (bkz. §2.5) |
| Bayi paneli "Uzat/İptal" çalışmıyor | `licenseId` null dönüyor | Müşteri lisansı yok ya da `active` değil — Admin panelinden kontrol et |
| Bayi Log sekmesi boş | `audit_log` tablosu henüz dolu değil | Herhangi bir işlem yapılınca dolmaya başlar (ilk girişten itibaren) |

### Tanı Komutları
```bash
# Container detayları
docker inspect mailtrustai-license-server --format='{{json .State.Health}}'

# Network bağlantı testi
docker exec mailtrustai-dealer wget -qO- http://license-server:3200/healthz

# DB tablolarını gör
docker exec mailtrustai-mariadb \
  mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" mailtrustai_license \
  -e "SHOW TABLES; SELECT id,name FROM dealers; SELECT COUNT(*) FROM licenses;"

# Customer'dan license-server'a görünebiliyor mu (aynı network'te değiller — internet üzerinden)
docker exec mailtrustai-customer wget -qO- "$MSA_LICENSE_REMOTE_URL/healthz"
```

---

## Çoklu Lisans (Bir Müşteri = N Lisans)

Bir müşteri (firma) birden fazla lisans satın alabilir:
- "Üretim" + "Test/Yedek" lisansları (high availability)
- Farklı şubeler / departmanlar
- Plan upgrade için geçici dual-license

### Sunucu Tarafı (Otomatik Destekler)

| Yer | Davranış |
|-----|----------|
| DB | `licenses.customer_id` UNIQUE değil — N kayıt mümkün |
| `POST /api/license/create` | Her çağrı yeni lisans (kontrol yok) — yan yana yaşar |
| Admin panel (`/admin`) | Hem **düz** (her lisans satır) hem **gruplu** (müşteri başına) görünüm |
| Lisans etiketi | `licenses.label` (örn: "Üretim", "Şube-Ankara") — admin panelden set |
| Offline grace | Her lisans için ayrı override (admin panelinden tek tek veya bulk) |

### Müşteri Tarafı: Çoklu Lisans Nasıl Çalışır

Bir müşteri **host'unda** customer container'ı tek `MSA_LICENSE_KEY` ile çalışır. Çoklu lisans için 3 senaryo:

**1. Tek host, N container (çoğu durum):**
```bash
# Lisans A (üretim) — port 3000
docker compose --env-file .env.docker.a -f docker-compose.customer.yml \
    -p mailtrustai-prod up -d

# Lisans B (test) — port 3001
docker compose --env-file .env.docker.b -f docker-compose.customer.yml \
    -p mailtrustai-test up -d
```
Her `.env.docker.X` farklı `MSA_LICENSE_KEY`, farklı `CUSTOMER_PORT`, farklı `MSA_INSTANCE_ID`. Compose project name `-p` ile ayrıştırılır.

**2. N farklı host:** Her host kendi `MSA_LICENSE_KEY`'i ile bağımsız çalışır — en temiz model.

**3. Tek container, lisans değişimi:** `.env.docker`'da `MSA_LICENSE_KEY`'i değiştir + `docker compose up -d --force-recreate`. Eski lisansın activation kaydı kalır (audit log'ta), yeni key aktivasyon olur.

### Lisans Etiketleme (Admin Panelden)

```
1. /admin → giriş
2. "Müşteri grup" toggle (sağ üstteki)
3. Şirket satırı → ▶ tıkla → lisans listesi açılır
4. Her lisans satırında "Etiket" butonu → "Üretim" / "Test" / "Şube-..." gir
```

Etiket aramada filtrelenir, raporlamada görünür.

---

## Mimari Notları

### Müşteri Host'unda NE BULUNUR / NE BULUNMAZ

✅ **Var olan:**
- `apps/customer/` (mail tarama + arayüz)
- `packages/{analyzer,mail,storage,security,shared}` (paylaşımlı)
- `packages/{license-client,central-sync,policy-client}` (read-only istemciler)

❌ **YOK (Dockerfile build sırasında silinir):**
- `apps/dealer/`
- `apps/license-server/`
- `packages/license-core/` (key generator)
- `src/license/keygenTool.js`, `license-generator.js`
- `src/storage/dealerStore.js`, `dealerSales.js`, `issuedLicenseStore.js`, `creditTransactionStore.js`
- `public/keygen.html`, `bayi.html`
- `src/middleware/adminAuth.js`

🛡️ **Runtime HARD-GATE** (müşteri server.js):
- `/api/dealer/*`, `/api/admin/*`, `/api/license/{generate,batch,trial,revoke,create,renew,customer}`, `/api/resellers`, `/api/central/*`, `/api/customer-sync/*` (in-bound), `/api/policy/*`, `/api/lists/*`, `/api/config/*` → tümü **404**

### Hangi Veri Hangi Tarafta

| Veri | Sunucu | Müşteri | Sızar mı? |
|------|--------|---------|-----------|
| License key | hash (sha256) | plaintext + encrypted cache | ❌ asla (hash one-way) |
| Mail içerikleri | YOK | local SQLite | ❌ payload'da forbidden |
| IMAP/SMTP credential | YOK | encrypted cache | ❌ asla |
| Plan/limits | yetkili tek kaynak | encrypted snapshot | ✅ sadece sunucudan müşteriye |
| Whitelist/blacklist | yetkili tek kaynak | encrypted snapshot | ✅ sadece sunucudan müşteriye |
| Heartbeat telemetri | activations.last_payload_json | gönderir | ✅ sadece sayaçlar + version'lar (PII yok) |
| Audit log | merkezi | YOK | — |

Heartbeat'in **PII koruması** her iki tarafta enforce edilir:
- Müşteri tarafı: `sanitizeHeartbeatPayload` whitelist (`packages/central-sync`)
- Sunucu tarafı: `serverWhitelistTelemetry` whitelist (`customerSync.routes.js`) + `ensureNoPII` + 16KB limit + recursion depth 8

---

## Yararlı npm Scriptleri

```bash
# Build
npm run build:license     # sadece license-server image
npm run build:dealer      # sadece dealer image
npm run build:customer    # sadece customer image

# Up/Down
npm run up:server         # mariadb + license-server + dealer
npm run down:server
npm run up:customer       # customer
npm run down:customer

# Loglar (canlı)
npm run logs:server
npm run logs:customer

# Test
npm run test:docker          # tüm test suite Docker'da
npm run test:docker:build    # sadece test image build
npm run test:docker:rebuild  # --no-cache build + run
```

---

> 💡 **Hızlı Başlangıç (Sunucu):** `cp .env.docker.example .env.docker` → 5 secret üret (LICENSE_SIGNING_SECRET, DEALER_API_SECRET, DEALER_SESSION_SECRET, **ADMIN_PANEL_TOKEN**, MARIADB_PASSWORD) → `npm run up:server` → `bootstrap.js create-dealer` → bayi panele gir (`http://<sunucu>:3100`).
>
> 💡 **Admin Paneli:** `http(s)://license.mailtrustai.com/admin` — `ADMIN_PANEL_TOKEN` ile giriş. Yeni bayi ekleme, lisans yönetimi, audit log.
>
> 💡 **Hızlı Başlangıç (Müşteri):** bayiden lisans key'i al → `cp .env.docker.example .env.docker` → `MSA_LICENSE_KEY` + `MSA_LICENSE_REMOTE_URL` doldur → `npm run up:customer`.
