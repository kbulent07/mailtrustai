@echo off
REM ============================================================
REM  MailTrustAI - Windows Musteri Otomatik Kurulum (cift-tikla)
REM
REM  Bu dosyaya cift tiklayinca:
REM    1) Yonetici yetkisine yukselir (UAC istemi cikar)
REM    2) install_windows_musteri.ps1'i calistirir (yaninda yoksa indirir)
REM    3) PS1 sirayla:
REM         winget -> git -> Docker Desktop -> repo klon ->
REM         install_windows_user.ps1 (asil kurulum)
REM
REM  Internet baglantisi gerekir.
REM  Docker Desktop ilk kurulduysa Windows yeniden baslatma isteyebilir.
REM ============================================================

setlocal

REM --- Yonetici kontrolu ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM --- PS1 dosyasi yaninda mi? Yoksa GitHub'dan indir ---
set "PS1_PATH=%~dp0install_windows_musteri.ps1"

if not exist "%PS1_PATH%" (
    echo install_windows_musteri.ps1 bulunamadi. GitHub'dan indiriliyor...
    powershell -ExecutionPolicy Bypass -NoProfile -Command ^
        "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/install_windows_musteri.ps1' -OutFile '%PS1_PATH%'"
    if not exist "%PS1_PATH%" (
        echo HATA: install_windows_musteri.ps1 indirilemedi. Internet baglantinizi kontrol edin.
        pause
        exit /b 1
    )
)

REM --- PS1'i calistir ---
echo.
echo ===============================================
echo  MailTrustAI Musteri Kurulumu Baslatiliyor
echo ===============================================
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1_PATH%"

echo.
echo Kurulum sureci tamamlandi. Pencereyi kapatmak icin tusa basin.
pause
endlocal
