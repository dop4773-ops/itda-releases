const { BrowserWindow } = require('electron');
const path = require('path');
const { attachExternalLinkHandler } = require('../shared/external-links');

/**
 * postit-widget/window-manager.js와 같은 컨셉("항목 하나당 창 하나")이지만,
 * 포스트잇 외 타입(todo/memo/event)까지 같이 다루기 위해 map 키를 `${type}:${id}`로 잡는다.
 * 바탕화면 드래그앤드롭으로 열리는 낱개 위젯 전용 — 종류별 요약 보드 위젯(widgets/window-manager.js)과는 별개.
 */
const windows = new Map();

const SIZE_BY_TYPE = {
  todo: { width: 260, height: 140 },
  memo: { width: 260, height: 200 },
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
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: item.x != null ? Math.round(item.x) : undefined,
    y: item.y != null ? Math.round(item.y) : undefined,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    resizable: true, // 내용이 많은 일정/메모는 기본 크기로 다 안 보일 수 있어 직접 키울 수 있게(내부 스크롤도 됨)
    frame: false,
    transparent: true,
    alwaysOnTop: true,
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
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'widget.html'), {
    query: { type: `${item.type}-item`, id: String(item.id) },
  });
  windows.set(key, win);

  win.on('closed', () => {
    windows.delete(key);
    onClosed?.(item.type, item.id);
  });

  return win;
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

module.exports = { openWidget, isOpen, closeIfOpen, getOpenItems };
