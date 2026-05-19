#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI - Windows Musteri Guncelleme Betigi

.DESCRIPTION
    Mevcut C:\MailTrustAI kurulumunu yeni surume yukseltir.
    - .env DOKUNULMAZ (lisans + secret'lar korunur)
    - customer-data ve customer-logs volume'lari DOKUNULMAZ
    - Repo modunda: git pull + docker compose build
    - Tar modunda : yeni image dosyasi yuklenir (-ImageFile ile gec)
    - Servis graceful restart edilir + healthcheck

.PARAMETER InstallDir
    Kurulum dizini. Varsayilan: C:\MailTrustAI

.PARAMETER ImageFile
    Bayinizden aldiginiz YENI tar dosyasi (pre-built image modu).
    Verilmezse local repo'dan git pull + build yapilir.

.PARAMETER Unattended
    Sorularsiz mod (otomasyon icin). Lokal degisiklik varsa cikar.

.EXAMPLE
    # Klasik (interaktif, repo'dan):
    powershell -ExecutionPolicy Bypass -File install\client\update_client_windows.ps1

    # Yeni image tar dosyasiyla:
    powershell -ExecutionPolicy Bypass -File install\client\update_client_windows.ps1 `
        -ImageFile "C:\Downloads\mailtrustai-customer-v2.tar"

    # Otomasyon (Task Scheduler):
    powershell -ExecutionPolicy Bypass -File install\client\update_client_windows.ps1 -Unattended
#>

[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\MailTrustAI',
    [string]$ImageFile  = '',
    [switch]$Unattended
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Log dosyasi -------------------------------------------------------------
$UpgradeLog = Join-Path $env:TEMP "mailtrustai-upgrade-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Start-Transcript -Path $UpgradeLog -Append | Out-Null

# --- Yardimci fonksiyonlar ---------------------------------------------------
function Write-Color($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function Info($msg)    { Write-Color "  [BILGI]  $msg" 'Cyan' }
function Ok($msg)      { Write-Color "  [OK]     $msg" 'Green' }
function Warn($msg)    { Write-Color "  [UYARI]  $msg" 'Yellow' }
function Fatal($msg)   {
    Write-Color "  [HATA]   $msg" 'Red'
    Write-Color "  Tam log: $UpgradeLog" 'Yellow'
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}
function Hr()      { Write-Color ('-' * 56) 'DarkCyan' }
function Step($msg) { Write-Host ""; Write-Color ">>> $msg" 'White' }

function Assert-NativeOk($cmdLabel) {
    if ($LASTEXITCODE -ne 0) {
        Fatal "$cmdLabel basarisiz (exit code: $LASTEXITCODE)"
    }
}

# --- Yonetici kontrolu -------------------------------------------------------
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik Yonetici yetkisiyle calistirilmalidir. PowerShell'i 'Yonetici olarak calistir' ile acin."
}

# --- Banner ------------------------------------------------------------------
Write-Host ""
Write-Color "  ======================================================" 'Cyan'
Write-Color "  ===   MailTrustAI - Musteri Guncelleme Betigi      ===" 'Cyan'
Write-Color "  ===   .env ve veriler korunur                      ===" 'Cyan'
Write-Color "  ======================================================" 'Cyan'
Write-Host ""
Info "Log dosyasi: $UpgradeLog"

# --- 1. Kurulum kontrolu -----------------------------------------------------
Step "1/7  Kurulum tespit ediliyor..."

$EnvFile     = Join-Path $InstallDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.customer.yml'

if (-not (Test-Path $InstallDir)) {
    Fatal "Kurulum dizini bulunamadi: $InstallDir. Ilk kurulum icin install_client_windows_setup.ps1 kullanin."
}
if (-not (Test-Path $EnvFile)) {
    Fatal ".env bulunamadi: $EnvFile. Kurulum bozulmus olabilir; install scriptini yeniden calistirin."
}
if (-not (Test-Path $ComposeFile)) {
    Fatal "Compose dosyasi bulunamadi: $ComposeFile"
}

Ok "Kurulum   : $InstallDir"
Ok "Env       : $EnvFile"
Ok "Compose   : $ComposeFile"

# --- 2. Docker kontrolu ------------------------------------------------------
Step "2/7  Docker Desktop kontrol ediliyor..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fatal "Docker komutu bulunamadi. Docker Desktop yuklu mu?"
}

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fatal "Docker daemon calismiyor. Docker Desktop'i baslatin ve tekrar deneyin."
}
Ok "Docker hazir: $(docker --version)"

docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fatal "docker compose plugin bulunamadi. Docker Desktop'i guncelleyin."
}

# --- 3. Otomatik yedek -------------------------------------------------------
Step "3/7  Otomatik yedekleme..."

$BackupDir = Join-Path $InstallDir 'backups'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$TS = Get-Date -Format 'yyyyMMdd_HHmmss'

# .env yedegi
$EnvBackup = Join-Path $BackupDir ".env.pre-upgrade.$TS"
Copy-Item $EnvFile $EnvBackup -Force
Ok "Env yedegi: $EnvBackup"

# Yardimci: PS strict mode + ErrorActionPreference=Stop, native exe
# stderr ciktilarini (docker'in "Unable to find image..." gibi bilgi
# mesajlari dahil) terminating error olarak gorur. Bu wrapper, native
# komut suresince Stop'u Continue'ya alir ve trap'in tetiklenmesini onler.
function Invoke-NativeSilent {
    param([scriptblock]$Block)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Block } finally { $ErrorActionPreference = $prev }
}

# alpine image'i ilk kullanimda docker stderr'e "Unable to find..." yazar.
# Backup oncesi sessizce cekelim ki yedek dongusunde stderr gurultusu olmasin.
Info "alpine image hazirlaniyor (yedekleme arac kutusu)..."
Invoke-NativeSilent { docker image inspect alpine:latest 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    Invoke-NativeSilent { docker pull alpine:latest 2>&1 | Out-Null }
    if ($LASTEXITCODE -ne 0) { Warn "alpine indirilemedi — yedekleme atlanacak." }
}

# Volume snapshot'lari — hem customer-data hem customer-logs
function Backup-Volume($volName, $label) {
    $exists = $false
    Invoke-NativeSilent {
        $script:exists = (docker volume ls --format '{{.Name}}' 2>$null |
            Select-String -Pattern "^$volName$" -Quiet)
    }
    if ($script:exists -or $exists) {
        Info "$label volume snapshot aliniyor..."
        $tarName = "$label-pre-upgrade.$TS.tar.gz"
        Invoke-NativeSilent {
            docker run --rm `
                -v "${volName}:/data:ro" `
                -v "${BackupDir}:/backup" `
                alpine tar czf "/backup/$tarName" -C /data . 2>&1 | Out-Null
        }
        if ($LASTEXITCODE -eq 0) {
            Ok "$label yedegi: $BackupDir\$tarName"
        } else {
            Warn "$label yedegi alinamadi (devam ediliyor)."
        }
    }
}
Backup-Volume "mailtrustai-customer_customer-data" "customer-data"
Backup-Volume "mailtrustai-customer_customer-logs" "customer-logs"

# --- 4. Yeni surumu hazirla --------------------------------------------------
Step "4/7  Yeni surum hazirlaniyor..."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = $null
$PrevCommit = $null
$NewCommit  = $null

if ($ImageFile) {
    # MOD A: tar dosyasi ile yukseltme
    if (-not (Test-Path $ImageFile)) {
        Fatal "Image dosyasi bulunamadi: $ImageFile"
    }
    Info "Image tar modu: $ImageFile"

    # Tar dosyasini yedekle (rollback icin)
    $tarBackup = Join-Path $BackupDir "image.pre-upgrade.$TS.tar"
    Invoke-NativeSilent {
        docker save mailtrustai-customer:latest -o $tarBackup 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -eq 0) {
        Ok "Onceki image yedegi: $tarBackup"
    } else {
        Warn "Onceki image yedeklenemedi (devam ediliyor)."
    }

    Info "Yeni image yukleniyor: $ImageFile"
    Invoke-NativeSilent { docker load -i $ImageFile }
    Assert-NativeOk "docker load"
    Ok "Yeni image yuklendi."

} else {
    # MOD B: repo'dan git pull
    try {
        $RepoRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
    } catch {
        Fatal "Repo koku bulunamadi. -ImageFile parametresi ile tar dosyasi belirtin."
    }

    if (-not (Test-Path (Join-Path $RepoRoot '.git'))) {
        Fatal "$RepoRoot bir git repo'su degil. Repo'yu yeniden klonlayin veya -ImageFile kullanin:
    cd (Split-Path $RepoRoot)
    git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git"
    }

    Set-Location $RepoRoot

    $PrevCommit = (git rev-parse HEAD).Trim()
    Set-Content -Path (Join-Path $env:TEMP 'mailtrustai-upgrade-prev-commit') -Value $PrevCommit
    Info "Onceki commit: $PrevCommit"

    $CurrentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
    Info "Aktif branch : $CurrentBranch"

    # Lokal degisiklik kontrolu
    $dirty = git status --porcelain
    if ($dirty) {
        Warn "Lokal degisiklikler var:"
        Write-Host $dirty
        if ($Unattended) {
            Fatal "Unattended mod - lokal degisiklikler oldugu icin pull edilemez."
        }
        $stashAns = Read-Host "  Lokal degisiklikleri stash'e at ve devam et? [e/H]"
        if ($stashAns -match '^[EeYy]') {
            git stash push -m "auto-stash before upgrade $TS"
            Assert-NativeOk "git stash"
            Ok "Stash: 'auto-stash before upgrade $TS'"
        } else {
            Fatal "Iptal edildi. Lokal degisiklikleri commit/stash edin."
        }
    }

    Info "Pull yapiliyor: origin/$CurrentBranch"
    git fetch origin $CurrentBranch
    Assert-NativeOk "git fetch"

    git pull --ff-only origin $CurrentBranch
    if ($LASTEXITCODE -ne 0) {
        Fatal "Fast-forward pull basarisiz (divergent history). Manuel cozun: git status"
    }

    $NewCommit = (git rev-parse HEAD).Trim()
    if ($PrevCommit -eq $NewCommit) {
        Ok "Zaten guncel: $NewCommit"
        Info "Yine de image rebuild + restart yapiliyor."
    } else {
        Ok "Guncellendi: $PrevCommit -> $NewCommit"
        Info "Degisiklikler:"
        git log --oneline "$PrevCommit..$NewCommit" | Select-Object -First 15 | ForEach-Object { Write-Host "    $_" }
    }

    # --- 5. Compose senkron + build ----------------------------------------
    Step "5/7  Compose senkronizasyonu ve image build..."
    $SourceCompose = Join-Path $RepoRoot 'docker-compose.customer.yml'
    if (Test-Path $SourceCompose) {
        # Eski compose ile yeni farkliysa yedekle
        $oldHash = (Get-FileHash $ComposeFile -Algorithm SHA256).Hash
        $newHash = (Get-FileHash $SourceCompose -Algorithm SHA256).Hash
        if ($oldHash -ne $newHash) {
            Copy-Item $ComposeFile (Join-Path $BackupDir "docker-compose.customer.yml.pre-upgrade.$TS")
            Info "Eski compose yedeklendi."
            Copy-Item $SourceCompose $ComposeFile -Force
            Ok "Compose senkron edildi."
        } else {
            Ok "Compose zaten guncel."
        }
    }

    Info "Image derleniyor (5-15 dakika)..."
    # docker compose build progress bar/satirlarini stderr'e yazar — wrap edilir.
    Invoke-NativeSilent {
        docker compose --env-file $EnvFile -f docker-compose.customer.yml build --pull
    }
    Assert-NativeOk "docker compose build"
    Ok "Image derlendi."
}

# --- 6. Servisleri yeniden baslat --------------------------------------------
Step "6/7  Servisler yeniden baslatiliyor..."
Set-Location $InstallDir

Invoke-NativeSilent {
    Invoke-Expression "docker compose --env-file `"$EnvFile`" -f `"$ComposeFile`" up -d --remove-orphans"
}
if ($LASTEXITCODE -ne 0) {
    Fatal "docker compose up basarisiz. Detay: $UpgradeLog"
}
Ok "Konteyner yeniden baslatildi."

# --- 7. Saglik kontrolu ------------------------------------------------------
Step "7/7  Saglik kontrolu (max 60s)..."

# Port'u .env'den oku
$portLine = Get-Content $EnvFile | Select-String -Pattern '^CUSTOMER_PORT=' | Select-Object -First 1
if ($portLine) {
    $Port = [int]($portLine -replace '^CUSTOMER_PORT=', '').Trim()
} else {
    $Port = 3000
}

$maxWait = 60
$elapsed = 0
$healthy = $false

while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$Port/healthz" `
            -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 5
    $elapsed += 5
    Info "Bekleniyor... ($elapsed/$maxWait saniye)"
}

# --- Ozet --------------------------------------------------------------------
Hr
Write-Host ""
if ($healthy) {
    Write-Color "  ======================================================" 'Green'
    Write-Color "  ===          GUNCELLEME TAMAMLANDI                ===" 'Green'
    Write-Color "  ======================================================" 'Green'
    Write-Host ""
    Write-Color "  Uygulama: http://localhost:$Port" 'Cyan'
} else {
    Write-Color "  ======================================================" 'Yellow'
    Write-Color "  ===  GUNCELLEME BITTI - SAGLIK KONTROLU EKSIK     ===" 'Yellow'
    Write-Color "  ======================================================" 'Yellow'
    Write-Host ""
    Warn "60 saniye icinde /healthz cevap vermedi."
    Warn "Loglar: docker logs mailtrustai-customer --tail 50"
}

Write-Host ""
if ($PrevCommit -and $NewCommit) {
    Write-Color "  Onceki commit : $($PrevCommit.Substring(0,12))" 'Yellow'
    Write-Color "  Yeni commit   : $($NewCommit.Substring(0,12))" 'Yellow'
}
Write-Color "  Env yedegi    : $EnvBackup" 'Yellow'
Write-Color "  Log dosyasi   : $UpgradeLog" 'Yellow'
Write-Host ""

if ($PrevCommit -and $NewCommit -and $PrevCommit -ne $NewCommit) {
    Write-Color "  Rollback (sorun varsa):" 'White'
    Write-Color "  cd `"$RepoRoot`"" 'Cyan'
    Write-Color "  git reset --hard $PrevCommit" 'Cyan'
    Write-Color "  powershell -ExecutionPolicy Bypass -File install\client\update_client_windows.ps1" 'Cyan'
    Write-Host ""
}

Hr

try { Stop-Transcript | Out-Null } catch { }
