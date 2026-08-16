/**
 * main/global-shortcut/index.js
 *
 * OS 전역 단축키 모음 — 잇다가 포커스 밖에 있어도(다른 프로그램 사용 중 등) 눌리도록
 * Electron의 globalShortcut을 사용한다(별도 네이티브 의존성 없음).
 *   1. "빠른 입력"(Inbox 저장 모달)을 어디서든 띄움
 *   2. "지금 잠그기" — 비밀번호 잠금이 켜져 있으면 자리 비울 때 바로 잠금
 *
 * accelerator는 settings(app_settings: shortcut_globalQuickCapture / shortcut_lockNow)에서
 * 읽고, 없으면 DEFAULTS를 쓴다. 렌더러(renderer/shared/shortcuts.js)와 같은 id/기본값을
 * 쓰지만 모듈 시스템이 달라(CJS/ESM) 공유는 못 하니 값이 바뀌면 두 곳 다 맞춰야 한다.
 * 설정 화면에서 바꾸면 IPC(shortcuts:reregisterGlobal)로 다시 등록한다.
 *
 * 설계 원칙 (updater와 동일):
 *   - 다른 기능과 결합하지 않는 독립 모듈 → main.js는 initGlobalShortcut() 한 줄만 호출.
 *   - 조용히 실패해도 앱이 죽지 않게: 단축키가 다른 프로그램과 충돌해서 등록이 안 되면
 *     콘솔에만 남기고 넘어간다(병원 PC에서 이미 다른 프로그램이 같은 키를 쓰고 있을 수 있음).
 *
 * 동작:
 *   - 빠른입력: 메인 창을 보이게/포커스한 뒤 'itda:openQuickCapture'를 보내서 기존
 *     ⌘K 빠른입력 모달을 그대로 연다(새 UI를 만들지 않고 재사용 — 중복 구현 없음).
 *   - 잠금: 마찬가지로 메인 창을 보이게/포커스한 뒤 'itda:lockNow'를 보낸다. 실제로
 *     잠금이 꺼져 있으면(비밀번호 미설정) 렌더러 쪽(lock-screen.js)에서 안내만 하고 끝낸다.
 */
const { globalShortcut, ipcMain } = require('electron');

const DEFAULTS = {
  globalQuickCapture: 'CmdOrCtrl+Alt+I',
  lockNow: 'CmdOrCtrl+Alt+L',
};

function focusMainWindow(win) {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function registerOrLog(accelerator, handler) {
  const ok = globalShortcut.register(accelerator, handler);
  if (!ok) {
    // 이미 다른 프로그램이 같은 조합을 쓰고 있으면 등록 자체가 실패할 수 있음 — 앱은 정상 동작해야 하므로 조용히 로그만
    console.error(`[itda] 전역 단축키(${accelerator}) 등록 실패 — 다른 프로그램과 충돌했을 수 있어요`);
  }
  return ok;
}

function initGlobalShortcut(app, getMainWindow, settings) {
  let lastStatus = {};

  function registerAll() {
    globalShortcut.unregisterAll();
    const quickCaptureAccel = settings.get('shortcut_globalQuickCapture') || DEFAULTS.globalQuickCapture;
    const lockAccel = settings.get('shortcut_lockNow') || DEFAULTS.lockNow;

    lastStatus = {
      globalQuickCapture: registerOrLog(quickCaptureAccel, () => {
        const win = getMainWindow();
        if (!win) return;
        focusMainWindow(win);
        win.webContents.send('itda:openQuickCapture');
      }),
      lockNow: registerOrLog(lockAccel, () => {
        const win = getMainWindow();
        if (!win) return;
        focusMainWindow(win); // 잠금화면을 바로 눈으로 확인시켜주기 위해 창을 앞으로 가져옴
        win.webContents.send('itda:lockNow');
      }),
    };
    return lastStatus;
  }

  app.whenReady().then(registerAll);

  // 설정 화면에서 단축키를 바꿨을 때 앱 재시작 없이 바로 반영
  ipcMain.handle('shortcuts:reregisterGlobal', () => registerAll());
  ipcMain.handle('shortcuts:getGlobalStatus', () => lastStatus);

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

module.exports = { initGlobalShortcut, DEFAULTS };
