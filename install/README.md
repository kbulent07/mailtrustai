# MailTrustAI — Kurulum Kılavuzu

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
# 1. Repoyu sunucuya kopyalayın (git clone veya scp ile)
git clone https://github.com/kbulent07/mailtrustai.git /opt/mailtrustai-repo
cd /opt/mailtrustai-repo

# 2. Kurulum betiğini çalıştırın
sudo bash install/server/install_server_ubuntu.sh

# Betik şunları yapar:
#   ✓ Docker kurulumu/kontrolü
#   ✓ Güvenli secret üretimi (openssl rand -hex 32)
#   ✓ /opt/mailtrustai/.env dosyası oluşturma
#   ✓ Docker image build (license-server, dealer, MariaDB)
#   ✓ Servisleri başlatma ve sağlık kontrolü
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
# Durum
/opt/mailtrustai/mailtrustai-ctl.sh status

# Loglar (canlı)
/opt/mailtrustai/mailtrustai-ctl.sh logs

# Yedek (MariaDB + license-server verisi + .env)
/opt/mailtrustai/mailtrustai-ctl.sh backup

# Durdur / Başlat
/opt/mailtrustai/mailtrustai-ctl.sh stop
/opt/mailtrustai/mailtrustai-ctl.sh start
```

---

## 2. Sunucu Kaldırma (Linux)

```bash
# Sadece servisleri durdur (veriler korunur):
sudo bash install/server/uninstall_server_ubuntu.sh

# Tüm verileri SİL (MariaDB, lisans DB, .env):
sudo bash install/server/uninstall_server_ubuntu.sh --purge
```

> ⚠ `--purge` geri alınamaz. Önce `backup` alın.

---

## 3. Müşteri Kurulumu (Windows)

**Gereksinimler:**
- Windows 10/11 (64-bit)
- [Docker Desktop](https://www.docker.com/products/docker-desktop) 4.x+ kurulu ve çalışıyor
- WSL2 etkin (`wsl --install` ile)
- 4 GB RAM (müşteri konteyneri için)
- Açık port: `3000/tcp` (Güvenlik Duvarı → Yeni Kural)
- Bayiden alınan **lisans anahtarı** ve **license-server URL'i**

**Adımlar:**

```powershell
# PowerShell'i "Yönetici olarak çalıştır" ile açın

# Yöntem A: Etkileşimli (en kolay)
cd C:\path\to\mailtrustai-repo
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1

# Yöntem B: Parametreli
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
    -LicenseKey "MSA-XXXX-XXXX-XXXX" `
    -LicenseServerUrl "https://license.firma.com" `
    -Port 3000

# Yöntem C: Hazır image tar dosyasıyla (build gerekmez)
powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
    -LicenseKey "MSA-XXXX-XXXX-XXXX" `
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
# Durum
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' status

# Loglar
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' logs

# Yedek
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' backup

# Durdur / Başlat
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' stop
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' start
```

---

## 4. Müşteri Kaldırma (Windows)

```powershell
# PowerShell'i "Yönetici olarak çalıştır" ile açın

# Sadece konteyneri durdur (veriler korunur):
powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1

# Tüm verileri SİL + image'ı da kaldır:
powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1 -Purge -RemoveImage
```

---

## 5. Sık Sorulan Sorular

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
Müşteri `install.ps1 -ImageFile mailtrustai-customer.tar.gz` ile yükler.

### Güncelleme nasıl yapılır?
```bash
# Sunucu:
cd /path/to/mailtrustai-repo
git pull
sudo bash install/server/install_server_ubuntu.sh  # mevcut .env korunur

# Müşteri (PowerShell - Yönetici):
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' update
```

### Yedek nerede saklanır?
| Sistem   | Yedek yolu                        |
|----------|-----------------------------------|
| Linux    | `/opt/mailtrustai/backups/`        |
| Windows  | `C:\MailTrustAI\backups\`          |

---

## 6. Güvenlik Notları

- `.env` dosyalarını asla git'e commit etmeyin (`.gitignore`'a ekli).
- `LICENSE_SIGNING_SECRET` değiştirilirse mevcut tüm lisanslar geçersiz olur.
- Üretimde Nginx reverse proxy + Let's Encrypt kullanın.
- `ADMIN_PANEL_TOKEN`'ı yalnızca siz saklayın — bayilere vermeyin.
- Düzenli yedek alın: aylık en az 1 kez `backup` komutu çalıştırın.
