const { BrowserWindow } = require('electron');
const path = require('path');
const { attachExternalLinkHandler } = require('../shared/external-links');

// widgetType(문자열) -> BrowserWindow. postit-widget/window-manager.js와 달리
// "항목 하나당 창 하나"가 아니라 "위젯 종류당 창 하나"라 map 키가 id가 아니라 type이다.
const windows = new Map();

const DEFAULT_BOUNDS = { width: 300, height: 360 };

function openWidget(type, bounds = {}, { onBoundsChange } = {}) {
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
    alwaysOnTop: true, // 바탕화면 위젯 보드 컨셉이라 기본적으로 다른 창들 위에 떠있음
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
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

module.exports = { openWidget, closeWidget, isOpen };
