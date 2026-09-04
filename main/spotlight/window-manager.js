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

// 높이는 renderer가 내용에 맞춰 spotlight:resize로 다시 알려준다(아래는 첫 표시용 시작값).
const SIZE = {
  capture: { width: 640, height: 96 },
  find: { width: 640, height: 112 },
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

// 창 높이를 내용에 맞게(빠른 찾기에서 결과 수에 따라). renderer가 spotlight:resize로 알려준다.
function resizeSpotlight(height) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const h = Math.max(80, Math.min(560, Math.round(height)));
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
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

module.exports = { openSpotlight, resizeSpotlight, closeSpotlight };
