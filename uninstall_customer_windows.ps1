<#
================================================================================
  MailTrustAI - Windows MUSTERI Kurulum Kaldirma Scripti
  Surum   : 1.0  (2026-05)

  Bu script install_customer_windows.ps1 tarafindan yapilan kurulumu kaldirir:
    - docker-compose.customer.yml ile baslatilan konteynerler
    - Windows Firewall kurallari (3000/tcp, 4443/tcp)
    - Istege bagli: C:\MailTrustAI dizini ve Docker volume'leri

  Kullanim:
    PowerShell'i YONETICI olarak ac:
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
      .\uninstall_customer_windows.ps1

  Parametreler:
    -InstallDir   Kurulum dizini  (varsayilan: C:\MailTrustAI)
    -HttpPort     Dis HTTP portu  (varsayilan: 3000)
    -HttpsPort    Dis HTTPS portu (varsayilan: 4443)
    -Purge        Onay sormadan TUM veriyi sil
    -Keep         Onay sormadan veriyi koru
================================================================================
#>

[CmdletBinding()]
param(
    [string]$InstallDir = "C:\MailTrustAI",
    [int]   $HttpPort   = 3000,
    [int]   $HttpsPort  = 4443,
    [switch]$Purge,
    [switch]$Keep
)

$ErrorActionPreference = "Stop"

$ComposeFile = "docker-compose.customer.yml"

# ── Yardimci fonksiyonlar ───────────────────────────────────────────────────
function Write-Step($msg)  { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Info($msg)  { Write-Host "[INFO] $msg" -ForegroundColor Blue }
function Write-Ok($msg)    { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[ERR]  $msg" -ForegroundColor Red }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-DockerReady {
    try {
        & docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Red
Write-Host "|  MailTrustAI - MUSTERI Kurulum Kaldirma  (Windows / Docker)  |" -ForegroundColor Red
Write-Host "+==============================================================+" -ForegroundColor Red
Write-Host ""

if (-not (Test-Admin)) {
    Write-Err "Bu script Yonetici olarak calistirilmalidir."
    exit 1
}

# Mod belirleme
if ($Purge -and $Keep) {
    Write-Err "-Purge ve -Keep ayni anda kullanilamaz."
    exit 1
}

if (-not $Purge -and -not $Keep) {
    Write-Host "Bu islem MailTrustAI musteri kurulumunu durduracak ve sistemden kaldiracak." -ForegroundColor Yellow
    $confirm = Read-Host "Devam edilsin mi? [e/H]"
    if ($confirm -notmatch '^[Ee]$') {
        Write-Info "Iptal edildi."
        exit 0
    }
}

# ── 1) Docker konteynerleri ─────────────────────────────────────────────────
Write-Step "[1/4] Docker konteynerleri durduruluyor"

if ((Test-Path "$InstallDir\$ComposeFile") -and (Test-DockerReady)) {
    Push-Location $InstallDir
    try {
        & docker compose -f $ComposeFile down --remove-orphans 2>$null
        Write-Ok "Konteynerler durduruldu (docker compose down)."
    } catch {
        Write-Warn "docker compose down hata verdi: $_"
    } finally {
        Pop-Location
    }
} else {
    Write-Info "Docker veya $InstallDir\$ComposeFile bulunamadi - bu adim atlaniyor."
}

# Bilinen container'lari zorla temizle
if (Test-DockerReady) {
    foreach ($c in @("mailtrustai-customer", "mailtrustai-customer-nginx")) {
        $exists = (& docker ps -a --format "{{.Names}}") -contains $c
        if ($exists) {
            & docker rm -f $c 2>$null | Out-Null
            Write-Info "Konteyner zorla silindi: $c"
        }
    }
}

# ── 2) Windows Firewall ─────────────────────────────────────────────────────
Write-Step "[2/4] Windows Firewall kurallari"

foreach ($port in @($HttpPort, $HttpsPort)) {
    $ruleName = "MailTrustAI-Customer-TCP-$port"
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($rule) {
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        Write-Ok "Firewall kurali silindi: $ruleName"
    } else {
        Write-Info "Firewall kurali bulunamadi: $ruleName"
    }
}

# ── 3) Veri / dizin / volume / imaj ─────────────────────────────────────────
Write-Step "[3/4] Veri ve Docker artifaktlari"

$doPurge = $Purge.IsPresent

if (-not $doPurge -and -not $Keep.IsPresent) {
    Write-Host ""
    Write-Host "Asagidaki kalici veriler silinsin mi? (GERI ALINAMAZ)" -ForegroundColor Yellow
    Write-Host "  - $InstallDir  (.env, nginx config, SSL sertif.)"
    Write-Host "  - Docker volume: mailtrustai_data, mailtrustai_logs  (SQLite DB)"
    Write-Host "  - Docker imajlari (mailtrustai-* prefix'li)"
    Write-Host ""
    $purgeChoice = Read-Host "Silinsin mi? [e/H]"
    $doPurge = ($purgeChoice -match '^[Ee]$')
}

if ($doPurge) {
    if (Test-Path $InstallDir) {
        try {
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
            Write-Ok "Uygulama dizini silindi: $InstallDir"
        } catch {
            Write-Warn "$InstallDir silinemedi: $_"
            Write-Warn "Manuel silmeyi deneyin: Remove-Item -Path $InstallDir -Recurse -Force"
        }
    }

    if (Test-DockerReady) {
        $knownVolumes = @(
            "mailtrustai_data", "mailtrustai_logs",
            "mailtrustai_mailtrustai_data", "mailtrustai_mailtrustai_logs",
            "mailtrustai-customer_mailtrustai_data", "mailtrustai-customer_mailtrustai_logs"
        )
        $existing = & docker volume ls -q
        foreach ($v in $knownVolumes) {
            if ($existing -contains $v) {
                & docker volume rm $v 2>$null | Out-Null
                Write-Info "Volume silindi: $v"
            }
        }

        # mailtrustai-* prefix'li imajlari sil
        $images = & docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -match '^mailtrustai' }
        if ($images) {
            foreach ($img in $images) {
                & docker rmi -f $img 2>$null | Out-Null
            }
            Write-Info "Docker imajlari temizlendi."
        }
    }

    Write-Ok "Tum musteri kurulumu verileri kaldirildi."
} else {
    Write-Info "Veriler KORUNDU."
    Write-Info "  - $InstallDir\ ve veritabani yerinde."
    Write-Info "  - Yeniden kurmak icin install_customer_windows.ps1 calistirin."
}

# ── 4) Docker Desktop (opsiyonel uyari) ─────────────────────────────────────
Write-Step "[4/4] Docker Desktop"
Write-Info "Docker Desktop baska konteynerleri etkileyebileceginden otomatik kaldirilmaz."
Write-Info "Tamamen kaldirmak icin:"
Write-Info "  winget uninstall Docker.DockerDesktop"

Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host "|        Kaldirma Islemi Basariyla Tamamlandi                  |" -ForegroundColor Green
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host ""
