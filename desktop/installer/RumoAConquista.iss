; Instalador do aplicativo Rumo à Conquista (gerado por desktop/scripts/build.mjs).
; Instala só para o usuário atual (sem administrador). Os dados do agente ficam em
; %LOCALAPPDATA%\RumoAConquista\agent e são preservados na desinstalação.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6F4B7A3E-2C1D-4E8B-9A5F-7D3C2B1A0E9F}
AppName=Rumo à Conquista
AppVersion={#AppVersion}
AppPublisher=Rumo à Conquista
DefaultDirName={localappdata}\Programs\Rumo a Conquista
DefaultGroupName=Rumo à Conquista
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename=RumoAConquista-Setup-{#AppVersion}
SetupIconFile={#StageDir}\icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; Flags: unchecked
Name: "startup"; Description: "Iniciar com o Windows (minimizado na bandeja)"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; AppUserModelID igual ao do aplicativo: a barra de tarefas usa o ícone do atalho (troféu) em vez do ícone do executável.
Name: "{group}\Rumo à Conquista"; Filename: "{app}\Rumo a Conquista.exe"; IconFilename: "{app}\icon.ico"; AppUserModelID: "br.rumoaconquista.desktop"
Name: "{group}\Desinstalar Rumo à Conquista"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Rumo à Conquista"; Filename: "{app}\Rumo a Conquista.exe"; IconFilename: "{app}\icon.ico"; AppUserModelID: "br.rumoaconquista.desktop"; Tasks: desktopicon

[Registry]
; Mesmo nome que o aplicativo usa em "Iniciar com o Windows"; removido na desinstalação.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "RumoAConquista"; ValueData: """{app}\Rumo a Conquista.exe"" --hidden"; Tasks: startup; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "RumoAConquista"; Flags: uninsdeletevalue dontcreatekey

[Run]
Filename: "{app}\Rumo a Conquista.exe"; Description: "Abrir o Rumo à Conquista"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Fecha o aplicativo (e o agente que ele iniciou) de forma limpa antes de remover os arquivos.
Filename: "{app}\Rumo a Conquista.exe"; Parameters: "--quit"; Flags: runhidden waituntilterminated; RunOnceId: "FecharApp"
; O --quit só avisa a instância aberta; espera ela terminar (até 40 s) para nenhum arquivo ficar em uso.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Wait-Process -Name 'Rumo a Conquista' -Timeout 40 -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated; RunOnceId: "EsperarApp"
