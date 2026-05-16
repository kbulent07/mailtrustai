<#
================================================================================
  MailTrustAI - Windows MUSTERI Kurulum Scripti (Docker Desktop)
  Surum   : 1.0  (2026-05)
  Hedef   : Windows 10 / 11  ve  Windows Server 2019 / 2022 (Docker Desktop)

  Bu script bir MUSTERI kurulumu yapar:
    - /keygen.html ve /bayi.html paneller KAPALI
    - /api/dealer/* ve lisans-uretici API'leri KAPALI
    - Yalniz musteri yonetim paneli (index.html) acik

  Kullanim:
    PowerShell'i YONETICI olarak ac, sonra:

      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
      .\install_customer_windows.ps1

  Parametreler:
    -InstallDir   Kurulum dizini       (varsayilan: C:\MailTrustAI)
    -HttpPort     Dis HTTP portu       (varsayilan: 3000)
    -HttpsPort    Dis HTTPS portu      (varsayilan: 4443)
    -RepoUrl      Git deposu           (varsayilan: kbulent07/mailtrustai)
    -SkipDocker   Docker Desktop kurulumunu atla (zaten kuruluysa)
================================================================================
#>

[CmdletBinding()]
param(
    [string]$InstallDir = "C:\MailTrustAI",
    [int]   $HttpPort   = 3000,
    [int]   $HttpsPort  = 4443,
    [string]$RepoUrl    = "https://github.com/kbulent07/mailtrustai.git",
    [string]$Branch     = "main",
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"

# Sabitler
$ComposeFile = "docker-compose.customer.yml"
$ProjectName = "mailtrustai-customer"

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

function New-RandomHex([int]$Bytes) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

function Replace-EnvLine([string]$File, [string]$Key, [string]$Value) {
    $content = Get-Content -Path $File -Raw
    $pattern = "(?m)^$([Regex]::Escape($Key))=.*$"
    $replacement = "$Key=$Value"
    if ($content -match $pattern) {
        $content = [Regex]::Replace($content, $pattern, $replacement)
    } else {
        $content = $content.TrimEnd("`r","`n") + "`r`n$replacement`r`n"
    }
    # UTF-8 (no BOM) - dotenv okuyabilsin
    [IO.File]::WriteAllText($File, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function Wait-Health([string]$Url, [int]$TimeoutSec = 90) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        try {
            $r = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Cyan
Write-Host "|  MailTrustAI - MUSTERI Kurulum  (Windows / Docker Desktop)   |" -ForegroundColor Cyan
Write-Host "|  (keygen ve bayi panelleri devre disi)                       |" -ForegroundColor Cyan
Write-Host "+==============================================================+" -ForegroundColor Cyan
Write-Host ""

# ── On kontroller ───────────────────────────────────────────────────────────
if (-not (Test-Admin)) {
    Write-Err "Bu script Yonetici olarak calistirilmalidir."
    Write-Err "PowerShell'i 'Yonetici olarak calistir' ile acin."
    exit 1
}
Write-Ok "Yonetici hakki dogrulandi."

$winVer = [System.Environment]::OSVersion.Version
Write-Ok "Windows $($winVer.Major).$($winVer.Minor) build $($winVer.Build)"

# ── Adim 1: Git ─────────────────────────────────────────────────────────────
Write-Step "[1/8] Git kontrolu"
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Warn "Git bulunamadi. winget ile kuruluyor..."
    try {
        winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
        # PATH'i yenile (yeni baslayan oturumda gorunmesi icin)
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path","User")
    } catch {
        Write-Err "Git kurulamadi: $_"
        Write-Err "Lutfen elle kurun: https://git-scm.com/download/win"
        exit 1
    }
}
$gitVer = (& git --version) 2>$null
Write-Ok "Git: $gitVer"

# ── Adim 2: Docker Desktop ──────────────────────────────────────────────────
Write-Step "[2/8] Docker Desktop kontrolu"
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd -and -not $SkipDocker) {
    Write-Warn "Docker bulunamadi. winget ile Docker Desktop kuruluyor..."
    try {
        winget install --id Docker.DockerDesktop -e --silent --accept-package-agreements --accept-source-agreements
    } catch {
        Write-Err "Docker Desktop kurulamadi: $_"
        Write-Err "Lutfen elle kurun: https://www.docker.com/products/docker-desktop"
        exit 1
    }
    Write-Warn "Docker Desktop kuruldu. Lutfen Docker Desktop'i baslatin ve WSL2 backend'i etkin oldugundan emin olun, ardindan bu scripti tekrar calistirin."
    exit 0
}

# Docker daemon erisilebilir mi?
$dockerOk = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        & docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break }
    } catch { }
    if ($i -eq 1) { Write-Info "Docker daemon bekleniyor (Docker Desktop calisiyor olmali)..." }
    Start-Sleep -Seconds 2
}
if (-not $dockerOk) {
    Write-Err "Docker daemon erisilemiyor. Docker Desktop'i baslatip tekrar deneyin."
    exit 1
}
Write-Ok "Docker: $(& docker --version)"

# Compose v2 kontrolu
try { & docker compose version | Out-Null } catch {
    Write-Err "Docker Compose v2 bulunamadi. Docker Desktop'i guncelleyin."
    exit 1
}
Write-Ok "Docker Compose: $(& docker compose version --short)"

# ── Adim 3: Proje dizini ────────────────────────────────────────────────────
Write-Step "[3/8] Proje dizini: $InstallDir"

if (Test-Path "$InstallDir\.git") {
    Write-Info "Mevcut depo guncelleniyor..."
    & git -C $InstallDir fetch --depth 1 origin $Branch
    & git -C $InstallDir reset --hard "origin/$Branch"
} elseif (Test-Path $InstallDir) {
    $contents = Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue
    if ($contents) {
        Write-Warn "$InstallDir bos degil - git klonu atlaniyor."
    } else {
        & git clone --branch $Branch --depth 1 $RepoUrl $InstallDir
    }
} else {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    & git clone --branch $Branch --depth 1 $RepoUrl $InstallDir
}

Set-Location $InstallDir

if (-not (Test-Path $ComposeFile)) {
    Write-Err "$ComposeFile bulunamadi; depodaki guncel surumu kullandiginizdan emin olun."
    exit 1
}
Write-Ok "Proje hazir: $InstallDir"

# ── Adim 4: data / logs / nginx dizinleri ──────────────────────────────────
Write-Step "[4/8] Veri / log / nginx dizinleri olusturuluyor"
foreach ($d in @("data","logs","nginx\certs","nginx\webroot")) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Write-Ok "Dizinler hazir."

# ── Adim 5: .env olusturma ─────────────────────────────────────────────────
Write-Step "[5/8] .env hazirlaniyor"

$SetupToken = ""

if (Test-Path .env) {
    Write-Warn ".env zaten mevcut - mevcut degerler korunacak."
    $existing = Get-Content -Path .env -Raw
    $m = [Regex]::Match($existing, "(?m)^MSA_SETUP_TOKEN=(.*)$")
    if ($m.Success) { $SetupToken = $m.Groups[1].Value.Trim() }
    Replace-EnvLine ".env" "MSA_CUSTOMER_ONLY" "true"
} else {
    if (-not (Test-Path .env.example)) {
        Write-Err ".env.example bulunamadi."
        exit 1
    }
    Copy-Item .env.example .env

    $EncPassword       = New-RandomHex 32
    $EncSalt           = New-RandomHex 16
    $LicenseSecret     = New-RandomHex 32
    $AdminTokenSecret  = New-RandomHex 32
    $SetupToken        = New-RandomHex 24

    Replace-EnvLine ".env" "MSA_ENC_PASSWORD"        $EncPassword
    Replace-EnvLine ".env" "MSA_ENC_SALT"            $EncSalt
    Replace-EnvLine ".env" "MSA_LICENSE_SECRET"      $LicenseSecret
    Replace-EnvLine ".env" "MSA_ADMIN_TOKEN_SECRET"  $AdminTokenSecret
    Replace-EnvLine ".env" "MSA_SETUP_TOKEN"         $SetupToken
    Replace-EnvLine ".env" "MSA_CUSTOMER_ONLY"       "true"
    Replace-EnvLine ".env" "NODE_ENV"                "production"

    # .env'i ACL ile sadece Yoneticiler+SYSTEM okuyabilsin
    try {
        $acl = Get-Acl .env
        $acl.SetAccessRuleProtection($true, $false)
        $admins = New-Object System.Security.Principal.NTAccount("BUILTIN\Administrators")
        $system = New-Object System.Security.Principal.NTAccount("NT AUTHORITY\SYSTEM")
        $allow  = [System.Security.AccessControl.FileSystemRights]::FullControl
        $type   = [System.Security.AccessControl.AccessControlType]::Allow
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins,$allow,$type)))
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system,$allow,$type)))
        Set-Acl -Path .env -AclObject $acl
    } catch {
        Write-Warn ".env ACL ayarlanamadi: $_"
    }

    Write-Ok ".env olusturuldu (MUSTERI modu)."
    Write-Warn "ONEMLI: MSA_LICENSE_SECRET degerini guvenli yedekleyin."
}

# Eski initial_creds.json varsa temizle
if (Test-Path "data\initial_creds.json") {
    Remove-Item "data\initial_creds.json" -Force
    Write-Info "Eski initial_creds.json silindi."
}

# ── Adim 6: Windows Firewall kurallari ─────────────────────────────────────
Write-Step "[6/8] Windows Firewall kurallari"
foreach ($port in @($HttpPort, $HttpsPort)) {
    $ruleName = "MailTrustAI-Customer-TCP-$port"
    $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $port -Profile Any | Out-Null
        Write-Ok "Firewall kurali eklendi: TCP $port"
    } else {
        Write-Info "Firewall kurali zaten var: TCP $port"
    }
}

# ── Adim 7: Docker imajini derle ve baslat ─────────────────────────────────
Write-Step "[7/8] Docker imaji derleniyor ve baslatiliyor"
Write-Info "Ilk derleme birkac dakika surebilir (native npm build)..."

& docker compose -f $ComposeFile build --pull
if ($LASTEXITCODE -ne 0) { Write-Err "docker compose build basarisiz."; exit 1 }

& docker compose -f $ComposeFile up -d --remove-orphans
if ($LASTEXITCODE -ne 0) { Write-Err "docker compose up basarisiz."; exit 1 }

Write-Ok "Konteyner calisiyor."

# Docker Desktop'in 'restart=always' policy'si Windows yeniden baslatildiginda
# konteynerlari otomatik baslatir. Ek bir Windows Service'e gerek yok.

# ── Adim 8: Saglik kontrolu ────────────────────────────────────────────────
Write-Step "[8/8] Saglik kontrolu"
$healthUrl = "http://127.0.0.1:$HttpPort/api/health"
if (Wait-Health -Url $healthUrl -TimeoutSec 90) {
    Write-Ok "Saglik kontrolu BASARILI - uygulama hazir."
} else {
    Write-Warn "Saglik kontrolu zaman asimi."
    Write-Warn "Loglar: cd $InstallDir; docker compose -f $ComposeFile logs --tail=80"
}

# Customer-mode dogrulama
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$HttpPort/keygen.html" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    Write-Warn "MUSTERI modu beklenen sekilde calismiyor - /keygen.html HTTP $($r.StatusCode) dondu (404 olmaliydi)."
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 404) {
        Write-Ok "MUSTERI modu dogrulandi: /keygen.html -> 404"
    } else {
        Write-Warn "/keygen.html -> $code"
    }
}

# ── Ozet ────────────────────────────────────────────────────────────────────
$LocalIPs = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
             Select-Object -ExpandProperty IPAddress -First 1)
if (-not $LocalIPs) { $LocalIPs = "localhost" }

Write-Host ""
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host "|        Musteri Kurulumu Basariyla Tamamlandi!                |" -ForegroundColor Green
Write-Host "+==============================================================+" -ForegroundColor Green
Write-Host ""

Write-Host "Erisim Adresleri:" -ForegroundColor White
Write-Host "  Musteri Yonetimi : http://$($LocalIPs):$HttpPort/"
Write-Host "  HTTPS            : https://$($LocalIPs):$HttpsPort/  (SSL kurulduktan sonra)"
Write-Host ""
Write-Host "KAPALI panel/uc noktalar (404):" -ForegroundColor White
Write-Host "  /keygen.html, /bayi.html"
Write-Host "  /api/dealer/*"
Write-Host "  /api/license/generate, /trial, /revoke, /unrevoke, /batch ..."

if ($SetupToken) {
    Write-Host ""
    Write-Host "+==============================================================+" -ForegroundColor Yellow
    Write-Host "|         ILK KURULUM - UZAKTAN SIFRE BELIRLEME                |" -ForegroundColor Yellow
    Write-Host "+==============================================================+" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Asagidaki URL'ye tarayicidan baglanip musteri yonetim sifresini"
    Write-Host "  KENDINIZ belirleyin:"
    Write-Host ""
    Write-Host "    http://$($LocalIPs):$HttpPort/?setup_token=$SetupToken" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Setup Token: $SetupToken"
    Write-Host ""
    Write-Host "  Sifre belirlendikten sonra:"
    Write-Host "    1) $InstallDir\.env icindeki MSA_SETUP_TOKEN satirini bosaltin"
    Write-Host "    2) docker compose -f $ComposeFile restart"
}

Write-Host ""
Write-Host "Yonetim Komutlari (PowerShell - $InstallDir altinda):" -ForegroundColor White
Write-Host "  Durum   : docker compose -f $ComposeFile ps"
Write-Host "  Loglar  : docker compose -f $ComposeFile logs -f"
Write-Host "  Yenile  : docker compose -f $ComposeFile restart"
Write-Host "  Durdur  : docker compose -f $ComposeFile down"
Write-Host "  Baslat  : docker compose -f $ComposeFile up -d"
Write-Host ""

Write-Host "Onemli Dosyalar:" -ForegroundColor White
Write-Host "  Uygulama : $InstallDir"
Write-Host "  .env     : $InstallDir\.env"
Write-Host "  Nginx    : $InstallDir\nginx\nginx.conf"
Write-Host "  SSL      : $InstallDir\nginx\certs\"
Write-Host ""
