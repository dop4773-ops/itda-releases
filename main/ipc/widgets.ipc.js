const windowManager = require('../widgets/window-manager');
const postitWindowManager = require('../postit-widget/window-manager');

const WIDGET_TYPES = ['today-schedule', 'today-todo', 'postit-board', 'google-calendar-mini', 'inbox', 'dday'];

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

  // 설정 > 위젯의 "투명도"/"항상 위에 표시" — 값이 없으면(신규 설치) 기존 동작 그대로(불투명/항상위)
  function currentOpacity() {
    const raw = repos.settings.get('widget_opacity');
    const n = raw ? Number(raw) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  function currentAlwaysOnTop() {
    return repos.settings.get('widget_always_on_top') !== '0';
  }

  function assertValidType(type) {
    if (!WIDGET_TYPES.includes(type)) throw new Error('알 수 없는 위젯입니다: ' + type);
  }

  // 실제로 여는 로직 — 사용자가 직접 누르는 "widgets:open"과, 자동 업데이트 재시작 직후
  // 원래 열려있던 위젯을 되살리는 main/widget-restore가 둘 다 이걸 쓴다(중복 구현 방지).
  function openWidgetByType(type) {
    assertValidType(type);
    windowManager.openWidget(type, loadBounds(type), { onBoundsChange: saveBounds, opacity: currentOpacity(), alwaysOnTop: currentAlwaysOnTop() });
  }

  // 위젯은 사용자가 이 핸들러를 직접 호출했을 때만 열린다 — 앱 시작 시 자동으로
  // 다시 켜지는 동작은 의도적으로 없다(전에 있었다가 "예상 못하게 다 켜진다"는
  // 피드백을 받고 제거함). 위치/크기(bounds)만 기억해서, 나중에 다시 켤 때 그 자리에 뜬다.
  // (자동 업데이트로 재시작될 때 재시작 직전 상태를 되살리는 건 예외 — main/widget-restore 참고,
  // "일반적인 앱 시작"이 아니라 "끊긴 세션 이어붙이기"라 이 규칙과 상충하지 않는다.)
  ipcMain.handle('widgets:open', (event, type) => {
    openWidgetByType(type);
    return { opened: true };
  });

  // 설정 화면에서 투명도/항상위를 바꿨을 때, 이미 열려있는 위젯(보드형 + 포스트잇)에 즉시 반영
  ipcMain.handle('widgets:applyAppearance', () => {
    windowManager.setOpacityAll(currentOpacity());
    windowManager.setAlwaysOnTopAll(currentAlwaysOnTop());
    postitWindowManager.setOpacityAll(currentOpacity()); // 포스트잇의 "항상 위"는 개별 핀(is_always_on_top)을 그대로 유지 — 여기선 건드리지 않음
    return { ok: true };
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

  return { WIDGET_TYPES, openWidgetByType };
};
