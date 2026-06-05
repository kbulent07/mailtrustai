#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI - Windows Musteri NATIVE Guncelleme (Docker'siz)

.DESCRIPTION
    - .env DOKUNULMAZ (lisans + secret korunur)
    - data/ ve logs/ DOKUNULMAZ
    - git pull + npm install + strip + guvenlik kontrolu + servis restart + health

.PARAMETER InstallDir
    Kurulum dizini. Varsayilan: C:\MailTrustAI
.PARAMETER Unattended
    Sorularsiz mod.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install\client\windows\update-native-windows.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\MailTrustAI',
    [switch]$Unattended
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ServiceName = 'MailTrustAI'
$Branch = 'mainpaketler'

$BackupDir = Join-Path $InstallDir 'backups'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$UpgradeLog = Join-Path $BackupDir "update-native-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
try { Start-Transcript -Path $UpgradeLog -Append | Out-Null } catch { }

function Write-Color($m, $c='White') { Write-Host $m -ForegroundColor $c }
function Info($m) { Write-Color "  [BILGI]  $m" 'Cyan' }
function Ok($m)   { Write-Color "  [OK]     $m" 'Green' }
function Warn($m) { Write-Color "  [UYARI]  $m" 'Yellow' }
function Step($m) { Write-Host ""; Write-Color ">>> $m" 'White' }
function Hr()     { Write-Color ('-' * 56) 'DarkCyan' }
function Fatal($m){ Write-Color "  [HATA]   $m" 'Red'; Write-Color "  Log: $UpgradeLog" 'Yellow'; try { Stop-Transcript | Out-Null } catch {}; exit 1 }

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik Yonetici yetkisiyle calistirilmalidir."
}

Write-Host ""
Write-Color "  === MailTrustAI - Windows NATIVE Guncelleme ===" 'Cyan'
Info "Kurulum: $InstallDir"
Info "Log    : $UpgradeLog"

$EnvFile = Join-Path $InstallDir '.env'
if (-not (Test-Path (Join-Path $InstallDir '.git'))) { Fatal "$InstallDir bir git repo'su degil. Once install-native-windows.ps1 calistirin." }
if (-not (Test-Path $EnvFile)) { Fatal ".env bulunamadi: $EnvFile" }

$NssmExe = Join-Path $InstallDir 'nssm.exe'
# Servis modunu tespit et: nssm.exe varsa NSSM, yoksa Zamanlanmis Gorev.
$ServiceMode = if (Test-Path $NssmExe) { 'nssm' } else { 'task' }
Info "Servis modu: $ServiceMode"

Set-Location $InstallDir

# 1. Yedek
Step "1/6  Yedek aliniyor..."
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item $EnvFile (Join-Path $BackupDir ".env.$ts") -Force
Ok "Env yedegi: $BackupDir\.env.$ts"

# 2. git pull
Step "2/6  Kaynak guncelleniyor (git)..."
$prevCommit = (git rev-parse --short HEAD).Trim()
git fetch --depth 1 origin $Branch
if ($LASTEXITCODE -ne 0) { Fatal "git fetch basarisiz." }
git checkout -q $Branch
git reset --hard "origin/$Branch"
if ($LASTEXITCODE -ne 0) { Fatal "git reset basarisiz." }
$newCommit = (git rev-parse --short HEAD).Trim()
Ok "Surum: $prevCommit -> $newCommit"

# 3. npm install
Step "3/6  Bagimliliklar guncelleniyor..."
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& npm install --omit=dev --no-audit --no-fund --prefix $InstallDir
$npmExit = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($npmExit -ne 0) { Fatal "npm install basarisiz (exit $npmExit)." }
$nmScope = Join-Path $InstallDir 'node_modules\@mailtrustai'
New-Item -ItemType Directory -Force -Path $nmScope | Out-Null
Get-ChildItem (Join-Path $InstallDir 'packages') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $link = Join-Path $nmScope $_.Name
    if (Test-Path $link) { cmd /c rmdir "$link" 2>$null }
    cmd /c mklink /J "$link" "$($_.FullName)" | Out-Null
}
Ok "node_modules guncel."

# 4. strip + guvenlik
Step "4/6  Musteri agaci temizleniyor + guvenlik kontrolu..."
& node (Join-Path $InstallDir 'scripts\strip-customer-tree.js')
if ($LASTEXITCODE -ne 0) { Fatal "strip-customer-tree basarisiz." }
$lcLink = Join-Path $nmScope 'license-core'
if (Test-Path $lcLink) { cmd /c rmdir "$lcLink" 2>$null }
$env:MSA_CUSTOMER_BUILD = '1'
& node (Join-Path $InstallDir 'scripts\check-customer-package.js') --scope=image
if ($LASTEXITCODE -ne 0) { Fatal "GUVENLIK KONTROLU BASARISIZ - guncelleme durduruldu." }
Ok "Guvenlik kontrolu basarili."

# 5. Servis restart
Step "5/6  Servis yeniden baslatiliyor..."
if ($ServiceMode -eq 'nssm') {
    & $NssmExe restart $ServiceName | Out-Null
} else {
    Stop-ScheduledTask  -TaskName $ServiceName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $ServiceName
}
Ok "Servis yeniden baslatildi."

# 6. Saglik
Step "6/6  Saglik kontrolu (max 60s)..."
$portLine = Get-Content $EnvFile | Select-String -Pattern '^PORT=' | Select-Object -First 1
$Port = if ($portLine) { [int](($portLine -replace '^PORT=','').Trim()) } else { 3000 }
$healthy = $false; $elapsed = 0; Start-Sleep -Seconds 5
while ($elapsed -lt 60) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 5; $elapsed += 5
}

Hr
Write-Host ""
if ($healthy) {
    Write-Color "  === GUNCELLEME TAMAMLANDI ($prevCommit -> $newCommit) ===" 'Green'
    Write-Color "  Uygulama: http://localhost:$Port" 'Cyan'
} else {
    Write-Color "  === GUNCELLEME BITTI - SAGLIK KONTROLU EKSIK ===" 'Yellow'
    Warn "Loglar: $InstallDir\logs\service.log"
    Write-Color "  Rollback: cd `"$InstallDir`"; git reset --hard $prevCommit; & nssm.exe restart $ServiceName" 'Cyan'
}
Write-Host ""
try { Stop-Transcript | Out-Null } catch { }
