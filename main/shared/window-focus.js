/**
 * main/shared/window-focus.js
 *
 * 숨겨져 있던(트레이 상주) 창을 화면 맨 앞으로 가져올 때 쓰는 공용 헬퍼.
 * 윈도우는 백그라운드 프로세스가 SetForegroundWindow로 포커스를 "훔치는" 걸 정책적으로
 * 막는다 — show()+focus()만 부르면 창이 "보이기만" 하고 실제로 맨 앞/키보드 포커스는
 * 못 가져오는 경우가 있다(다른 창 뒤에 남아있거나 활성화가 안 됨). 특히 트레이에 한동안
 * 숨어있다 막 복귀할 때(Spotlight/전역 단축키/트레이 클릭) 잘 드러난다.
 * alwaysOnTop을 잠깐 켰다 끄는 건 이 문제를 우회하려고 Electron 앱들이 널리 쓰는 방법 —
 * 반짝 최상위로 올리면 윈도우가 강제로 활성화를 허용해주고, 곧바로 다시 꺼서 계속
 * 최상위로 남지 않게 한다. macOS/Linux에선 이 토글이 그냥 무해하게 지나간다.
 */
function forceShowAndFocus(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true);
  win.show();
  win.setAlwaysOnTop(false);
  win.focus();
}

// 화면(렌더러)이 아직 로딩 중이면 끝난 뒤에 보낸다 — 로딩 중에 보낸 메시지는 받는 쪽 리스너가 없어서 사라진다
// (앱을 막 켰거나, 화면이 다시 불러와지는 중에 빠른 찾기로 항목을 열면 "눌렀는데 아무 반응 없음"이 되던 원인 후보).
function sendWhenLoaded(win, channel, payload) {
  const wc = win.webContents;
  if (wc.isLoading()) wc.once('did-finish-load', () => !win.isDestroyed() && wc.send(channel, payload));
  else wc.send(channel, payload);
}

/**
 * 본 창을 앞으로 가져오고(필요하면 화면 이동까지) — 위젯의 "전체 보기", 빠른 찾기, 알림 클릭 등 공용.
 * 윈도우가 포커스를 안 내줘서 다른 창 뒤에 남는 경우를 위해, 잠깐 뒤 상태를 확인해 한 번 더 앞으로 올리고
 * 그래도 안 되면 작업표시줄을 깜박여 알린다(그리고 windows.log에 한 줄 남긴다).
 * @returns {boolean} 창이 있어서 요청을 처리했는지
 */
function bringMainForward(win, route, { note = () => {}, verifyMs = 300 } = {}) {
  if (!win || win.isDestroyed()) {
    note('open-main-failed', `route=${route || '-'} reason=no-window`);
    return false;
  }
  const wc = win.webContents;
  if (wc.isCrashed()) wc.reload(); // 죽은 화면이면 다시 불러온다(로드가 끝나면 아래 이동 요청이 전달됨)
  forceShowAndFocus(win);
  if (route) sendWhenLoaded(win, 'itda:navigate', route);
  setTimeout(() => {
    if (win.isDestroyed()) return;
    if (win.isVisible() && !win.isMinimized() && win.isFocused()) return;
    note('open-main-unfocused', `route=${route || '-'} visible=${win.isVisible()} minimized=${win.isMinimized()} focused=${win.isFocused()}`);
    forceShowAndFocus(win);
    win.moveTop();
    if (!win.isFocused()) {
      win.flashFrame(true);
      win.once('focus', () => win.flashFrame(false));
    }
  }, verifyMs);
  return true;
}

module.exports = { forceShowAndFocus, bringMainForward, sendWhenLoaded };
