const { BrowserWindow } = require('electron');
const path = require('path');
const { attachExternalLinkHandler } = require('../shared/external-links');

// widgetType(문자열) -> BrowserWindow. postit-widget/window-manager.js와 달리
// "항목 하나당 창 하나"가 아니라 "위젯 종류당 창 하나"라 map 키가 id가 아니라 type이다.
const windows = new Map();

const DEFAULT_BOUNDS = { width: 300, height: 360 };

function openWidget(type, bounds = {}, { onBoundsChange, opacity = 1, alwaysOnTop = true } = {}) {
  const existing = windows.get(type);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: bounds.width || DEFAULT_BOUNDS.width,
    height: bounds.height || DEFAULT_BOUNDS.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop, // 바탕화면 위젯 보드 컨셉이라 기본은 다른 창들 위에 떠있음 — 설정 > 위젯에서 끌 수 있음
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setOpacity(opacity);
  win.setMenu(null);
  if (alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('blur', () => {
      if (!win.isDestroyed() && win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
    });
  }
  attachExternalLinkHandler(win);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'widget.html'), { query: { type } });
  windows.set(type, win);

  let boundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      onBoundsChange?.(type, { x: b.x, y: b.y, width: b.width, height: b.height });
    }, 400);
  };
  win.on('moved', scheduleBoundsSave);
  win.on('resized', scheduleBoundsSave);
  win.on('closed', () => {
    clearTimeout(boundsTimer);
    windows.delete(type);
  });

  return win;
}

function closeWidget(type) {
  const win = windows.get(type);
  if (win && !win.isDestroyed()) win.close();
}

function isOpen(type) {
  const win = windows.get(type);
  return !!(win && !win.isDestroyed());
}

// 설정에서 투명도/항상위를 바꿨을 때 이미 열려있는 위젯 창들에도 바로 반영하기 위함
function setOpacityAll(opacity) {
  windows.forEach((win) => {
    if (!win.isDestroyed()) win.setOpacity(opacity);
  });
}
function setAlwaysOnTopAll(value) {
  windows.forEach((win) => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(value, value ? 'screen-saver' : 'normal');
  });
}

// 자동 업데이트 재시작 직전에 "지금 뭐가 열려있었는지" 스냅샷 뜨기 위함(main/widget-restore 참고)
function getOpenTypes() {
  return [...windows.keys()].filter((type) => isOpen(type));
}

module.exports = { openWidget, closeWidget, isOpen, setOpacityAll, setAlwaysOnTopAll, getOpenTypes };
