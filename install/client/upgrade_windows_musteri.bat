@echo off
REM ============================================================
REM  MailTrustAI - Windows Musteri Guncelleme (cift-tikla)
REM
REM  Bu dosyaya cift tiklayinca:
REM    1) Yonetici yetkisine yukselir (UAC istemi)
REM    2) upgrade_windows.ps1'i calistirir:
REM       - .env DOKUNULMAZ
REM       - Otomatik yedek alir (.env + customer-data + customer-logs)
REM       - git pull --ff-only ile yeni surume gecer
REM       - docker compose build + restart
REM       - /healthz polling ile saglik kontrolu yapar
REM
REM  Onkosul: Repo C:\mailtrustai-source altinda kurulu olmali
REM           (install_windows_musteri.bat ile kuruldu mu?)
REM ============================================================

setlocal

REM --- Yonetici kontrolu ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici yetkisi gerekiyor. UAC istemi acilacak...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

REM --- Repo'yu bul ---
REM upgrade_windows.ps1 git pull yapacagi icin REPO'DAKI .ps1'i kullanmali
set "PS1_REPO=C:\mailtrustai-source\install\client\upgrade_windows.ps1"

if not exist "%PS1_REPO%" (
    echo.
    echo HATA: Repo bulunamadi: C:\mailtrustai-source\install\client\upgrade_windows.ps1
    echo.
    echo Bu kurulum 'install_windows_musteri.bat' ile yapilmamis olabilir.
    echo Guncelleme icin once asagidakilerden birini yapin:
    echo.
    echo   1) Bootstrap ile yeniden kur:
    echo      install_windows_musteri.bat'a cift tiklayin
    echo.
    echo   2) Repo'yu manuel klonla:
    echo      git clone -b mainpaketler https://github.com/kbulent07/mailtrustai.git C:\mailtrustai-source
    echo.
    pause
    exit /b 1
)

REM --- Tar dosyasi mi var? Sor ---
echo.
echo ===============================================
echo  MailTrustAI Musteri Guncelleme
echo ===============================================
echo.
echo Bayinizden YENI image tar dosyasi (.tar) aldiniz mi?
echo Almadiysaniz Enter'a basin (git pull + build kullanilir).
echo.
set /p TARFILE="Tar dosyasi yolu (bos = yok): "

set "PS_ARGS=-ExecutionPolicy Bypass -NoProfile -File ""%PS1_REPO%"""

if not "%TARFILE%"=="" (
    if not exist "%TARFILE%" (
        echo HATA: Tar dosyasi bulunamadi: %TARFILE%
        pause
        exit /b 1
    )
    set "PS_ARGS=%PS_ARGS% -ImageFile ""%TARFILE%"""
)

REM --- PS1'i calistir ---
echo.
echo Guncelleme baslatiliyor...
echo Komut: powershell %PS_ARGS%
echo.
powershell %PS_ARGS%

echo.
echo Pencereyi kapatmak icin tusa basin.
pause
endlocal
