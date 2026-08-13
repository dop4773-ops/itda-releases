const { BrowserWindow } = require('electron');
const path = require('path');
const { attachExternalLinkHandler } = require('../shared/external-links');

// postitId -> BrowserWindow. 같은 포스트잇을 중복으로 열지 않고 이미 열려있으면 포커스만 준다.
const windows = new Map();

/**
 * @param {object} postit - postits.repository.js가 반환하는 row (id, content, color_hex, pos_x, pos_y, width, height, is_always_on_top)
 * @param {{ onBoundsChange?: (postitId, bounds) => void }} handlers - 창을 옮기거나 크기를 바꿨을 때 위치/크기를 영속화하기 위한 콜백
 */
// 기본 크기는 실제 포스트잇 크기(7.8cm × 7.8cm — 96dpi 기준 295x295px, postits 테이블
// 기본값과 일치)를 그대로 쓰되, 내용이 많아서 답답하면 사용자가 직접 키울 수 있도록
// 리사이즈를 허용한다. 저장된 postit.width/height가 있으면(과거에 이미 늘려놓은 크기) 그
// 값을 우선 쓰고, 실제 포스트잇보다 더 작게는 못 줄이게 최소 크기로 고정한다.
const MIN_WIDTH = 295;
const MIN_HEIGHT = 295;

function openWidget(postit, { onBoundsChange, dropPos } = {}) {
  const existing = windows.get(postit.id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: postit.width || MIN_WIDTH,
    height: postit.height || MIN_HEIGHT,
    x: dropPos?.x != null ? Math.round(dropPos.x) : (postit.pos_x ?? undefined),
    y: dropPos?.y != null ? Math.round(dropPos.y) : (postit.pos_y ?? undefined),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    resizable: true, // 내용이 넘칠 때 직접 키울 수 있게 — 넘치는 동안은 내부 스크롤로도 볼 수 있음(widget.css)
    frame: false, // 제목표시줄 없는 작은 스티커 형태
    transparent: true, // 카드 자체의 둥근 모서리가 보이도록 창 배경을 투명하게
    alwaysOnTop: !!postit.is_always_on_top,
    skipTaskbar: true, // 작업표시줄에 별도 항목으로 안 뜨게(메인 앱과 별개로 느껴지지 않도록)
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  attachExternalLinkHandler(win);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'widget.html'), { query: { type: 'postit', id: String(postit.id) } });
  windows.set(postit.id, win);

  // 위치/크기를 바꿀 때마다 저장하면 너무 잦으니 살짝 디바운스.
  let boundsTimer = null;
  const scheduleBoundsSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      onBoundsChange?.(postit.id, { posX: b.x, posY: b.y, width: b.width, height: b.height });
    }, 400);
  };
  win.on('moved', scheduleBoundsSave);
  win.on('resized', scheduleBoundsSave);

  win.on('closed', () => {
    clearTimeout(boundsTimer);
    windows.delete(postit.id);
  });

  return win;
}

function isOpen(postitId) {
  const win = windows.get(postitId);
  return !!(win && !win.isDestroyed());
}

function setAlwaysOnTop(postitId, value) {
  const win = windows.get(postitId);
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(value);
}

// 포스트잇이 완전삭제(휴지통 비우기)될 때 열려있는 위젯 창도 같이 정리하기 위함
function closeIfOpen(postitId) {
  const win = windows.get(postitId);
  if (win && !win.isDestroyed()) win.close();
}

module.exports = { openWidget, isOpen, setAlwaysOnTop, closeIfOpen };
