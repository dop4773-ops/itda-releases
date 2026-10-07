// Google OAuth 토큰은 별도 테이블 없이 기존 app_settings(key-value)에 저장한다.
// 다만 토큰(리프레시/액세스)은 DB 파일이나 백업이 복사돼도 못 쓰도록 OS 계정에 묶어 암호화해서 넣는다
// (Electron safeStorage — 윈도우는 DPAPI). 암호화를 못 쓰는 환경이면 예전처럼 평문으로 저장한다.
// 값 형식: 'enc1:<base64>' = 암호화됨, 그 외 = 예전 평문(읽을 때 자동으로 암호화본으로 바꿔 저장).
const ENC_PREFIX = 'enc1:';
let cipher; // 테스트에서 가짜로 바꿔 끼울 수 있게 모듈 안에 둔다
function getCipher() {
  if (cipher !== undefined) return cipher;
  try {
    const { safeStorage } = require('electron');
    cipher = safeStorage?.isEncryptionAvailable?.() ? safeStorage : null;
  } catch (e) {
    cipher = null;
  }
  return cipher;
}
function __setCipherForTest(c) {
  cipher = c;
}

function seal(plain) {
  const c = getCipher();
  return c ? ENC_PREFIX + c.encryptString(plain).toString('base64') : plain;
}
// 복호화 못 하면(다른 PC/계정에서 복사된 DB 등) null — 호출하는 쪽은 "연결 안 됨"으로 처리한다
function open(stored) {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored || null;
  try {
    return getCipher().decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch (e) {
    return null;
  }
}
const KEYS = {
  refreshToken: 'google_refresh_token',
  accessToken: 'google_access_token',
  accessTokenExpiry: 'google_access_token_expiry', // ISO 문자열
  selectedCalendarId: 'google_selected_calendar_id', // 동기화 대상으로 고른 캘린더 (기본은 'primary')
  selectedCalendarName: 'google_selected_calendar_name', // 설정 화면 표시용 (예: "미래병원")
};

function saveTokens(settingsRepo, { refreshToken, accessToken, expiresIn }) {
  if (refreshToken) settingsRepo.set(KEYS.refreshToken, seal(refreshToken));
  if (accessToken) settingsRepo.set(KEYS.accessToken, seal(accessToken));
  if (expiresIn != null) {
    const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    settingsRepo.set(KEYS.accessTokenExpiry, expiry);
  }
}

function getTokens(settingsRepo) {
  const raw = { refreshToken: settingsRepo.get(KEYS.refreshToken), accessToken: settingsRepo.get(KEYS.accessToken) };
  // 예전 평문 토큰이 남아 있으면 읽는 김에 암호화본으로 바꿔 둔다(암호화를 못 쓰는 환경이면 seal이 평문 그대로라 변화 없음)
  for (const [name, key] of [['refreshToken', KEYS.refreshToken], ['accessToken', KEYS.accessToken]]) {
    if (raw[name] && !raw[name].startsWith(ENC_PREFIX) && getCipher()) settingsRepo.set(key, seal(raw[name]));
  }
  return {
    refreshToken: open(raw.refreshToken),
    accessToken: open(raw.accessToken),
    accessTokenExpiry: settingsRepo.get(KEYS.accessTokenExpiry),
  };
}

function clearTokens(settingsRepo) {
  Object.values(KEYS).forEach((k) => settingsRepo.set(k, null));
}

function isConnected(settingsRepo) {
  return !!open(settingsRepo.get(KEYS.refreshToken));
}

function getSelectedCalendar(settingsRepo) {
  return {
    id: settingsRepo.get(KEYS.selectedCalendarId) || 'primary',
    name: settingsRepo.get(KEYS.selectedCalendarName) || null,
  };
}

function setSelectedCalendar(settingsRepo, { id, name }) {
  settingsRepo.set(KEYS.selectedCalendarId, id);
  settingsRepo.set(KEYS.selectedCalendarName, name || null);
}

module.exports = { __setCipherForTest, KEYS, saveTokens, getTokens, clearTokens, isConnected, getSelectedCalendar, setSelectedCalendar };
