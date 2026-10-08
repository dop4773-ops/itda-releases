/**
 * 미니 모드(작은 창) — 상단 버튼으로 켜고 끈다. 켜면 본체 창이 작아지고 "오늘 요약"만 보인다(사이드바·상단바·빠른입력 버튼은 숨김).
 * 끄면 켜기 직전의 크기·위치와 보던 화면으로 돌아온다.
 * ⚠ 이 모듈은 대시보드 등 어떤 화면의 저장값도 읽지도 쓰지도 않는다. 하는 일은 (1) 창 크기 요청 (2) body 클래스 (3) 화면 이동뿐.
 */
import { goToHash } from './ui-utils.js';
import { setMiniActiveForZoom } from './shell.js';

let active = false;
let prevHash = '#/dashboard';

export const isMiniActive = () => active;

function paint(on, pin) {
  active = on;
  document.body.classList.toggle('mini-mode', on);
  setMiniActiveForZoom(on);
  const pinBtn = document.getElementById('mini-pin');
  if (pinBtn) pinBtn.classList.toggle('on', !!pin);
}

export async function enterMini() {
  if (active) return;
  prevHash = location.hash && location.hash !== '#/today' ? location.hash : prevHash;
  const r = await window.itda.mini.enter();
  paint(r.active, (await window.itda.mini.get()).pin);
  goToHash('#/today');
}

export async function exitMini({ restoreHash = true } = {}) {
  if (!active) return;
  const r = await window.itda.mini.exit();
  paint(r.active, false);
  if (restoreHash) goToHash(prevHash || '#/dashboard');
}

export function initMiniMode() {
  document.getElementById('miniBtn')?.addEventListener('click', () => (active ? exitMini() : enterMini()));
  document.getElementById('gt-miniBtn')?.addEventListener('click', () => (active ? exitMini() : enterMini()));
  document.getElementById('mini-expand')?.addEventListener('click', () => exitMini());
  document.getElementById('mini-pin')?.addEventListener('click', async () => {
    const next = !document.getElementById('mini-pin').classList.contains('on');
    await window.itda.mini.setPin(next);
    document.getElementById('mini-pin').classList.toggle('on', next);
  });
  // 창이 다른 경로로 바뀐 경우(트레이로 숨겼다 복귀 등)에도 화면 상태를 맞춘다
  window.itda.mini.onChanged(({ active: on, pin }) => on !== active && paint(on, pin));
  // 이미 미니 상태로 이 화면이 (다시) 열린 경우
  window.itda.mini.get().then((s) => s.active && paint(true, s.pin)).catch(() => {});
}
