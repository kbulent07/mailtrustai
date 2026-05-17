<#
================================================================================
  MailTrustAI - Musteri Kurulum Scripti (Windows) - v2.0 (3-tier)
  Hedef   : Windows 10/11 + Docker Desktop (WSL 2 backend)

  Musteri host'unda SADECE customer container'i calisir.
  Bayi/license-server kodu image'a fiziksel olarak GIRMEZ.

  Kullanim (interaktif):
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
    .\install_customer_windows.ps1

  Kullanim (sessiz):
    .\install_customer_windows.ps1 -Yes `
        -LicenseKey "MTAI-PRO-XXXX-XXXX" `
        -RemoteUrl  "https://license.bayiniz.com"
================================================================================
#>
[CmdletBinding()]
param(
    [switch]$Yes,
    [string]$LicenseKey = "",
    [string]$RemoteUrl  = "",
    [int]   $CustomerPort = 3000,
    [string]$InstallDir = "C:\MailTrustAI",
    [string]$RepoUrl    = "https://github.com/kbulent07/mailtrustai.git",
    [string]$Branch     = "mainpaketler"
)
$ErrorActionPreference = "Stop"

$ComposeFile = "docker-compose.customer.yml"
$EnvFile     = ".env.docker"

function Write-Step($m) { Write-Host "`n[STEP] $m" -ForegroundColor Cyan }
function Write-Info($m) { Write-Host "[INFO] $m" -ForegroundColor Blue }
function Write-Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Err($m)  { Write-Host "[ERR]  $m" -ForegroundColor Red }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function New-RandomHex([int]$Bytes) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

# ── Banner ──
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  MailTrustAI - Musteri Kurulumu (Customer-only)" -ForegroundColor Cyan
Write-Host "  Bayi/Lisans Sunucusu AYRI bir host'tadir." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Admin kontrol ──
if (-not (Test-Admin)) {
    Write-Err "Bu scripti YONETICI PowerShell'de calistirin."
    exit 1
}

# ── Etkilesimli soru: lisans + URL ──
if ([string]::IsNullOrWhiteSpace($LicenseKey) -and -not $Yes) {
    $LicenseKey = Read-Host "Bayiden aldiginiz lisans key (MTAI-...)"
}
if ([string]::IsNullOrWhiteSpace($RemoteUrl) -and -not $Yes) {
    $RemoteUrl = Read-Host "Bayi sunucu URL'i (default: https://license.mailtrustai.com)"
    if ([string]::IsNullOrWhiteSpace($RemoteUrl)) { $RemoteUrl = "https://license.mailtrustai.com" }
}
if ([string]::IsNullOrWhiteSpace($LicenseKey)) { Write-Err "LicenseKey zorunlu."; exit 1 }
if ([string]::IsNullOrWhiteSpace($RemoteUrl))  { Write-Err "RemoteUrl zorunlu."; exit 1 }
if ($RemoteUrl -notmatch "^https?://") {
    Write-Err "RemoteUrl http:// veya https:// ile baslamali."
    exit 1
}

# ── 1) Docker Desktop ──
Write-Step "1/5 Docker Desktop kontrolu"
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Warn "Docker komutu PATH'te yok."
    Write-Info "Docker Desktop kuruldu mu? https://www.docker.com/products/docker-desktop"
    Write-Info "Kurulduktan sonra bilgisayari yeniden baslatip bu scripti tekrar calistirin."
    exit 1
}
try { docker info 2>$null | Out-Null }
catch {
    Write-Err "Docker Desktop calismiyor. Baslatip tekrar deneyin."
    exit 1
}
Write-Ok "Docker calisiyor: $(docker version --format '{{.Server.Version}}')"

# Compose plugin
$composeCheck = docker compose version 2>$null
if (-not $composeCheck) {
    Write-Err "Docker Compose plugin bulunamadi. Docker Desktop guncel olmali."
    exit 1
}

# Git
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Err "git PATH'te yok. https://git-scm.com/downloads adresinden indirin."
    exit 1
}

# ── 2) Repo clone / pull ──
Write-Step "2/5 Repo: $InstallDir"
if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Info "Mevcut repo guncelleniyor..."
    git -C $InstallDir fetch --quiet origin
    git -C $InstallDir checkout --quiet $Branch
    git -C $InstallDir pull --quiet origin $Branch
} else {
    if (-not (Test-Path (Split-Path $InstallDir -Parent))) {
        New-Item -ItemType Directory -Path (Split-Path $InstallDir -Parent) -Force | Out-Null
    }
    git clone --quiet --branch $Branch $RepoUrl $InstallDir
}
Set-Location $InstallDir
$gitHash = (git rev-parse --short HEAD)
Write-Ok "Repo hazir: $gitHash"

# ── 3) .env.docker ──
Write-Step "3/5 .env.docker uretimi"
$envPath = Join-Path $InstallDir $EnvFile
$existingEnv = Test-Path $envPath

if ($existingEnv) {
    if (-not $Yes) {
        $ans = Read-Host "$EnvFile mevcut. Yeniden uretilsin mi? (mevcut secret'lar yedeklenir) [e/H]"
        if ($ans -match "^[eE]$") {
            $bk = "$envPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Move-Item $envPath $bk
            Write-Warn "Eski .env yedeklendi: $bk"
            $existingEnv = $false
        }
    } else {
        Write-Warn "$EnvFile mevcut - KORUNUYOR."
    }
}

if (-not $existingEnv) {
    $setupToken = New-RandomHex 24
    $envContent = @"
# Auto-generated by install_customer_windows.ps1 on $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')

MSA_LICENSE_KEY=$LicenseKey
MSA_LICENSE_REMOTE_URL=$RemoteUrl
MSA_CENTRAL_SYNC_URL=$RemoteUrl
MSA_CENTRAL_SYNC_ENABLED=true

MSA_HEARTBEAT_INTERVAL_SECONDS=300
MSA_POLICY_SYNC_INTERVAL_SECONDS=900

MSA_LOCAL_ENCRYPTION_KEY=$(New-RandomHex 32)
MSA_ENC_PASSWORD=$(New-RandomHex 32)
MSA_ENC_SALT=$(New-RandomHex 32)
MSA_LICENSE_SECRET=$(New-RandomHex 32)

MSA_SETUP_TOKEN=$setupToken

CUSTOMER_PORT=$CustomerPort
"@
    Set-Content -Path $envPath -Value $envContent -Encoding utf8
    Write-Ok "$envPath olusturuldu."
    $setupTokenOut = $setupToken
} else {
    $setupTokenOut = (Get-Content $envPath | Where-Object { $_ -match "^MSA_SETUP_TOKEN=" } |
                      ForEach-Object { ($_ -split "=", 2)[1] }) -join ""
}

# ── 4) Build + up ──
Write-Step "4/5 Docker image build + up"
docker compose --env-file $envPath -f $ComposeFile build --pull
if ($LASTEXITCODE -ne 0) { Write-Err "Build basarisiz."; exit 1 }
docker compose --env-file $envPath -f $ComposeFile up -d
Start-Sleep -Seconds 10
docker compose --env-file $envPath -f $ComposeFile ps

# ── 5) Windows servis kaydi (Task Scheduler) ──
Write-Step "5/5 Otomatik baslatma (Task Scheduler)"
$startupScript = Join-Path $InstallDir "start-customer.ps1"
@"
# Auto-generated startup script
`$maxWait = 120; `$waited = 0
while (-not (docker info 2>`$null)) {
    Start-Sleep -Seconds 5
    `$waited += 5
    if (`$waited -ge `$maxWait) { exit 1 }
}
Set-Location "$InstallDir"
docker compose --env-file $envPath -f $ComposeFile up -d --remove-orphans
"@ | Set-Content -Path $startupScript -Encoding utf8

$taskName = "MailTrustAI-Customer"
$action   = New-ScheduledTaskAction -Execute "powershell.exe" `
                -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$startupScript`""
$trigger  = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT60S"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Description "MailTrustAI Customer (3-tier)" -Force | Out-Null
Write-Ok "Task Scheduler kuruldu: $taskName (sistem baslangicinda otomatik)."

# ── Ozet ──
$ipAddr = (Get-NetIPAddress -AddressFamily IPv4 |
           Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
           Select-Object -First 1 -ExpandProperty IPAddress) -as [string]
if (-not $ipAddr) { $ipAddr = "localhost" }

Write-Host ""
Write-Host "============= KURULUM TAMAM =============" -ForegroundColor Green
Write-Host "Musteri panel: http://${ipAddr}:$CustomerPort" -ForegroundColor White
Write-Host ""
Write-Host "ILK GIRIS:" -ForegroundColor Yellow
Write-Host "  http://${ipAddr}:$CustomerPort/?setup_token=$setupTokenOut"
Write-Host "  (e-posta + sifre belirle, admin kullanici olustur)"
Write-Host ""
Write-Host "Sonraki girisler: http://${ipAddr}:$CustomerPort"
Write-Host ""
Write-Host "Komutlar:"
Write-Host "  docker compose --env-file $envPath -f $ComposeFile logs -f"
Write-Host "  docker compose --env-file $envPath -f $ComposeFile down"
Write-Host "  docker compose --env-file $envPath -f $ComposeFile restart"
Write-Host ""
Write-Host "GUVENLIK:"
Write-Host "  - $envPath dosyasini guvenli sakla (lisans + crypto keys)"
Write-Host "  - Setup tamamlandiktan sonra MSA_SETUP_TOKEN env'ini silebilirsin"
