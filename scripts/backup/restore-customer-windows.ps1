# ============================================================
# MailTrustAI Customer -- Windows Docker Geri Yukleme
#
# Kullanim (yedek dizini belirt):
#   .\scripts\backup\restore-customer-windows.ps1 -BackupDir "C:\MailTrustAI\backups\2026-05-24_152000"
#
# Kullanim (secim menusu -- yedek dizini verilmezse):
#   .\scripts\backup\restore-customer-windows.ps1
#   -> C:\MailTrustAI\backups\ taranir, tarihli klasorler listelenir, secim yapilir
#
# Farkli kurulum dizini:
#   .\scripts\backup\restore-customer-windows.ps1 -InstallDir "D:\MailTrustAI"
# ============================================================

param(
    [string]$BackupDir  = '',
    [string]$InstallDir = 'C:\MailTrustAI'
)

$ErrorActionPreference = 'Stop'

Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host '  MailTrustAI Customer -- Geri Yukleme' -ForegroundColor Cyan
Write-Host '===========================================================' -ForegroundColor Cyan

# --- Yedek dizini belirlenmemisse listele ve sec ----------------
if (-not $BackupDir) {
    $backupsRoot = Join-Path $InstallDir 'backups'

    if (-not (Test-Path $backupsRoot)) {
        Write-Host " HATA: Yedek klasoru bulunamadi: $backupsRoot" -ForegroundColor Red
        Write-Host " Once yedek alin: .\scripts\backup\backup-customer-windows.ps1" -ForegroundColor Yellow
        exit 1
    }

    # Gecerli yedek klasorlerini bul (.env ve customer-data.tar.gz icerenleri)
    $candidates = Get-ChildItem $backupsRoot -Directory |
        Where-Object {
            (Test-Path (Join-Path $_.FullName '.env')) -and
            (Test-Path (Join-Path $_.FullName 'customer-data.tar.gz'))
        } |
        Sort-Object Name -Descending

    if ($candidates.Count -eq 0) {
        Write-Host " HATA: $backupsRoot altinda gecerli yedek bulunamadi." -ForegroundColor Red
        Write-Host " Gecerli yedek = .env + customer-data.tar.gz iceren klasor." -ForegroundColor Yellow
        exit 1
    }

    Write-Host ''
    Write-Host ' Mevcut yedekler (en yeni ustte):' -ForegroundColor Cyan
    Write-Host ''

    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $c = $candidates[$i]
        $dataSize = [Math]::Round((Get-Item (Join-Path $c.FullName 'customer-data.tar.gz')).Length / 1048576, 1)
        Write-Host ("  [{0}] {1}  ({2} MB)" -f ($i + 1), $c.Name, $dataSize) -ForegroundColor White
    }

    Write-Host ''
    $choice = Read-Host "  Geri yuklenecek yedegi secin [1-$($candidates.Count)] (iptal: Enter)"

    if ([string]::IsNullOrWhiteSpace($choice)) {
        Write-Host ' Iptal edildi.' -ForegroundColor Yellow
        exit 0
    }

    $idx = 0
    if (-not [int]::TryParse($choice, [ref]$idx) -or $idx -lt 1 -or $idx -gt $candidates.Count) {
        Write-Host " HATA: Gecersiz secim: $choice" -ForegroundColor Red
        exit 1
    }

    $BackupDir = $candidates[$idx - 1].FullName
    Write-Host ''
    Write-Host " Secilen yedek: $BackupDir" -ForegroundColor Cyan
}

# --- Yedek icerigini dogrula ------------------------------------
$BackupDir  = (Resolve-Path $BackupDir).Path
$EnvBackup  = Join-Path $BackupDir '.env'
$DataBackup = Join-Path $BackupDir 'customer-data.tar.gz'

if (-not (Test-Path $EnvBackup))  { Write-Host " HATA: $EnvBackup yok"  -ForegroundColor Red; exit 1 }
if (-not (Test-Path $DataBackup)) { Write-Host " HATA: $DataBackup yok" -ForegroundColor Red; exit 1 }

$EnvFile     = Join-Path $InstallDir '.env'
$ComposeFile = Join-Path $InstallDir 'docker-compose.customer.yml'

if (-not (Test-Path $ComposeFile)) {
    Write-Host " HATA: Compose dosyasi bulunamadi: $ComposeFile" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host ' Kaynak : ' -NoNewline; Write-Host $BackupDir -ForegroundColor Yellow
Write-Host ' Hedef  : ' -NoNewline; Write-Host $InstallDir -ForegroundColor Yellow
Write-Host ''

$confirm = Read-Host " Geri yukleme baslasin mi? Mevcut veri SILINECEK. [e/H]"
if ($confirm -notmatch '^[EeYy]') {
    Write-Host ' Iptal edildi.' -ForegroundColor Yellow
    exit 0
}

Write-Host ''

# --- 1) Container durdur ----------------------------------------
Write-Host ' [1/4] Container durduruluyor...'
$running = docker ps --format '{{.Names}}' 2>$null | Select-String -Pattern '^mailtrustai-customer$'
if ($running) {
    docker compose --env-file $EnvFile -f $ComposeFile down
    Write-Host '  [OK] Container durduruldu.' -ForegroundColor Green
} else {
    Write-Host '  Container zaten calismiyor.' -ForegroundColor Gray
}

# --- 2) Mevcut .env yedekle, sonra geri yukle -------------------
Write-Host ' [2/4] .env geri yukleniyor...'
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'backups') | Out-Null
if (Test-Path $EnvFile) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    Copy-Item $EnvFile (Join-Path $InstallDir "backups\.env.before-restore-$stamp") -Force
    Write-Host "  Mevcut .env yedeklendi: .env.before-restore-$stamp" -ForegroundColor Gray
}
Copy-Item $EnvBackup $EnvFile -Force
Write-Host '  [OK] .env geri yuklendi.' -ForegroundColor Green

# --- 3) Volume temizle + geri yukle ----------------------------
Write-Host ' [3/4] Volume geri yukleniyor...'
$volume = 'mailtrustai-customer_customer-data'
docker volume create $volume | Out-Null

$cleanCmd   = 'rm -rf /data/* /data/.[!.]* 2>/dev/null || true'
$restoreCmd = 'cd /data && tar xzf /backup/customer-data.tar.gz'

docker run --rm -v "${volume}:/data" alpine sh -c $cleanCmd
docker run --rm -v "${volume}:/data" -v "${BackupDir}:/backup:ro" alpine sh -c $restoreCmd

if ($LASTEXITCODE -ne 0) {
    Write-Host ' HATA: Volume geri yuklenemedi.' -ForegroundColor Red
    exit 1
}
Write-Host '  [OK] Volume geri yuklendi.' -ForegroundColor Green

# --- 4) Container baslat ----------------------------------------
Write-Host ' [4/4] Container baslatiliyor...'
docker compose --env-file $EnvFile -f $ComposeFile up -d
Start-Sleep -Seconds 8
docker compose --env-file $EnvFile -f $ComposeFile ps

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Green
Write-Host ' [OK] Geri yukleme tamam.' -ForegroundColor Green
Write-Host ' Uygulama: http://localhost:3000' -ForegroundColor Green
Write-Host '===========================================================' -ForegroundColor Green
