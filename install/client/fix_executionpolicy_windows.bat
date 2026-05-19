@echo off
REM ============================================================
REM  MailTrustAI - Windows ExecutionPolicy Tek-Tikla Onarim
REM
REM  "running scripts is disabled on this system" hatasi cikan
REM  kullanicilar icin bir defalik onarim araci. .ps1 dosyalarini
REM  dogrudan calistirabilmek icin CurrentUser scope'unda policy'i
REM  RemoteSigned olarak ayarlar (sistem genelini etkilemez).
REM
REM  Bu dosyaya cift tiklayin, UAC istemine 'Evet' deyin.
REM ============================================================

setlocal

REM --- Yonetici kontrolu (CurrentUser scope yonetici gerektirmez
REM     ama UAC olmadan calistirilmasi kullanici hatasini onler) ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo ===============================================
echo  MailTrustAI - ExecutionPolicy Onarim Araci
echo ===============================================
echo.
echo Mevcut ExecutionPolicy ayarlari okunuyor...
echo.

powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "Write-Host '  CurrentUser : ' -NoNewline; Get-ExecutionPolicy -Scope CurrentUser; ^
     Write-Host '  LocalMachine: ' -NoNewline; Get-ExecutionPolicy -Scope LocalMachine; ^
     Write-Host '  Effective   : ' -NoNewline; Get-ExecutionPolicy"

echo.
echo CurrentUser scope'da RemoteSigned olarak ayarlaniyor...
echo (Sadece sizin kullaniciniz icin gecerli; sistem geneline dokunmaz.)
echo.

powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force"

if %errorlevel% neq 0 (
    echo.
    echo HATA: Policy ayarlanamadi. Group Policy tarafindan kilitli olabilir.
    echo Sistem yoneticinize basvurun.
    pause
    exit /b 1
)

echo.
echo BASARILI! Artik .ps1 dosyalari dogrudan calistirilabilir:
echo.
echo   ^& 'C:\MailTrustAI\mailtrustai-ctl.ps1' status
echo.
echo Yeni durum:
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
    "Write-Host '  CurrentUser : ' -NoNewline; Get-ExecutionPolicy -Scope CurrentUser; ^
     Write-Host '  Effective   : ' -NoNewline; Get-ExecutionPolicy"

echo.
echo Pencereyi kapatmak icin tusa basin.
pause
endlocal
