# ============================================================
# 잇다 (Itda) Windows 환경 점검 스크립트
#
# 우클릭 > PowerShell로 실행 하면 스크립트가 끝나자마자 창이 닫혀버려서
# 결과를 볼 수 없습니다. 아래처럼 PowerShell을 먼저 열고 실행하는 걸 권장합니다.
#
# 사용법:
#   1. 시작 메뉴에서 "Windows PowerShell" 검색해서 실행 (관리자 권한 불필요)
#   2. cd 명령으로 이 파일이 있는 scripts 폴더로 이동
#      예) cd C:\Users\사용자명\Downloads\itda\scripts
#   3. 아래 명령 실행 (Bypass는 이번 실행에만 적용되고 시스템 설정은 바꾸지 않음)
#      powershell -ExecutionPolicy Bypass -File .\check_windows_env.ps1
# ============================================================

$ErrorActionPreference = 'Continue'
trap {
    Write-Host "`n[예상치 못한 오류] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "위 메시지를 그대로 복사해서 알려주시면 원인을 확인해드릴게요.`n" -ForegroundColor Yellow
    Read-Host "계속하려면 Enter를 누르세요"
    exit 1
}

Write-Host "`n=== 잇다 Windows 환경 점검 ===" -ForegroundColor Cyan

$problems = @()

# ---------- 1. Node.js ----------
Write-Host "`n[1/7] Node.js 확인..." -NoNewline
try {
    $nodeVersion = node -v 2>$null
    if ($nodeVersion) {
        $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
        if ($major -ge 18) {
            Write-Host " OK ($nodeVersion)" -ForegroundColor Green
            if ($major -ge 23) {
                Write-Host "     ↳ 경고: Node.js $major 는 최신 버전입니다. Node.js 24.16.0 이상/26.1.0 이상에서는" -ForegroundColor Yellow
                Write-Host "       Electron 설치 시 압축 해제가 조용히 실패하는 확인된 버그가 있습니다" -ForegroundColor Yellow
                Write-Host "       (electron/electron#51619). 이 문제가 발생하면 README.md의 'Electron 압축 해제 실패'" -ForegroundColor Yellow
                Write-Host "       항목을 참고하거나, Node.js 22.x LTS로 낮추는 걸 권장합니다." -ForegroundColor Yellow
            }
        } else {
            Write-Host " 버전이 낮음 ($nodeVersion, 18 이상 권장)" -ForegroundColor Yellow
            $problems += "Node.js 18 이상으로 업그레이드 권장 (nodejs.org 에서 LTS 다운로드)"
        }
    } else {
        throw "not found"
    }
} catch {
    Write-Host " 설치 안 됨" -ForegroundColor Red
    $problems += "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치해주세요."
}

# ---------- 2. npm ----------
Write-Host "[2/7] npm 확인..." -NoNewline
try {
    $npmVersion = npm -v 2>$null
    if ($npmVersion) { Write-Host " OK ($npmVersion)" -ForegroundColor Green }
    else { throw "not found" }
} catch {
    Write-Host " 없음" -ForegroundColor Red
    $problems += "npm을 찾을 수 없습니다 (보통 Node.js와 함께 설치됩니다)."
}

# ---------- 3. 인터넷 연결 (npm install이 패키지를 받아와야 함) ----------
Write-Host "[3/7] npm 레지스트리 연결 확인..." -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://registry.npmjs.org" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " 연결 실패" -ForegroundColor Red
    $problems += "registry.npmjs.org 접속이 안 됩니다. 병원 네트워크 방화벽/프록시 설정을 확인해주세요. " +
                  "(npm install 시 better-sqlite3의 사전 컴파일된 바이너리를 여기서 받아옵니다)"
}

# ---------- 4. 아키텍처 (better-sqlite3 사전 빌드 바이너리와 매칭되어야 함) ----------
Write-Host "[4/7] 시스템 아키텍처 확인..." -NoNewline
$arch = $env:PROCESSOR_ARCHITECTURE
Write-Host " $arch" -ForegroundColor $(if ($arch -eq "AMD64") { "Green" } else { "Yellow" })
if ($arch -ne "AMD64") {
    $problems += "일반적인 x64(AMD64)가 아닙니다 ($arch). better-sqlite3 사전 빌드 바이너리가 없을 수 있어요."
}

# ---------- 5. %APPDATA% 쓰기 권한 (DB가 저장될 위치) ----------
Write-Host "[5/7] 데이터 폴더 쓰기 권한 확인..." -NoNewline
$testPath = Join-Path $env:APPDATA "itda_write_test.tmp"
try {
    "test" | Out-File -FilePath $testPath -ErrorAction Stop
    Remove-Item $testPath -ErrorAction SilentlyContinue
    Write-Host " OK ($env:APPDATA)" -ForegroundColor Green
} catch {
    Write-Host " 쓰기 실패" -ForegroundColor Red
    $problems += "%APPDATA% 폴더에 쓰기 권한이 없습니다. 병원 PC 계정 권한을 확인해주세요."
}

# ---------- 6. Visual C++ 재배포 패키지 (네이티브 모듈 실행에 필요) ----------
Write-Host "[6/7] Visual C++ Redistributable 확인..." -NoNewline
$vcInstalled = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" -ErrorAction SilentlyContinue
if ($vcInstalled) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " 확인 안 됨 (없을 수도 있음)" -ForegroundColor Yellow
    $problems += "Visual C++ Redistributable이 없을 수 있습니다. better-sqlite3 실행 오류가 나면 " +
                  "https://aka.ms/vs/17/release/vc_redist.x64.exe 를 설치해보세요."
}

# ---------- 7. GitHub 접속 (Electron 바이너리 다운로드 경로) ----------
Write-Host "[7/7] GitHub 접속 확인 (Electron 바이너리 다운로드용)..." -NoNewline
try {
    $null = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " 연결 실패" -ForegroundColor Red
    $problems += "github.com 접속이 안 됩니다. npm install은 성공해도 Electron 실행파일 다운로드가 " +
                  "실패해서 'npm start' 시 'Electron failed to install correctly' 에러가 날 수 있습니다. " +
                  "이 프로젝트의 .npmrc에 미러 설정을 이미 넣어뒀으니 그대로 진행해보고, 안 되면 " +
                  "README.md의 'Electron 바이너리 다운로드 실패' 항목을 참고하세요."
}

# ---------- 결과 요약 ----------
Write-Host "`n=== 결과 ===" -ForegroundColor Cyan
if ($problems.Count -eq 0) {
    Write-Host "모든 항목 통과. npm install 진행하셔도 됩니다." -ForegroundColor Green
} else {
    Write-Host "$($problems.Count)개 항목을 확인해주세요:" -ForegroundColor Yellow
    $problems | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
}
Write-Host ""
Read-Host "확인했으면 Enter를 눌러 창을 닫으세요"
