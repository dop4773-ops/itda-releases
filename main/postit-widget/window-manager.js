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

function openWidget(postit, { onBoundsChange, dropPos, opacity = 1 } = {}) {
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

  win.setOpacity(opacity);
  win.setMenu(null);
  // BrowserWindow 생성자의 alwaysOnTop:true만으로는(특히 macOS) 창 레벨이 애매해서 다른 앱
  // 창 뒤로 밀리는 것처럼 보일 수 있었다 — 생성 직후 setAlwaysOnTop으로 'floating' 레벨을
  // 명시해서 다시 한 번 확실히 건다(아래 setAlwaysOnTop() 토글 함수와 동일한 처리).
  if (postit.is_always_on_top) win.setAlwaysOnTop(true, 'floating');
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
  if (!win || win.isDestroyed()) return;
  // 'floating' 레벨을 명시해야 다른 앱 창 뒤로 밀리지 않고 확실히 위에 뜬다(레벨 없이 그냥
  // true만 넘기면 창 종류에 따라 애매하게 동작하는 경우가 있었다). 켤 때는 moveTop()으로
  // 지금 당장 맨 위로도 올려서 "켰는데 그대로 뒤에 있는" 것처럼 보이지 않게 한다.
  win.setAlwaysOnTop(value, 'floating');
  if (value) win.moveTop();
}

// 포스트잇이 완전삭제(휴지통 비우기)될 때 열려있는 위젯 창도 같이 정리하기 위함
function closeIfOpen(postitId) {
  const win = windows.get(postitId);
  if (win && !win.isDestroyed()) win.close();
}

// 설정 > 위젯에서 투명도를 바꿨을 때 이미 열려있는 포스트잇 창들에도 바로 반영하기 위함
function setOpacityAll(opacity) {
  windows.forEach((win) => {
    if (!win.isDestroyed()) win.setOpacity(opacity);
  });
}

module.exports = { openWidget, isOpen, setAlwaysOnTop, closeIfOpen, setOpacityAll };
