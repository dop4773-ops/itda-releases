const http = require('http');
const { shell } = require('electron');
const { loadCredentials } = require('./credentials');

// 읽기 전용 — 잇다는 Google Calendar에 절대 쓰지 않는다(설계 원칙, README/메모리 참고)
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function buildAuthUrl(credentials, redirectUri) {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // refresh_token을 받기 위해 필요
    prompt: 'consent', // 재연결 시에도 매번 refresh_token을 새로 받기 위해 동의 화면을 강제로 다시 띄움
  });
  return `${credentials.authUri}?${params.toString()}`;
}

// 사용 가능한 로컬 포트를 하나 찾는다 (0번 포트로 바인딩하면 OS가 빈 포트를 골라줌)
function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

// 로컬 루프백 서버를 열고, 시스템 브라우저에서 로그인 완료 후 리다이렉트되는
// authorization code를 받는다. Electron 데스크톱 앱의 표준 OAuth 패턴(loopback flow).
function waitForAuthCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, `http://127.0.0.1:${port}`);
      } catch {
        res.end('잘못된 요청입니다.');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (error) {
        res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>인증이 취소됐어요.</h2><p>이 창은 닫으셔도 됩니다.</p></body></html>');
        server.close();
        reject(new Error('사용자가 인증을 취소했거나 거부했습니다: ' + error));
        return;
      }
      if (code) {
        res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>인증이 완료됐어요! ✅</h2><p>이 창은 닫고 잇다로 돌아가세요.</p></body></html>');
        server.close();
        resolve(code);
        return;
      }
      res.end('잘못된 요청입니다.');
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1');

    // 사용자가 브라우저 창을 그냥 닫아버리는 경우까지 대비한 타임아웃
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('인증 시간이 초과됐어요(5분). 다시 시도해주세요.'));
    }, 5 * 60 * 1000);
    server.on('close', () => clearTimeout(timer));
  });
}

async function exchangeCodeForTokens(credentials, code, redirectUri) {
  const res = await fetch(credentials.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`토큰 교환에 실패했어요 (${res.status}): ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(credentials, refreshToken) {
  const res = await fetch(credentials.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`토큰 갱신에 실패했어요 (${res.status}): ${await res.text()}`);
  return res.json(); // { access_token, expires_in, ... } (refresh_token은 보통 다시 안 옴)
}

// 전체 흐름: 빈 포트 찾기 -> 시스템 브라우저 열기 -> code 대기 -> 토큰 교환
async function runAuthFlow() {
  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error('config/google-credentials.json 파일을 찾을 수 없어요. 안내드린 위치에 넣어주세요.');
  }

  const port = await findAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = buildAuthUrl(credentials, redirectUri);

  const codePromise = waitForAuthCode(port);
  await shell.openExternal(authUrl);
  const code = await codePromise;

  return exchangeCodeForTokens(credentials, code, redirectUri);
}

module.exports = { runAuthFlow, refreshAccessToken, buildAuthUrl, findAvailablePort, waitForAuthCode };
