#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI — Windows Müşteri Kaldırma Betiği

.DESCRIPTION
    Müşteri Docker konteynerini ve (isteğe bağlı olarak) tüm verileri kaldırır.

.PARAMETER InstallDir
    Kurulum dizini. Varsayılan: C:\MailTrustAI

.PARAMETER Purge
    Tüm verileri (volumes, .env, kurulum dizini) SİL.
    GERİ ALINAMAZ — dikkatli kullanın!

.PARAMETER RemoveImage
    Docker image'ını da kaldır (disk alanı geri kazan).

.EXAMPLE
    # Sadece konteyneri kaldır (veriler korunur):
    powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1

    # Her şeyi sil (tam temizlik):
    powershell -ExecutionPolicy Bypass -File install\client\uninstall_windows.ps1 -Purge -RemoveImage
#>

[CmdletBinding()]
param(
    [string]$InstallDir  = 'C:\MailTrustAI',
    [switch]$Purge,
    [switch]$RemoveImage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Color($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function Info($msg)  { Write-Color "  [BILGI]  $msg" 'Cyan' }
function Ok($msg)    { Write-Color "  [OK]     $msg" 'Green' }
function Warn($msg)  { Write-Color "  [UYARI]  $msg" 'Yellow' }
function Fatal($msg) { Write-Color "  [HATA]   $msg" 'Red'; exit 1 }
function Hr()        { Write-Color ('─' * 56) 'DarkCyan' }

# ─── Yönetici kontrolü ───────────────────────────────────────────────────────
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik yönetici (Administrator) yetkisiyle çalıştırılmalıdır."
}

# ─── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Color "  ╔══════════════════════════════════════════════════════╗" 'Red'
Write-Color "  ║     MailTrustAI  —  Müşteri Kaldırma Betiği         ║" 'Red'
Write-Color "  ╚══════════════════════════════════════════════════════╝" 'Red'
Write-Host ""

if ($Purge) {
    Write-Color "  ⚠  PURGE MODU: Tüm veriler silinecek — GERİ ALINAMAZ!" 'Red'
    Write-Host ""
}

# ─── Kurulum dizini doğrula ──────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
    Warn "Kurulum dizini bulunamadı: $InstallDir"
    $InstallDir = Read-Host "  Kurulum dizini (tam yol)"
}

$EnvFile     = Join-Path $InstallDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.customer.yml'

if (-not (Test-Path $ComposeFile)) {
    # Repo içinden dene
    $ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoRoot    = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
    $ComposeFile = Join-Path $RepoRoot 'docker-compose.customer.yml'
}

if (-not (Test-Path $ComposeFile)) {
    Fatal "docker-compose.customer.yml bulunamadı. InstallDir parametresini kontrol edin."
}

# ─── Onay ────────────────────────────────────────────────────────────────────
Write-Host ""
if ($Purge) {
    Write-Color "  ÇOK ÖNEMLİ: Aşağıdakiler kalıcı olarak silinecek:" 'Red'
    Write-Color "  • Docker konteyneri ve volume'ları (tüm tarama verileri)" 'Red'
    Write-Color "  • .env dosyası (tüm secret'lar)" 'Red'
    Write-Color "  • Kurulum dizini: $InstallDir" 'Red'
    Write-Host ""
    $confirm = Read-Host "  Devam etmek için 'EVET SIL' yazın"
    if ($confirm -ne 'EVET SIL') {
        Info "İptal edildi."
        exit 0
    }
} else {
    Write-Color "  Konteyner durdurulacak ve silinecek." 'Yellow'
    Write-Color "  Veriler (volumes, .env) KORUNACAK." 'Yellow'
    Write-Color "  Tüm verileri silmek için: uninstall_windows.ps1 -Purge" 'Yellow'
    Write-Host ""
    Read-Host "  Devam etmek için Enter'a basın (Ctrl+C ile iptal)"
}

# ─── Docker kontrolü ─────────────────────────────────────────────────────────
$dockerOk = $false
try {
    docker info 2>&1 | Out-Null
    $dockerOk = $true
} catch {
    Warn "Docker daemon çalışmıyor. Konteynerler zaten durmuş olabilir."
}

# ─── Konteyneri durdur ve kaldır ─────────────────────────────────────────────
Hr
Info "Konteyner durduruluyor ve kaldırılıyor..."

if ($dockerOk) {
    $envArg = if (Test-Path $EnvFile) { "--env-file `"$EnvFile`"" } else { "" }
    $downArgs = if ($Purge) { "down -v --remove-orphans" } else { "down --remove-orphans" }

    try {
        Invoke-Expression "docker compose $envArg -f `"$ComposeFile`" $downArgs" 2>&1 | Out-Null
        Ok "Konteyner ve ağ kaldırıldı."
    } catch {
        Warn "docker compose down başarısız (zaten silinmiş olabilir): $_"
    }
} else {
    Warn "Docker çalışmıyor, konteyner durumu bilinmiyor — dosya temizliğine geçiliyor."
}

# ─── Image kaldır ────────────────────────────────────────────────────────────
if ($RemoveImage -and $dockerOk) {
    Info "Docker image kaldırılıyor..."
    try {
        docker rmi mailtrustai-customer:latest 2>&1 | Out-Null
        Ok "Image silindi: mailtrustai-customer:latest"
    } catch {
        Warn "Image silinemedi (başka bir şey tarafından kullanılıyor olabilir)."
    }
}

# ─── Purge: dizin ve dosyalar ────────────────────────────────────────────────
if ($Purge) {
    # Yedek klasörü kontrolü
    $backupDir = Join-Path $InstallDir 'backups'
    if (Test-Path $backupDir) {
        $backups = Get-ChildItem $backupDir -ErrorAction SilentlyContinue
        if ($backups.Count -gt 0) {
            Warn "Yedek dosyaları mevcut ($($backups.Count) adet): $backupDir"
            $keepBkp = Read-Host "  Yedekleri koru (sadece kurulum dizinini sil)? [E/h]"
            if ($keepBkp -eq '' -or $keepBkp -match '^[EeYy]') {
                # Yedekler dışındakileri sil
                Get-ChildItem $InstallDir -Exclude 'backups' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
                Ok "Kurulum dosyaları silindi. Yedekler korundu: $backupDir"
                Write-Host ""
                Hr
                Write-Host ""
                Write-Color "  ✓  Kaldırma tamamlandı." 'Green'
                Write-Color "     Yedekler: $backupDir" 'Yellow'
                Write-Host ""
                Hr
                exit 0
            }
        }
    }

    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
        Ok "Kurulum dizini silindi: $InstallDir"
    }
}

# ─── Özet ────────────────────────────────────────────────────────────────────
Hr
Write-Host ""
Write-Color "  ✓  Kaldırma tamamlandı." 'Green'
Write-Host ""

if (-not $Purge) {
    Write-Color "  Veriler korundu: $InstallDir" 'Yellow'
    Write-Color ""
    Write-Color "  Yeniden kurmak için:" 'White'
    Write-Color "  powershell -ExecutionPolicy Bypass -File install\client\install_windows.ps1" 'Cyan'
}

Write-Host ""
Hr
