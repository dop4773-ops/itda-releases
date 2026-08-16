// 단축키 커스터마이징 — 기본값 + 사용자가 바꾼 값(app_settings: shortcut_<id>)을 합쳐서 관리.
// accelerator 문자열은 Electron의 accelerator 포맷(예: 'CmdOrCtrl+Alt+I')을 그대로 쓴다 —
// 전역 단축키(main/global-shortcut)에 그대로 넘길 수 있어서 별도 변환이 필요 없다.
// main 프로세스는 CJS라 이 파일을 직접 import할 수 없으므로, 전역 단축키 기본값은
// main/global-shortcut/index.js에도 동일하게 들고 있다(둘 다 바뀌면 같이 맞춰줘야 함).

export const SHORTCUTS = [
  { id: 'quickCapture', label: '빠른 입력 (Inbox에 바로 저장) — 잇다 안에서', default: 'CmdOrCtrl+K', scope: 'app' },
  { id: 'globalQuickCapture', label: '어디서든 빠른 입력 — 다른 프로그램을 쓰고 있어도', default: 'CmdOrCtrl+Alt+I', scope: 'global' },
  { id: 'commandPalette', label: '빠른 실행 (원하는 화면·태그·항목으로 바로 이동)', default: 'CmdOrCtrl+Shift+P', scope: 'app' },
  { id: 'toggleSidebar', label: '사이드바 접기/펼치기', default: 'CmdOrCtrl+\\', scope: 'app' },
  { id: 'lockNow', label: '지금 잠그기 — 다른 프로그램을 쓰고 있어도', default: 'CmdOrCtrl+Alt+L', scope: 'global' },
];

const cache = new Map();

function defaultFor(id) {
  return SHORTCUTS.find((s) => s.id === id)?.default;
}

// 키다운 리스너처럼 동기적으로 값이 필요한 곳에서 쓰는 캐시 조회 (preloadShortcuts 이후에만 정확함)
export function getCachedBinding(id) {
  return cache.has(id) ? cache.get(id) : defaultFor(id);
}

export async function preloadShortcuts() {
  await Promise.all(
    SHORTCUTS.map(async (s) => {
      const saved = await window.itda.settings.get(`shortcut_${s.id}`);
      cache.set(s.id, saved || s.default);
    })
  );
}

export async function getBinding(id) {
  if (!cache.has(id)) await preloadShortcuts();
  return getCachedBinding(id);
}

export async function getAllBindings() {
  if (cache.size === 0) await preloadShortcuts();
  return Object.fromEntries(SHORTCUTS.map((s) => [s.id, cache.get(s.id)]));
}

// 다른 단축키와 겹치면 그 id를 반환 (없으면 null)
export function findConflict(accelerator, excludeId) {
  for (const s of SHORTCUTS) {
    if (s.id !== excludeId && getCachedBinding(s.id) === accelerator) return s;
  }
  return null;
}

export async function setBinding(id, accelerator) {
  await window.itda.settings.set({ key: `shortcut_${id}`, value: accelerator });
  cache.set(id, accelerator);
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (shortcut?.scope === 'global') {
    return window.itda.shortcuts.reregisterGlobal(); // main 쪽에 새 accelerator로 다시 등록시킴, {ok: {id: true/false}} 반환
  }
  return null;
}

// KeyboardEvent가 이 accelerator와 일치하는지 (앱 내부 단축키 리스너에서 하드코딩된 e.key 비교 대신 사용)
export function matchesAccelerator(e, accelerator) {
  if (!accelerator) return false;
  const parts = accelerator.split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  const wantMod = mods.has('CmdOrCtrl') || mods.has('CommandOrControl');
  if (wantMod !== (e.metaKey || e.ctrlKey)) return false;
  if (mods.has('Alt') !== e.altKey) return false;
  if (mods.has('Shift') !== e.shiftKey) return false;
  const ek = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const kk = key.length === 1 ? key.toLowerCase() : key;
  return ek === kk;
}

// 사용자가 실제로 누른 키 조합으로 accelerator 문자열을 만든다 (재바인딩 UI의 "키 입력 받기"용)
export function acceleratorFromEvent(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

// 조합 없이 단독으로 누른 키(Escape, Enter, 순수 문자 등)는 단축키로 쓸 수 없음
export function isBareKey(e) {
  return !(e.metaKey || e.ctrlKey || e.altKey) || ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key);
}

export function labelForAccelerator(accelerator) {
  const isMac = navigator.platform?.toUpperCase().includes('MAC');
  return accelerator
    .replace('CmdOrCtrl', isMac ? '⌘' : 'Ctrl')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .split('+')
    .join(isMac ? '' : '+');
}
