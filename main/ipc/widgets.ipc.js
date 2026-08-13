const windowManager = require('../widgets/window-manager');

const WIDGET_TYPES = ['today-schedule', 'today-todo', 'postit-board', 'quick-memo', 'google-calendar-mini', 'inbox', 'dday'];

const boundsKey = (type) => `widget_bounds:${type}`;

module.exports = function registerWidgetsIpc(ipcMain, repos, getMainWindow) {
  function loadBounds(type) {
    const raw = repos.settings.get(boundsKey(type));
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  function saveBounds(type, bounds) {
    repos.settings.set(boundsKey(type), JSON.stringify(bounds));
  }

  function assertValidType(type) {
    if (!WIDGET_TYPES.includes(type)) throw new Error('알 수 없는 위젯입니다: ' + type);
  }

  // 위젯은 사용자가 이 핸들러를 직접 호출했을 때만 열린다 — 앱 시작 시 자동으로
  // 다시 켜지는 동작은 의도적으로 없다(전에 있었다가 "예상 못하게 다 켜진다"는
  // 피드백을 받고 제거함). 위치/크기(bounds)만 기억해서, 나중에 다시 켤 때 그 자리에 뜬다.
  ipcMain.handle('widgets:open', (event, type) => {
    assertValidType(type);
    windowManager.openWidget(type, loadBounds(type), { onBoundsChange: saveBounds });
    return { opened: true };
  });

  ipcMain.handle('widgets:close', (event, type) => {
    assertValidType(type);
    windowManager.closeWidget(type);
    return { closed: true };
  });

  ipcMain.handle('widgets:isOpen', (event, type) => windowManager.isOpen(type));

  ipcMain.handle('widgets:listStatus', () => {
    return WIDGET_TYPES.map((type) => ({ type, open: windowManager.isOpen(type) }));
  });

  // 위젯의 "전체 OO 보기" 링크에서 사용 — 메인 앱 창을 앞으로 가져오고 필요하면 특정 화면으로 이동
  ipcMain.handle('widgets:openMainApp', (event, route) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (route) win.webContents.send('itda:navigate', route);
    return { ok: true };
  });

  return { WIDGET_TYPES };
};
