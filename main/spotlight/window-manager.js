/**
 * main/spotlight/window-manager.js
 *
 * macOS Spotlight처럼 — 전역 단축키를 눌렀을 때 잇다 본체를 통째로 띄우지 않고,
 * 화면 가운데에 작은 검색/입력 창 하나만 띄운다.
 *   - 빠른 입력(capture): Inbox에 바로 저장하고 닫힘. 본 창은 안 뜸.
 *   - 빠른 찾기(find):   항목/화면 검색 → 선택하면 그때 본 창을 앞으로 가져와 이동/열기.
 *
 * frameless + transparent + always-on-top + skipTaskbar. 포커스를 잃거나(blur) Esc면 닫힘.
 * 위젯 창(main/widgets/window-manager.js)과 같은 패턴이라 별도 네이티브 의존성 없음.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let win = null;

// 창 크기는 모드별로 고정 — 키 입력마다 창을 리사이즈하면 위치가 튀고 입력이 버벅인다.
// find는 결과가 많으면 내부(#sp-results)에서 스크롤.
const SIZE = {
  capture: { width: 640, height: 100 },
  find: { width: 640, height: 424 },
};

function openSpotlight(mode = 'capture') {
  const size = SIZE[mode] || SIZE.capture;

  if (win && !win.isDestroyed()) {
    win.setBounds(centered(size));
    win.webContents.send('spotlight:setMode', mode);
    win.show();
    win.focus();
    return win;
  }

  win = new BrowserWindow({
    ...centered(size),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'spotlight.html'), { query: { mode } });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // 포커스를 잃으면(다른 데 클릭) 닫는다 — Spotlight와 동일. 단, 개발자도구를 열면 blur가 나므로 그때는 예외.
  win.on('blur', () => {
    if (win && !win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.close();
  });
  win.on('closed', () => {
    win = null;
  });

  return win;
}

function closeSpotlight() {
  if (win && !win.isDestroyed()) win.close();
}

function centered({ width, height }) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  return {
    width,
    height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + wa.height * 0.22), // Spotlight처럼 화면 위쪽 1/5 지점
  };
}

module.exports = { openSpotlight, closeSpotlight };
