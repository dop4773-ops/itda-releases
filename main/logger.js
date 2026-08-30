/**
 * main/logger.js
 *
 * 예상 못한 에러(main의 uncaughtException/unhandledRejection, renderer의 window.onerror 등)를
 * userData/logs/error.log 에 append 한다. 크래시보다 "로그 남기고 계속 실행"이 우선.
 *
 * 로테이션: 파일이 MAX_BYTES를 넘으면 error.log → error.log.1 로 한 번 밀어낸다(직전 1개만 보관).
 *           디스크에 error.log(≤512KB) + error.log.1(≤512KB) 정도만 쌓인다.
 */
const { app, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;

function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}
function logPath() {
  return path.join(logDir(), 'error.log');
}

function rotateIfNeeded(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, file + '.1'); // 기존 .1은 덮어씀
    }
  } catch (e) {
    /* 파일이 아직 없으면 무시 */
  }
}

/**
 * @param {string} source - 'main' | 'renderer' | 'renderer:widget' 등 발생 위치
 * @param {*} err - Error 객체 또는 { message, stack } 또는 아무 값
 */
function logError(source, err) {
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = logPath();
    rotateIfNeeded(file);

    const ts = new Date().toISOString();
    const message = err && err.message ? err.message : String(err);
    const stack = err && err.stack ? `\n${err.stack}` : '';
    fs.appendFileSync(file, `[${ts}] [${source}] ${message}${stack}\n\n`);
  } catch (e) {
    // 로깅 자체가 실패해도(권한/디스크풀 등) 앱은 계속 돌아야 한다 — 콘솔에만 남기고 끝.
    console.error('[itda] 에러 로그 기록 실패:', e);
  }
}

/**
 * main.js에서 앱 준비 후 한 번 호출.
 * - process 레벨 전역 핸들러 등록(콘솔 + 파일)
 * - renderer가 preload를 통해 보내는 'itda:log-error' 수신
 */
function initErrorLogging() {
  process.on('uncaughtException', (err) => {
    console.error('[itda] uncaughtException:', err);
    logError('main', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[itda] unhandledRejection:', reason);
    logError('main', reason instanceof Error ? reason : { message: `unhandledRejection: ${JSON.stringify(reason)}` });
  });

  ipcMain.on('itda:log-error', (_event, payload = {}) => {
    logError(payload.source || 'renderer', { message: payload.message, stack: payload.stack });
  });
}

function openLogsFolder() {
  const dir = logDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    /* 무시 */
  }
  return shell.openPath(dir);
}

module.exports = { initErrorLogging, logError, openLogsFolder, logDir };
