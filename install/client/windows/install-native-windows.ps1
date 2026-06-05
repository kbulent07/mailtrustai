#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI - Windows Musteri NATIVE Kurulum (Docker'siz)

.DESCRIPTION
    Docker KULLANMAZ. Uygulamayi dogrudan Node.js 22 ile bir Windows
    Service (NSSM ile) olarak kurar. Sirayla:
      1) Yonetici + ExecutionPolicy
      2) Node.js 22 LTS (yoksa winget ile) + Git (yoksa winget ile)
      3) Repo'yu InstallDir'e klonlar/gunceller (branch: mainpaketler)
      4) npm install --omit=dev  (workspace + native moduller)
      5) Musteri agacini temizler (keygen/bayi/license-server kodu silinir)
      6) check-customer-package ile guvenlik dogrulamasi
      7) Guvenli .env uretir
      8) NSSM ile Windows Service kurar + baslatir
      9) Firewall + saglik kontrolu (/healthz)

.PARAMETER InstallDir
    Kurulum dizini. Varsayilan: C:\MailTrustAI

.PARAMETER LicenseKey
    Bayinizden aldiginiz lisans anahtari (interaktif de sorulur).

.PARAMETER LicenseServerUrl
    License-server URL'i. Varsayilan: http://licence.mailtrustai.com:3200

.PARAMETER Port
    Uygulama portu. Varsayilan: 3000

.PARAMETER Unattended
    Tum interaktif sorulari atla (installer/bootstrap'tan cagrilirken).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install\client\windows\install-native-windows.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install\client\windows\install-native-windows.ps1 `
        -LicenseKey "MTAI-PRO-XXXX-XXXX" -Unattended
#>

[CmdletBinding()]
param(
    [string]$InstallDir        = 'C:\MailTrustAI',
    [string]$LicenseKey        = '',
    [string]$LicenseServerUrl  = '',
    [int]   $Port              = 3000,
    [switch]$Unattended
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoUrl      = 'https://github.com/kbulent07/mailtrustai.git'
$Branch       = 'mainpaketler'
$ServiceName  = 'MailTrustAI'
$NssmUrl      = 'https://nssm.cc/release/nssm-2.24.zip'

# --- Log ---
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs') | Out-Null
$InstallLog = Join-Path $InstallDir "logs\install-native-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
try { Start-Transcript -Path $InstallLog -Append | Out-Null } catch { }

function Write-Color($msg, $c = 'White') { Write-Host $msg -ForegroundColor $c }
function Info($m)  { Write-Color "  [BILGI]  $m" 'Cyan' }
function Ok($m)    { Write-Color "  [OK]     $m" 'Green' }
function Warn($m)  { Write-Color "  [UYARI]  $m" 'Yellow' }
function Step($m)  { Write-Host ""; Write-Color ">>> $m" 'White' }
function Hr()      { Write-Color ('-' * 56) 'DarkCyan' }
function Fatal($m) {
    Write-Color "  [HATA]   $m" 'Red'
    Write-Color "  Log: $InstallLog" 'Yellow'
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}
trap {
    Write-Host ""
    Write-Color "  ===== KURULUM BASARISIZ =====" 'Red'
    Write-Color "  Hata  : $($_.Exception.Message)" 'Red'
    if ($_.InvocationInfo) { Write-Color "  Satir : $($_.InvocationInfo.ScriptLineNumber)" 'Red' }
    Write-Color "  Log   : $InstallLog" 'Yellow'
    try { Stop-Transcript | Out-Null } catch { }
    exit 1
}

function New-RandomHex([int]$bytes = 32) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $bytes
    $rng.GetBytes($buf); $rng.Dispose()
    return ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}
function Read-Input($prompt, $default = '') {
    if ($default) {
        $r = Read-Host "  $prompt [$default]"
        if ([string]::IsNullOrWhiteSpace($r)) { return $default }
        return $r
    }
    return Read-Host "  $prompt"
}
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}
function Add-DirToPath([string]$dir) {
    if ($dir -and (Test-Path $dir) -and (($env:Path -split ';') -notcontains $dir)) {
        $env:Path = "$dir;$env:Path"
    }
}
# node.exe'yi PATH'te degilse bilinen kurulum dizinlerinde de arar (winget kurulumu
# sonrasi elevated oturum PATH'i yenilemese bile bulunsun).
function Node-Candidates {
    # ProgramW6432: 32-bit process'ten bile gercek 64-bit "Program Files".
    @(
        "$env:ProgramW6432\nodejs\node.exe",
        'C:\Program Files\nodejs\node.exe',
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    ) | Where-Object { $_ } | Select-Object -Unique
}
function Git-Candidates {
    @(
        "$env:ProgramW6432\Git\cmd\git.exe",
        'C:\Program Files\Git\cmd\git.exe',
        (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
    ) | Where-Object { $_ } | Select-Object -Unique
}
function Resolve-NodeExe {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in (Node-Candidates)) { if (Test-Path $p) { return $p } }
    return $null
}
function Resolve-GitExe {
    $c = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in (Git-Candidates)) { if (Test-Path $p) { return $p } }
    return $null
}
function Get-NodeMajorFrom($exe) {
    if (-not $exe) { return 0 }
    try {
        # 'node --version' -> "v24.16.0"; major'u regex ile al (en saglam yontem).
        $v = (& $exe --version 2>$null | Select-Object -First 1)
        if ($v -and ($v -match 'v?(\d+)\.')) { return [int]$matches[1] }
    } catch { }
    return 0
}

Write-Host ""
Write-Color "  ==============================================================" 'Cyan'
Write-Color "  ===  MailTrustAI - Windows Musteri NATIVE Kurulum          ===" 'Cyan'
Write-Color "  ===  Docker YOK - Node.js 22 + Windows Service (NSSM)      ===" 'Cyan'
Write-Color "  ==============================================================" 'Cyan'
Write-Host ""
Info "Log dosyasi: $InstallLog"

# --- Yonetici ---
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fatal "Bu betik Yonetici yetkisiyle calistirilmalidir."
}
Ok "Yonetici yetkisi mevcut."

try {
    $cu = Get-ExecutionPolicy -Scope CurrentUser
    if ($cu -in @('Restricted','AllSigned','Undefined')) {
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
        Info "ExecutionPolicy (CurrentUser) -> RemoteSigned"
    }
} catch { }

# ============================================================
# 1/9  Node.js 22
# ============================================================
Step "1/9  Node.js kontrol ediliyor..."
$nodeExe = Resolve-NodeExe
$nodeMajor = Get-NodeMajorFrom $nodeExe
if ($nodeMajor -ge 22) {
    Add-DirToPath (Split-Path $nodeExe)
    Ok "Node.js mevcut: $(& $nodeExe --version)"
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fatal "Node.js >=22 yok ve winget bulunamadi. Node 22 LTS'i elle kurun: https://nodejs.org"
    }
    Info "Node.js 22 LTS kuruluyor (winget OpenJS.NodeJS.LTS)..."
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    $ErrorActionPreference = $prevEAP
    # MSI PATH yazimi + dosya commit'i biraz gecikebilir — kisa retry.
    $nodeExe = $null
    for ($i = 0; $i -lt 6 -and -not $nodeExe; $i++) {
        Start-Sleep -Seconds 2
        Refresh-Path
        $nodeExe = Resolve-NodeExe
    }
    $nodeMajor = Get-NodeMajorFrom $nodeExe
    if ($nodeMajor -lt 22) {
        Warn "Node.js otomatik bulunamadi. Aranan yollar:"
        foreach ($p in (Node-Candidates)) { Warn ("  {0} : {1}" -f $p, (Test-Path $p)) }
        Warn ("  PATH'te node.exe: {0}" -f [bool](Get-Command node.exe -ErrorAction SilentlyContinue))
        Fatal "Node.js bulunamadi veya 22'den eski. Yeni bir PowerShell penceresi acip scripti tekrar calistirin (PATH yenilensin) ya da Node 22+'i elle kurun: https://nodejs.org"
    }
    Add-DirToPath (Split-Path $nodeExe)
    Ok "Node.js hazir: $(& $nodeExe --version)"
}
$script:NodeExe = $nodeExe

# ============================================================
# 2/9  Git
# ============================================================
Step "2/9  Git kontrol ediliyor..."
$gitExe = Resolve-GitExe
if ($gitExe) {
    Add-DirToPath (Split-Path $gitExe)
    Ok "Git mevcut: $(& $gitExe --version)"
} else {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fatal "Git yok ve winget bulunamadi. Git'i elle kurun: https://git-scm.com/download/win"
    }
    Info "Git kuruluyor (winget Git.Git)..."
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
    $ErrorActionPreference = $prevEAP
    Refresh-Path
    $gitExe = Resolve-GitExe
    if (-not $gitExe) {
        Fatal "Git bulunamadi. Git'i elle kurun (https://git-scm.com/download/win) ve tekrar deneyin."
    }
    Add-DirToPath (Split-Path $gitExe)
    Ok "Git hazir: $(& $gitExe --version)"
}

# ============================================================
# 3/9  Yapilandirma
# ============================================================
Step "3/9  Kurulum yapilandirmasi..."
Hr
if (-not $LicenseKey) {
    if ($Unattended) { Fatal "Unattended modda -LicenseKey zorunlu." }
    $LicenseKey = Read-Input "Lisans anahtari (or: MTAI-PRO-XXXX-XXXX)"
    if (-not $LicenseKey) { Fatal "Lisans anahtari zorunludur." }
}
$DefaultUrl = 'http://licence.mailtrustai.com:3200'
if (-not $LicenseServerUrl) {
    if ($Unattended) { $LicenseServerUrl = $DefaultUrl }
    else { $LicenseServerUrl = Read-Input "Lisans sunucusu URL'i" $DefaultUrl }
}
$LicenseServerUrl = $LicenseServerUrl.TrimEnd('/')
if (-not $Unattended) {
    $InstallDir = Read-Input "Kurulum dizini" $InstallDir
    $Port = [int](Read-Input "Uygulama port numarasi" $Port)
}
Info "InstallDir=$InstallDir | Port=$Port | URL=$LicenseServerUrl"

# ============================================================
# 4/9  Repo klon/guncelle
# ============================================================
Step "4/9  Kaynak kod hazirlaniyor: $InstallDir ($Branch)"
if (Test-Path (Join-Path $InstallDir '.git')) {
    Info "Mevcut repo guncelleniyor..."
    git -C $InstallDir fetch --depth 1 origin $Branch
    git -C $InstallDir checkout -q $Branch
    git -C $InstallDir reset --hard "origin/$Branch"
} else {
    if ((Test-Path $InstallDir) -and (Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'logs' })) {
        Fatal "$InstallDir bos degil ve git repo'su degil. Once bosaltin veya silin."
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    git clone --depth 1 -b $Branch $RepoUrl $InstallDir
}
Set-Location $InstallDir
Ok "Kaynak hazir: $(git -C $InstallDir rev-parse --short HEAD 2>$null)"

New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'data')    | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'logs')    | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir 'backups') | Out-Null

# ============================================================
# 5/9  npm install
# ============================================================
Step "5/9  Bagimliliklar yukleniyor (npm install --omit=dev)..."
Info "Native moduller (better-sqlite3, bcrypt) icin prebuilt binari indirilir."
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& npm install --omit=dev --no-audit --no-fund --prefix $InstallDir
$npmExit = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($npmExit -ne 0) { Fatal "npm install basarisiz (exit $npmExit). Log: $InstallLog" }
Ok "node_modules hazir."

# Workspace symlink (junction) garantisi
$nmScope = Join-Path $InstallDir 'node_modules\@mailtrustai'
New-Item -ItemType Directory -Force -Path $nmScope | Out-Null
Get-ChildItem (Join-Path $InstallDir 'packages') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $link = Join-Path $nmScope $_.Name
    if (Test-Path $link) { cmd /c rmdir "$link" 2>$null }
    cmd /c mklink /J "$link" "$($_.FullName)" | Out-Null
}

# ============================================================
# 6/9  Musteri agacini temizle
# ============================================================
Step "6/9  Musteri-disi kod temizleniyor (guvenlik)..."
& node (Join-Path $InstallDir 'scripts\strip-customer-tree.js')
if ($LASTEXITCODE -ne 0) { Fatal "strip-customer-tree basarisiz." }
$lcLink = Join-Path $nmScope 'license-core'
if (Test-Path $lcLink) { cmd /c rmdir "$lcLink" 2>$null }

# ============================================================
# 7/9  Guvenlik dogrulamasi
# ============================================================
Step "7/9  Guvenlik dogrulamasi (check-customer-package)..."
$env:MSA_CUSTOMER_BUILD = '1'
& node (Join-Path $InstallDir 'scripts\check-customer-package.js') --scope=image
if ($LASTEXITCODE -ne 0) { Fatal "GUVENLIK KONTROLU BASARISIZ - musteri agacinda yasak kod kaldi. Kurulum durduruldu." }
Ok "Guvenlik kontrolu basarili - yasak kod yok."

# ============================================================
# 8/9  .env + NSSM servisi
# ============================================================
Step "8/9  .env ve Windows Service (NSSM)..."
$EnvFile = Join-Path $InstallDir '.env'
$SkipEnv = $false
if ((Test-Path $EnvFile) -and (Select-String -Path $EnvFile -Pattern '^MSA_LICENSE_KEY=.{4,}' -Quiet)) {
    $SkipEnv = $true
    Ok "Mevcut .env korunuyor (guncelleme modu)."
}
if (-not $SkipEnv) {
    $encPassword = New-RandomHex 32
    $encSalt     = New-RandomHex 16
    $licSecret   = New-RandomHex 32
    $localEncKey = New-RandomHex 32

    $hostMachineGuid = ''
    try { $hostMachineGuid = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid } catch {}
    $hostSystemUuid = ''
    try {
        $cs = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop
        if ($cs -and $cs.UUID -and $cs.UUID -ne '00000000-0000-0000-0000-000000000000') { $hostSystemUuid = $cs.UUID }
    } catch {}

    $fp = "# === Fingerprint (host'tan) ==="
    if ($hostMachineGuid) { $fp += "`nHOST_MACHINE_ID=$hostMachineGuid" }
    if ($hostSystemUuid)  { $fp += "`nHOST_SYSTEM_UUID=$hostSystemUuid" }
    if ($env:COMPUTERNAME) { $fp += "`nHOST_HOSTNAME=$env:COMPUTERNAME" }

    $dataDir = (Join-Path $InstallDir 'data')
    $logDir  = (Join-Path $InstallDir 'logs')
    $envContent = @"
# ============================================================
# MailTrustAI Musteri (NATIVE) Yapilandirmasi
# Olusturulma: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# UYARI: Bu dosyayi guvenli yerde yedekleyin!
# ============================================================

# === Lisans Bilgileri ===
MSA_LICENSE_KEY=$LicenseKey
MSA_LICENSE_REMOTE_URL=$LicenseServerUrl
MSA_CENTRAL_SYNC_URL=$LicenseServerUrl
MSA_CENTRAL_SYNC_ENABLED=true
MSA_HEARTBEAT_INTERVAL_SECONDS=300
MSA_POLICY_SYNC_INTERVAL_SECONDS=900

# === Guvenlik Secret lari (degistirmeyin) ===
MSA_LOCAL_ENCRYPTION_KEY=$localEncKey
MSA_ENC_PASSWORD=$encPassword
MSA_ENC_SALT=$encSalt
MSA_LICENSE_SECRET=$licSecret

# === Port & Ortam ===
PORT=$Port
CUSTOMER_PORT=$Port
NODE_ENV=production
MSA_CUSTOMER_ONLY=true
TRUST_PROXY=1
DATA_DIR=$dataDir
LOG_DIR=$logDir

# === Ilk Kurulum ===
# Tarayicida http://localhost:$Port adresini acin, admin e-posta + sifrenizi olusturun.

$fp
"@
    Set-Content -Path $EnvFile -Value $envContent -Encoding UTF8
    try {
        $acl = Get-Acl $EnvFile
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($id in @('BUILTIN\Administrators','NT AUTHORITY\SYSTEM')) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','Allow')
            $acl.AddAccessRule($rule)
        }
        Set-Acl $EnvFile $acl
    } catch { Warn ".env ACL ayarlanamadi (devam ediliyor)." }
    Ok ".env olusturuldu."
}

# --- NSSM indir ---
$NssmExe = Join-Path $InstallDir 'nssm.exe'
if (-not (Test-Path $NssmExe)) {
    Info "NSSM indiriliyor (Windows Service yoneticisi)..."
    $tmpZip = Join-Path $env:TEMP "nssm-$(Get-Random).zip"
    $tmpDir = Join-Path $env:TEMP "nssm-$(Get-Random)"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $NssmUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 60
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
        $arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
        $found = Get-ChildItem $tmpDir -Recurse -Filter 'nssm.exe' | Where-Object { $_.FullName -match "\\$arch\\" } | Select-Object -First 1
        if (-not $found) { $found = Get-ChildItem $tmpDir -Recurse -Filter 'nssm.exe' | Select-Object -First 1 }
        if (-not $found) { throw "Arsiv icinde nssm.exe bulunamadi." }
        Copy-Item $found.FullName $NssmExe -Force
        Ok "NSSM hazir: $NssmExe"
    } catch {
        Fatal "NSSM indirilemedi: $($_.Exception.Message). Internet baglantisini kontrol edin."
    } finally {
        Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$NodeExe = if ($script:NodeExe) { $script:NodeExe } else { (Get-Command node).Source }
$serverRel = 'apps\customer\server.js'

# Mevcut servisi temizle
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Info "Mevcut servis durduruluyor/kaldiriliyor..."
    & $NssmExe stop $ServiceName 2>$null | Out-Null
    & $NssmExe remove $ServiceName confirm 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

Info "Servis kuruluyor: $ServiceName"
& $NssmExe install $ServiceName $NodeExe "--use-system-ca $serverRel" | Out-Null
& $NssmExe set $ServiceName AppDirectory $InstallDir            | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $InstallDir 'logs\service.log') | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $InstallDir 'logs\service.log') | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1                    | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760             | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START            | Out-Null
& $NssmExe set $ServiceName AppEnvironmentExtra NODE_ENV=production | Out-Null
& $NssmExe set $ServiceName DisplayName "MailTrustAI Customer (native)" | Out-Null
& $NssmExe set $ServiceName Description "MailTrustAI musteri uygulamasi (Node.js, Docker'siz)" | Out-Null
& $NssmExe start $ServiceName | Out-Null
Ok "Windows Service kuruldu ve baslatildi: $ServiceName"

# --- Firewall ---
foreach ($p in @($Port)) {
    $rn = "MailTrustAI-Native-TCP-$p"
    if (-not (Get-NetFirewallRule -DisplayName $rn -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rn -Direction Inbound -Action Allow -Protocol TCP -LocalPort $p -Profile Any | Out-Null
        Ok "Firewall kurali: TCP $p"
    }
}

# ============================================================
# 9/9  Saglik kontrolu
# ============================================================
Step "9/9  Saglik kontrolu (max 60s)..."
$healthy = $false; $elapsed = 0; Start-Sleep -Seconds 8
while ($elapsed -lt 60) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/healthz" -UseBasicParsing -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 5; $elapsed += 5; Info "Bekleniyor... ($elapsed/60s)"
}

# --- ctl scripti ---
$CtlPs  = Join-Path $InstallDir 'mailtrustai-native-ctl.ps1'
$ctl = @"
# MailTrustAI Musteri (NATIVE) Yonetim Araci
param([string]`$Action='help')
`$svc  = '$ServiceName'
`$dir  = '$InstallDir'
`$port = $Port
`$nssm = Join-Path `$dir 'nssm.exe'
switch (`$Action) {
    'start'   { & `$nssm start `$svc }
    'stop'    { & `$nssm stop `$svc }
    'restart' { & `$nssm restart `$svc }
    'status'  { Get-Service `$svc | Format-List Name,Status,StartType }
    'logs'    { Get-Content (Join-Path `$dir 'logs\service.log') -Tail 200 -Wait }
    'update'  { & powershell -ExecutionPolicy Bypass -File (Join-Path `$dir 'install\client\windows\update-native-windows.ps1') }
    'backup'  {
        `$ts = Get-Date -Format 'yyyyMMdd_HHmmss'; `$b = Join-Path `$dir 'backups'
        New-Item -ItemType Directory -Force -Path `$b | Out-Null
        Copy-Item (Join-Path `$dir '.env') (Join-Path `$b ".env.`$ts")
        Write-Host "Yedek: `$b\.env.`$ts" -ForegroundColor Green
    }
    'version' {
        Write-Host ("git    : " + (git -C `$dir rev-parse --abbrev-ref HEAD 2>`$null) + " @ " + (git -C `$dir rev-parse --short HEAD 2>`$null))
        Write-Host ("node   : " + (node --version))
        Write-Host ("service: " + (Get-Service `$svc).Status)
    }
    'health'  {
        `$http='000'
        try { `$r = Invoke-WebRequest "http://localhost:`$port/healthz" -TimeoutSec 3 -UseBasicParsing; `$http=[string]`$r.StatusCode } catch {}
        `$st = (Get-Service `$svc -ErrorAction SilentlyContinue).Status
        `$ok = if (`$http -eq '200' -and `$st -eq 'Running') { 'true' } else { 'false' }
        Write-Output ('{0}"ok":{1},"service":"{2}","http_status":"{3}"{4}' -f '{', `$ok, `$st, `$http, '}')
        if (`$ok -ne 'true') { exit 1 }
    }
    'doctor'  {
        Write-Host "=== MailTrustAI Customer (native) Diyagnostik ==="
        `$s = Get-Service `$svc -ErrorAction SilentlyContinue
        Write-Host ("[1] Servis : " + (if (`$s) { `$s.Status } else { 'YOK' }))
        Write-Host ("[2] Node   : " + (node --version 2>`$null))
        try { `$r = Invoke-WebRequest "http://localhost:`$port/healthz" -TimeoutSec 3 -UseBasicParsing; Write-Host "[3] /healthz: `$(`$r.Content)" } catch { Write-Host "[3] /healthz: CEVAP YOK" }
        Write-Host ("[4] .env   : " + (if (Test-Path (Join-Path `$dir '.env')) { 'var' } else { 'YOK' }))
    }
    default   { Write-Host "Kullanim: mailtrustai-native-ctl.ps1 {start|stop|restart|status|logs|update|backup|version|health|doctor}" }
}
"@
Set-Content -Path $CtlPs -Value $ctl -Encoding UTF8
$CtlBat = Join-Path $InstallDir 'mailtrustai-native-ctl.bat'
Set-Content -Path $CtlBat -Encoding Default -Value @"
@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0mailtrustai-native-ctl.ps1" %*
"@
Ok "Yonetim araci: $CtlBat"

# ============================================================
# Ozet
# ============================================================
Hr
Write-Host ""
if ($healthy) {
    Write-Color "  ==============================================================" 'Green'
    Write-Color "  ===            NATIVE KURULUM TAMAMLANDI                   ===" 'Green'
    Write-Color "  ==============================================================" 'Green'
} else {
    Write-Color "  ==============================================================" 'Yellow'
    Write-Color "  ===   KURULUM BITTI - SAGLIK KONTROLU EKSIK                ===" 'Yellow'
    Write-Color "  ==============================================================" 'Yellow'
}
Write-Host ""
Write-Color "  Uygulama : http://localhost:$Port" 'Cyan'
if (-not $SkipEnv) {
    Write-Host ""
    Write-Color "  Ilk Admin Kurulumu: http://localhost:$Port" 'Yellow'
    Write-Color "  (Tarayicida acin - e-posta ve sifrenizi olusturun)" 'Yellow'
}
Write-Host ""
Write-Color "  Servis   : $ServiceName (services.msc)" 'White'
Write-Color "  .env     : $EnvFile" 'Yellow'
Write-Color "  Yonetim  : $CtlBat status|logs|restart|update|backup" 'White'
Write-Host ""
if (-not $healthy) { Warn "Saglik kontrolu eksik. Loglar: $InstallDir\logs\service.log" }
Hr
try { Stop-Transcript | Out-Null } catch { }
