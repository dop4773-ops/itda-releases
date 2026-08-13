const fs = require('fs');
const path = require('path');

// config/ 는 .gitignore 대상 — 사용자가 Google Cloud Console에서 발급받은 OAuth 클라이언트
// JSON 파일을 직접 이 경로에 넣어둔다. 저장소에는 절대 포함되지 않는다.
const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'config', 'google-credentials.json');

// 파일이 없거나 형식이 이상해도 앱이 죽지 않고 null을 반환 — 호출부에서
// "연동 파일이 없어요" 같은 안내로 자연스럽게 처리한다.
function loadCredentials() {
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

module.exports = { loadCredentials, CREDENTIALS_PATH };
