# MailTrustAI Windows Installer (Inno Setup)

Müşteri tarafı için **tek `.exe` kurulum sihirbazı** üretir. Müşteri çift tıklar,
lisans + URL girer, gerisi otomatik (Git → Docker → repo → build → start).

## Dosyalar

```
installer/
├── MailTrustAIClient.iss   ← Inno Setup script (asıl tanım)
├── LICENSE.txt             ← Kuruluma gömülü EULA metni
├── build-installer.ps1     ← Lokal derleme yardımcısı
└── README.md               ← bu dosya
```

Çıktı: `dist/MailTrustAI-Client-Setup-<sürüm>.exe`

## Kurulum sihirbazı akışı

1. **Hoşgeldin** + bilgi sayfası (ne yapılacağı özeti)
2. **EULA** kabul
3. **Lisans Anahtarı** girişi (zorunlu)
4. **License-Server URL** girişi (varsayılan `https://license.mailtrustai.com`)
5. Kurulum: `install_client_windows.ps1` bootstrap'ı parametrelerle çağrılır
   - Git for Windows (yoksa winget ile)
   - Docker Desktop (yoksa winget ile — yeniden başlatma gerekebilir)
   - Repo → `C:\mailtrustai-source`
   - `.env` yazılır, image build, container başlatılır (port 3000)
6. **Bitiş** → "Tarayıcıda aç" seçeneği

## Derleme — 2 yol

### A) CI (önerilen) — otomatik

`.github/workflows/build-windows-installer.yml` tag push'unda Windows runner'da
derler ve GitHub Releases'a yükler:

```bash
git tag v2.0.1
git push origin v2.0.1
# → Actions çalışır → Releases'te MailTrustAI-Client-Setup-2.0.1.exe
```

Manuel tetikleme: Actions sekmesi → "build-windows-installer" → Run workflow.

### B) Lokal derleme

Windows makinede:

```powershell
# Inno Setup yoksa otomatik kurar:
.\installer\build-installer.ps1 -InstallIfMissing

# Inno Setup zaten kuruluysa:
.\installer\build-installer.ps1
```

Veya doğrudan:

```powershell
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\MailTrustAIClient.iss
```

## Sürüm güncelleme

`MailTrustAIClient.iss` içinde:

```
#define MyAppVersion      "2.0.0"
```

değerini güncelleyin (CI tag'i ile senkron tutun).

## Kod imzalama (opsiyonel)

İmzasız `.exe` Windows SmartScreen'de "Bilinmeyen yayıncı" uyarısı verir.
İmzalamak için bir Authenticode sertifikası + `signtool` gerekir:

```powershell
signtool sign /f cert.pfx /p <parola> /tr http://timestamp.digicert.com /td sha256 /fd sha256 dist\MailTrustAI-Client-Setup-2.0.0.exe
```

CI'da imzalamak için sertifikayı GitHub Secret olarak ekleyip workflow'a
bir imza adımı eklenebilir (şimdilik kapsamda değil).

## Notlar

- Installer `PrivilegesRequired=admin` — yönetici yetkisi ister (Docker/winget için).
- Bootstrap PS1 zaten `-LicenseKey` / `-LicenseServerUrl` parametrelerini kabul ediyor;
  installer bu parametreleri wizard'dan toplayıp geçirir.
- Kaldırma: Denetim Masası → Programlar, veya `uninstall_client_windows.bat` (soft/full menü).
