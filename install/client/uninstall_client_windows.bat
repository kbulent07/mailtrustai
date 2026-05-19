@echo off
REM ============================================================
REM  MailTrustAI - Windows Musteri Kaldirma (cift-tikla)
REM
REM  Bu dosyaya cift tiklayinca:
REM    1) Yonetici yetkisine yukselir (UAC istemi)
REM    2) Kullaniciya seri sorar:
REM       - Sadece container kapat (veriler korunur)
REM       - Her seyi sil (volume + .env + kurulum dizini)
REM    3) uninstall_client_windows.ps1'i ilgili parametrelerle calistirir
REM
REM  PS1 dosyasi:
REM    Once C:\mailtrustai-source\install\client\uninstall_client_windows.ps1
REM    Sonra .bat ile ayni dizinde
REM    Bulunmazsa GitHub'dan indirilir
REM ============================================================

setlocal EnableDelayedExpansion

REM --- Yonetici kontrolu ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM --- PS1'i bul (oncelik sirasi: repo, ayni klasor, indir) ---
set "PS1_REPO=C:\mailtrustai-source\install\client\uninstall_client_windows.ps1"
set "PS1_LOCAL=%~dp0uninstall_client_windows.ps1"
set "PS1_PATH="

if exist "%PS1_REPO%"  set "PS1_PATH=%PS1_REPO%"
if not defined PS1_PATH if exist "%PS1_LOCAL%" set "PS1_PATH=%PS1_LOCAL%"

if not defined PS1_PATH (
    echo uninstall_client_windows.ps1 bulunamadi. GitHub'dan indiriliyor...
    set "PS1_PATH=%PS1_LOCAL%"
    powershell -ExecutionPolicy Bypass -NoProfile -Command ^
        "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/kbulent07/mailtrustai/mainpaketler/install/client/uninstall_client_windows.ps1' -OutFile '!PS1_PATH!'"
    if not exist "!PS1_PATH!" (
        echo HATA: uninstall_client_windows.ps1 indirilemedi. Internet baglantinizi kontrol edin.
        pause
        exit /b 1
    )
)

REM --- Mod secimi ---
echo.
echo ===============================================
echo  MailTrustAI Musteri Kaldirma
echo ===============================================
echo.
echo  1 = SOFT  - Ayarlar korunsun (container durur, .env + volume kalir)
echo  2 = FULL  - Hicbir iz kalmasin (Docker Desktop + Git + her sey silinir)
echo.
set /p MODE="Seciminiz [1/2, varsayilan 1]: "

if "%MODE%"=="" set "MODE=1"

set "PS_ARGS=-ExecutionPolicy Bypass -NoProfile -File ""%PS1_PATH%"""

if "%MODE%"=="2" (
    echo.
    echo DIKKAT: FULL purge -- GERI ALINAMAZ!
    echo   - Container ve volume silinecek
    echo   - .env ve kurulum dizini silinecek
    echo   - Docker Desktop kaldirilacak (winget ile)
    echo   - Git kaldirilacak (winget ile)
    echo   - C:\mailtrustai-source repo'su silinecek
    echo.
    set /p CONFIRM="Onaylamak icin 'EVET SIL' yazin: "
    if /i not "!CONFIRM!"=="EVET SIL" (
        echo Iptal edildi.
        pause
        exit /b 0
    )
    set "PS_ARGS=!PS_ARGS! -Purge -RemoveImage -RemoveDocker -RemoveGit -Unattended"
)

REM --- PS1'i calistir ---
echo.
echo Kaldirma sureci baslatiliyor...
echo Komut: powershell !PS_ARGS!
echo.
powershell !PS_ARGS!

echo.
echo Pencereyi kapatmak icin tusa basin.
pause
endlocal
