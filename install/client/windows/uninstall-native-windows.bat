@echo off
REM ============================================================
REM  MailTrustAI - Windows NATIVE Kaldirma (cift-tikla, Docker'siz)
REM
REM  Servisi durdurur/kaldirir. Veriler korunur.
REM  Tum verileri silmek icin: uninstall-native-windows.ps1 -Purge
REM ============================================================
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "PS1_PATH=%~dp0uninstall-native-windows.ps1"
if not exist "%PS1_PATH%" (
    echo HATA: uninstall-native-windows.ps1 bulunamadi.
    pause
    exit /b 1
)

powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1_PATH%" %*

echo.
pause
endlocal
