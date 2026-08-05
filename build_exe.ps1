# 잇다(Itda) .exe 빌드 스크립트
#
# 사전 준비 (한 번만):
#   py -3.12 -m pip install flask pywebview pyinstaller joblib scikit-learn pystray pillow
#   (joblib/scikit-learn은 "설정 > 지금 수집하기"의 2단계 ML 분류에 필요합니다.
#    pystray/pillow는 작업표시줄 트레이 상주 기능에 필요합니다.
#    둘 다 없어도 빌드/실행은 되고, 해당 기능만 비활성화됩니다.)
#
# 사용법:
#   1) 처음 빌드할 땐 콘솔 보이는 채로 (에러 나면 바로 보임):
#        powershell -ExecutionPolicy Bypass -File build_exe.ps1 -Debug
#   2) 잘 되는 거 확인되면 콘솔 없는 깔끔한 버전으로:
#        powershell -ExecutionPolicy Bypass -File build_exe.ps1
#
# 빌드 결과물: dist\잇다\잇다.exe
#   그 옆에 같이 두면 자동으로 인식되는 파일들:
#     - assistant.db (없으면 처음엔 빈 상태로 시작)
#     - itda_config.json (모델/소스 경로 설정 - 앱의 '설정' 화면에서도 만들고 수정 가능)
#
# 폴더 구조 주의: static\fonts\Pretendard-*.woff2 파일들이 itda_app.py와 같은 폴더의
# static\fonts\ 안에 있어야 합니다 (화면 폰트용, 없으면 기본 시스템 폰트로 대체됨).

param(
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

# py -3.12 -c "import X"가 (X가 없어서) 실패할 때, 일부 PowerShell 환경에서
# $ErrorActionPreference="Stop"과 맞물려 스크립트 전체가 죽어버리는 문제가 있었다.
# 위의 설정 하나로는 환경에 따라 안 먹힐 수 있어서, 더 확실하게 try/catch로
# 감싸서 어떤 PowerShell 버전에서도 절대 스크립트가 안 죽게 만든다.
function Test-PyModule {
    param([string]$ModuleName)
    try {
        py -3.12 -c "import $ModuleName" *>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

if (-not (Test-Path "itda_app.py")) {
    Write-Host "itda_app.py가 이 폴더에 없습니다. C:\itda_project 에서 실행해주세요." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "itda_review_app.py")) {
    Write-Host "itda_review_app.py가 이 폴더에 없습니다." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path "static\fonts")) {
    Write-Host "경고: static\fonts 폴더가 없습니다 - 화면 폰트가 기본 시스템 폰트로 대체됩니다." -ForegroundColor Yellow
    Write-Host "      (기능은 정상 동작하니 급하면 넘어가도 됩니다)" -ForegroundColor Yellow
}

# 이 파일들은 없어도 빌드는 되지만, 없으면 해당 기능만 못 씀 (나머지는 정상)
$optionalFiles = @{
    "itda_llm_stage3.py"   = "분석하기(붙여넣기 AI 분류) 기능"
    "itda_pipeline_v2.py"  = "설정 > 지금 수집하기 기능"
    "itda_adapters.py"     = "설정 > 지금 수집하기 기능"
    "itda_rules.py"        = "설정 > 지금 수집하기 기능"
}
foreach ($file in $optionalFiles.Keys) {
    if (-not (Test-Path $file)) {
        Write-Host "안내: $file 없음 -> $($optionalFiles[$file])은 빌드에는 포함 안 되고, 실행 시 에러 메시지로 안내됩니다." -ForegroundColor Yellow
    }
}

$iconArg = @()
if (Test-Path "itda_icon.ico") {
    $iconArg = @("--icon", "itda_icon.ico")
    Write-Host "아이콘 적용: itda_icon.ico" -ForegroundColor Cyan
} else {
    Write-Host "itda_icon.ico가 없어서 기본 아이콘으로 빌드합니다." -ForegroundColor Yellow
}

# static\fonts 폴더(Pretendard 웹폰트) + itda_icon.ico(트레이 아이콘용)를 exe 안에 데이터로 포함시킴.
# PyInstaller --add-data 형식(Windows): "원본경로;대상경로"
# 주의: itda_icon.ico는 --icon 옵션(exe 파일 자체의 아이콘)과는 별개로, 트레이 아이콘을
#       런타임에 실제 파일로 읽어야 해서 --add-data로도 한 번 더 포함시켜야 함.
$addDataArg = @()
if (Test-Path "static\fonts") {
    $addDataArg += @("--add-data", "static\fonts;static\fonts")
}
if (Test-Path "itda_icon.ico") {
    $addDataArg += @("--add-data", "itda_icon.ico;.")
}

$consoleFlag = if ($Debug) { "--console" } else { "--noconsole" }
Write-Host "===== 잇다 .exe 빌드 시작 (모드: $consoleFlag) =====" -ForegroundColor Cyan

# 아래 모듈들은 코드 안에서 함수 호출 시점에만 import되는(지연 임포트) 구조라
# PyInstaller가 정적 분석만으로는 자동으로 못 찾을 수 있음 - 명시적으로 알려줘야 함
$hiddenImports = @(
    "itda_llm_stage3",
    "itda_pipeline_v2",
    "itda_adapters",
    "itda_rules"
)

# joblib/scikit-learn은 선택사항("지금 수집하기"의 ML 2단계용) - 실제로 설치돼있을 때만
# hidden-import에 추가한다. 예전엔 무조건 추가해서, 설치 안 하고 빌드하면 exe 안에 이
# 모듈들이 아예 안 담긴 채로 "No module named 'joblib'" 에러가 나는 문제가 있었음.
$hasJoblib = Test-PyModule "joblib"
if ($hasJoblib) {
    $hiddenImports += "joblib"
    Write-Host "joblib 감지됨 - 지금 수집하기(ML 2단계) 기능 포함해서 빌드" -ForegroundColor Cyan
} else {
    Write-Host "joblib 미설치 - 지금 수집하기(ML 2단계) 기능 없이 빌드됩니다" -ForegroundColor Yellow
    Write-Host "  (pip install joblib scikit-learn 실행 후 재빌드하면 활성화됩니다)" -ForegroundColor Yellow
}
$hasSklearn = Test-PyModule "sklearn"
if ($hasSklearn) {
    $hiddenImports += "sklearn.feature_extraction.text"
    $hiddenImports += "sklearn.linear_model"
} elseif ($hasJoblib) {
    Write-Host "경고: joblib은 있는데 scikit-learn이 없어요 - 둘 다 있어야 ML 기능이 동작합니다" -ForegroundColor Yellow
}

# pystray/Pillow는 선택사항 - 실제로 설치돼있을 때만 hidden-import에 추가한다
# (설치 안 된 모듈을 억지로 추가하면 PyInstaller 빌드 자체가 실패함)
if (Test-PyModule "pystray") {
    $hiddenImports += "pystray"
    Write-Host "pystray 감지됨 - 트레이 상주 기능 포함해서 빌드" -ForegroundColor Cyan
} else {
    Write-Host "pystray 미설치 - 트레이 상주 기능 없이 빌드 (pip install pystray pillow 후 재빌드하면 활성화)" -ForegroundColor Yellow
}
if (Test-PyModule "PIL") {
    $hiddenImports += "PIL"
}

$hiddenImportArgs = $hiddenImports | ForEach-Object { "--hidden-import"; $_ }

# llama-cpp-python은 llama.dll 같은 네이티브 라이브러리를 자기 패키지 폴더 안의
# 정해진 상대경로(예: llama_cpp/lib/)에서 찾는데, --hidden-import만으로는 이 DLL이
# 안 딸려와서 "연결 테스트"가 '지정된 경로를 찾을 수 없습니다: ...\llama_cpp\lib'
# 같은 에러로 실패하는 문제가 있었음. --collect-all로 데이터+바이너리+서브모듈을
# 통째로 포함시켜야 한다.
$collectAllArgs = @()
if (Test-PyModule "llama_cpp") {
    $collectAllArgs += @("--collect-all", "llama_cpp")
    Write-Host "llama_cpp 감지됨 - 네이티브 라이브러리까지 전부 포함해서 빌드" -ForegroundColor Cyan
} else {
    Write-Host "llama_cpp 미설치 - 분석하기(AI) 기능 없이 빌드됩니다" -ForegroundColor Yellow
}

# scikit-learn도 컴파일된 확장 모듈(.pyd)이 많아서 --hidden-import만으로는 누락될 수 있음
if ($hasSklearn) {
    $collectAllArgs += @("--collect-all", "sklearn")
}

py -3.12 -m PyInstaller `
    --name "잇다" `
    --onedir `
    $consoleFlag `
    --clean `
    --noconfirm `
    @iconArg `
    @addDataArg `
    @hiddenImportArgs `
    @collectAllArgs `
    itda_app.py

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n빌드 실패. 위 에러 메시지를 확인해주세요." -ForegroundColor Red
    exit 1
}

Write-Host "`n===== 빌드 완료 =====" -ForegroundColor Green
Write-Host "결과물: dist\잇다\잇다.exe"
Write-Host "실행 전에 assistant.db 파일을 dist\잇다\ 폴더 안에 복사해두세요 (없으면 자동으로 빈 걸 못 찾아서 경고만 뜨고 동작은 함)."
Write-Host "테스트: dist\잇다\잇다.exe 더블클릭"
