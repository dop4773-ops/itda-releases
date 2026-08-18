const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// userData(예: %APPDATA%\잇다\)에 둔다 — 패키징된 앱의 설치 폴더(resources/app.asar)는
// 빌드 시점에 고정되는 읽기전용 아카이브라, 설치 후에 사용자가 파일을 새로 넣을 수 있는
// 곳이 아니다. 예전엔 프로젝트 폴더 안 config/에서 읽었는데, 그건 개발 모드(npm start)
// 에서만 우연히 동작했을 뿐 패키징된 실제 설치본에서는 애초에 인식될 수 없는 경로였음
// (설정 화면에서 "인증 파일 선택"으로 여기 복사해줌 — main/ipc/googleCalendar.ipc.js 참고).
// assistant.db/backups와 같은 위치라 업데이트해도 유지된다.
// 함수로 두는 이유: app.getPath는 app이 준비된 뒤에만 안전한데, 이 모듈은 main.js가
// app.whenReady() 이전에(require 체인을 통해) 먼저 로드하므로 값을 모듈 로드 시점에
// 바로 계산해두면 안 된다 — 실제로 쓰일 때(IPC 핸들러 호출 시점, 이미 ready 이후)만 계산한다.
function getCredentialsPath() {
  return path.join(app.getPath('userData'), 'google-credentials.json');
}

// 파일이 없거나 형식이 이상해도 앱이 죽지 않고 null을 반환 — 호출부에서
// "연동 파일이 없어요" 같은 안내로 자연스럽게 처리한다.
function loadCredentials() {
  const CREDENTIALS_PATH = getCredentialsPath();
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    // Google이 "데스크톱 앱" 타입으로 내려주는 JSON은 "installed" 키 아래 들어있다.
    // 혹시 다른 타입으로 잘못 발급받았어도 "web" 키까지는 한 번 더 시도해준다.
    const cred = raw.installed || raw.web;
    if (!cred || !cred.client_id || !cred.client_secret) return null;
    return {
      clientId: cred.client_id,
      clientSecret: cred.client_secret,
      authUri: cred.auth_uri || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUri: cred.token_uri || 'https://oauth2.googleapis.com/token',
    };
  } catch (e) {
    console.error('[itda] google-credentials.json 파싱 실패:', e.message);
    return null;
  }
}

module.exports = { loadCredentials, getCredentialsPath };
