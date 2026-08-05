# 잇다(Itda) 전체 재빌드 스크립트 - exe + 설치 프로그램을 한 번에
#
# 코드 수정하고 새 버전 배포할 때마다 이 스크립트 하나만 실행하면 됩니다.
# (build_exe.ps1 + build_installer.ps1을 순서대로, 항상 깨끗한 상태에서 실행)
#
# 사용법:
#   powershell -ExecutionPolicy Bypass -File rebuild_all.ps1
#
# 결과물: Output\Itda_Setup.exe (이 파일을 배포하면 됨)
#
# 주의: 이 스크립트는 항상 콘솔 없는(--noconsole) 최종 배포용으로만 빌드합니다.
#       콘솔 보이는 디버그 버전이 필요하면 build_exe.ps1 -Debug를 따로 실행하세요.

$ErrorActionPreference = "Stop"

Write-Host "===== 이전 빌드 결과물 정리 =====" -ForegroundColor Cyan
foreach ($dir in @("build", "dist", "Output")) {
    if (Test-Path $dir) {
        Remove-Item $dir -Recurse -Force
        Write-Host "삭제: $dir"
    }
}

Write-Host "`n===== 1/2: .exe 빌드 (콘솔 없는 최종 버전) =====" -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File build_exe.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "exe 빌드 실패 - 중단합니다." -ForegroundColor Red
    exit 1
}

Write-Host "`n===== 2/2: 설치 프로그램(setup.exe) 빌드 =====" -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File build_installer.ps1
if ($LASTEXITCODE -ne 0) {
    Write-Host "설치 프로그램 빌드 실패 - 중단합니다." -ForegroundColor Red
    exit 1
}

Write-Host "`n===== 전체 재빌드 완료 =====" -ForegroundColor Green
Write-Host "배포할 파일: Output\Itda_Setup.exe"
Write-Host ""
Write-Host "설치 시 이전 버전이 있으면 자동으로 업그레이드됩니다 (assistant.db/itda_config.json은 유지됨)."
Write-Host "이전 버전을 먼저 지우고 싶으면 Windows 설정 > 앱에서 '잇다' 제거 후 재설치하세요."
