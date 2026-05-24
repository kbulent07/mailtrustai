# ============================================================
# MailTrustAI Customer — Windows PowerShell Yedek Scripti
#
# Yeni kurulum / rebuild / Docker upgrade ONCESI calistir.
# Backups klasorune tarihli klasor + .env.docker (KRITIK) +
# customer-data.tar.gz + customer-logs.tar.gz birakir.
#
# Kullanim:
#   .\scripts\backup-windows-customer.ps1
#       → backups\YYYY-MM-DD_HHMMSS\ altina yeni yedek
#
#   .\scripts\backup-windows-customer.ps1 -TargetDir backups\auto-weekly
#       → Belirtilen klasore UZERINE YAZAR (haftalik zamanlayici modu)
# ============================================================

param(
    [string]$TargetDir = ""   # Bos → zaman damgali yeni klasor.  Dolu → uzerine yaz.
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$Ts       = Get-Date -Format "yyyy-MM-dd_HHmmss"

if ($TargetDir) {
    # Mutlak yol degilse repo-root'a gore coz
    if (-not [System.IO.Path]::IsPathRooted($TargetDir)) {
        $BackupDir = Join-Path $RepoRoot $TargetDir
    } else {
        $BackupDir = $TargetDir
    }
    # Eski yedegi temizle (uzerine yazma modu)
    if (Test-Path $BackupDir) {
        Remove-Item -Path $BackupDir -Recurse -Force
    }
    $ModeLabel = "HAFTALIK (uzerine yaz)"
} else {
    $BackupDir = Join-Path $RepoRoot "backups\$Ts"
    $ModeLabel = "ZAMANLI"
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " MailTrustAI Customer Yedek [$ModeLabel] - $Ts" -ForegroundColor Cyan
Write-Host " Hedef: $BackupDir" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

# --- 1) .env.docker (EN KRITIK - AES anahtarlari) ----------------
$EnvSrc = Join-Path $RepoRoot ".env.docker"
if (-not (Test-Path $EnvSrc)) {
    Write-Host " HATA: .env.docker bulunamadi! Yedek iptal." -ForegroundColor Red
    exit 1
}
Copy-Item $EnvSrc (Join-Path $BackupDir ".env.docker") -Force
Write-Host " [OK] .env.docker kopyalandi" -ForegroundColor Green

# --- 2) customer-data volume (msa.db, settings, *.enc) -----------
$Volume = "mailtrustai-customer_customer-data"
$null = docker volume inspect $Volume 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host " UYARI: Volume $Volume bulunamadi - atlandi." -ForegroundColor Yellow
} else {
    docker run --rm `
        -v "${Volume}:/data:ro" `
        -v "${BackupDir}:/backup" `
        alpine `
        sh -c "cd /data && tar czf /backup/customer-data.tar.gz ."
    if ($LASTEXITCODE -ne 0) { Write-Host " HATA: customer-data tar olusturulamadi" -ForegroundColor Red; exit 1 }
    $Size = (Get-Item (Join-Path $BackupDir "customer-data.tar.gz")).Length / 1MB
    Write-Host (" [OK] customer-data.tar.gz olusturuldu ({0:N1} MB)" -f $Size) -ForegroundColor Green
}

# --- 3) customer-logs volume (opsiyonel) -------------------------
$LogVolume = "mailtrustai-customer_customer-logs"
$null = docker volume inspect $LogVolume 2>&1
if ($LASTEXITCODE -eq 0) {
    docker run --rm `
        -v "${LogVolume}:/logs:ro" `
        -v "${BackupDir}:/backup" `
        alpine `
        sh -c "cd /logs && tar czf /backup/customer-logs.tar.gz . 2>/dev/null || true"
    if (Test-Path (Join-Path $BackupDir "customer-logs.tar.gz")) {
        Write-Host " [OK] customer-logs.tar.gz olusturuldu" -ForegroundColor Green
    }
}

# --- 4) README.txt (geri yukleme rehberi) ------------------------
$Readme = @"
MailTrustAI Customer Yedek - $Ts
================================================================

Bu klasor SU 3 dosyayi icerir:
  - .env.docker             -> AES sifreleme anahtarlari (KRITIK)
  - customer-data.tar.gz    -> msa.db, settings.json, *.enc dosyalari
  - customer-logs.tar.gz    -> Uygulama loglari (opsiyonel)

GERI YUKLEME (PowerShell):
--------------------------
.\scripts\restore-windows-customer.ps1 $BackupDir

GERI YUKLEME (manuel):
1) docker compose --env-file .env.docker -f docker-compose.customer.yml down
2) Copy-Item "$BackupDir\.env.docker" .env.docker -Force
3) docker volume create mailtrustai-customer_customer-data
4) docker run --rm ``
     -v mailtrustai-customer_customer-data:/data ``
     -v "${BackupDir}:/backup:ro" ``
     alpine ``
     sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; cd /data && tar xzf /backup/customer-data.tar.gz"
5) docker compose --env-file .env.docker -f docker-compose.customer.yml up -d

NOT: .env.docker ve customer-data.tar.gz HER ZAMAN BIRLIKTE
saklanmalidir. Yalniz biri kurtulursa eski sifrelenmis dosyalar acilamaz.
================================================================
"@
Set-Content -Path (Join-Path $BackupDir "README.txt") -Value $Readme -Encoding utf8

# --- 5) Mevcut yedekleri listele ---------------------------------
Write-Host ""
Write-Host "Mevcut yedekler:"
Get-ChildItem (Join-Path $RepoRoot "backups") -Directory |
    Sort-Object Name -Descending |
    Select-Object -First 5 |
    ForEach-Object { Write-Host "  - $($_.Name)" }

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " [OK] Yedekleme tamam: $BackupDir" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
