@echo off
REM ============================================================
REM  MailTrustAI - Windows NATIVE Kurulum (cift-tikla, Docker'siz)
REM
REM  Bu dosyaya cift tiklayinca:
REM    1) Yonetici yetkisine yukselir (UAC istemi cikar)
REM    2) install-native-windows.ps1'i calistirir (yaninda yoksa indirir)
REM    3) PS1 sirayla:
REM         Node.js 22 -> Git -> repo klon -> npm install ->
REM         musteri agaci strip -> guvenlik kontrolu -> NSSM servis
REM
REM  Internet baglantisi gerekir. Docker GEREKMEZ.
REM ============================================================
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "PS1_PATH=%~dp0install-native-windows.ps1"

if not exist "%PS1_PATH%" (
    echo install-native-windows.ps1 bulunamadi. GitHub'dan indiriliyor...
    powershell -ExecutionPolicy Bypass -NoProfile -Command ^
        "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/windows/install-native-windows.ps1' -OutFile '%PS1_PATH%'"
    if not exist "%PS1_PATH%" (
        echo HATA: install-native-windows.ps1 indirilemedi. Internet baglantinizi kontrol edin.
        pause
        exit /b 1
    )
)

echo.
echo ===============================================
echo  MailTrustAI NATIVE Kurulumu Baslatiliyor
echo ===============================================
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1_PATH%"

echo.
echo Kurulum sureci tamamlandi. Pencereyi kapatmak icin tusa basin.
pause
endlocal
