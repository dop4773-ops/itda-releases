const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerMemoFoldersIpc(ipcMain, repos) {
  const { memoFolders } = repos;

  ipcMain.handle('memoFolders:list', () => {
    return memoFolders.list();
  });

  ipcMain.handle('memoFolders:add', (event, { name, sortOrder }) => {
    assertNonEmpty(name, '폴더 이름을 입력해주세요.');
    const result = memoFolders.insert({ name: name.trim(), sortOrder });
    broadcastDataChanged('memoFolder', result.id);
    return result;
  });

  ipcMain.handle('memoFolders:rename', (event, { id, name }) => {
    assertNonEmpty(name, '폴더 이름을 입력해주세요.');
    memoFolders.rename(id, name.trim());
    broadcastDataChanged('memoFolder', id);
    return { id };
  });

  ipcMain.handle('memoFolders:reorder', (event, ids) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('폴더 순서 배열이 필요합니다.');
    memoFolders.reorder(ids.map(Number));
    broadcastDataChanged('memoFolder');
    return { ok: true };
  });

  // 폴더를 지워도 그 안의 메모는 삭제되지 않고 "미분류"로 남는다(FK ON DELETE SET NULL) —
  // 폴더 목록과 메모 목록(folder_id 표시) 둘 다 갱신돼야 하므로 두 종류로 broadcast한다.
  ipcMain.handle('memoFolders:delete', (event, id) => {
    memoFolders.remove(id);
    broadcastDataChanged('memoFolder', id);
    broadcastDataChanged('memo');
    return { id };
  });
};
