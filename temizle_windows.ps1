<#
================================================================================
  MailTrustAI - Windows TAM VERI TEMIZLEME Scripti
  Surum  : 1.0  (2026-05)

  +======================================================================+
  |  DIKKAT: Bu script MailTrustAI'a ait TUM verileri siler.             |
  |  GERI ALINAMAZ. Yedek aldiginizdan emin olun.                        |
  |  Silinecekler:                                                       |
  |   * Docker konteynerleri + volume'lar + imajlar                     |
  |   * Uygulama dizini (varsayilan: C:\MailTrustAI)                    |
  |   * Windows Firewall kurallari (3000/tcp, 4443/tcp)                 |
  |   * Scheduled Tasks (varsa)                                         |
  |   * Gecici/cache dosyalari                                          |
  +======================================================================+

  Kullanim:
    PowerShell'i YONETICI olarak ac, sonra:
      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
      .\temizle_windows.ps1

  Parametreler:
    -InstallDir      Uygulama dizini       (varsayilan: C:\MailTrustAI)
    -Force           Onay sormaz (CI/CD modu)
    -RemoveDocker    Docker Desktop'i da kaldir (TEHLIKELI)
    -KeepNodeModules node_modules'i sakla  (yerel test icin)
================================================================================
#>

[CmdletBinding()]
param(
    [string]$InstallDir      = "C:\MailTrustAI",
    [int[]] $UfwPorts        = @(3000, 4443),
    [switch]$Force,
    [switch]$RemoveDocker,
    [switch]$KeepNodeModules
)

$ErrorActionPreference = "Continue"  # bir adim hata verse bile devam et

# ----- Yardimci fonksiyonlar -----
function Write-Step($msg)  { Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "  OK    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  ERR   $msg" -ForegroundColor Red }
function Write-InfoLine($msg) { Write-Host "  $msg" -ForegroundColor Gray }

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

# ----- Sabitler -----
$ComposeFiles = @(
    "docker-compose.prod.yml",
    "docker-compose.prod.host-nginx.yml",
    "docker-compose.yml",
    "docker-compose.customer.yml",
    "docker-compose.customer.host-nginx.yml"
)
$ContainerNames = @(
    "mailtrustai-app",
    "mailtrustai-nginx",
    "mailtrustai-dev",
    "mailtrustai-customer",
    "mailtrustai-customer-nginx"
)
$VolumeNames = @(
    "mailtrustai_data",
    "mailtrustai_logs",
    "mailtrustai_mailtrustai_data",
    "mailtrustai_mailtrustai_logs",
    "mailtrustai-customer_mailtrustai_data",
    "mailtrustai-customer_mailtrustai_logs"
)
$FirewallRuleNames = @(
    "MailTrustAI-Customer-TCP-3000",
    "MailTrustAI-Customer-TCP-4443",
    "MailTrustAI-TCP-3000",
    "MailTrustAI-TCP-4443"
)
$ScheduledTaskNames = @(
    "MailTrustAI",
    "MailTrustAI-Customer",
    "MailTrustAI-AutoStart"
)

# ----- Banner -----
Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Red
Write-Host "|     !  MailTrustAI - TAM VERI TEMIZLEME (Windows)  !       |" -ForegroundColor Red
Write-Host "|                                                              |" -ForegroundColor Red
Write-Host "|     BU SCRIPT MAILTRUSTAI'A AIT HER SEYI KALICI OLARAK SILER.|" -ForegroundColor Red
Write-Host "|     GERI ALMA YOK. YEDEK ALDIGINIZDAN EMIN OLUN.            |" -ForegroundColor Red
Write-Host "+==============================================================+" -ForegroundColor Red
Write-Host ""

if (-not (Test-Admin)) {
    Write-Err "Bu script Yonetici olarak calistirilmalidir."
    Write-Err "PowerShell'i 'Yonetici olarak calistir' ile acin."
    exit 1
}

# ----- Tek seferlik onay -----
if (-not $Force) {
    Write-Host "Asagidaki kalici verileri silmek uzeresiniz:" -ForegroundColor Yellow
    Write-Host "  * $InstallDir (kod, .env, SQLite DB, SSL sertif.)"
    Write-Host "  * Docker konteynerleri: $($ContainerNames -join ', ')"
    Write-Host "  * Docker volume'lari (SQLite DB + loglar)"
    Write-Host "  * Docker imajlari (mailtrustai-* prefix'li)"
    Write-Host "  * Windows Firewall kurallari ($($UfwPorts -join ', '))"
    Write-Host "  * Scheduled Tasks (varsa)"
    if ($RemoveDocker) {
        Write-Host "  * Docker Desktop (baska konteynerleri ETKILER!)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Bu islem GERI ALINAMAZ." -ForegroundColor Red
    $confirm = Read-Host "Devam etmek icin 'TEMIZLE' yazin"
    if ($confirm -ne 'TEMIZLE') {
        Write-Host "Iptal edildi."
        exit 0
    }
}

# ----- 1) Docker konteynerleri -----
Write-Step "[1/8] Docker konteynerleri durduruluyor"

if (Test-DockerReady) {
    # Compose dosyalari ile down
    if (Test-Path $InstallDir) {
        Push-Location $InstallDir
        foreach ($cf in $ComposeFiles) {
            if (Test-Path $cf) {
                & docker compose -f $cf down --remove-orphans 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) { Write-Ok "$cf -> down" }
            }
        }
        Pop-Location
    }

    # Bilinen container'lari zorla sil
    foreach ($c in $ContainerNames) {
        $exists = (& docker ps -a --format "{{.Names}}" 2>$null) -contains $c
        if ($exists) {
            & docker rm -f $c 2>$null | Out-Null
            Write-Ok "Konteyner silindi: $c"
        }
    }
} else {
    Write-Warn "Docker erisilemiyor - bu adim atlaniyor."
}

# ----- 2) Docker volume'lari -----
Write-Step "[2/8] Docker volume'lari"

if (Test-DockerReady) {
    $existingVols = & docker volume ls -q 2>$null
    foreach ($v in $VolumeNames) {
        if ($existingVols -contains $v) {
            & docker volume rm $v 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Volume silindi: $v"
            } else {
                Write-Warn "Volume silinemedi: $v (kullanimda olabilir)"
            }
        }
    }
}

# ----- 3) Docker imajlari -----
Write-Step "[3/8] Docker imajlari"

if (Test-DockerReady) {
    $images = & docker images --format "{{.Repository}}:{{.Tag}}" 2>$null | Where-Object { $_ -match '^mailtrustai' }
    if ($images) {
        foreach ($img in $images) {
            & docker rmi -f $img 2>$null | Out-Null
        }
        Write-Ok "Docker imajlari temizlendi (mailtrustai-* prefix'li)."
    } else {
        Write-InfoLine "Silinecek imaj bulunamadi."
    }
    & docker image prune -f 2>$null | Out-Null
}

# ----- 4) Windows Firewall kurallari -----
Write-Step "[4/8] Windows Firewall kurallari"

# Bilinen rule isimleri
foreach ($ruleName in $FirewallRuleNames) {
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($rule) {
        Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        Write-Ok "Firewall kurali silindi: $ruleName"
    }
}

# Genel fallback: $UfwPorts portlarini hedefleyen mailtrustai-* kurallari
foreach ($port in $UfwPorts) {
    $rules = Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like "*MailTrustAI*" -or $_.DisplayName -like "*mailtrustai*" }
    foreach ($r in $rules) {
        Remove-NetFirewallRule -InputObject $r -ErrorAction SilentlyContinue
        Write-Ok "Firewall kurali silindi: $($r.DisplayName)"
    }
}

# ----- 5) Scheduled Tasks (varsa) -----
Write-Step "[5/8] Scheduled Tasks"

foreach ($taskName in $ScheduledTaskNames) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Ok "Scheduled Task silindi: $taskName"
    }
}

# ----- 6) Uygulama dizini -----
Write-Step "[6/8] Uygulama dizini"

if (Test-Path $InstallDir) {
    try {
        if ($KeepNodeModules -and (Test-Path "$InstallDir\node_modules")) {
            Write-InfoLine "node_modules korunuyor (--KeepNodeModules)."
            $tmpNm = Join-Path $env:TEMP "mailtrustai-node_modules-$(Get-Random)"
            Move-Item -Path "$InstallDir\node_modules" -Destination $tmpNm -Force -ErrorAction Stop
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
            New-Item -ItemType Directory -Path $InstallDir | Out-Null
            Move-Item -Path $tmpNm -Destination "$InstallDir\node_modules" -Force
            Write-Ok "Dizin silindi (node_modules saklandi): $InstallDir"
        } else {
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
            Write-Ok "Dizin silindi: $InstallDir"
        }
    } catch {
        Write-Err "Dizin silinemedi: $($_.Exception.Message)"
        Write-Warn "Manuel silmeyi deneyin: Remove-Item -Path $InstallDir -Recurse -Force"
    }
} else {
    Write-InfoLine "Dizin zaten yok: $InstallDir"
}

# Gecici / cache dosyalar
$tempPatterns = @(
    "$env:TEMP\mailtrustai*.log",
    "$env:TEMP\msa-*.json",
    "$env:LOCALAPPDATA\mailtrustai*"
)
foreach ($pattern in $tempPatterns) {
    $files = Get-ChildItem $pattern -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        Remove-Item -Path $f.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "Gecici dosya silindi: $($f.FullName)"
    }
}

# ----- 7) Bilinen Windows servisleri (varsa eskiden NSSM ile kurulduysa) -----
Write-Step "[7/8] Windows Servisleri"

foreach ($svcName in @("MailTrustAI", "mailtrustai")) {
    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
        # NSSM ile kuruldu ise:
        $nssm = Get-Command nssm -ErrorAction SilentlyContinue
        if ($nssm) {
            & nssm remove $svcName confirm | Out-Null
            Write-Ok "Servis kaldirildi (nssm): $svcName"
        } else {
            & sc.exe delete $svcName | Out-Null
            Write-Ok "Servis kaldirildi (sc.exe): $svcName"
        }
    }
}

# ----- 8) Docker Desktop (opsiyonel) -----
Write-Step "[8/8] Docker Desktop"

if ($RemoveDocker) {
    Write-Warn "Docker Desktop kaldiriliyor - BU SISTEMDEKI TUM KONTEYNERLER ETKILENIR!"
    try {
        Stop-Process -Name 'Docker Desktop' -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        & winget uninstall --id Docker.DockerDesktop --silent --accept-source-agreements 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Docker Desktop kaldirildi."
        } else {
            Write-Warn "Docker Desktop kaldirilamadi (winget hata). Manuel kaldirma gerekebilir."
        }
    } catch {
        Write-Err "Docker Desktop kaldirma hatasi: $($_.Exception.Message)"
    }
} else {
    Write-InfoLine "Docker Desktop KORUNDU (-RemoveDocker ile silinebilir)."
}

# ----- Ozet -----
Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host "|          [OK] Temizlik Tamamlandi                            |" -ForegroundColor Green
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host ""

Write-Host "Sistemden tamamen kaldirildi:" -ForegroundColor White
Write-Host "  [OK] Docker konteynerleri + volume'lar + imajlar"
Write-Host "  [OK] Uygulama dizini ($InstallDir)"
Write-Host "  [OK] Windows Firewall kurallari (3000, 4443)"
Write-Host "  [OK] Scheduled Tasks (varsa)"
Write-Host "  [OK] Windows Servisleri (varsa)"
Write-Host "  [OK] Gecici/cache dosyalari"
if ($RemoveDocker) { Write-Host "  [OK] Docker Desktop" }

Write-Host ""
Write-Host "Korunan sistem ogeleri:" -ForegroundColor White
if (-not $RemoveDocker) { Write-Host "  - Docker Desktop (-RemoveDocker ile silinebilir)" }

Write-Host ""
Write-Host "Yeniden kurmak icin:" -ForegroundColor White
Write-Host "  git clone https://github.com/kbulent07/mailtrustai.git $InstallDir"
Write-Host "  cd $InstallDir"
Write-Host "  .\install_customer_windows.ps1"
Write-Host ""
