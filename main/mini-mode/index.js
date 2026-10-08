/**
 * main/mini-mode/index.js — 미니 모드(작은 창) 전용 창 제어.
 *
 * 켜면 메인 창을 작게(기본 380x640, 마지막으로 둔 자리·크기 기억) 줄여 "오늘 요약"만 보여주고, 끄면 켜기 직전의 크기·위치로 되돌린다.
 * ⚠ 대시보드 등 기존 화면의 저장값은 절대 건드리지 않는다 — 이 모듈이 쓰는 설정은 mini_bounds / mini_pin 둘뿐이고,
 *   창 크기만 바꾼다(대시보드는 12칸 그리드 단위로 저장돼 있어 창 크기와 무관). test/mini-mode-invariants.test.js가 이 약속을 지킨다.
 */
const { screen } = require('electron');
const { fitToScreens } = require('../shared/window-bounds');

const MINI_DEFAULT = { width: 380, height: 640 };
const MINI_MIN = { width: 320, height: 420 };
const NORMAL_MIN = { width: 512, height: 350 }; // 축소 보기(창을 줄이면 비율 축소)가 받쳐 주는 하한
const NORMAL_DEFAULT = { width: 1440, height: 900 };

function initMiniMode(ipcMain, getMainWindow, settings) {
  const state = { active: false, normal: null, wasMaximized: false };
  let saveTimer = null;

  const readJson = (key) => {
    try {
      return JSON.parse(settings.get(key) || 'null');
    } catch (e) {
      return null;
    }
  };
  const pinned = () => settings.get('mini_pin') === '1';
  const notify = (win) => !win.isDestroyed() && win.webContents.send('mini:changed', { active: state.active, pin: pinned() });

  function saveMiniBounds(win) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!state.active || win.isDestroyed()) return;
      const b = win.getBounds();
      settings.set('mini_bounds', JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
    }, 400);
  }

  function enter(win) {
    if (state.active) return;
    state.wasMaximized = win.isMaximized();
    if (state.wasMaximized) win.unmaximize();
    state.normal = win.getBounds();
    const saved = readJson('mini_bounds');
    let b = saved && saved.width ? saved : null;
    if (!b) {
      const wa = screen.getDisplayMatching(state.normal).workArea;
      b = { ...MINI_DEFAULT, x: wa.x + wa.width - MINI_DEFAULT.width - 24, y: wa.y + 40 };
    }
    b = fitToScreens({ ...b, width: Math.max(MINI_MIN.width, b.width), height: Math.max(MINI_MIN.height, b.height) });
    state.active = true;
    win.setMinimumSize(MINI_MIN.width, MINI_MIN.height);
    win.setBounds(b);
    win.setAlwaysOnTop(pinned(), 'floating');
    notify(win);
  }

  function exit(win) {
    if (!state.active) return;
    state.active = false;
    clearTimeout(saveTimer);
    win.setAlwaysOnTop(false);
    win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
    const target = fitToScreens(state.normal || { ...NORMAL_DEFAULT });
    win.setBounds(target);
    if (state.wasMaximized) win.maximize();
    notify(win);
  }

  ipcMain.handle('mini:get', () => ({ active: state.active, pin: pinned() }));
  ipcMain.handle('mini:enter', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) enter(win);
    return { active: state.active };
  });
  ipcMain.handle('mini:exit', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) exit(win);
    return { active: state.active };
  });
  ipcMain.handle('mini:setPin', (event, value) => {
    settings.set('mini_pin', value ? '1' : '0');
    const win = getMainWindow();
    if (win && !win.isDestroyed() && state.active) win.setAlwaysOnTop(!!value, 'floating');
    return { pin: !!value };
  });

  // 미니 모드 중에 옮기거나 크기를 바꾸면 그 자리를 기억한다(다음에 켤 때 그대로)
  const hook = (win) => {
    win.on('moved', () => saveMiniBounds(win));
    win.on('resized', () => saveMiniBounds(win));
  };
  return { hook, MINI_MIN, NORMAL_MIN };
}

module.exports = { initMiniMode, MINI_DEFAULT, MINI_MIN, NORMAL_MIN };
