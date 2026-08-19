const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

// inbox_items는 deleted_at 컬럼이 없음 → inbox:delete는 하드 삭제(설계상 의도)
module.exports = function registerInboxIpc(ipcMain, repos, { deleteLinksFor } = {}) {
  const { inbox } = repos;

  ipcMain.handle('inbox:add', (event, content) => {
    assertNonEmpty(content, '내용을 입력해주세요.');
    const trimmed = content.trim();
    const { id } = inbox.insert(trimmed);
    broadcastDataChanged('inbox', id);
    return { id, content: trimmed };
  });

  ipcMain.handle('inbox:list', (event, { onlyUnprocessed = true } = {}) => {
    return inbox.list(onlyUnprocessed);
  });

  // Inbox 항목을 todo/event/memo/postit로 전환 처리 표시 (실제 레코드 생성은 각 :add를 호출한 뒤 이걸 호출)
  ipcMain.handle('inbox:markProcessed', (event, { id, type, refId }) => {
    if (!['todo', 'event', 'memo', 'postit'].includes(type)) throw new Error('알 수 없는 처리 타입입니다.');
    inbox.markProcessed({ id, type, refId });
    broadcastDataChanged('inbox', id);
    return { id };
  });

  ipcMain.handle('inbox:delete', (event, id) => {
    inbox.remove(id);
    deleteLinksFor?.('inbox', id); // 하드 삭제라 trash:permanentlyDelete를 안 거치므로 여기서 직접 정리
    broadcastDataChanged('inbox', id);
    broadcastDataChanged('link');
    return { id };
  });
};
