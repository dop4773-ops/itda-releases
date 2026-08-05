# 잇다(Itda) 설치 프로그램(setup.exe) 빌드 스크립트
#
# 사전 준비 (한 번만):
#   1) build_exe.ps1을 먼저 실행해서 dist\잇다\ 폴더를 만들어둔다
#   2) Inno Setup(무료) 설치: https://jrsoftware.org/isdl.php
#      "Inno Setup Compiler" 다운로드해서 기본 설정으로 설치하면 됨
#
# 사용법:
#   powershell -ExecutionPolicy Bypass -File build_installer.ps1
#
# 결과물: Output\Itda_Setup.exe (이 파일 하나만 배포하면 됨)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

if (-not (Test-Path "dist\잇다\잇다.exe")) {
    Write-Host "dist\잇다\잇다.exe가 없습니다. 먼저 build_exe.ps1을 실행해주세요:" -ForegroundColor Red
    Write-Host "  powershell -ExecutionPolicy Bypass -File build_exe.ps1" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path "installer.iss")) {
    Write-Host "installer.iss가 이 폴더에 없습니다." -ForegroundColor Red
    exit 1
}

# Inno Setup Compiler(ISCC.exe) 찾기 - 기본 설치 경로들을 순서대로 확인
$isccCandidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
)
$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
    Write-Host "Inno Setup Compiler(ISCC.exe)를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "https://jrsoftware.org/isdl.php 에서 'Inno Setup Compiler'를 먼저 설치해주세요." -ForegroundColor Yellow
    exit 1
}

Write-Host "===== 설치 프로그램(setup.exe) 빌드 시작 =====" -ForegroundColor Cyan
Write-Host "Inno Setup: $iscc"

& $iscc "installer.iss"

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n빌드 실패. 위 에러 메시지를 확인해주세요." -ForegroundColor Red
    exit 1
}

Write-Host "`n===== 빌드 완료 =====" -ForegroundColor Green
Write-Host "결과물: Output\Itda_Setup.exe"
Write-Host "이 파일을 사무실 PC로 옮겨서 더블클릭하면 설치됩니다 (관리자 권한 불필요)."
