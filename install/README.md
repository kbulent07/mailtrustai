# MailTrustAI — Kurulum Kılavuzu

## Adlandırma Konvansiyonu

```
<action>_<subject>_<os>.<ext>
```

- **action**: `install` / `update` / `uninstall`
- **subject**: `client` (müşteri Docker'i çalıştırır) veya `server` (license-server + dealer + MariaDB)
- **os**: `windows` veya `ubuntu`

## Dosya Listesi

### Sunucu (Linux)
```
install/server/
├── install_server_ubuntu.sh
├── update_server_ubuntu.sh
└── uninstall_server_ubuntu.sh
```

### Müşteri / Client (Windows + Linux)
```
install/client/
├── install_client_windows.bat       ← çift-tıkla giriş
├── install_client_windows.ps1       ← bootstrap (winget+git+docker+repo klon)
├── install_client_windows_setup.ps1 ← asıl kurulum (bootstrap tarafından çağrılır)
├── update_client_windows.bat
├── update_client_windows.ps1
├── uninstall_client_windows.bat
├── uninstall_client_windows.ps1
├── install_client_ubuntu.sh
├── update_client_ubuntu.sh
└── uninstall_client_ubuntu.sh
```

---

## 1. Sunucu (Linux)

```bash
# Kurulum
git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git /home/ubuntu/mailtrustai
cd /home/ubuntu/mailtrustai
sudo bash install/server/install_server_ubuntu.sh

# Güncelleme
sudo /opt/mailtrustai/mailtrustai-ctl.sh update
# veya doğrudan:
sudo bash install/server/update_server_ubuntu.sh

# Kaldırma
sudo bash install/server/uninstall_server_ubuntu.sh
# Otomasyon:
sudo UNATTENDED=true PURGE_DATA=true bash install/server/uninstall_server_ubuntu.sh
```

**Reset (tam temizlik + yeniden kurulum):**
```bash
sudo RESET=true bash install/server/install_server_ubuntu.sh
```

---

## 2. Müşteri / Client — Windows

### Kurulum (sıfırdan, hiçbir önkoşul yok)

İndirin ve **çift tıklayın**: `install_client_windows.bat`

```powershell
# PowerShell - Yönetici
mkdir C:\mailtrustai-setup -Force | Out-Null
cd C:\mailtrustai-setup
Invoke-WebRequest "https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/install_client_windows.bat" -OutFile "install_client_windows.bat"
Invoke-WebRequest "https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/install_client_windows.ps1" -OutFile "install_client_windows.ps1"

# Çift tıkla VEYA:
.\install_client_windows.bat
```

Bootstrap sırayla şunları yapar:
1. winget kontrolü/kurulumu
2. Git kontrolü/kurulumu (winget ile)
3. Docker Desktop kontrolü/kurulumu (winget ile)
4. Repo klonu → `C:\mailtrustai-source`
5. `install_client_windows_setup.ps1` çağrılır (asıl kurulum)
6. Lisans + URL sorulur, `.env` yazılır, image build, container başlat

### Güncelleme

```
C:\mailtrustai-source\install\client\update_client_windows.bat
```
çift tıklayın → otomatik git pull + yedek + rebuild + restart.

### Kaldırma — Soft vs Full

```
C:\mailtrustai-source\install\client\uninstall_client_windows.bat
```
çift tıklayın. Menü çıkar:

| Seçim | Davranış |
|---|---|
| **1 = SOFT** | Container durur, `.env` yedeklenir ve korunur, volume'lar korunur, Docker/Git kalır |
| **2 = FULL** | Container + volume + `.env` + kurulum dizini + `C:\mailtrustai-source` + **Docker Desktop** + **Git** silinir. "EVET SIL" onayı gerekir, geri alınamaz. |

### Otomasyon

```powershell
# Soft uninstall (sessiz)
powershell -ExecutionPolicy Bypass -File install\client\uninstall_client_windows.ps1 -Unattended

# Full purge (Docker dahil her şey)
powershell -ExecutionPolicy Bypass -File install\client\uninstall_client_windows.ps1 `
    -Purge -RemoveImage -RemoveDocker -RemoveGit -Unattended -DeleteBackups
```

---

## 3. Müşteri / Client — Ubuntu

### Kurulum

```bash
git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git /home/ubuntu/mailtrustai
cd /home/ubuntu/mailtrustai

# İnteraktif
sudo bash install/client/install_client_ubuntu.sh

# Parametreli (otomasyon)
sudo LICENSE_KEY="MTAI-PRO-XXXX-XXXX" \
     LICENSE_SERVER_URL="https://license.firma.com" \
     CUSTOMER_PORT=3000 \
     bash install/client/install_client_ubuntu.sh
```

Docker yoksa otomatik kurulur (resmi Docker deposundan), marker dosyası bırakılır:
```
/var/lib/mailtrustai-client-docker-installed-by-script
```

### Güncelleme

```bash
sudo /opt/mailtrustai/mailtrustai-client-ctl.sh update
# veya
sudo bash install/client/update_client_ubuntu.sh

# Otomasyon (cron)
sudo UNATTENDED=true bash install/client/update_client_ubuntu.sh
```

### Kaldırma — Soft vs Full

```bash
sudo bash install/client/uninstall_client_ubuntu.sh
```

İnteraktif menüde 2 seçenek:

| Seçim | Davranış |
|---|---|
| **1 = SOFT** | Container kapatılır, `.env` yedeklenir ve korunur, volume'lar korunur, Docker kalır |
| **2 = FULL** | Container + volume + `.env` + kurulum dizini silinir. **Marker varsa Docker da apt purge ile kaldırılır.** Onceden manuel kurulu Docker korunur. |

### Otomasyon

```bash
# Soft uninstall (sessiz)
sudo MODE=soft UNATTENDED=true bash install/client/uninstall_client_ubuntu.sh

# Full purge (Docker dahil — bu betik kurduysa)
sudo MODE=full UNATTENDED=true bash install/client/uninstall_client_ubuntu.sh
```

---

## 4. Sık Kullanılan Komutlar

### Server (Linux)
```bash
sudo /opt/mailtrustai/mailtrustai-ctl.sh status     # Container durumları
sudo /opt/mailtrustai/mailtrustai-ctl.sh logs       # Canlı loglar
sudo /opt/mailtrustai/mailtrustai-ctl.sh backup     # MariaDB + .env yedek
sudo /opt/mailtrustai/mailtrustai-ctl.sh update     # Yeni sürüme yükselt
```

### Client (Windows)
```powershell
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' status
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' logs
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' backup
& 'C:\MailTrustAI\mailtrustai-ctl.ps1' update
```

### Client (Linux)
```bash
sudo /opt/mailtrustai/mailtrustai-client-ctl.sh status
sudo /opt/mailtrustai/mailtrustai-client-ctl.sh logs
sudo /opt/mailtrustai/mailtrustai-client-ctl.sh backup
sudo /opt/mailtrustai/mailtrustai-client-ctl.sh update
```

---

## 5. Güvenlik Notları

- `.env` dosyaları **asla** git'e commit etmeyin (`.gitignore`'da)
- `LICENSE_SIGNING_SECRET` değiştirilirse mevcut tüm lisanslar geçersiz olur
- Üretimde Nginx reverse proxy + Let's Encrypt kullanın
- `ADMIN_PANEL_TOKEN` yalnızca üreticide kalmalı — bayilere verilmez
- Düzenli yedek alın

## 6. SSS

### "Access denied for user 'mailtrustai'" hatası alıyorum
Eski MariaDB volume kalıntısı var. Çözüm:
```bash
sudo RESET=true bash install/server/install_server_ubuntu.sh
```

### Kurulum script'i bir yerde patlıyor
Otomatik log dosyalarına bakın:
- Linux server install: `/tmp/mailtrustai-install-*.log`
- Linux client install: `/tmp/mailtrustai-client-install-*.log`
- Windows: `%TEMP%\mailtrustai-install-*.log`, `%TEMP%\mailtrustai-bootstrap-*.log`

### Lisans aktivasyonu çalışmıyor
Müşteri UI'da lisans modalında **🔌 Bağlantı Testi** butonuna basın → license-server'a erişilebilirliği test edin. **📋 Loglar** butonuyla iletişim detaylarını görün.
