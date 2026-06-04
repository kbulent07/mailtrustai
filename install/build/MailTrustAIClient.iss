; ============================================================
; MailTrustAI Client - Windows Installer (Inno Setup 6+)
; ============================================================
; Bu betik mevcut install_client_windows.ps1 bootstrap script'ini
; cagirarak Docker Desktop + Git + repo klonu + container build
; islemlerini yapar. Kullanici sadece lisans key + server URL
; girer, gerisi otomatik.
;
; Derleme:
;   .\installer\build-installer.ps1 -InstallIfMissing
;
; Veya manuel:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\MailTrustAIClient.iss
; ============================================================

#define MyAppName         "MailTrustAI Client"
#define MyAppVersion      "2.0.0"
#define MyAppPublisher    "MailTrustAI"
#define MyAppURL          "https://github.com/kbulent07/mailtrustai"
#define MyAppRepoBranch   "mainpaketler"
#define MyAppId           "{{B8F3A1F6-7B4E-4D2C-9F31-A8D5E2C1B3F4}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Bu kurulum kendi dosyalarini buraya kopyalamiyor — sadece bootstrap
; yapiyor. Yine de bir DefaultDirName gerekli (kayit defteri vs).
DefaultDirName={autopf}\MailTrustAI
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=no

OutputDir=..\..\dist
OutputBaseFilename=MailTrustAI-Client-Setup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; 64-bit zorunlu (Docker Desktop x64 gerektiriyor)
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Yonetici yetkisi gerekiyor (Docker, winget vs.)
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Detayli yukleme penceresi
ShowLanguageDialog=yes
DisableReadyPage=no
DisableFinishedPage=no

UninstallDisplayName={#MyAppName}

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Bootstrap PS1 temp'e kopyalanir — repo klonlandiktan sonra silinir.
Source: "..\client\windows\install.ps1"; DestDir: "{tmp}"; DestName: "install.ps1"; Flags: deleteafterinstall ignoreversion
; Uninstall script {app}'e kalici kopyalanir — repo silinse bile calisir.
Source: "..\client\windows\uninstall.ps1"; DestDir: "{app}"; DestName: "uninstall.ps1"; Flags: ignoreversion

[Registry]
; Repo kok dizinini kayit defterine yaz. Kaldirma sirasinda
; {reg:...} ile okunarak uninstall script dogru konumdan cagrilir.
Root: HKLM; Subkey: "Software\MailTrustAI\Client"; \
  ValueType: string; ValueName: "RepoRoot"; \
  ValueData: "{code:GetRepoRoot}"; \
  Flags: uninsdeletekey

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "Ek gorevler:"; Flags: unchecked
Name: "openbrowser"; Description: "Kurulum bitince tarayicida ac"; GroupDescription: "Ek gorevler:"

[Icons]
Name: "{group}\{#MyAppName} Kontrol Paneli"; Filename: "http://localhost:3000"; Comment: "MailTrustAI musteri paneline tarayicidan eris"
Name: "{group}\Komut Araci (CMD)"; Filename: "{cmd}"; Parameters: "/k cd /d C:\MailTrustAI"; WorkingDir: "C:\MailTrustAI"; Comment: "Komut satiri ile musteriyi yonet"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MailTrustAI"; Filename: "http://localhost:3000"; Tasks: desktopicon

[Run]
; ANA KURULUM: bootstrap script'i admin yetkisiyle, kullanicidan alinan
; degerlerle cagir. Cikti kullaniciya gosterilmek icin runascurrentuser
; yerine waituntilterminated kullaniyoruz.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\install.ps1"" -LicenseKey ""{code:GetLicense}"" -LicenseServerUrl ""{code:GetServerURL}"" -InstallRoot ""{code:GetRepoRoot}"""; \
  WorkingDir: "{tmp}"; \
  StatusMsg: "MailTrustAI kuruluyor... (Docker indirme dahil 5-15 dk surebilir, lutfen bekleyin)"; \
  Flags: waituntilterminated

; Kurulum sonrasi tarayicida ac (gorev secildiyse)
Filename: "http://localhost:3000"; Description: "MailTrustAI Kontrol Paneli'ni ac"; Tasks: openbrowser; Flags: shellexec postinstall skipifsilent

[UninstallRun]
; {app}\uninstall.ps1 kurulum sirasinda kopyalanir — repo olsa da olmasa da calisir.
; Purge karari InitializeUninstall() wizard'indan gelir (GetPurgeFlag getter).
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"" -Unattended {code:GetPurgeFlag}"; \
  RunOnceId: "MailTrustAIUninstall"; \
  Flags: waituntilterminated

[Code]
// ────────────────────────────────────────────────────────────
// Wizard ek sayfalari: Lisans Anahtari + License Server URL
// Uninstall: veri silme secimi
// ────────────────────────────────────────────────────────────
var
  LicensePage:   TInputQueryWizardPage;
  ServerURLPage: TInputQueryWizardPage;
  InfoPage:      TOutputMsgWizardPage;
  g_Purge:       Boolean;
  g_RemoveDocker: Boolean;

// Kaldirma baslamadan once iki soru sor.
// InitializeUninstall() uninstall baslamadan hemen once cagrilir.
function InitializeUninstall(): Boolean;
var
  answer: Integer;
begin
  Result := True;
  g_Purge := False;
  g_RemoveDocker := False;

  // --- Soru 1: Veri ---
  answer := MsgBox(
    'MailTrustAI verilerini de silmek istiyor musunuz?' + #13#10 + #13#10 +
    'EVET  - Tum veriler kalici olarak silinir:' + #13#10 +
    '        mail gecmisi, msa.db, ayarlar, .env, yedekler' + #13#10 + #13#10 +
    'HAYIR - Sadece konteyner durdurulur.' + #13#10 +
    '        Veriler korunur; yeniden kurulumda devam edilir.',
    mbConfirmation, MB_YESNO);
  g_Purge := (answer = IDYES);

  // --- Soru 2: Docker Desktop ---
  answer := MsgBox(
    'Docker Desktop da kaldirilsin mi?' + #13#10 + #13#10 +
    'EVET  - winget ile Docker Desktop kaldirilir.' + #13#10 +
    '        DIKKAT: Sistemde Docker kullanan baska uygulama varsa' + #13#10 +
    '        onlar da etkilenir!' + #13#10 + #13#10 +
    'HAYIR - Docker Desktop korunur (onerilir).',
    mbConfirmation, MB_YESNO);
  g_RemoveDocker := (answer = IDYES);
end;

// [UninstallRun] Parameters icinde {code:GetPurgeFlag} olarak kullanilir
function GetPurgeFlag(Param: String): String;
var
  flags: String;
begin
  flags := '';
  if g_Purge then
    flags := flags + ' -Purge -DeleteBackups -RemoveImage';
  if g_RemoveDocker then
    flags := flags + ' -RemoveDocker';
  Result := Trim(flags);
end;

procedure InitializeWizard();
begin
  // 1) Bilgi sayfasi — ne yapacagini ozetler
  InfoPage := CreateOutputMsgPage(wpWelcome,
    'Kurulum hakkinda',
    'Bu kurulum ne yapacak?',
    'Bu sihirbaz sirayla:' + #13#10 +
    '  1. Git for Windows (yoksa kurar)' + #13#10 +
    '  2. Docker Desktop (yoksa kurar — sistem yeniden baslatma gerekebilir)' + #13#10 +
    '  3. MailTrustAI kaynak kodunu C:\mailtrustai-source dizinine indirir' + #13#10 +
    '  4. Lisans bilgilerinizi yapilandirir' + #13#10 +
    '  5. Docker imajini olusturur ve servisi baslatir (port 3000)' + #13#10 + #13#10 +
    'Tahmini sure: 5-15 dakika (internet hizina bagli).' + #13#10 +
    'Devam etmek icin ileri''ye tiklayin.');

  // 2) Lisans anahtari sayfasi
  LicensePage := CreateInputQueryPage(InfoPage.ID,
    'Lisans Anahtari',
    'Bayinizden aldiginiz lisans anahtarini girin',
    'Lisans anahtari MTAI-XXXX-XXXX biciminde olur ve bayinizden temin edilir. ' +
    'Bu bilgi yerel olarak .env dosyasinda saklanir, internet uzerinden license-server''a iletilir.');
  LicensePage.Add('Lisans Anahtari:', False);

  // 3) License-server URL sayfasi — varsayilan mailtrustai.com altyapisi
  ServerURLPage := CreateInputQueryPage(LicensePage.ID,
    'License Server URL',
    'Lisans dogrulamasi yapilacak adres',
    'Varsayilan deger MailTrustAI merkezi sunucusudur. ' +
    'Farkli bir license-server kullanacaksaniz URL''i degistirebilirsiniz.');
  ServerURLPage.Add('URL:', False);
  ServerURLPage.Values[0] := 'http://license.mailtrustai.com:3200';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = LicensePage.ID then begin
    if Trim(LicensePage.Values[0]) = '' then begin
      MsgBox('Lisans anahtari bos birakilamaz.', mbError, MB_OK);
      Result := False;
    end;
  end;

  if CurPageID = ServerURLPage.ID then begin
    if Trim(ServerURLPage.Values[0]) = '' then begin
      MsgBox('License-server URL bos birakilamaz.', mbError, MB_OK);
      Result := False;
    end;
    // Basit URL formati kontrolu
    if (Pos('http://', LowerCase(ServerURLPage.Values[0])) <> 1) and
       (Pos('https://', LowerCase(ServerURLPage.Values[0])) <> 1) then begin
      MsgBox('URL "http://" veya "https://" ile baslamali.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// [Run] section icindeki {code:...} cagrilari icin getter'lar
function GetLicense(Param: String): String;
begin
  Result := Trim(LicensePage.Values[0]);
end;

function GetServerURL(Param: String): String;
begin
  Result := Trim(ServerURLPage.Values[0]);
end;

function GetRepoRoot(Param: String): String;
begin
  // Bootstrap script'in repo klonladigi yer — kurulum dizini ile case-
  // insensitive cakismayi onlemek icin farkli isimde tutuluyor.
  Result := 'C:\mailtrustai-source';
end;
