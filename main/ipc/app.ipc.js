const { app, BrowserWindow } = require('electron');

// 아이템을 바탕화면으로 드래그해서 위젯으로 열 때, "메인 윈도우 밖으로 나갔는지"를
// renderer가 판단할 수 있도록 메인 윈도우의 현재 화면 좌표/크기를 제공한다.
module.exports = function registerAppIpc(ipcMain, getMainWindow) {
  ipcMain.handle('app:getMainWindowBounds', () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return win.getBounds();
  });

  // 윈도우 시작 시 자동 실행 — Electron 내장 API 하나로 충분해서 별도 레지스트리 조작 없음.
  // 개발 모드(패키징 안 된 실행)에서는 실행 파일 경로가 electron.exe라 의미가 없어서 항상 false로 응답.
  ipcMain.handle('app:getAutoLaunch', () => {
    if (!app.isPackaged) return { enabled: false };
    return { enabled: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('app:setAutoLaunch', (event, enabled) => {
    if (!app.isPackaged) throw new Error('개발 모드에서는 자동 실행을 설정할 수 없어요.');
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return { enabled: !!enabled };
  });

  // 위젯 창(포스트잇/일정·할일·메모 낱개 위젯) 전용 — 내용이 다 렌더링된 직후 렌더러가
  // 실제 필요한 높이(scrollHeight 등)를 알려주면, 그 창 자신을 리사이즈해서 "열자마자
  // 스크롤 없이 다 보이는" 상태로 맞춘다. 어떤 위젯 창에서 호출했는지는 BrowserWindow.
  // fromWebContents(event.sender)로 알아내므로 위젯 종류별로 채널을 따로 만들 필요가 없다.
  ipcMain.handle('widgetWindow:fitToContent', (event, { height, width } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    const current = win.getBounds();
    const [minW, minH] = win.getMinimumSize();
    // 화면 밖으로 터무니없이 커지지 않도록 화면 높이의 80%를 상한으로 둔다
    const display = require('electron').screen.getDisplayMatching(current);
    const maxHeight = Math.round((display?.workAreaSize?.height || 900) * 0.8);
    const nextWidth = Math.max(minW, Math.round(width || current.width));
    const nextHeight = Math.min(maxHeight, Math.max(minH, Math.round(height || current.height)));
    win.setBounds({ x: current.x, y: current.y, width: nextWidth, height: nextHeight });
    return { width: nextWidth, height: nextHeight };
  });
};
