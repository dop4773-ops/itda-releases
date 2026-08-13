// Google OAuth 토큰은 별도 테이블 없이 기존 app_settings(key-value)에 저장한다.
// 잇다는 이미 로컬 SQLite 파일 자체를 신뢰 경계로 삼고 있어(문서화된 설계 원칙),
// 이 토큰 저장 방식도 그 원칙과 일관성을 유지한다 — 새 테이블을 만들 이유가 없음.
const KEYS = {
  refreshToken: 'google_refresh_token',
  accessToken: 'google_access_token',
  accessTokenExpiry: 'google_access_token_expiry', // ISO 문자열
  selectedCalendarId: 'google_selected_calendar_id', // 동기화 대상으로 고른 캘린더 (기본은 'primary')
  selectedCalendarName: 'google_selected_calendar_name', // 설정 화면 표시용 (예: "미래병원")
};

function saveTokens(settingsRepo, { refreshToken, accessToken, expiresIn }) {
  if (refreshToken) settingsRepo.set(KEYS.refreshToken, refreshToken);
  if (accessToken) settingsRepo.set(KEYS.accessToken, accessToken);
  if (expiresIn != null) {
    const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    settingsRepo.set(KEYS.accessTokenExpiry, expiry);
  }
}

function getTokens(settingsRepo) {
  return {
    refreshToken: settingsRepo.get(KEYS.refreshToken),
    accessToken: settingsRepo.get(KEYS.accessToken),
    accessTokenExpiry: settingsRepo.get(KEYS.accessTokenExpiry),
  };
}

function clearTokens(settingsRepo) {
  Object.values(KEYS).forEach((k) => settingsRepo.set(k, null));
}

function isConnected(settingsRepo) {
  return !!settingsRepo.get(KEYS.refreshToken);
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

module.exports = { KEYS, saveTokens, getTokens, clearTokens, isConnected, getSelectedCalendar, setSelectedCalendar };
