/**
 * ipc/* 도메인 모듈들이 공통으로 쓰는 작은 헬퍼.
 * 이 파일 자체에는 ipcMain.handle을 등록하지 않는다 (등록은 각 도메인 파일의 책임).
 */

const TRASH_TABLES = {
  todo: 'todos',
  event: 'events',
  memo: 'memos',
  postit: 'postits',
};

function assertNonEmpty(value, message) {
  if (!value || !String(value).trim()) throw new Error(message);
}

module.exports = { TRASH_TABLES, assertNonEmpty };
