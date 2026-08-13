/**
 * main/global-shortcut/index.js
 *
 * OS 전역 단축키로 "빠른 입력"(Inbox 저장 모달)을 어디서든 띄우는 모듈.
 * 잇다가 포커스 밖에 있어도(다른 프로그램 사용 중, 브라우저 보는 중 등) 눌리도록
 * Electron의 globalShortcut을 사용한다(별도 네이티브 의존성 없음).
 *
 * 설계 원칙 (updater와 동일):
 *   - 다른 기능과 결합하지 않는 독립 모듈 → main.js는 initGlobalShortcut() 한 줄만 호출.
 *   - 조용히 실패해도 앱이 죽지 않게: 단축키가 다른 프로그램과 충돌해서 등록이 안 되면
 *     콘솔에만 남기고 넘어간다(병원 PC에서 이미 다른 프로그램이 같은 키를 쓰고 있을 수 있음).
 *
 * 동작:
 *   1. 단축키가 눌리면 메인 창을 보이게/포커스하고(최소화 상태면 복원)
 *   2. 렌더러에 'itda:openQuickCapture' 이벤트를 보내서 기존 ⌘K 빠른입력 모달을 그대로 연다.
 *      (새 UI를 만들지 않고 이미 있는 Inbox 빠른입력을 재사용 — 중복 구현 없음)
 */
const { globalShortcut } = require('electron');

// 병원 PC에 흔한 프로그램들과 충돌 가능성이 낮은 조합으로 선택.
// Cmd/Ctrl+Space(OS 자체 단축키), Ctrl+Shift+I(개발자도구) 등은 의도적으로 피함.
const ACCELERATOR = 'CommandOrControl+Alt+I';

function initGlobalShortcut(app, getMainWindow) {
  app.whenReady().then(() => {
    const ok = globalShortcut.register(ACCELERATOR, () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send('itda:openQuickCapture');
    });
    if (!ok) {
      // 이미 다른 프로그램이 같은 조합을 쓰고 있으면 등록 자체가 실패할 수 있음 — 앱은 정상 동작해야 하므로 조용히 로그만
      console.error(`[itda] 전역 단축키(${ACCELERATOR}) 등록 실패 — 다른 프로그램과 충돌했을 수 있어요`);
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

module.exports = { initGlobalShortcut, ACCELERATOR };
