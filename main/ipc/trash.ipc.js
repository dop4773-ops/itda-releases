const { TRASH_TABLES } = require('./_shared');
const { deleteStoredFile } = require('../memo-attachments/storage');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerTrashIpc(ipcMain, repos, { deleteLinksFor, closeWidgetIfOpen, closeItemWidgetIfOpen } = {}) {
  const { trash, memoAttachments } = repos;

  ipcMain.handle('trash:list', () => {
    return trash.listTrashed();
  });

  ipcMain.handle('trash:restore', (event, { type, id }) => {
    if (!TRASH_TABLES[type]) throw new Error('알 수 없는 항목 타입입니다.');
    trash.restore(type, id);
    broadcastDataChanged(type, id);
    return { id, type };
  });

  ipcMain.handle('trash:permanentlyDelete', (event, { type, id }) => {
    if (!TRASH_TABLES[type]) throw new Error('알 수 없는 항목 타입입니다.');
    // 메모가 완전삭제되면 첨부파일 DB 행은 FK CASCADE로 자동 정리되지만,
    // 디스크의 실제 파일은 SQL이 못 지우므로 미리 목록을 읽어서 먼저 지워둔다.
    if (type === 'memo') {
      memoAttachments.listForMemo(id).forEach((att) => deleteStoredFile(att.stored_name));
    }
    trash.permanentlyDelete(type, id);
    deleteLinksFor?.(type, id); // 완전 삭제되는 항목이 걸려있던 연결(item_links)도 같이 정리
    if (type === 'postit') closeWidgetIfOpen?.(id); // 열려있던 플로팅 위젯 창도 같이 닫기
    if (type === 'todo' || type === 'memo' || type === 'event') closeItemWidgetIfOpen?.(type, id); // 낱개 위젯도 동일하게 정리
    broadcastDataChanged(type, id);
    return { id, type };
  });
};
