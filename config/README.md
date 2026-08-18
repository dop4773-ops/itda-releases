# config/

이 폴더는 `.gitignore`에 등록되어 있어 절대 GitHub에 올라가지 않습니다(README.md만 예외).

## google-credentials.json — 더 이상 여기 안 씁니다

⚠️ 예전엔 이 폴더에 `google-credentials.json`을 직접 넣어두는 방식이었는데,
**패키징된 설치본(exe)에서는 이 폴더 자체가 앱 안에 없어서 실제로는 절대 인식되지
않는 안내였습니다** (설치 폴더는 빌드 시점에 고정되는 읽기전용 리소스라, 설치 후에
사용자가 새 파일을 넣을 방법이 없음). 2026-08-16에 이 버그를 고치면서 저장 위치를
userData(`%APPDATA%\잇다\google-credentials.json`, 맥은 `~/Library/Application
Support/itda/`)로 옮겼습니다 — `assistant.db`, 자동백업과 같은 위치라 앱을 업데이트해도
유지됩니다.

**지금은 이렇게 하면 됩니다:**
1. Google Cloud Console에서 "데스크톱 앱" 타입 OAuth 클라이언트를 만들고 JSON을 다운로드
2. 잇다 실행 → 설정 → Google Calendar 탭 → **"인증 파일 선택…"** 버튼 클릭 → 방금 받은
   JSON 파일 선택

버튼이 알아서 올바른 위치로 파일을 복사해줍니다. 폴더 경로를 직접 찾아 들어갈 필요 없음.
