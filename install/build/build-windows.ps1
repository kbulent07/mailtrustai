#Requires -Version 5.1
<#
.SYNOPSIS
    MailTrustAI Client Windows installer'ini lokal makinede derler.

.DESCRIPTION
    Inno Setup 6+ compiler'ini (iscc.exe) bulup MailTrustAIClient.iss
    dosyasini derler. Cikti dist/MailTrustAI-Client-Setup-X.Y.Z.exe.

    Inno Setup yoksa -InstallIfMissing ile winget veya chocolatey
    yoluyla otomatik kurabilir.

.PARAMETER IsccPath
    iscc.exe'nin tam yolu. Verilmezse standart konumlar taranir.

.PARAMETER InstallIfMissing
    Inno Setup bulunamazsa winget ile otomatik kurar.

.PARAMETER Verbose
    Inno Setup'in detayli ciktisini gosterir.

.EXAMPLE
    # Standart kullanim (Inno Setup'in onceden kurulu olmasi gerekiyor)
    .\installer\build-installer.ps1

    # Otomatik kurulumla
    .\installer\build-installer.ps1 -InstallIfMissing

.NOTES
    Build sonrasi installer .exe imzalanmamis olur. Kullanicilar
    "Bilinmeyen yayinci" uyarisi alir. Imzalamak icin signtool ile
    ek bir adim gerekir (sertifika gerekli).
#>
[CmdletBinding()]
param(
    [string]$IsccPath          = '',
    [switch]$InstallIfMissing
)

# UTF-8 BOM yazma (Turkce karakter destegi icin)
$OutputEncoding             = [System.Text.UTF8Encoding]::new($true)
[Console]::OutputEncoding   = [System.Text.UTF8Encoding]::new($false)

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║  MailTrustAI Client - Windows Installer Build           ║' -ForegroundColor Cyan
Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ─── 1) Inno Setup yerini bul ───────────────────────────────
$candidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    'C:\Program Files (x86)\Inno Setup 5\ISCC.exe'
)

if (-not $IsccPath) {
    $IsccPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if ((-not $IsccPath) -or (-not (Test-Path $IsccPath))) {
    if ($InstallIfMissing) {
        Write-Host '[1/3] Inno Setup bulunamadi, kuruluyor...' -ForegroundColor Yellow

        # Once winget dene
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            & winget install -e --id JRSoftware.InnoSetup `
                --accept-source-agreements --accept-package-agreements
        } else {
            # Choco dene
            $choco = Get-Command choco -ErrorAction SilentlyContinue
            if ($choco) {
                & choco install innosetup -y
            } else {
                throw 'Inno Setup kurulamadi: winget ve chocolatey bulunamadi. Manuel olarak kurun: https://jrsoftware.org/isdl.php'
            }
        }

        # Tekrar bul
        $IsccPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $IsccPath) {
            throw "Inno Setup kurulduktan sonra bile ISCC.exe bulunamadi. Manuel yolu -IsccPath ile verin."
        }
    } else {
        throw @"
Inno Setup Compiler bulunamadi.

Cozumler:
  1) Otomatik kurun:    .\build-installer.ps1 -InstallIfMissing
  2) Manuel indirin:    https://jrsoftware.org/isdl.php
  3) Yolu belirtin:     .\build-installer.ps1 -IsccPath 'C:\...\ISCC.exe'
"@
    }
}

Write-Host "[1/3] Inno Setup bulundu: $IsccPath" -ForegroundColor Green

# ─── 2) Cikti dizini hazirla ────────────────────────────────
$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DistDir    = Join-Path $RepoRoot 'dist'
$IssFile    = Join-Path $PSScriptRoot 'MailTrustAIClient.iss'

if (-not (Test-Path $IssFile)) {
    throw "ISS dosyasi bulunamadi: $IssFile"
}

if (-not (Test-Path $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
}

Write-Host "[2/3] Cikti dizini: $DistDir" -ForegroundColor Green

# ─── 3) Derle ───────────────────────────────────────────────
Write-Host ''
Write-Host '[3/3] Inno Setup ile derleniyor...' -ForegroundColor Yellow
Write-Host ''

Push-Location $PSScriptRoot
try {
    if ($VerbosePreference -eq 'Continue') {
        & $IsccPath $IssFile
    } else {
        # Sessiz mod: yalniz hata ve uyari satirlarini goster
        & $IsccPath /Qp $IssFile
    }
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host "DERLEME BASARISIZ (exit=$exitCode)" -ForegroundColor Red
    exit $exitCode
}

# ─── Cikti ozeti ────────────────────────────────────────────
Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║                    BUILD BASARILI                       ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''

$outputs = Get-ChildItem -Path $DistDir -Filter '*.exe' | Sort-Object LastWriteTime -Descending
foreach ($f in $outputs | Select-Object -First 3) {
    $sizeMB = [Math]::Round($f.Length / 1MB, 1)
    Write-Host ("  -> {0} ({1} MB)" -f $f.FullName, $sizeMB) -ForegroundColor Cyan
}

Write-Host ''
Write-Host 'Test icin .exe''ye cift tiklayin veya:' -ForegroundColor Yellow
Write-Host "  Start-Process '$($outputs[0].FullName)'" -ForegroundColor Gray
Write-Host ''
