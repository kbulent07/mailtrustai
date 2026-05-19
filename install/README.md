# MailTrustAI — Kurulum Kılavuzu

## İçindekiler

1. [Sunucu Kurulumu (Linux)](#1-sunucu-kurulumu-linux)
2. [Sunucu Güncelleme (Linux)](#2-sunucu-güncelleme-linux)
3. [Sunucu Kaldırma (Linux)](#3-sunucu-kaldırma-linux)
4. [Müşteri Kurulumu (Windows)](#4-müşteri-kurulumu-windows)
5. [Müşteri Güncelleme (Windows)](#5-müşteri-güncelleme-windows)
6. [Müşteri Kaldırma (Windows)](#6-müşteri-kaldırma-windows)
7. [Sık Sorulan Sorular](#7-sık-sorulan-sorular)
8. [Güvenlik Notları](#8-güvenlik-notları)

---

## Mimari Özet

```
┌──────────────────────────────────────────────┐
│  SUNUCU (Linux — Siz/Bayi)                   │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  license-server  │  │   dealer panel   │   │
│  │   port 3200      │  │    port 3100     │   │
│  └────────┬─────────┘  └──────────────────┘   │
│           │ MariaDB (iç ağ)                   │
│  ┌────────┴─────────┐                         │
│  │     MariaDB      │                         │
│  └──────────────────┘                         │
└──────────────────────────────────────────────┘
              ▲ HTTPS (lisans doğrulama)
              │
┌──────────────────────────────────────────────┐
│  MÜŞTERİ (Windows — Müşteri)                 │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │   customer (MailTrustAI Arayüzü)     │    │
│  │            port 3000                 │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## 1. Sunucu Kurulumu (Linux)

**Gereksinimler:**
- Linux (Debian 12 / Ubuntu 22+ / Rocky 9 önerilir)
- 2 GB RAM, 20 GB disk
- Açık portlar: `3200/tcp` (license API), `3100/tcp` (dealer panel)
- Docker 24+ (yoksa betik otomatik kurar — Debian/Ubuntu)
- `openssl` komutu (`apt install openssl`)

**Adımlar:**

```bash
# 1. Repoyu sunucuya kopyalayın — branch'i belirtmek önemli
git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git /home/ubuntu/mailtrustai
cd /home/ubuntu/mailtrustai

# 2. Kurulum betiğini çalıştırın (script /opt/mailtrustai altına kurar)
sudo bash install/server/install_server_ubuntu.sh
```

**Betik şunları yapar:**
- ✓ Docker kurulumu/kontrolü
- ✓ Interaktif/non-interactive mod (`SERVER_HOST=...` env vars ile geçilebilir)
- ✓ Güvenli secret üretimi (`openssl rand -hex 32`) + her birinde fatal kontrolü
- ✓ Atomik `.env` yazımı + 7 zorunlu değişkenin doğrulanması
- ✓ Eski MariaDB volume kalıntısı tespit → kullanıcıya silme onayı sorar
  (yoksa "Access denied" hatasıyla MariaDB başlamaz)
- ✓ Docker image build (license-server, dealer, MariaDB)
- ✓ Servisleri başlatma + 60s `/healthz` kontrolü
- ✓ `ERR trap`: herhangi bir hatada satır no + komut + log dosyası gösterir
- ✓ Tam log: `/tmp/mailtrustai-install-TIMESTAMP.log`

**Non-interactive (otomasyon) örneği:**
```bash
sudo SERVER_HOST=license.firma.com \
     PURGE_OLD_VOLUMES=true \
     bash install/server/install_server_ubuntu.sh
```

**Erişim adresleri:**
| Servis         | URL                                    |
|----------------|----------------------------------------|
| License API    | `http://SUNUCU_IP:3200/healthz`        |
| Dealer Panel   | `http://SUNUCU_IP:3100`                |
| Admin Panel    | `http://SUNUCU_IP:3200/admin`          |

> ⚠ **Üretim ortamı için Nginx + Let's Encrypt ile HTTPS kurun.**

**Yönetim komutları:**
```bash
sudo /opt/mailtrustai/mailtrustai-ctl.sh status     # Durum
sudo /opt/mailtrustai/mailtrustai-ctl.sh logs       # Loglar (canlı)
sudo /opt/mailtrustai/mailtrustai-ctl.sh backup     # Yedek (MariaDB + .env)
sudo /opt/mailtrustai/mailtrustai-ctl.sh upgrade    # Yeni sürüme yükselt
sudo /opt/mailtrustai/mailtrustai-ctl.sh stop       # Durdur
sudo /opt/mailtrustai/mailtrustai-ctl.sh start      # Başlat
```

---

## 2. Sunucu Güncelleme (Linux)

Yeni bir sürüm geldiğinde **mevcut `.env` ve veritabanı korunarak** yükseltme yapılır.

```bash
# YOL 1 — ctl ile (en kolay):
sudo /opt/mailtrustai/mailtrustai-ctl.sh upgrade

# YOL 2 — doğrudan script:
cd /home/ubuntu/mailtrustai
sudo bash install/server/upgrade_server_ubuntu.sh

# YOL 3 — otomasyon (cron):
sudo UNATTENDED=true bash /home/ubuntu/mailtrustai/install/server/upgrade_server_ubuntu.sh
```

**Upgrade script şunları yapar (7 adım):**
1. `/opt/mailtrustai/.env` var mı kontrol
2. Docker daemon aktif mi
3. **Otomatik yedek**: `.env.pre-upgrade.TS` + `mariadb-pre-upgrade.TS.tar.gz`
4. Git **fast-forward** pull (divergent history'de fail; lokal değişiklik varsa stash sorar)
5. `docker-compose.server.yml` repo'dan kurulum dizinine senkronize
6. `docker compose build --pull`
7. `docker compose up -d` + 60s `/healthz` polling

**Veri kaybı yok**: `.env`, `mariadb-data`, `license-server-data` volume'ları dokunulmaz.
Migration'lar license-server boot'unda otomatik çalışır.

**Hata olursa rollback** komutları script sonunda ekrana basılır:
```bash
cd /home/ubuntu/mailtrustai
git reset --hard $(cat /tmp/mailtrustai-upgrade-prev-commit)
sudo bash install/server/upgrade_server_ubuntu.sh
```

**Cron örneği — her Pazar 03:00 otomatik upgrade:**
```bash
echo '0 3 * * 0 root UNATTENDED=true bash /home/ubuntu/mailtrustai/install/server/upgrade_server_ubuntu.sh >> /var/log/mailtrustai-upgrade.log 2>&1' | sudo tee /etc/cron.d/mailtrustai-upgrade
```

---

## 3. Sunucu Kaldırma (Linux)

```bash
# Sadece servisleri durdur (veriler korunur):
sudo bash install/server/uninstall_server_ubuntu.sh

# Tüm verileri SİL (MariaDB, lisans DB, .env):
sudo bash install/server/uninstall_server_ubuntu.sh --purge
```

> ⚠ `--purge` geri alınamaz. Önce `backup` alın.

---

## 4. Müşteri Kurulumu (Windows)

**Gereksinimler:**
- Windows 10/11 (64-bit, Windows 10 1809+ winget için)
- 4 GB RAM (müşteri konteyneri için)
- Açık port: `3000/tcp` (Güvenlik Duvarı → Yeni Kural)
- İnternet bağlantısı
- Bayiden alınan **lisans anahtarı** ve **license-server URL'i**

> **Not:** Git, Docker Desktop ve WSL2 gerekli ama **bootstrap script bunları otomatik kurar**. Manuel kurmanıza gerek yok.

---

### YÖNTEM A — Çift tıkla, her şeyi otomatik kur (önerilen)

Hiçbir ön-gereksinim yok. Sadece 2 dosya indirin:

```powershell
# PowerShell'i Yönetici olarak açın
mkdir C:\mailtrustai-setup -Force | Out-Null
cd C:\mailtrustai-setup

# .bat ve .ps1'i GitHub'dan indir
Invoke-WebRequest "https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/install_windows_musteri.bat" -OutFile "install_windows_musteri.bat"
Invoke-WebRequest "https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/install_windows_musteri.ps1" -OutFile "install_windows_musteri.ps1"
```

Sonra `install_windows_musteri.bat` dosyasına **çift tıklayın**.

Bootstrap sırayla şunları yapar:
1. **UAC istemi** — Yönetici yetkisi ister
2. **winget** kontrolü/kurulumu (Microsoft App Installer)
3. **Git** kontrolü/kurulumu (`winget install Git.Git`)
4. **Docker Desktop** kontrolü/kurulumu (`winget install Docker.DockerDesktop`)
   - İlk Docker kurulumunda **Windows yeniden başlatma isteyebilir** (WSL2 için)
   - Yeniden başlattıktan sonra `.bat`'a tekrar çift tıklayın
5. **Repo klonu** → `C:\mailtrustai-source` (kurulum dizini `C:\MailTrustAI` ile çakışmasın diye farklı yer)
6. `install_windows_user.ps1`'i çağırır (lisans anahtarınızı + URL'i sorar)
7. Image build + container başlat + sağlık kontrolü

⚠ **İlk çalıştırmadan sonra Docker Desktop'ı manuel başlatıp hoş geldin ekranını geçmeniz gerekir.**

---

### YÖNTEM B — Git + Docker zaten kuruluysa (orijinal yol)

```powershell
# PowerShell'i "Yönetici olarak çalıştır" ile açın
cd C:\
git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git mailtrustai-source
cd mailtrustai-source

# Etkileşimli
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1

# Veya parametreli (tek satır)
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
    -LicenseKey "MTAI-PRO-XXXX-XXXX" `
    -LicenseServerUrl "https://license.firma.com" `
    -Port 3000

# Veya hazır image tar dosyasıyla (build gerekmez, hızlı)
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
    -LicenseKey "MTAI-PRO-XXXX-XXXX" `
    -LicenseServerUrl "https://license.firma.com" `
    -ImageFile "C:\Downloads\mailtrustai-customer.tar"
```

**Betik şunları yapar:**
- Docker Desktop ve daemon kontrolü
- Güvenli secret üretimi (.NET Crypto RNG)
- `C:\MailTrustAI\.env` oluşturma
- Docker image build veya tar'dan yükleme
- Konteyneri başlatma ve sağlık kontrolü
- İlk admin kurulum URL'i gösterme

**İlk Kurulum:**
Betik tamamlandığında şu URL'i tarayıcıda açın:
```
http://localhost:3000/?setup_token=<SETUP_TOKEN>
```
Admin e-postanızı ve şifrenizi oluşturun.

**Yönetim komutları (PowerShell - Yönetici):**
```powershell
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' status      # Durum
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' logs        # Loglar
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' backup      # Yedek
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' upgrade     # Yeni sürüme yükselt
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' stop        # Durdur
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' start       # Başlat
```

---

## 5. Müşteri Güncelleme (Windows)

Mevcut `.env` ve `customer-data` volume'u korunarak yükseltme yapılır.

### YOL A — Çift-tıkla bat dosyası (en kolay)

```
C:\mailtrustai-source\install\client\upgrade_windows_musteri.bat
```

dosyasına çift tıklayın. UAC istemi → varsa tar dosyası yolu sorar (yoksa Enter geçin) → git pull + build + restart.

### YOL B — ctl ile

```powershell
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' upgrade
```

### YOL C — doğrudan script

```powershell
cd C:\mailtrustai-source
powershell -ExecutionPolicy Bypass -File install\client\upgrade_windows.ps1

# Bayi tar dosyası gönderdiyse:
powershell -ExecutionPolicy Bypass -File install\client\upgrade_windows.ps1 `
    -ImageFile "C:\Downloads\mailtrustai-customer-v2.tar"

# Task Scheduler için sessiz mod:
powershell -ExecutionPolicy Bypass -File install\client\upgrade_windows.ps1 -Unattended
```

**Upgrade script şunları yapar (7 adım):**
1. `C:\MailTrustAI\.env` ve compose dosyası var mı kontrol
2. Docker Desktop çalışıyor mu (`$LASTEXITCODE` kontrolü)
3. **Otomatik yedek**: `.env`, `customer-data` tar.gz snapshot, önceki image (`docker save`)
4. Repo modu → `git pull --ff-only`; Tar modu → `docker load`
5. Compose senkron + `docker compose build --pull`
6. `docker compose up -d --remove-orphans`
7. `/healthz` 60s polling

**Veri kaybı yok**: `.env`, `customer-data`, `customer-logs` volume'ları dokunulmaz.

**Hata olursa**: Önceki commit hash ve rollback komutları ekrana basılır.

**Task Scheduler örneği — her Pazar 04:00 otomatik upgrade:**
```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument '-ExecutionPolicy Bypass -File "C:\path\to\mailtrustai\install\client\upgrade_windows.ps1" -Unattended'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4am
Register-ScheduledTask -TaskName 'MailTrustAI-Upgrade' -Action $action -Trigger $trigger `
    -User 'SYSTEM' -RunLevel Highest
```

---

## 6. Müşteri Kaldırma (Windows)

### YOL A — Çift-tıkla bat dosyası (en kolay)

```
C:\mailtrustai-source\install\client\uninstall_windows_musteri.bat
```

dosyasına çift tıklayın. UAC istemi → menüden seçim:
- **1** = Sadece container kapat (veriler korunur)
- **2** = HER ŞEYİ SİL (volume + .env + kurulum dizini) — "EVET SIL" onayı gerekir

### YOL B — Doğrudan script

```powershell
# PowerShell'i "Yönetici olarak çalıştır" ile açın

# Sadece konteyneri durdur (veriler korunur):
powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1

# Tüm verileri SİL + image'ı da kaldır:
powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1 -Purge -RemoveImage

# Sessiz mod (otomasyon — Task Scheduler):
powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1 `
    -Purge -RemoveImage -Unattended -DeleteBackups
```

---

## 7. Sık Sorulan Sorular

### Lisans aktivasyonu çalışmıyor
Müşteri konteyneri license-server'a ulaşamazsa:
1. `MSA_LICENSE_REMOTE_URL` doğru mu? (`C:\MailTrustAI\.env`)
2. Sunucu firewall'ı `3200/tcp` portunu açık mı?
3. Ağ bağlantısını test edin: `curl http://SUNUCU_IP:3200/healthz`

### Docker image nasıl müşteriye gönderilir?
Sunucuda image'ı tar'a aktar, müşteriye gönderin:
```bash
# Sunucuda (Linux):
docker build -f apps/customer/Dockerfile -t mailtrustai-customer:latest .
docker save mailtrustai-customer:latest | gzip > mailtrustai-customer.tar.gz
```
Müşteri `install_windows_user.ps1 -ImageFile mailtrustai-customer.tar.gz` ile yükler.
Sonraki güncellemelerde aynı `-ImageFile` parametresi `upgrade_windows.ps1` için de kullanılır.

### Güncelleme nasıl yapılır?
**Sunucu:** `sudo /opt/mailtrustai/mailtrustai-ctl.sh upgrade`
**Müşteri:** `& 'C:\MailTrustAI\mailtrustai-ctl.ps1' upgrade`

Detay için bkz. **Bölüm 2** (sunucu) ve **Bölüm 5** (müşteri).

### "Access denied for user 'mailtrustai'" hatası alıyorum
Eski MariaDB volume kalıntısı var ama `.env` yeniden üretilmiş. İki yol:

**Otomatik:** Install script'i yeniden çalıştırın — eski volume'u görüp size silmek isteyip
istemediğinizi sorar. "e" deyin (lisans verisi kaybolacak ikazı çıkar).

**Manuel:**
```bash
sudo docker compose --env-file /opt/mailtrustai/.env \
    -f /opt/mailtrustai/docker-compose.server.yml down -v
sudo docker volume rm mailtrustai-server_mariadb-data mailtrustai-server_license-server-data
sudo bash install/server/install_server_ubuntu.sh
```

### Kurulum bir yerde patlıyor ama mesaj görünmüyor
Yeni script `/tmp/mailtrustai-install-TIMESTAMP.log` dosyasına tüm çıktıyı yazar ve ERR trap
ile hangi satırda patladığını ekrana basar. Log dosyasını inceleyin:
```bash
ls -t /tmp/mailtrustai-install-*.log | head -1 | xargs tail -50
```

### Yedek nerede saklanır?
| Sistem   | Yedek yolu                        |
|----------|-----------------------------------|
| Linux    | `/opt/mailtrustai/backups/`       |
| Windows  | `C:\MailTrustAI\backups\`         |

Upgrade script çalıştığında otomatik yedek de aynı dizine düşer:
- `.env.pre-upgrade.TIMESTAMP`
- `mariadb-pre-upgrade.TIMESTAMP.tar.gz` (Linux)
- `customer-data-pre-upgrade.TIMESTAMP.tar.gz` (Windows)
- `image.pre-upgrade.TIMESTAMP.tar` (Windows, önceki image rollback için)

---

## 8. Güvenlik Notları

- `.env` dosyalarını asla git'e commit etmeyin (`.gitignore`'a ekli).
- `LICENSE_SIGNING_SECRET` değiştirilirse mevcut tüm lisanslar geçersiz olur.
- Üretimde Nginx reverse proxy + Let's Encrypt kullanın.
- `ADMIN_PANEL_TOKEN`'ı yalnızca siz saklayın — bayilere vermeyin.
- Düzenli yedek alın: aylık en az 1 kez `backup` komutu çalıştırın.
