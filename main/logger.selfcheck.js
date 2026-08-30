/**
 * logger.js 빠른 자체 점검:  node main/logger.selfcheck.js
 * electron을 스텁으로 갈아끼워 순수 로직(파일 append / 로테이션 / IPC 포워딩 / 이상값 방어)만 확인한다.
 */
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-logger-'));
const origLoad = Module._load;
const ipcHandlers = {};
Module._load = function (req, ...rest) {
  if (req === 'electron') {
    return {
      app: { getPath: () => tmp },
      shell: { openPath: async () => '' },
      ipcMain: { on: (ch, fn) => { ipcHandlers[ch] = fn; } },
    };
  }
  return origLoad.call(this, req, ...rest);
};

const { initErrorLogging, logError, logDir } = require('./logger');
const logFile = path.join(logDir(), 'error.log');

// 1) 기본 기록: timestamp + source + message + stack
logError('main', new Error('boom1'));
assert(fs.readFileSync(logFile, 'utf8').includes('[main] boom1'), '기본 기록');

// 2) 로테이션: 캡(512KB)을 훨씬 넘겨도 error.log는 유계, 직전분은 error.log.1로 보존
const stack = 'at f (x.js:1:1)\n'.repeat(200);
for (let i = 0; i < 400; i++) logError('main', Object.assign(new Error('e' + i), { stack }));
assert(fs.existsSync(logFile + '.1'), '로테이션 파일 생성');
assert(fs.statSync(logFile).size < 512 * 1024, '현재 로그 유계');

// 3) initErrorLogging이 process 핸들러 + itda:log-error IPC 등록
initErrorLogging();
assert(typeof ipcHandlers['itda:log-error'] === 'function', 'IPC 핸들러 등록');
ipcHandlers['itda:log-error'](null, { source: 'renderer:widget', message: 'from widget', stack: 's' });
assert(fs.readFileSync(logFile, 'utf8').includes('[renderer:widget] from widget'), 'IPC 포워딩 기록');

// 4) Error가 아닌 값(문자열/undefined/객체)도 예외 없이 처리
logError('main', 'plain string');
logError('main', undefined);
logError('main', { message: 'obj only' });

fs.rmSync(tmp, { recursive: true, force: true });
console.log('logger self-check OK');
