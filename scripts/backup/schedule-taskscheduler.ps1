# ============================================================
# MailTrustAI Customer -- Windows Task Scheduler Kurulumu
#
# Haftalik otomatik yedek icin Windows Gorev Zamanlayicisi'na
# kalici gorev ekler. Uygulama kapali olsa da, kullanici
# oturumu acik oldugu surece calisir (Docker Desktop yeterli).
#
# Kullanim (normal PS -- yonetici GEREKMEZ):
#   .\scripts\setup-taskscheduler-backup.ps1            # Kur
#   .\scripts\setup-taskscheduler-backup.ps1 -Remove    # Kaldir
#   .\scripts\setup-taskscheduler-backup.ps1 -Show      # Durumu goster
#   .\scripts\setup-taskscheduler-backup.ps1 -RunNow    # Hemen calistir
# ============================================================

param(
    [switch]$Remove,
    [switch]$Show,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$TaskFolder = "\MailTrustAI\"
$TaskName   = "CustomerWeeklyBackup"
$FullName   = "$TaskFolder$TaskName"

$RepoRoot    = (Resolve-Path "$PSScriptRoot\..\..").Path
$ScriptPath  = Join-Path $RepoRoot "scripts\backup\backup-customer.ps1"
$TargetDir   = Join-Path $RepoRoot "backups\auto-weekly"
$LogFile     = Join-Path $RepoRoot "logs\backup-customer.log"
$WrapperFile = Join-Path $RepoRoot "scripts\backup\_runner.ps1"

New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "logs") | Out-Null

# ----------------------------------------------------------------
# Durumu goster
# ----------------------------------------------------------------
if ($Show) {
    Write-Host "MailTrustAI Task Scheduler gorevi:" -ForegroundColor Cyan
    $t = Get-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
        $info = Get-ScheduledTaskInfo -TaskPath $TaskFolder -TaskName $TaskName
        Write-Host ("  Durum       : {0}" -f $t.State) -ForegroundColor Green
        Write-Host ("  Son calisma : {0}" -f $info.LastRunTime)
        Write-Host ("  Sonraki     : {0}" -f $info.NextRunTime)
        Write-Host ("  Son sonuc   : 0x{0:X8}" -f $info.LastTaskResult)
    } else {
        Write-Host "  Gorev kayitli degil." -ForegroundColor Yellow
    }
    exit 0
}

# ----------------------------------------------------------------
# Gorevi kaldir
# ----------------------------------------------------------------
if ($Remove) {
    $t = Get-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($t) {
        Unregister-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName -Confirm:$false
        Write-Host " [OK] Gorev kaldirildi: $FullName" -ForegroundColor Green
    } else {
        Write-Host " Gorev bulunamadi veya zaten kaldırilmis." -ForegroundColor Yellow
    }
    if (Test-Path $WrapperFile) { Remove-Item $WrapperFile -Force }
    exit 0
}

# ----------------------------------------------------------------
# Hemen calistir
# ----------------------------------------------------------------
if ($RunNow) {
    $t = Get-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $t) {
        Write-Host " Gorev bulunamadi. Once kurulum yapin." -ForegroundColor Red
        exit 1
    }
    Write-Host " > Gorev hemen calistiriliyor..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName
    Start-Sleep -Seconds 4
    $info = Get-ScheduledTaskInfo -TaskPath $TaskFolder -TaskName $TaskName
    $state = (Get-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName).State
    Write-Host ("  Durum       : {0}" -f $state)
    Write-Host ("  Son calisma : {0}" -f $info.LastRunTime)
    exit 0
}

# ----------------------------------------------------------------
# Kurulum
# ----------------------------------------------------------------
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " MailTrustAI Customer -- Task Scheduler Kurulumu"            -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Repo  : $RepoRoot"
Write-Host " Script: $ScriptPath"
Write-Host " Hedef : $TargetDir"
Write-Host " Log   : $LogFile"
Write-Host " Zaman : Her Pazar 02:00"
Write-Host ""

if (-not (Test-Path $ScriptPath)) {
    Write-Host " HATA: Backup scripti bulunamadi: $ScriptPath" -ForegroundColor Red
    exit 1
}

# Wrapper script: backup'i calistir, ciktiyi log dosyasina yaz
$WrapperContent = @"
Start-Transcript -Path "$LogFile" -Append
try {
    & powershell.exe -ExecutionPolicy Bypass -NonInteractive ``
        -File "$ScriptPath" -TargetDir "$TargetDir"
} finally {
    Stop-Transcript
}
"@
Set-Content -Path $WrapperFile -Value $WrapperContent -Encoding UTF8

# Task Scheduler action, trigger, settings, principal
$PsExe    = (Get-Command powershell.exe).Source
$Action   = New-ScheduledTaskAction -Execute $PsExe `
    -Argument ("-ExecutionPolicy Bypass -NonInteractive -File `"" + $WrapperFile + "`"")

$Trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "02:00"

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -WakeToRun:$false `
    -RunOnlyIfNetworkAvailable:$false `
    -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

# Kaydet veya guncelle
$existing = Get-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName -ErrorAction SilentlyContinue
try {
    if ($existing) {
        Set-ScheduledTask -TaskPath $TaskFolder -TaskName $TaskName `
            -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal | Out-Null
        Write-Host " [OK] Mevcut gorev guncellendi: $FullName" -ForegroundColor Green
    } else {
        Register-ScheduledTask `
            -TaskPath  $TaskFolder `
            -TaskName  $TaskName `
            -Action    $Action `
            -Trigger   $Trigger `
            -Settings  $Settings `
            -Principal $Principal `
            -Description "MailTrustAI Customer haftalik yedek -- backups\auto-weekly uzerine yazar" | Out-Null
        Write-Host " [OK] Gorev olusturuldu: $FullName" -ForegroundColor Green
    }
} catch {
    Write-Host (" HATA: Gorev olusturulamadi: {0}" -f $_) -ForegroundColor Red
    Write-Host " Ipucu: taskschd.msc ile manuel de ekleyebilirsiniz." -ForegroundColor Yellow
    exit 1
}

$info = Get-ScheduledTaskInfo -TaskPath $TaskFolder -TaskName $TaskName
Write-Host ""
Write-Host (" Sonraki calisma : {0}" -f $info.NextRunTime) -ForegroundColor Cyan
Write-Host ""
Write-Host " Gorev Zamanlayicisi'ndan yonetmek icin:"
Write-Host "   taskschd.msc -> Gorev Zamanlayici Kutuphanesi -> MailTrustAI"
Write-Host ""
Write-Host " PowerShell komutlari:"
Write-Host "   Durumu goster  : .\scripts\setup-taskscheduler-backup.ps1 -Show"
Write-Host "   Hemen calistir : .\scripts\setup-taskscheduler-backup.ps1 -RunNow"
Write-Host "   Kaldir         : .\scripts\setup-taskscheduler-backup.ps1 -Remove"
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " [OK] Kurulum tamam. Her Pazar 02:00 yedek alinacak."        -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
