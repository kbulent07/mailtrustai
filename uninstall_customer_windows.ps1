<#
================================================================================
  MailTrustAI - Windows Musteri Kaldirma Scripti - v2.0 (3-tier)

  Kullanim:
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\uninstall_customer_windows.ps1
    .\uninstall_customer_windows.ps1 -PurgeData
    .\uninstall_customer_windows.ps1 -KeepRepo
================================================================================
#>
[CmdletBinding()]
param(
    [switch]$PurgeData,
    [switch]$KeepRepo,
    [string]$InstallDir = "C:\MailTrustAI"
)
$ErrorActionPreference = "Stop"

$ComposeFile = "docker-compose.customer.yml"
$EnvFile     = ".env.docker"

function Write-Step($m) { Write-Host "`n[STEP] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "[ERR]  $m" -ForegroundColor Red }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Err "YONETICI PowerShell gerekir."
    exit 1
}

Write-Host "Kaldirilacak: $InstallDir"
if ($PurgeData) {
    Write-Warn "DIKKAT: Volume'lar silinecek - IMAP/tarama verisi KAYBOLACAK."
}
$ans = Read-Host "Devam edilsin mi? [e/H]"
if ($ans -notmatch "^[eE]$") { Write-Host "Iptal."; exit 0 }

# 1) Task Scheduler
Write-Step "1/4 Task Scheduler"
$taskName = "MailTrustAI-Customer"
try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Ok "Task kaldirildi: $taskName"
} catch { Write-Warn "Task bulunamadi (zaten silinmis olabilir)." }

# 2) Container down
Write-Step "2/4 Docker container'i durdur"
$envPath = Join-Path $InstallDir $EnvFile
$composePath = Join-Path $InstallDir $ComposeFile
if (Test-Path $composePath) {
    Push-Location $InstallDir
    try {
        if ($PurgeData) {
            docker compose --env-file $envPath -f $ComposeFile down -v --remove-orphans 2>$null
            Write-Ok "Container + volume'lar silindi."
        } else {
            docker compose --env-file $envPath -f $ComposeFile down --remove-orphans 2>$null
            Write-Ok "Container silindi (volume'lar korundu)."
        }
    } finally { Pop-Location }
}

# 3) Image sil
Write-Step "3/4 Customer image'ini sil"
docker rmi -f mailtrustai-customer:latest 2>$null | Out-Null
Write-Ok "Image silindi."

# 4) Repo klasoru
if (-not $KeepRepo -and (Test-Path $InstallDir)) {
    Write-Step "4/4 Repo klasoru sil"
    try {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Ok "$InstallDir kaldirildi."
    } catch { Write-Warn "Klasor silinemedi: $($_.Exception.Message)" }
} elseif (Test-Path $InstallDir) {
    Write-Warn "Repo korundu: $InstallDir"
}

Write-Host ""
Write-Ok "Musteri kurulumu kaldirildi."
