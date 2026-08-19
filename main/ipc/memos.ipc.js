const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerMemosIpc(ipcMain, repos) {
  const { memos } = repos;

  ipcMain.handle('memos:recent', (event, limit = 5) => {
    return memos.recent(limit);
  });

  ipcMain.handle('memos:list', (event, filter = {}) => {
    return memos.list(filter);
  });

  ipcMain.handle('memos:get', (event, id) => {
    return memos.getById(id);
  });

  // 애플 메모장처럼 "빈 메모"로 시작할 수 있어야 하므로 content를 필수로 강제하지 않는다
  // (완전히 빈 채로 두면 사용자가 나중에 지우거나 계속 비워둘 수도 있음 — 정상적인 사용 흐름)
  ipcMain.handle('memos:add', (event, { title, content, categoryId, colorHex, folderId }) => {
    const result = memos.insert({ title, content: content ?? '', categoryId, colorHex, folderId });
    broadcastDataChanged('memo', result.id);
    return result;
  });

  // folderId: undefined="이 필드는 안 건드림", null="미분류로 이동" — ??는 null도 걸러버려서
  // 미분류로 옮기는 게 안 되므로 직접 구분한다(다른 update 핸들러의 pick 패턴과 동일).
  ipcMain.handle('memos:update', (event, { id, title, content, categoryId, colorHex, folderId }) => {
    const memo = memos.getById(id);
    if (!memo) throw new Error('메모를 찾을 수 없습니다.');
    memos.update({
      id,
      title: title ?? memo.title,
      content: content ?? memo.content,
      categoryId: categoryId ?? memo.category_id,
      colorHex: colorHex ?? memo.color_hex,
      folderId: folderId !== undefined ? folderId : memo.folder_id,
    });
    broadcastDataChanged('memo', id);
    return { id };
  });

  ipcMain.handle('memos:togglePin', (event, id) => {
    const memo = memos.getById(id);
    if (!memo) return null;
    const next = memo.is_pinned ? 0 : 1;
    memos.setPinned(id, next);
    broadcastDataChanged('memo', id);
    return { id, is_pinned: next };
  });

  ipcMain.handle('memos:delete', (event, id) => {
    memos.softDelete(id);
    broadcastDataChanged('memo', id);
    return { id };
  });
};
