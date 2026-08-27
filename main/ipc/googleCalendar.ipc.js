const fs = require('fs');
const { dialog, BrowserWindow } = require('electron');
const tokenStore = require('../google-calendar/token-store');
const { runAuthFlow } = require('../google-calendar/oauth-flow');
const { loadCredentials, getCredentialsPath } = require('../google-calendar/credentials');
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

  // Google Cloud Console에서 받은 OAuth 클라이언트 JSON을 사용자가 직접 골라서 userData로
  // 복사해온다. 예전엔 "프로젝트 폴더의 config/에 파일을 넣어두세요"였는데, 패키징된 설치본은
  // 그 폴더 자체가 없어서(읽기전용 앱 리소스) 실제로는 절대 인식될 수 없는 안내였다.
  ipcMain.handle('googleCalendar:importCredentialsFile', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Google OAuth 클라이언트 JSON 선택',
      properties: ['openFile'],
      filters: [{ name: 'JSON 파일', extensions: ['json'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { imported: false };

    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    const cred = raw.installed || raw.web;
    if (!cred || !cred.client_id || !cred.client_secret) {
      throw new Error('올바른 Google OAuth 클라이언트 JSON이 아니에요.');
    }
    fs.copyFileSync(filePaths[0], getCredentialsPath());
    return { imported: true };
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

  // ================= 주기적 자동 동기화 =================
  // 예전엔 연결/수동 동기화/캘린더 변경 시에만 동기화해서, 앱을 오래 켜둔 채로 구글 쪽에서
  // 일정이 바뀌면(예: 병원 어드민이 새 휴가를 올림) 재연결하거나 "지금 동기화"를 직접 누르기
  // 전까진 반영이 안 됐다. 설정(google_calendar_sync_interval_min)으로 주기를 바꿀 수 있고,
  // 값이 없으면 30분이 기본, 0이면 자동 동기화를 끄고 수동 버튼으로만 동기화한다.
  // setInterval 자체를 설정이 바뀔 때마다 새로 만들지 않고, 짧은 틱(1분)마다 "마지막 동기화
  // 이후 설정된 시간이 지났는지"를 확인하는 방식이라 사용자가 값을 바꿔도 앱 재시작 없이
  // 다음 틱부터 바로 반영된다.
  const AUTO_SYNC_TICK_MS = 60 * 1000;
  let lastAutoSyncAt = 0;
  function getSyncIntervalMinutes() {
    const raw = repos.settings.get('google_calendar_sync_interval_min');
    if (raw === undefined || raw === null || raw === '') return 30;
    return Number(raw) || 0;
  }
  setInterval(async () => {
    if (!tokenStore.isConnected(repos.settings)) return;
    const intervalMin = getSyncIntervalMinutes();
    if (intervalMin <= 0) return;
    if (Date.now() - lastAutoSyncAt < intervalMin * 60 * 1000) return;
    lastAutoSyncAt = Date.now();
    try {
      const { id: calendarId } = tokenStore.getSelectedCalendar(repos.settings);
      await syncNow(repos, () => getValidAccessToken(repos.settings), calendarId);
    } catch (err) {
      console.error('[itda] 구글 캘린더 자동 동기화 실패:', err.message);
    }
  }, AUTO_SYNC_TICK_MS);
};
