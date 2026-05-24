# ============================================================
# MailTrustAI Customer — Windows Docker Yedek Scripti
#
# Yeni kurulum / rebuild / Docker upgrade ONCESI calistir.
# C:\MailTrustAI\backups\ altina tarihli klasor birakir:
#   .env                   (lisans + secret'lar — KRITIK)
#   customer-data.tar.gz   (msa.db, settings, enc dosyalari)
#   customer-logs.tar.gz   (loglar — opsiyonel)
#   README.txt             (geri yukleme rehberi)
#
# Kullanim:
#   .\scripts\backup\backup-customer.ps1
#       → C:\MailTrustAI\backups\YYYY-MM-DD_HHMMSS\ altina yeni yedek
#
#   .\scripts\backup\backup-customer.ps1 -TargetDir "C:\MailTrustAI\backups\auto-weekly"
#       → Belirtilen klasore UZERINE YAZAR (haftalik zamanlayici modu)
#
#   .\scripts\backup\backup-customer.ps1 -InstallDir "D:\MailTrustAI"
#       → Farkli kurulum dizini
# ============================================================

param(
    [string]$InstallDir = 'C:\MailTrustAI',
    [string]$TargetDir  = ''   # Bos → zaman damgali yeni klasor. Dolu → uzerine yaz.
)

$ErrorActionPreference = 'Stop'

$Ts = Get-Date -Format 'yyyy-MM-dd_HHmmss'

if ($TargetDir) {
    $BackupDir = $TargetDir
    if (Test-Path $BackupDir) { Remove-Item -Path $BackupDir -Recurse -Force }
    $ModeLabel = 'HAFTALIK (uzerine yaz)'
} else {
    $BackupDir = Join-Path $InstallDir "backups\$Ts"
    $ModeLabel = 'ZAMANLI'
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host " MailTrustAI Customer Yedek [$ModeLabel] - $Ts" -ForegroundColor Cyan
Write-Host " Kaynak : $InstallDir" -ForegroundColor Cyan
Write-Host " Hedef  : $BackupDir" -ForegroundColor Cyan
Write-Host '===========================================================' -ForegroundColor Cyan

# --- 1) .env (EN KRITIK — lisans anahtari + AES secret'lari) -----
$EnvSrc = Join-Path $InstallDir '.env'
if (-not (Test-Path $EnvSrc)) {
    Write-Host " HATA: .env bulunamadi: $EnvSrc" -ForegroundColor Red
    Write-Host " Kurulum dizinini -InstallDir parametresiyle belirtin." -ForegroundColor Yellow
    exit 1
}
Copy-Item $EnvSrc (Join-Path $BackupDir '.env') -Force
Write-Host ' [OK] .env kopyalandi' -ForegroundColor Green

# --- 2) customer-data volume (msa.db, settings, *.enc) -----------
$DataVolume = 'mailtrustai-customer_customer-data'
$null = docker volume inspect $DataVolume 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host " UYARI: Volume '$DataVolume' bulunamadi — atlandi." -ForegroundColor Yellow
} else {
    docker run --rm `
        -v "${DataVolume}:/data:ro" `
        -v "${BackupDir}:/backup" `
        alpine `
        sh -c 'cd /data && tar czf /backup/customer-data.tar.gz .'
    if ($LASTEXITCODE -ne 0) {
        Write-Host ' HATA: customer-data.tar.gz olusturulamadi' -ForegroundColor Red
        exit 1
    }
    $SizeMB = [Math]::Round((Get-Item (Join-Path $BackupDir 'customer-data.tar.gz')).Length / 1MB, 1)
    Write-Host (" [OK] customer-data.tar.gz ({0} MB)" -f $SizeMB) -ForegroundColor Green
}

# --- 3) customer-logs volume (opsiyonel) -------------------------
$LogVolume = 'mailtrustai-customer_customer-logs'
$null = docker volume inspect $LogVolume 2>&1
if ($LASTEXITCODE -eq 0) {
    docker run --rm `
        -v "${LogVolume}:/logs:ro" `
        -v "${BackupDir}:/backup" `
        alpine `
        sh -c 'cd /logs && tar czf /backup/customer-logs.tar.gz . 2>/dev/null || true'
    if (Test-Path (Join-Path $BackupDir 'customer-logs.tar.gz')) {
        Write-Host ' [OK] customer-logs.tar.gz olusturuldu' -ForegroundColor Green
    }
}

# --- 4) README.txt -----------------------------------------------
$Readme = @"
MailTrustAI Customer Yedek — $Ts
================================================================

Dosyalar:
  .env                  -> Lisans + AES secret'lari (KRITIK)
  customer-data.tar.gz  -> msa.db, settings.json, *.enc
  customer-logs.tar.gz  -> Uygulama loglari (opsiyonel)

GERI YUKLEME:
  powershell -ExecutionPolicy Bypass ``
    -File scripts\backup\restore-customer.ps1 ``
    -BackupDir "$BackupDir"

NOT: .env ve customer-data.tar.gz HER ZAMAN BIRLIKTE saklanmalidir.
     Yalniz biri kurtulursa eski sifrelenmis dosyalar acilamaz.
================================================================
"@
Set-Content -Path (Join-Path $BackupDir 'README.txt') -Value $Readme -Encoding utf8

# --- 5) Son 5 yedegi listele -------------------------------------
$BackupsRoot = Join-Path $InstallDir 'backups'
Write-Host ''
Write-Host 'Son yedekler:' -ForegroundColor Cyan
Get-ChildItem $BackupsRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 5 |
    ForEach-Object { Write-Host "  $($_.Name)" }

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Green
Write-Host " [OK] Yedekleme tamam: $BackupDir" -ForegroundColor Green
Write-Host '===========================================================' -ForegroundColor Green
