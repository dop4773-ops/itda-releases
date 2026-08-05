# 잇다(Itda) Windows 이관 사전 체크 스크립트
# 사무실 PC에서 PowerShell(관리자 권한 아니어도 됨)로 실행:
#   powershell -ExecutionPolicy Bypass -File check_windows_env.ps1
# 또는 파일 내용을 복사해서 PowerShell 창에 붙여넣기만 해도 됩니다.
# 결과를 통째로 복사해서 Claude에게 보여주세요.

Write-Host "===== 1. OS / 시스템 정보 =====" -ForegroundColor Cyan
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, OSArchitecture, Version, BuildNumber

Write-Host "`n===== 2. CPU =====" -ForegroundColor Cyan
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed

Write-Host "`n===== 3. 메모리(RAM) =====" -ForegroundColor Cyan
$mem = Get-CimInstance Win32_ComputerSystem
"{0} GB (전체)" -f [math]::Round($mem.TotalPhysicalMemory / 1GB, 1)
Get-CimInstance Win32_OperatingSystem | ForEach-Object {
    "{0} GB (여유)" -f [math]::Round($_.FreePhysicalMemory / 1MB, 1)
}

Write-Host "`n===== 4. 디스크 여유공간 =====" -ForegroundColor Cyan
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |
    Select-Object DeviceID, @{N='SizeGB';E={[math]::Round($_.Size/1GB,1)}}, @{N='FreeGB';E={[math]::Round($_.FreeSpace/1GB,1)}}

Write-Host "`n===== 5. GPU (있으면 llama.cpp GPU 가속 가능성 체크용) =====" -ForegroundColor Cyan
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion

Write-Host "`n===== 6. Python 설치 여부 =====" -ForegroundColor Cyan
try { python --version } catch { Write-Host "python 명령어 없음 (PATH 미등록 또는 미설치)" -ForegroundColor Yellow }
try { python3 --version } catch { Write-Host "python3 명령어 없음" -ForegroundColor Yellow }
try { py --version } catch { Write-Host "py 런처 없음" -ForegroundColor Yellow }

Write-Host "`n===== 7. pip / 인터넷(PyPI) 접근 가능 여부 =====" -ForegroundColor Cyan
try {
    $result = Invoke-WebRequest -Uri "https://pypi.org" -UseBasicParsing -TimeoutSec 5
    "PyPI 접근 가능 (status $($result.StatusCode))"
} catch {
    Write-Host "PyPI 접근 실패 - 사내망 방화벽/프록시 있을 수 있음: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n===== 8. 현재 로그인 계정 권한 (관리자 여부) =====" -ForegroundColor Cyan
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
"관리자 권한: $isAdmin"

Write-Host "`n===== 9. IP메신저/미래랜메신저 설치 경로 (참고용, 있으면) =====" -ForegroundColor Cyan
Get-ChildItem -Path "C:\Program Files","C:\Program Files (x86)" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "IP.?Messenger|MiraeLan|미래랜" }

Write-Host "`n===== 10. 작업 스케줄러(Task Scheduler) 서비스 상태 =====" -ForegroundColor Cyan
Get-Service -Name Schedule | Select-Object Status, StartType

Write-Host "`n===== 체크 끝. 위 결과 전체를 복사해서 Claude에게 붙여넣어 주세요 =====" -ForegroundColor Green
