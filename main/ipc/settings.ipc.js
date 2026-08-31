// 사이드바 접힘, 대시보드 우측 패널 접힘, 프레즌스 등 앱 UI 상태를 저장.
// (localStorage 대신 SQLite app_settings를 단일 진실 공급원으로 사용하기로 한 결정 반영)
module.exports = function registerSettingsIpc(ipcMain, repos) {
  const { settings } = repos;

  ipcMain.handle('settings:get', (event, key) => {
    return settings.get(key);
  });

  // 여러 키를 한 번의 IPC 왕복으로 — 대시보드 mount가 설정을 15개 넘게 순차로 읽어
  // 화면 전환이 느려지던 것 완화. { key: value } 맵 반환(없는 키는 null).
  ipcMain.handle('settings:getMany', (event, keys) => {
    const out = {};
    if (Array.isArray(keys)) {
      for (const k of keys) out[k] = settings.get(k) ?? null;
    }
    return out;
  });

  ipcMain.handle('settings:set', (event, { key, value }) => {
    settings.set(key, value);
    return { key, value };
  });
};
