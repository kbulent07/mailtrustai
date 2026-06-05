#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI - Windows Musteri NATIVE Kaldirma (Docker'siz)

.DESCRIPTION
    NSSM Windows Service'i durdurur/kaldirir. -Purge ile veriler de silinir.

.PARAMETER InstallDir
    Kurulum dizini. Varsayilan: C:\MailTrustAI
.PARAMETER Purge
    Tum verileri (.env, data, kurulum dizini) SIL. GERI ALINAMAZ!
.PARAMETER DeleteBackups
    -Purge ile birlikte: yedekleri de sil.
.PARAMETER Unattended
    Onay sorularini atla.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install\client\windows\uninstall-native-windows.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install\client\windows\uninstall-native-windows.ps1 -Purge
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\MailTrustAI',
    [switch]$Purge,
    [switch]$DeleteBackups,
    [switch]$Unattended
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ServiceName = 'MailTrustAI'

function Write-Color($m, $c='White') { Write-Host $m -ForegroundColor $c }
function Info($m) { Write-Color "  [BILGI]  $m" 'Cyan' }
function Ok($m)   { Write-Color "  [OK]     $m" 'Green' }
function Warn($m) { Write-Color "  [UYARI]  $m" 'Yellow' }
function Fatal($m){ Write-Color "  [HATA]   $m" 'Red'; exit 1 }
function Hr()     { Write-Color ('-' * 56) 'DarkCyan' }

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik Yonetici yetkisiyle calistirilmalidir."
}

Write-Host ""
Write-Color "  ==============================================================" 'Red'
Write-Color "  ===      MailTrustAI - Windows NATIVE Kaldirma            ===" 'Red'
Write-Color "  ==============================================================" 'Red'
Write-Host ""
if ($Purge) { Write-Color "  PURGE MODU: Tum veriler silinecek - GERI ALINAMAZ!" 'Red'; Write-Host "" }

if (-not (Test-Path $InstallDir)) {
    Warn "Kurulum dizini bulunamadi: $InstallDir"
    if (-not $Unattended) { $InstallDir = Read-Host "  Kurulum dizini (tam yol)" }
}

if ($Purge -and -not $Unattended) {
    $c = Read-Host "  Tum veriler silinecek. Devam icin 'EVET SIL' yazin"
    if ($c -ne 'EVET SIL') { Info "Iptal edildi."; exit 0 }
} elseif (-not $Purge -and -not $Unattended) {
    Read-Host "  Servis kaldirilacak, veriler korunacak. Enter (Ctrl+C iptal)" | Out-Null
}

# --- Servisi durdur/kaldir ---
Hr
$NssmExe = Join-Path $InstallDir 'nssm.exe'
# Iki mod da temizlenir: NSSM/sc Windows Service VE Zamanlanmis Gorev.
$removed = $false

# 1) Windows Service (NSSM ile kurulduysa)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Info "Windows Service durduruluyor/kaldiriliyor: $ServiceName"
    if (Test-Path $NssmExe) {
        & $NssmExe stop $ServiceName 2>$null | Out-Null
        & $NssmExe remove $ServiceName confirm 2>$null | Out-Null
    } else {
        & sc.exe stop $ServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 2
        & sc.exe delete $ServiceName 2>$null | Out-Null
    }
    Start-Sleep -Seconds 2
    Ok "Windows Service kaldirildi."
    $removed = $true
}

# 2) Zamanlanmis Gorev (NSSM indirilemediginde kullanilan yedek)
$task = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
if ($task) {
    Info "Zamanlanmis Gorev durduruluyor/kaldiriliyor: $ServiceName"
    Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue
    Ok "Zamanlanmis Gorev kaldirildi."
    $removed = $true
}

if (-not $removed) {
    Warn "Servis/gorev bulunamadi: $ServiceName (zaten kaldirilmis olabilir)."
}

# --- Firewall kurallari ---
Get-NetFirewallRule -DisplayName 'MailTrustAI-Native-TCP-*' -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-NetFirewallRule -DisplayName $_.DisplayName -ErrorAction SilentlyContinue
    Info "Firewall kurali kaldirildi: $($_.DisplayName)"
}

# --- SOFT: .env yedegi ---
$EnvFile = Join-Path $InstallDir '.env'
if (-not $Purge -and (Test-Path $EnvFile)) {
    $b = Join-Path $InstallDir 'backups'
    New-Item -ItemType Directory -Force -Path $b | Out-Null
    Copy-Item $EnvFile (Join-Path $b ".env.pre-uninstall.$(Get-Date -Format 'yyyyMMdd_HHmmss')") -Force
    Ok "Env yedegi alindi (veriler korunuyor)."
}

# --- PURGE ---
if ($Purge) {
    if (-not $DeleteBackups -and (Test-Path (Join-Path $InstallDir 'backups'))) {
        Get-ChildItem $InstallDir -Force -Exclude 'backups' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Ok "Kurulum silindi, yedekler korundu: $InstallDir\backups"
    } elseif (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Ok "Kurulum dizini silindi: $InstallDir"
    }
}

Hr
Write-Host ""
Ok "Kaldirma tamamlandi."
if (-not $Purge) { Write-Color "  Veriler korundu: $InstallDir" 'Yellow' }
Write-Color "  Not: Node.js ve Git sistemde birakildi (baska uygulamalar kullanabilir)." 'Cyan'
Write-Host ""
