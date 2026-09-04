/**
 * main/spotlight/index.js — Spotlight 창 IPC 배선.
 *   - spotlight:close : renderer(Esc/저장 후)가 창을 닫아달라고 함
 *
 * 창 크기는 모드별 고정(window-manager). 결과 선택 시 화면 이동/위젯 열기는 renderer가
 * 기존 preload API를 그대로 쓴다(window.itda.widgets.openMainApp / itemWidget.open /
 * postitWidget.open) — 새 IPC 불필요.
 */
const { ipcMain } = require('electron');
const { openSpotlight, closeSpotlight } = require('./window-manager');

function initSpotlight() {
  ipcMain.handle('spotlight:close', () => closeSpotlight());
  return { openSpotlight };
}

module.exports = { initSpotlight };
