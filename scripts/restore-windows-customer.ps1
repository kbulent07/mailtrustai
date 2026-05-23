# ============================================================
# MailTrustAI Customer - Windows PowerShell Geri Yukleme
#
# Kullanim:
#   .\scripts\restore-windows-customer.ps1 backups\2026-05-23_211546
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$BackupDir
)

$ErrorActionPreference = "Stop"
$RepoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$BackupDir  = (Resolve-Path $BackupDir).Path

$EnvBackup  = Join-Path $BackupDir ".env.docker"
$DataBackup = Join-Path $BackupDir "customer-data.tar.gz"

if (-not (Test-Path $EnvBackup))  { Write-Host "HATA: $EnvBackup yok"  -ForegroundColor Red; exit 1 }
if (-not (Test-Path $DataBackup)) { Write-Host "HATA: $DataBackup yok" -ForegroundColor Red; exit 1 }

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Geri Yukleme: $BackupDir" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

Set-Location $RepoRoot

# --- 1) Container durdur ----------------------------------------
$Running = docker ps --format '{{.Names}}' | Select-String -Pattern '^mailtrustai-customer$'
if ($Running) {
    Write-Host " > Container durduruluyor..."
    docker compose --env-file .env.docker -f docker-compose.customer.yml down
}

# --- 2) Mevcut .env.docker yedekle, sonra geri yukle ------------
if (Test-Path (Join-Path $RepoRoot ".env.docker")) {
    $Stamp = [int][double]::Parse((Get-Date -UFormat %s))
    Copy-Item ".env.docker" ".env.docker.before-restore-$Stamp" -Force
    Write-Host " > Mevcut .env.docker once .before-restore-$Stamp olarak yedeklendi"
}
Copy-Item $EnvBackup ".env.docker" -Force
Write-Host " [OK] .env.docker geri yuklendi" -ForegroundColor Green

# --- 3) Volume'u temizle + geri yukle ---------------------------
$Volume = "mailtrustai-customer_customer-data"
docker volume create $Volume | Out-Null

Write-Host " > Volume icerigi temizleniyor..."
docker run --rm -v "${Volume}:/data" alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null || true"

Write-Host " > customer-data.tar.gz aciliyor..."
docker run --rm `
    -v "${Volume}:/data" `
    -v "${BackupDir}:/backup:ro" `
    alpine `
    sh -c "cd /data && tar xzf /backup/customer-data.tar.gz"
Write-Host " [OK] Volume geri yuklendi" -ForegroundColor Green

# --- 4) Container basla -----------------------------------------
Write-Host " > Container baslatiliyor..."
docker compose --env-file .env.docker -f docker-compose.customer.yml up -d

Start-Sleep -Seconds 5
docker compose --env-file .env.docker -f docker-compose.customer.yml ps

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " [OK] Geri yukleme tamam. http://localhost:3000" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
