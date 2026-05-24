# ============================================================
# MailTrustAI Customer — Windows Docker Geri Yukleme
#
# Kullanim:
#   .\scripts\backup\restore-customer.ps1 -BackupDir "C:\MailTrustAI\backups\2026-05-24_152000"
#
#   Farkli kurulum dizini:
#   .\scripts\backup\restore-customer.ps1 -BackupDir "..." -InstallDir "D:\MailTrustAI"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupDir,
    [string]$InstallDir = 'C:\MailTrustAI'
)

$ErrorActionPreference = 'Stop'
$BackupDir  = (Resolve-Path $BackupDir).Path

$EnvBackup  = Join-Path $BackupDir '.env'
$DataBackup = Join-Path $BackupDir 'customer-data.tar.gz'

if (-not (Test-Path $EnvBackup))  { Write-Host "HATA: $EnvBackup yok"  -ForegroundColor Red; exit 1 }
if (-not (Test-Path $DataBackup)) { Write-Host "HATA: $DataBackup yok" -ForegroundColor Red; exit 1 }

$EnvFile     = Join-Path $InstallDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.customer.yml'

if (-not (Test-Path $ComposeFile)) {
    Write-Host "HATA: Compose dosyasi bulunamadi: $ComposeFile" -ForegroundColor Red
    exit 1
}

Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host " Geri Yukleme Baslıyor" -ForegroundColor Cyan
Write-Host " Kaynak : $BackupDir" -ForegroundColor Cyan
Write-Host " Hedef  : $InstallDir" -ForegroundColor Cyan
Write-Host '===========================================================' -ForegroundColor Cyan

# --- 1) Container durdur ----------------------------------------
$Running = docker ps --format '{{.Names}}' 2>$null | Select-String -Pattern '^mailtrustai-customer$'
if ($Running) {
    Write-Host ' > Container durduruluyor...'
    docker compose --env-file $EnvFile -f $ComposeFile down
}

# --- 2) Mevcut .env yedekle, sonra geri yukle -------------------
if (Test-Path $EnvFile) {
    $Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    Copy-Item $EnvFile (Join-Path $InstallDir "backups\.env.before-restore-$Stamp") -Force
    Write-Host " > Mevcut .env yedeklendi (.env.before-restore-$Stamp)"
}
Copy-Item $EnvBackup $EnvFile -Force
Write-Host ' [OK] .env geri yuklendi' -ForegroundColor Green

# --- 3) Volume temizle + geri yukle ----------------------------
$Volume = 'mailtrustai-customer_customer-data'
docker volume create $Volume | Out-Null

Write-Host ' > Volume icerigi temizleniyor...'
docker run --rm -v "${Volume}:/data" alpine sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null || true'

Write-Host ' > customer-data.tar.gz aciliyor...'
docker run --rm `
    -v "${Volume}:/data" `
    -v "${BackupDir}:/backup:ro" `
    alpine `
    sh -c 'cd /data && tar xzf /backup/customer-data.tar.gz'
Write-Host ' [OK] Volume geri yuklendi' -ForegroundColor Green

# --- 4) Container baslat ----------------------------------------
Write-Host ' > Container baslatiliyor...'
docker compose --env-file $EnvFile -f $ComposeFile up -d

Start-Sleep -Seconds 8
docker compose --env-file $EnvFile -f $ComposeFile ps

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Green
Write-Host ' [OK] Geri yukleme tamam. http://localhost:3000' -ForegroundColor Green
Write-Host '===========================================================' -ForegroundColor Green
