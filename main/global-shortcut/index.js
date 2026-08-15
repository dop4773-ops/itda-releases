/**
 * main/global-shortcut/index.js
 *
 * OS 전역 단축키 모음 — 잇다가 포커스 밖에 있어도(다른 프로그램 사용 중 등) 눌리도록
 * Electron의 globalShortcut을 사용한다(별도 네이티브 의존성 없음).
 *   1. "빠른 입력"(Inbox 저장 모달)을 어디서든 띄움
 *   2. "지금 잠그기" — 비밀번호 잠금이 켜져 있으면 자리 비울 때 바로 잠금
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
const { globalShortcut } = require('electron');

// 병원 PC에 흔한 프로그램들과 충돌 가능성이 낮은 조합으로 선택.
// Cmd/Ctrl+Space(OS 자체 단축키), Ctrl+Shift+I(개발자도구) 등은 의도적으로 피함.
const ACCELERATOR = 'CommandOrControl+Alt+I';
const LOCK_ACCELERATOR = 'CommandOrControl+Alt+L';

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
}

function initGlobalShortcut(app, getMainWindow) {
  app.whenReady().then(() => {
    registerOrLog(ACCELERATOR, () => {
      const win = getMainWindow();
      if (!win) return;
      focusMainWindow(win);
      win.webContents.send('itda:openQuickCapture');
    });
    registerOrLog(LOCK_ACCELERATOR, () => {
      const win = getMainWindow();
      if (!win) return;
      focusMainWindow(win); // 잠금화면을 바로 눈으로 확인시켜주기 위해 창을 앞으로 가져옴
      win.webContents.send('itda:lockNow');
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

module.exports = { initGlobalShortcut, ACCELERATOR, LOCK_ACCELERATOR };
