; 잇다(Itda) Windows 설치 프로그램 스크립트
;
; Inno Setup(무료)으로 컴파일합니다: https://jrsoftware.org/isinfo.php
;
; 사용법:
;   1) build_exe.ps1을 먼저 실행해서 dist\잇다\ 폴더를 만들어둔다
;   2) Inno Setup Compiler로 이 파일을 열고 "Compile"을 누르거나,
;      build_installer.ps1을 실행한다 (자동으로 이 파일을 컴파일함)
;   3) 결과물: Output\Itda_Setup.exe - 이걸 사무실 PC에 옮겨서 더블클릭하면 설치 끝

#define MyAppName "잇다"
#define MyAppNameEng "Itda"
#define MyAppVersion "1.3.0"
#define MyAppPublisher "잇다 프로젝트"
#define MyAppExeName "잇다.exe"

[Setup]
AppId={{8F3E1A2B-4C5D-4E6F-8A9B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Program Files가 아니라 사용자 폴더(AppData)에 설치 -> 관리자 권한/UAC 프롬프트 불필요,
; 매일 쓰는 개인용 도구라 이게 훨씬 간편함
DefaultDirName={localappdata}\{#MyAppNameEng}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename={#MyAppNameEng}_Setup
SetupIconFile=itda_icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
DisableDirPage=no
; 제거해도 assistant.db/itda_config.json처럼 일부러 남겨두는 파일들 때문에 폴더가
; 완전히 비지는 않는데, 그것 때문에 재설치할 때마다 "폴더가 존재합니다" 경고가 뜨던
; 문제가 있었음 - 이 경고를 꺼서 그냥 조용히 넘어가게 함 (동작 자체는 항상 안전함)
DirExistsWarning=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 아이콘:"

[Files]
; PyInstaller가 만든 dist\잇다\ 폴더 전체(exe + 의존 라이브러리)를 설치 폴더로 복사.
; assistant.db/itda_config.json은 여기 포함되지 않음(앱 실행 중 새로 생성/관리되는 사용자 데이터라서) -
; 그래서 재설치/업데이트해도 기존 데이터가 안 지워짐.
Source: "dist\잇다\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Code]
// 잇다는 트레이 상주 기능이 있어서 창을 닫아도 백그라운드에 계속 떠있을 수 있다.
// 이 상태에서 설치/제거를 하면 exe 파일이 사용 중이라 파일 교체/삭제가 조용히
// 실패하고, "제거했는데도 트레이에 계속 남아있다"는 문제가 생긴다 - 그래서
// 설치 시작 전 + 제거 시작 전에 실행 중인 잇다.exe를 확실히 꺼준다.
procedure KillRunningItda;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM "{#MyAppExeName}" /T', '',
       SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function InitializeSetup(): Boolean;
begin
  KillRunningItda;
  Result := True;
end;

function InitializeUninstall(): Boolean;
begin
  KillRunningItda;
  Result := True;
end;

// 앱 파일을 지운 뒤, assistant.db/itda_config.json처럼 일부러 남겨뒀던 사용자 데이터도
// 같이 지울지 한 번 물어본다. "아니오"가 기본적으로 안전한 선택(데이터 보존)이고,
// 정말 완전히 깨끗하게 지우고 싶을 때만 "예"를 누르면 폴더까지 통째로 삭제된다.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if DirExists(ExpandConstant('{app}')) then
    begin
      if MsgBox('저장된 데이터(assistant.db, 설정, 로그 등)도 함께 삭제할까요?' + #13#10 +
                '나중에 재설치했을 때 기존 데이터를 이어서 쓰려면 "아니요"를 선택하세요.',
                mbConfirmation, MB_YESNO) = IDYES then
      begin
        DelTree(ExpandConstant('{app}'), True, True, True);
      end;
    end;
  end;
end;
