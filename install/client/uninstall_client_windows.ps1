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
    powershell -ExecutionPolicy Bypass -File install\client\uninstall_client_windows.ps1

    # Her şeyi sil (tam temizlik):
    powershell -ExecutionPolicy Bypass -File install\client\uninstall_client_windows.ps1 -Purge -RemoveImage
#>

[CmdletBinding()]
param(
    [string]$InstallDir  = 'C:\MailTrustAI',
    [switch]$Purge,
    [switch]$RemoveImage,
    # Otomasyon icin: tum prompt'lari atla. -Purge ile birlikte kullanildiginda
    # "EVET SIL" onayini ister, yedek silme sorusunu istemez.
    [switch]$Unattended,
    # -Purge -Unattended ile yedekleri de sil (varsayilan: koru)
    [switch]$DeleteBackups,
    # FULL purge: Docker Desktop'i winget ile kaldir
    # (bootstrap kurulumda winget ile kuruldugu icin uninstall ile temizleyebiliriz)
    [switch]$RemoveDocker,
    # FULL purge: Git'i winget ile kaldir
    [switch]$RemoveGit,
    # FULL purge'da silinecek repo klon dizini (bootstrap'in kullandigi yer)
    [string]$RepoRoot = 'C:\mailtrustai-source'
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
    Write-Color "  COK ONEMLI: Asagidakiler kalici olarak silinecek:" 'Red'
    Write-Color "  - Docker konteyneri ve volume'lari (tum tarama verileri)" 'Red'
    Write-Color "  - .env dosyasi (tum secret'lar)" 'Red'
    Write-Color "  - Kurulum dizini: $InstallDir" 'Red'
    Write-Host ""
    if ($Unattended) {
        Warn "Unattended modda -Purge onaylanmis sayilir."
    } else {
        $confirm = Read-Host "  Devam etmek icin 'EVET SIL' yazin"
        if ($confirm -ne 'EVET SIL') {
            Info "Iptal edildi."
            exit 0
        }
    }
} else {
    Write-Color "  Konteyner durdurulacak ve silinecek." 'Yellow'
    Write-Color "  Veriler (volumes, .env) KORUNACAK." 'Yellow'
    Write-Color "  Tum verileri silmek icin: uninstall_client_windows.ps1 -Purge" 'Yellow'
    Write-Host ""
    if (-not $Unattended) {
        Read-Host "  Devam etmek icin Enter'a basin (Ctrl+C ile iptal)" | Out-Null
    }
}

# ─── Docker kontrolü ─────────────────────────────────────────────────────────
$dockerOk = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $dockerOk = $true
    } else {
        Warn "Docker daemon calismiyor. Konteynerler zaten durmus olabilir."
    }
} else {
    Warn "Docker komutu bulunamadi. Dosya temizligine geciliyor."
}

# ─── SOFT modda .env yedeği al (Purge=false) ─────────────────────────────
if (-not $Purge -and (Test-Path $EnvFile)) {
    $backupDir = Join-Path $InstallDir 'backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
    $envBackup = Join-Path $backupDir ".env.pre-uninstall.$ts"
    Copy-Item $EnvFile $envBackup -Force
    Ok "Env yedegi: $envBackup"
}

# ─── Konteyneri durdur ve kaldır ─────────────────────────────────────────────
Hr
Info "Konteyner durduruluyor ve kaldırılıyor..."

if ($dockerOk) {
    $envArg = if (Test-Path $EnvFile) { "--env-file `"$EnvFile`"" } else { "" }
    $downArgs = if ($Purge) { "down -v --remove-orphans" } else { "down --remove-orphans" }

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        Invoke-Expression "docker compose $envArg -f `"$ComposeFile`" $downArgs" 2>&1 | Out-Null
        Ok "Konteyner ve ağ kaldırıldı."
    } catch {
        Warn "docker compose down başarısız (zaten silinmiş olabilir): $_"
    } finally {
        $ErrorActionPreference = $prev
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
    # Yedek klasoru kontrolu
    $backupDir = Join-Path $InstallDir 'backups'
    if (Test-Path $backupDir) {
        # @() ile array'e zorlanir; null veya tek item durumunda
        # strict mode .Count hatasi olmaz.
        $backups = @(Get-ChildItem $backupDir -ErrorAction SilentlyContinue)
        if ($backups.Count -gt 0) {
            Warn "Yedek dosyalari mevcut ($($backups.Count) adet): $backupDir"
            $keepBkp = $null
            if ($Unattended) {
                # Unattended: DeleteBackups flag'i belirler
                $keepBkp = if ($DeleteBackups) { 'h' } else { 'e' }
                Info "Unattended: yedekler $(if ($DeleteBackups) { 'silinecek' } else { 'korunacak' })."
            } else {
                $keepBkp = Read-Host "  Yedekleri koru (sadece kurulum dizinini sil)? [E/h]"
            }
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

    # Repo klonu (bootstrap C:\mailtrustai-source'a klonlamisti)
    if ($RepoRoot -and (Test-Path $RepoRoot)) {
        try {
            Remove-Item -Path $RepoRoot -Recurse -Force
            Ok "Repo klonu silindi: $RepoRoot"
        } catch {
            Warn "Repo klonu silinemedi: $RepoRoot ($($_.Exception.Message))"
        }
    }

    # FULL purge: Docker Desktop'i kaldir
    if ($RemoveDocker) {
        Hr
        Info "Docker Desktop kaldiriliyor (winget uninstall Docker.DockerDesktop)..."
        Warn "DIKKAT: Sistemde Docker kullanan diger uygulamalar varsa onlar da etkilenecek!"
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                winget uninstall --id Docker.DockerDesktop -e --accept-source-agreements --silent 2>&1 | Out-Null
            } finally {
                $ErrorActionPreference = $prev
            }
            if ($LASTEXITCODE -eq 0) {
                Ok "Docker Desktop kaldirildi."
            } else {
                Warn "Docker Desktop kaldirilamadi (exit: $LASTEXITCODE). Manuel: Apps & Features"
            }
            # Docker'a ait ek klasorler
            $dockerPaths = @(
                "$env:ProgramData\Docker",
                "$env:ProgramData\DockerDesktop",
                "$env:LOCALAPPDATA\Docker",
                "$env:APPDATA\Docker",
                "$env:APPDATA\Docker Desktop"
            )
            foreach ($p in $dockerPaths) {
                if (Test-Path $p) {
                    try { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue; Info "Silindi: $p" } catch {}
                }
            }
        } else {
            Warn "winget yok — Docker manuel kaldirin: Control Panel -> Apps & Features"
        }
    }

    # FULL purge: Git'i kaldir
    if ($RemoveGit) {
        Hr
        Info "Git kaldiriliyor (winget uninstall Git.Git)..."
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            $prev = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
                winget uninstall --id Git.Git -e --accept-source-agreements --silent 2>&1 | Out-Null
            } finally {
                $ErrorActionPreference = $prev
            }
            if ($LASTEXITCODE -eq 0) {
                Ok "Git kaldirildi."
            } else {
                Warn "Git kaldirilamadi (exit: $LASTEXITCODE). Manuel: Apps & Features"
            }
        } else {
            Warn "winget yok — Git manuel kaldirin: Control Panel -> Apps & Features"
        }
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
    Write-Color "  powershell -ExecutionPolicy Bypass -File install\client\install_client_windows_setup.ps1" 'Cyan'
}

Write-Host ""
Hr
