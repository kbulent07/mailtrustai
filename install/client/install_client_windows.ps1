#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI - Windows Musteri Sifirdan Kurulum Bootstrap

.DESCRIPTION
    Hicbir on-gereksinim olmadan calistirilabilir. Sirayla kurar:
      1) winget (Microsoft App Installer) - varsa atlanir
      2) Git for Windows - varsa atlanir
      3) Docker Desktop - varsa atlanir (yeniden baslatma gerekebilir!)
      4) GitHub'dan mainpaketler repo'sunu klonlar
      5) install_client_windows_setup.ps1 ile asil musteri kurulumunu baslatir

.PARAMETER InstallRoot
    Repo'nun klonlanacagi kok dizin. Varsayilan: C:\mailtrustai-source
    (Kurulum dizini C:\MailTrustAI ile case-insensitive cakismayi onlemek icin.)

.PARAMETER LicenseKey
    Bayinizden aldiginiz lisans anahtari (interaktif olarak da sorulur).

.PARAMETER LicenseServerUrl
    License-server URL'i (interaktif olarak da sorulur).

.PARAMETER SkipDockerInstall
    Docker Desktop kurulumunu atla (zaten kurulu oldugundan eminseniz).

.EXAMPLE
    # En basit (interaktif):
    powershell -ExecutionPolicy Bypass -File install_client_windows.ps1

    # Tek satir parametreli:
    powershell -ExecutionPolicy Bypass -File install_client_windows.ps1 `
        -LicenseKey "MTAI-PRO-XXXX-XXXX" `
        -LicenseServerUrl "https://license.firma.com"
#>

[CmdletBinding()]
param(
    # Repo'nun klonlanacagi kok. Default 'C:\mailtrustai-source' — kurulum
    # dizini olan 'C:\MailTrustAI' ile case-insensitive cakismayi onlemek icin
    # farkli isimde tutuluyor (Windows: MailTrustAI == mailtrustai).
    [string]$InstallRoot       = 'C:\mailtrustai-source',
    [string]$LicenseKey        = '',
    [string]$LicenseServerUrl  = '',
    [switch]$SkipDockerInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Log dosyasi ------------------------------------------------------------
$BootstrapLog = Join-Path $env:TEMP "mailtrustai-bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
try { Start-Transcript -Path $BootstrapLog -Append | Out-Null } catch { }

# --- Yardimci fonksiyonlar --------------------------------------------------
function Write-Color($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function Info($msg)  { Write-Color "  [BILGI]  $msg" 'Cyan' }
function Ok($msg)    { Write-Color "  [OK]     $msg" 'Green' }
function Warn($msg)  { Write-Color "  [UYARI]  $msg" 'Yellow' }
function Step($msg)  { Write-Host ""; Write-Color ">>> $msg" 'White' }
function Hr()        { Write-Color ('-' * 60) 'DarkCyan' }
function Fatal($msg) {
    Write-Color "  [HATA]   $msg" 'Red'
    Write-Color "  Log dosyasi: $BootstrapLog" 'Yellow'
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host "  Devam etmek icin Enter'a basin"
    exit 1
}

# Global error trap
trap {
    Write-Host ""
    Write-Color "  ===== BOOTSTRAP BASARISIZ =====" 'Red'
    Write-Color "  Hata     : $($_.Exception.Message)" 'Red'
    if ($_.InvocationInfo) {
        Write-Color "  Satir    : $($_.InvocationInfo.ScriptLineNumber)" 'Red'
        Write-Color "  Komut    : $($_.InvocationInfo.Line.Trim())" 'Red'
    }
    Write-Color "  Log      : $BootstrapLog" 'Yellow'
    try { Stop-Transcript | Out-Null } catch { }
    Read-Host "  Devam etmek icin Enter'a basin"
    exit 1
}

# --- Banner -----------------------------------------------------------------
Clear-Host
Write-Host ""
Write-Color "  ============================================================" 'Cyan'
Write-Color "  ===  MailTrustAI - Windows Musteri Otomatik Kurulum      ===" 'Cyan'
Write-Color "  ===  Sifirdan kurulum: winget -> git -> docker -> repo   ===" 'Cyan'
Write-Color "  ============================================================" 'Cyan'
Write-Host ""
Info "Log dosyasi: $BootstrapLog"
Info "Internet baglantisi gerekiyor."
Write-Host ""

# --- Yonetici kontrolu ------------------------------------------------------
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik Yonetici yetkisiyle calistirilmalidir."
}

# ============================================================================
# 1/5  winget kontrol + kurulum
# ============================================================================
Step "1/5  winget (App Installer) kontrol ediliyor..."

if (Get-Command winget -ErrorAction SilentlyContinue) {
    $wingetVersion = (winget --version) 2>&1
    Ok "winget mevcut: $wingetVersion"
} else {
    Warn "winget bulunamadi. Microsoft App Installer kuruluyor..."
    Info "Bu islem birkac dakika surebilir."

    # Microsoft Store'dan App Installer kur (Windows 10 1809+ icin)
    try {
        Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe 2>$null
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Ok "winget kuruldu."
        } else {
            throw "Add-AppxPackage basarili oldu ama winget hala bulunamiyor."
        }
    } catch {
        Warn "Otomatik winget kurulumu basarisiz oldu."
        Warn "Lutfen Microsoft Store'dan 'App Installer'i manuel kurun:"
        Warn "  https://www.microsoft.com/store/productId/9NBLGGH4NNS1"
        Fatal "winget olmadan otomatik kurulum yapilamaz."
    }
}

# ============================================================================
# 2/5  Git kontrol + kurulum
# ============================================================================
Step "2/5  Git kontrol ediliyor..."

if (Get-Command git -ErrorAction SilentlyContinue) {
    Ok "Git mevcut: $(git --version)"
} else {
    Info "Git bulunamadi. winget ile kuruluyor (Git.Git)..."
    winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Fatal "Git kurulumu basarisiz (exit: $LASTEXITCODE). Manuel kurun: https://git-scm.com/download/win"
    }

    # PATH'i yenilemek icin
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')

    if (Get-Command git -ErrorAction SilentlyContinue) {
        Ok "Git kuruldu: $(git --version)"
    } else {
        Fatal "Git kuruldu ama PATH'de bulunamiyor. PowerShell'i yeniden baslatip tekrar deneyin."
    }
}

# ============================================================================
# 3/5  Docker Desktop kontrol + kurulum
# ============================================================================
Step "3/5  Docker Desktop kontrol ediliyor..."

$dockerInstalled = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $dockerInstalled = $true
    Ok "Docker komutu mevcut."
}

if (-not $dockerInstalled -and $SkipDockerInstall) {
    Fatal "Docker yok ama -SkipDockerInstall belirtildi. Docker'i kurun ve tekrar deneyin."
}

if (-not $dockerInstalled) {
    Info "Docker Desktop bulunamadi. winget ile kuruluyor (Docker.DockerDesktop)..."
    Info "Bu islem 5-10 dakika surebilir; indirme boyutu yaklasik 500 MB."
    Warn "DIKKAT: Docker Desktop kurulumu sonrasi Windows yeniden baslatma isteyebilir."

    winget install --id Docker.DockerDesktop -e --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Fatal "Docker Desktop kurulumu basarisiz (exit: $LASTEXITCODE). Manuel kurun: https://www.docker.com/products/docker-desktop"
    }
    Ok "Docker Desktop kuruldu."

    # PATH'i yenile
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Hr
        Warn "============================================================"
        Warn "  ONEMLI: Docker Desktop kuruldu ama PATH'e eklenmedi."
        Warn ""
        Warn "  Lutfen su adimlari yapin:"
        Warn "  1) Windows'u YENIDEN BASLATIN (WSL2 etkinlestirme icin)"
        Warn "  2) Docker Desktop'i baslatin (Baslat menusu -> Docker Desktop)"
        Warn "  3) Docker Desktop hosgeldin ekranini gecin (kayit/lisans onayi)"
        Warn "  4) Sistem tepsisinde Docker yesil/calisir oldugunu dogrulayin"
        Warn "  5) Bu kurulumu yeniden baslatin:"
        Warn "     install_client_windows.bat'a tekrar cift tiklayin"
        Warn "============================================================"
        try { Stop-Transcript | Out-Null } catch { }
        Read-Host "  Devam etmek icin Enter'a basin"
        exit 0
    }
}

# Docker daemon calisiyor mu?
Info "Docker daemon kontrol ediliyor..."
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Warn "Docker komutu bulundu ama daemon calismiyor."
    Warn "Docker Desktop'i baslatin (Baslat menusu -> Docker Desktop)."
    Warn "Sistem tepsisinde 'Docker Desktop is running' yesil yazisini bekleyin."
    Write-Host ""

    $maxWait = 120
    $elapsed = 0
    Info "Docker baslamasi icin $maxWait saniye beklenecek..."
    while ($elapsed -lt $maxWait) {
        Start-Sleep -Seconds 5
        $elapsed += 5
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Ok "Docker daemon calisir hale geldi."
            break
        }
        Write-Host -NoNewline "."
    }
    Write-Host ""

    if ($LASTEXITCODE -ne 0) {
        Fatal "Docker daemon $maxWait saniye icinde baslatilmadi. Docker Desktop'i manuel baslatip tekrar deneyin."
    }
} else {
    Ok "Docker daemon hazir: $(docker --version)"
}

# ============================================================================
# 4/5  Repo klonu
# ============================================================================
Step "4/5  Repo klonlaniyor: $InstallRoot"

$RepoUrl = 'https://github.com/kbulent07/mailtrustai.git'
$Branch  = 'mainpaketler'

if (Test-Path $InstallRoot) {
    if (Test-Path (Join-Path $InstallRoot '.git')) {
        Info "Repo zaten mevcut. Guncelleme yapiliyor..."
        Push-Location $InstallRoot
        try {
            git fetch origin $Branch
            if ($LASTEXITCODE -ne 0) { Fatal "git fetch basarisiz." }
            git checkout $Branch 2>&1 | Out-Null
            git pull --ff-only origin $Branch
            if ($LASTEXITCODE -ne 0) { Fatal "git pull basarisiz (divergent history?)." }
            Ok "Repo guncel: $(git rev-parse --short HEAD)"
        } finally {
            Pop-Location
        }
    } else {
        Fatal "$InstallRoot var ama git repo'su degil. Once silin: Remove-Item -Recurse -Force '$InstallRoot'"
    }
} else {
    Info "Klonlaniyor: $RepoUrl ($Branch)..."
    git clone -b $Branch $RepoUrl $InstallRoot
    if ($LASTEXITCODE -ne 0) {
        Fatal "git clone basarisiz (exit: $LASTEXITCODE). Internet baglantinizi kontrol edin."
    }
    Ok "Repo klonlandi: $InstallRoot"
}

# ============================================================================
# 5/5  Asil musteri kurulumunu calistir
# ============================================================================
Step "5/5  Musteri kurulum scripti baslatiliyor..."

$InstallScript = Join-Path $InstallRoot 'install\client\install_client_windows_setup.ps1'
if (-not (Test-Path $InstallScript)) {
    Fatal "Kurulum scripti bulunamadi: $InstallScript"
}

# Parametreleri ilet
$psArgs = @(
    '-ExecutionPolicy', 'Bypass',
    '-NoProfile',
    '-File', $InstallScript
)
if ($LicenseKey)       { $psArgs += @('-LicenseKey', $LicenseKey) }
if ($LicenseServerUrl) { $psArgs += @('-LicenseServerUrl', $LicenseServerUrl) }

Info "Komut: powershell $($psArgs -join ' ')"
Hr

# Transcript'i kapat (asil script kendi log'unu acacak)
try { Stop-Transcript | Out-Null } catch { }

# Asil script'i CALL et (yeni process degil — ayni pencerede)
& powershell.exe @psArgs
$installExit = $LASTEXITCODE

# Yeniden transcript ac (ozet icin)
try { Start-Transcript -Path $BootstrapLog -Append | Out-Null } catch { }

Hr
if ($installExit -eq 0) {
    Ok "Kurulum scripti basariyla tamamlandi."
    Write-Host ""
    Write-Color "  ============================================================" 'Green'
    Write-Color "  ===              KURULUM TAMAMLANDI                      ===" 'Green'
    Write-Color "  ============================================================" 'Green'
    Write-Host ""
    Info "Repo  : $InstallRoot"
    Info "Log   : $BootstrapLog"
    Info "Ctl   : C:\MailTrustAI\mailtrustai-ctl.ps1 status"
} else {
    Warn "Kurulum scripti hata ile cikti (exit: $installExit)."
    Info "Detay icin install log'una bakin: $env:TEMP\mailtrustai-install-*.log"
}

try { Stop-Transcript | Out-Null } catch { }
