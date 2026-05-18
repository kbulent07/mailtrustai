#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI — Windows Müşteri Kurulum Betiği

.DESCRIPTION
    Müşteri tarafı Docker konteynerini (port 3000) kurar.
    Gereksinim: Windows 10/11 (64-bit), Docker Desktop 4.x+, 4 GB RAM

.PARAMETER LicenseKey
    Bayinizden aldığınız lisans anahtarı (ör: MSA-XXXX-XXXX-XXXX).

.PARAMETER LicenseServerUrl
    License-server'ın genel URL'i (ör: https://license.firma.com).

.PARAMETER InstallDir
    Kurulum dizini. Varsayılan: C:\MailTrustAI

.PARAMETER Port
    Müşteri arayüzü port numarası. Varsayılan: 3000

.PARAMETER ImageFile
    Bayinizden aldığınız Docker image tar dosyasının yolu.
    Verilmezse kaynak koddan derleme yapılır.

.PARAMETER SkipBuild
    Image zaten yüklü ve build atlanacaksa kullanın.

.EXAMPLE
    # Etkileşimli kurulum (en basit yol):
    powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1

    # Parametrelerle:
    powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
        -LicenseKey "MSA-XXXX-XXXX-XXXX" `
        -LicenseServerUrl "https://license.firma.com"

    # Hazır image tar dosyasıyla:
    powershell -ExecutionPolicy Bypass -File install\client\install_windows_user.ps1 `
        -ImageFile "C:\Downloads\mailtrustai-customer.tar"
#>

[CmdletBinding()]
param(
    [string]$LicenseKey       = '',
    [string]$LicenseServerUrl = '',
    [string]$InstallDir       = 'C:\MailTrustAI',
    [int]   $Port             = 3000,
    [string]$ImageFile        = '',
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─── Yardımcı fonksiyonlar ───────────────────────────────────────────────────
function Write-Color($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }
function Info($msg)    { Write-Color "  [BILGI]  $msg" 'Cyan' }
function Ok($msg)      { Write-Color "  [OK]     $msg" 'Green' }
function Warn($msg)    { Write-Color "  [UYARI]  $msg" 'Yellow' }
function Fatal($msg)   { Write-Color "  [HATA]   $msg" 'Red'; exit 1 }
function Hr()          { Write-Color ('─' * 56) 'DarkCyan' }
function Step($msg)    { Write-Host ""; Write-Color "▶ $msg" 'White' }

function New-RandomHex([int]$bytes = 32) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $bytes
    $rng.GetBytes($buf)
    $rng.Dispose()
    return ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

function New-RandomBase64([int]$bytes = 24) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $bytes
    $rng.GetBytes($buf)
    $rng.Dispose()
    return [Convert]::ToBase64String($buf) -replace '[/+=]','' | ForEach-Object { $_.Substring(0, [Math]::Min(28, $_.Length)) }
}

function Read-Input($prompt, $default = '') {
    # `return if (...) { ... }` PowerShell 5.1'de parse hatasi verir.
    # Klasik if/else ile yazilmali.
    if ($default) {
        $result = Read-Host "  $prompt [$default]"
        if ([string]::IsNullOrWhiteSpace($result)) { return $default }
        return $result
    }
    return Read-Host "  $prompt"
}

# Native exe exit kodunu zorla kontrol et. PowerShell try/catch
# native exe'ler icin exception firlatmaz ($ErrorActionPreference=Stop
# yalnizca cmdlet'leri etkiler). LASTEXITCODE 0 degilse Fatal cagir.
function Assert-NativeOk($cmdLabel) {
    if ($LASTEXITCODE -ne 0) {
        Fatal "$cmdLabel basarisiz (exit code: $LASTEXITCODE)"
    }
}

# ─── Banner ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Color "  ╔══════════════════════════════════════════════════════╗" 'Cyan'
Write-Color "  ║     MailTrustAI  —  Müşteri Kurulum Betiği          ║" 'Cyan'
Write-Color "  ║         Windows / Docker Desktop tabanlı             ║" 'Cyan'
Write-Color "  ╚══════════════════════════════════════════════════════╝" 'Cyan'
Write-Host ""

# ─── 1. Yönetici yetkisi kontrolü ───────────────────────────────────────────
Step "Yönetici yetkisi kontrol ediliyor..."
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Warn "Bu betik yönetici (Administrator) yetkisiyle çalıştırılmalıdır."
    Warn "PowerShell'i 'Yönetici olarak çalıştır' ile açın ve tekrar deneyin."
    Fatal "Yetersiz yetki."
}
Ok "Yönetici yetkisi mevcut."

# ─── 2. Docker Desktop kontrolü ─────────────────────────────────────────────
Step "Docker Desktop kontrol ediliyor..."

# Komut bulunabilir mi? (try/catch native exe icin guvenilmez,
# Get-Command kullanmak daha dogru.)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fatal "Docker bulunamadi. Docker Desktop'i kurun: https://www.docker.com/products/docker-desktop"
}

$dockerVersion = docker --version 2>&1
Assert-NativeOk "docker --version"
Ok "Docker bulundu: $dockerVersion"

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fatal "Docker daemon calismiyor. Docker Desktop'i baslatin ve tekrar deneyin."
}
Ok "Docker daemon calisiyor."

# Compose
$composeCmd = 'docker compose'
docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fatal "docker compose plugin bulunamadi. Docker Desktop'i guncelleyin (4.x+)."
}
Ok "Docker Compose hazir."

# ─── 3. Yapılandırma parametreleri ──────────────────────────────────────────
Step "Kurulum yapılandırması..."
Hr

if (-not $LicenseKey) {
    $LicenseKey = Read-Input "Lisans anahtarınız (ör: MSA-XXXX-XXXX-XXXX)"
    if (-not $LicenseKey) { Fatal "Lisans anahtarı zorunludur." }
}

if (-not $LicenseServerUrl) {
    $LicenseServerUrl = Read-Input "License-server URL'i (ör: https://license.firma.com)"
    if (-not $LicenseServerUrl) { Fatal "License-server URL'i zorunludur." }
}
$LicenseServerUrl = $LicenseServerUrl.TrimEnd('/')

$InstallDir       = Read-Input "Kurulum dizini" $InstallDir
$Port             = [int](Read-Input "Uygulama port numarasi" $Port)
# Not: $Hostname PowerShell 7+'da automatic variable, $ContainerHostname kullaniyoruz.
$ContainerHostname = Read-Input "Container hostname (sifreleme anahtari turevinde kullanilir)" "mailtrustai"

# ─── 4. Mevcut kurulum kontrolü ─────────────────────────────────────────────
$EnvFile      = Join-Path $InstallDir '.env'
$ComposeFile  = Join-Path $InstallDir 'docker-compose.customer.yml'
$SkipEnv      = $false

# İlk kurulum mu, güncelleme mi? (OTOMATİK)
# .env zaten varsa → güncelleme: secret'lar DOKUNULMADAN korunur.
# .env yoksa       → ilk kurulum: secret'lar otomatik üretilir.
if (Test-Path $EnvFile) {
    $SkipEnv = $true
    Write-Host ""
    Ok "Mevcut yapılandırma korunuyor (güncelleme modu): $EnvFile"
    Info "Secret'lar değiştirilmeyecek — yalnızca image yeniden derlenecek."
} else {
    Info "İlk kurulum tespit edildi. Secret'lar otomatik üretilecek."
}

# ─── 5. Dizin yapısı ────────────────────────────────────────────────────────
Step "Kurulum dizini oluşturuluyor: $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data') | Out-Null
Ok "Dizin hazır."

# ─── 6. .env oluştur ────────────────────────────────────────────────────────
if (-not $SkipEnv) {
    Step "Güvenli secret'lar üretiliyor..."

    $encPassword  = New-RandomHex 32
    $encSalt      = New-RandomHex 16
    $licSecret    = New-RandomHex 32
    $setupToken   = New-RandomHex 24
    $localEncKey  = New-RandomHex 32

    $envContent = @"
# ============================================================
# MailTrustAI Müşteri Yapılandırması
# Oluşturulma: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
#
# UYARI: Bu dosyayı güvenli yerde yedekleyin!
# ============================================================

# === Lisans Bilgileri ===
MSA_LICENSE_KEY=$LicenseKey
MSA_LICENSE_REMOTE_URL=$LicenseServerUrl
MSA_CENTRAL_SYNC_URL=$LicenseServerUrl
MSA_CENTRAL_SYNC_ENABLED=true
MSA_HEARTBEAT_INTERVAL_SECONDS=300
MSA_POLICY_SYNC_INTERVAL_SECONDS=900

# === Güvenlik Secret'ları (değiştirilmemelidir) ===
MSA_LOCAL_ENCRYPTION_KEY=$localEncKey
MSA_ENC_PASSWORD=$encPassword
MSA_ENC_SALT=$encSalt
MSA_LICENSE_SECRET=$licSecret

# === İlk Kurulum Token'ı ===
# Tarayıcıdan ilk admin kurulumu için:
#   http://localhost:$Port/?setup_token=$setupToken
# Kurulum tamamlandıktan sonra bu satırı boşaltabilirsiniz.
MSA_SETUP_TOKEN=$setupToken

# === Port & Ortam ===
CUSTOMER_PORT=$Port
NODE_ENV=production
TRUST_PROXY=1
"@

    Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8

    # Windows'ta dosya gizlilik ayarı
    try {
        $acl = Get-Acl $EnvFile
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $env:USERNAME, 'FullControl', 'Allow')
        $acl.SetAccessRule($rule)
        Set-Acl $EnvFile $acl
    } catch {
        Warn ".env erişim kısıtlaması ayarlanamadı (devam ediliyor)."
    }

    Ok ".env oluşturuldu → $EnvFile"
    Info "İlk kurulum token'ı: $setupToken"
    Info "Kurulum URL'i: http://localhost:$Port/?setup_token=$setupToken"
} else {
    Ok ".env mevcut → $EnvFile"
}

# ─── 7. docker-compose.customer.yml ─────────────────────────────────────────
Step "Compose dosyası hazırlanıyor..."

# Repo kökünü bul
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$SourceCompose = Join-Path $RepoRoot 'docker-compose.customer.yml'

# Image mod: dış tar dosyası mı, yoksa build mı?
$ImageName = 'mailtrustai-customer:latest'

if ($ImageFile) {
    # Tar'dan yükle — compose'da build yok
    if (-not (Test-Path $ImageFile)) { Fatal "Image dosyası bulunamadı: $ImageFile" }

    Step "Docker image yukleniyor: $ImageFile"
    docker load -i $ImageFile
    Assert-NativeOk "docker load"
    Ok "Image yuklendi."

    # Build context olmayan minimal compose yaz
    $composeContent = @"
# MailTrustAI — Müşteri (pre-built image)
name: mailtrustai-customer

services:
  customer:
    image: $ImageName
    container_name: mailtrustai-customer
    restart: unless-stopped
    hostname: $ContainerHostname
    environment:
      NODE_ENV: production
      PORT: 3000
      MSA_CUSTOMER_ONLY: "true"
      DATA_DIR: /app/data
      LOG_DIR: /app/logs
      MSA_LICENSE_KEY: `${MSA_LICENSE_KEY:-}
      MSA_LICENSE_REMOTE_URL: `${MSA_LICENSE_REMOTE_URL}
      MSA_CENTRAL_SYNC_URL: `${MSA_CENTRAL_SYNC_URL:-`${MSA_LICENSE_REMOTE_URL}}
      MSA_CENTRAL_SYNC_ENABLED: `${MSA_CENTRAL_SYNC_ENABLED:-true}
      MSA_HEARTBEAT_INTERVAL_SECONDS: `${MSA_HEARTBEAT_INTERVAL_SECONDS:-300}
      MSA_POLICY_SYNC_INTERVAL_SECONDS: `${MSA_POLICY_SYNC_INTERVAL_SECONDS:-900}
      MSA_LOCAL_ENCRYPTION_KEY: `${MSA_LOCAL_ENCRYPTION_KEY:-}
      MSA_ENC_PASSWORD: `${MSA_ENC_PASSWORD}
      MSA_ENC_SALT: `${MSA_ENC_SALT}
      MSA_LICENSE_SECRET: `${MSA_LICENSE_SECRET}
      MSA_SETUP_TOKEN: `${MSA_SETUP_TOKEN:-}
      TRUST_PROXY: `${TRUST_PROXY:-1}
    ports:
      - "`${CUSTOMER_PORT:-3000}:3000"
    volumes:
      - customer-data:/app/data
      - customer-logs:/app/logs
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      start_period: 30s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G
        reservations:
          memory: 256M

volumes:
  customer-data:
  customer-logs:
"@
    Set-Content -Path $ComposeFile -Value $composeContent -Encoding UTF8
    Ok "Compose dosyası oluşturuldu (pre-built image modu)."

} elseif (Test-Path $SourceCompose) {
    # Repo'dan kopyala
    Copy-Item -Path $SourceCompose -Destination $ComposeFile -Force
    Ok "Compose dosyası kopyalandı: $ComposeFile"

    if (-not $SkipBuild) {
        Step "Docker image derleniyor (bu 5-15 dakika surebilir)..."
        Set-Location $RepoRoot
        docker compose --env-file $EnvFile -f docker-compose.customer.yml build --pull
        Assert-NativeOk "docker compose build"
        Ok "Image derlendi: $ImageName"
    }
} else {
    Fatal "docker-compose.customer.yml bulunamadı ve --ImageFile belirtilmedi. Repo kökünden çalıştırın."
}

# ─── 8. Konteyneri başlat ────────────────────────────────────────────────────
Step "Konteyner başlatılıyor..."
Set-Location $InstallDir

# Compose'u calistir
Invoke-Expression "docker compose --env-file `"$EnvFile`" -f `"$ComposeFile`" up -d --remove-orphans"
if ($LASTEXITCODE -ne 0) {
    Fatal "docker compose up basarisiz oldu (exit: $LASTEXITCODE). Detay: docker compose -f `"$ComposeFile`" logs"
}
Ok "Konteyner baslatildi."

# ─── 9. Sağlık kontrolü ─────────────────────────────────────────────────────
Step "Sağlık kontrolü (30 saniye bekleniyor)..."
Start-Sleep -Seconds 15

$maxWait  = 60
$elapsed  = 0
$healthy  = $false
while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 5
    $elapsed += 5
    Info "Bekleniyor... ($elapsed/$maxWait saniye)"
}

if ($healthy) {
    Ok "Uygulama çalışıyor: http://localhost:$Port"
} else {
    Warn "Sağlık kontrolü zaman aşımı. Logları inceleyin:"
    Warn "  docker compose -f `"$ComposeFile`" logs --tail=30"
}

# ─── 10. Yönetim scripti oluştur ────────────────────────────────────────────
$ctlScript = Join-Path $InstallDir 'mailtrustai-ctl.ps1'
$ctlContent = @'
# MailTrustAI Müşteri Yönetim Aracı
param([string]$Action = 'help')
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$env  = Join-Path $dir '.env'
$comp = Join-Path $dir 'docker-compose.customer.yml'
$dc   = "docker compose --env-file `"$env`" -f `"$comp`""

switch ($Action) {
    'start'   { Invoke-Expression "$dc up -d" }
    'stop'    { Invoke-Expression "$dc stop" }
    'restart' { Invoke-Expression "$dc restart" }
    'status'  { Invoke-Expression "$dc ps" }
    'logs'    { Invoke-Expression "$dc logs -f --tail=200" }
    'update'  -
    'upgrade' {
        # Tam ozellikli upgrade scriptini cagir
        $repoPath = $null
        $repoFile = Join-Path $dir '.repo_path'
        if (Test-Path $repoFile) { $repoPath = (Get-Content $repoFile -Raw).Trim() }
        $upgradeScript = if ($repoPath) { Join-Path $repoPath 'install\client\upgrade_windows.ps1' } else { $null }
        if ($upgradeScript -and (Test-Path $upgradeScript)) {
            & powershell -ExecutionPolicy Bypass -File $upgradeScript
        } else {
            Write-Host "Upgrade scripti bulunamadi: $upgradeScript" -ForegroundColor Red
            Write-Host "Manuel: docker compose pull; docker compose up -d --remove-orphans" -ForegroundColor Yellow
            Invoke-Expression "$dc pull"
            Invoke-Expression "$dc up -d --remove-orphans"
        }
    }
    'backup'  {
        $ts   = Get-Date -Format 'yyyyMMdd_HHmmss'
        $bdir = Join-Path $dir 'backups'
        New-Item -ItemType Directory -Force -Path $bdir | Out-Null
        Copy-Item $env (Join-Path $bdir ".env.$ts")
        Write-Host "Env yedeği: $bdir\.env.$ts" -ForegroundColor Green
        docker run --rm `
            -v mailtrustai-customer_customer-data:/data `
            -v "${bdir}:/backup" `
            alpine tar czf "/backup/customer-data-$ts.tar.gz" -C /data .
        Write-Host "Veri yedeği: $bdir\customer-data-$ts.tar.gz" -ForegroundColor Green
    }
    default   {
        Write-Host "Kullanim: mailtrustai-ctl.ps1 {start|stop|restart|status|logs|upgrade|backup}"
        Write-Host ""
        Write-Host "  start    - Servisi baslat"
        Write-Host "  stop     - Servisi durdur"
        Write-Host "  restart  - Servisi yeniden baslat"
        Write-Host "  status   - Container durumu"
        Write-Host "  logs     - Loglari takip et"
        Write-Host "  upgrade  - Yeni surume yukselt (git pull + rebuild)"
        Write-Host "  backup   - .env + customer-data yedekle"
    }
}
'@
Set-Content -Path $ctlScript -Value $ctlContent -Encoding UTF8
Ok "Yönetim scripti: $ctlScript"

# Repo yolunu kaydet
Set-Content -Path (Join-Path $InstallDir '.repo_path') -Value $RepoRoot -Encoding UTF8

# ─── 11. Özet ───────────────────────────────────────────────────────────────
Hr
Write-Host ""
Write-Color "  ╔══════════════════════════════════════════════════════╗" 'Green'
Write-Color "  ║           ✓  Kurulum Tamamlandı!                     ║" 'Green'
Write-Color "  ╚══════════════════════════════════════════════════════╝" 'Green'
Write-Host ""
Write-Color "  Uygulama Adresi   : http://localhost:$Port" 'Cyan'

# Setup token göster
if (-not $SkipEnv) {
    $st = Select-String 'MSA_SETUP_TOKEN=(.+)' $EnvFile | ForEach-Object { $_.Matches[0].Groups[1].Value }
    if ($st) {
        Write-Host ""
        Write-Color "  İlk Admin Kurulumu:" 'Yellow'
        Write-Color "  http://localhost:$Port/?setup_token=$st" 'Cyan'
        Write-Color "  (Bu URL'yi tarayıcıda açın ve admin hesabınızı oluşturun)" 'Yellow'
    }
}

Write-Host ""
Write-Color "  Önemli Dosyalar:" 'White'
Write-Color "  ├─ Yapılandırma : $EnvFile" 'Yellow'
Write-Color "  ├─ Compose      : $ComposeFile" 'Yellow'
Write-Color "  └─ Yönetim      : $ctlScript" 'Yellow'
Write-Host ""
Write-Color "  Hızlı Komutlar (PowerShell'de):" 'White'
Write-Color "  ├─ Durum  : & '$ctlScript' status"  'Cyan'
Write-Color "  ├─ Loglar : & '$ctlScript' logs"    'Cyan'
Write-Color "  ├─ Yedek  : & '$ctlScript' backup"  'Cyan'
Write-Color "  └─ Durdur : & '$ctlScript' stop"    'Cyan'
Write-Host ""
Write-Color "  ⚠  .env dosyasını güvenli yerde yedekleyin: $EnvFile" 'Yellow'
Write-Color "  ⚠  Firewall: ${Port}/tcp portunu açın (Güvenlik Duvarı Ayarları)." 'Yellow'
Write-Host ""
Hr
