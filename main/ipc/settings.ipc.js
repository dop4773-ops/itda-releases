// 사이드바 접힘, 대시보드 우측 패널 접힘, 프레즌스 등 앱 UI 상태를 저장.
// (localStorage 대신 SQLite app_settings를 단일 진실 공급원으로 사용하기로 한 결정 반영)
module.exports = function registerSettingsIpc(ipcMain, repos) {
  const { settings } = repos;

  ipcMain.handle('settings:get', (event, key) => {
    return settings.get(key);
  });

  ipcMain.handle('settings:set', (event, { key, value }) => {
    settings.set(key, value);
    return { key, value };
  });
};
