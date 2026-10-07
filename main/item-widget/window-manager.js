const { BrowserWindow } = require('electron');
const path = require('path');
const { attachExternalLinkHandler } = require('../shared/external-links');
const { fitToScreens } = require('../shared/window-bounds');

/**
 * postit-widget/window-manager.js와 같은 컨셉("항목 하나당 창 하나")이지만,
 * 포스트잇 외 타입(todo/memo/event)까지 같이 다루기 위해 map 키를 `${type}:${id}`로 잡는다.
 * 바탕화면 드래그앤드롭으로 열리는 낱개 위젯 전용 — 종류별 요약 보드 위젯(widgets/window-manager.js)과는 별개.
 */
const windows = new Map();

// "항상 앞으로"를 끈 위젯만 설정(item_widget_unpinned = ["memo:3", ...])에 기록한다 — 기본은 켜짐이라 대부분은 기록이 없다.
const UNPINNED_KEY = 'item_widget_unpinned';
let settingsRepo = null;
function initPinStore(settings) {
  settingsRepo = settings;
}

// 위젯마다 마지막 위치·크기 — item_widget_bounds = { "memo:3": {x,y,width,height}, ... }. 최근 100개만 둔다.
const BOUNDS_KEY = 'item_widget_bounds';
const BOUNDS_CAP = 100;
function readAllBounds() {
  try {
    const o = JSON.parse(settingsRepo?.get(BOUNDS_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) {
    return {};
  }
}
function saveBounds(key, b) {
  const all = readAllBounds();
  delete all[key]; // 다시 넣어 "가장 최근"으로
  all[key] = b;
  const keys = Object.keys(all);
  keys.slice(0, Math.max(0, keys.length - BOUNDS_CAP)).forEach((k) => delete all[k]);
  settingsRepo?.set(BOUNDS_KEY, JSON.stringify(all));
}
function readUnpinned() {
  try {
    const list = JSON.parse(settingsRepo?.get(UNPINNED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

const SIZE_BY_TYPE = {
  todo: { width: 260, height: 140 },
  memo: { width: 384, height: 340 }, // 문서 시트(그림자 여백 12px 포함) — 내용 길이에 맞춰 높이는 자동으로 조절됨
  event: { width: 260, height: 150 },
};
const MIN_SIZE = { width: 220, height: 110 };

function keyOf(type, id) {
  return `${type}:${id}`;
}

/**
 * @param {{type:'todo'|'memo'|'event', id:number, x?:number, y?:number}} item
 */
function openWidget(item, { onClosed } = {}) {
  const key = keyOf(item.type, item.id);
  const existing = windows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const size = SIZE_BY_TYPE[item.type] || SIZE_BY_TYPE.todo;
  const pinned = !readUnpinned().includes(key);
  // 드래그해서 연 위치가 있으면 그 자리, 없으면(빠른 찾기·업데이트 후 복원 등) 마지막으로 두었던 위치·크기
  const saved = readAllBounds()[key] || {};
  const fit = fitToScreens({
    x: item.x != null ? Math.round(item.x) : saved.x,
    y: item.y != null ? Math.round(item.y) : saved.y,
    width: Math.max(MIN_SIZE.width, saved.width || size.width),
    height: Math.max(MIN_SIZE.height, saved.height || size.height),
  });
  const win = new BrowserWindow({
    width: fit.width,
    height: fit.height,
    x: fit.x,
    y: fit.y,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    resizable: true, // 내용이 많은 일정/메모는 기본 크기로 다 안 보일 수 있어 직접 키울 수 있게(내부 스크롤도 됨)
    frame: false,
    transparent: true,
    alwaysOnTop: pinned,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  // 항상 위 — 다른 위젯 창(포스트잇·보드)과 같은 방식: 가장 높은 레벨로 걸고, 윈도우에서 슬며시 풀리는 걸 막으려 주기적으로도 다시 올린다.
  const reassertAlwaysOnTop = () => {
    if (win.isDestroyed() || !win.isAlwaysOnTop()) return; // 항상 앞으로를 끈 위젯은 건드리지 않는다
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  };
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  win.on('blur', reassertAlwaysOnTop);
  win.on('show', reassertAlwaysOnTop);
  const reassertTimer = setInterval(reassertAlwaysOnTop, 1500);
  attachExternalLinkHandler(win);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'widget.html'), {
    query: { type: `${item.type}-item`, id: String(item.id) },
  });
  windows.set(key, win);

  let boundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized()) return;
      const b = win.getBounds();
      saveBounds(key, { x: b.x, y: b.y, width: b.width, height: b.height });
    }, 400);
  };
  win.on('moved', scheduleBoundsSave);
  win.on('resized', scheduleBoundsSave);

  win.on('closed', () => {
    clearTimeout(boundsTimer);
    clearInterval(reassertTimer);
    windows.delete(key);
    onClosed?.(item.type, item.id);
  });

  return win;
}

function findKey(win) {
  for (const [key, w] of windows) if (w === win) return key;
  return null;
}

// 창에서 호출(widgetControls IPC) — 이 창의 항상 앞으로 상태를 읽고/바꾸고/저장
function getPin(win) {
  return !!win && !win.isDestroyed() && win.isAlwaysOnTop();
}
function setPin(win, pinned) {
  const key = findKey(win);
  if (!key) return null;
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
  const rest = readUnpinned().filter((k) => k !== key);
  settingsRepo?.set(UNPINNED_KEY, JSON.stringify(pinned ? rest : [...rest, key]));
  return pinned;
}

function isOpen(type, id) {
  const win = windows.get(keyOf(type, id));
  return !!(win && !win.isDestroyed());
}

// 항목이 완전삭제(휴지통 비우기)되거나 소프트삭제될 때 열려있는 위젯 창도 같이 정리하기 위함
function closeIfOpen(type, id) {
  const win = windows.get(keyOf(type, id));
  if (win && !win.isDestroyed()) win.close();
}

// 자동 업데이트 재시작 직전에 "지금 뭐가 열려있었는지" 스냅샷 뜨기 위함(main/widget-restore 참고)
function getOpenItems() {
  return [...windows.keys()]
    .filter((key) => {
      const win = windows.get(key);
      return win && !win.isDestroyed();
    })
    .map((key) => {
      const [type, idStr] = key.split(':');
      return { type, id: Number(idStr) };
    });
}

module.exports = { openWidget, isOpen, closeIfOpen, getOpenItems, initPinStore, getPin, setPin };
