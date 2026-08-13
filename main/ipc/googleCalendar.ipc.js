const tokenStore = require('../google-calendar/token-store');
const { runAuthFlow } = require('../google-calendar/oauth-flow');
const { loadCredentials } = require('../google-calendar/credentials');
const { getValidAccessToken } = require('../google-calendar/token-manager');
const { syncNow, fetchCalendarList } = require('../google-calendar/sync');

module.exports = function registerGoogleCalendarIpc(ipcMain, repos) {
  ipcMain.handle('googleCalendar:status', () => {
    return {
      connected: tokenStore.isConnected(repos.settings),
      hasCredentialsFile: !!loadCredentials(),
      lastSyncedAt: repos.googleCalendar.lastSyncedAt(),
      selectedCalendar: tokenStore.getSelectedCalendar(repos.settings),
    };
  });

  ipcMain.handle('googleCalendar:connect', async () => {
    const tokens = await runAuthFlow(); // 실패하면 그대로 throw → 렌더러가 catch해서 토스트로 안내
    tokenStore.saveTokens(repos.settings, {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
    });
    const { id: calendarId } = tokenStore.getSelectedCalendar(repos.settings); // 기본 'primary'
    const result = await syncNow(repos, () => getValidAccessToken(repos.settings), calendarId);
    return { connected: true, ...result };
  });

  ipcMain.handle('googleCalendar:disconnect', () => {
    tokenStore.clearTokens(repos.settings);
    repos.googleCalendar.clearAll();
    return { connected: false };
  });

  ipcMain.handle('googleCalendar:syncNow', async () => {
    const { id: calendarId } = tokenStore.getSelectedCalendar(repos.settings);
    return syncNow(repos, () => getValidAccessToken(repos.settings), calendarId);
  });

  ipcMain.handle('googleCalendar:range', (event, { fromDate, toDate }) => {
    return repos.googleCalendar.range(fromDate, toDate);
  });

  // 연결된 구글 계정이 접근 가능한 캘린더 목록(예: "미래병원", 개인 캘린더 등)을 가져온다.
  // 설정 화면의 "동기화할 캘린더" 드롭다운에 쓰인다.
  ipcMain.handle('googleCalendar:listCalendars', async () => {
    const accessToken = await getValidAccessToken(repos.settings);
    return fetchCalendarList(accessToken);
  });

  // 동기화할 캘린더를 바꾸면, 이전 캘린더의 캐시된 이벤트는 지우고 새 캘린더로 즉시 재동기화한다
  // (섞여 남아있으면 "미래병원"만 골랐는데 예전 캘린더 일정이 계속 보이는 혼란을 줄 수 있음)
  ipcMain.handle('googleCalendar:selectCalendar', async (event, { id, name }) => {
    tokenStore.setSelectedCalendar(repos.settings, { id, name });
    repos.googleCalendar.clearAll();
    return syncNow(repos, () => getValidAccessToken(repos.settings), id);
  });
};
