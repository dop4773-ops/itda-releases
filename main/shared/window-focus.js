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

module.exports = { forceShowAndFocus };
