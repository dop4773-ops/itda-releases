const windowManager = require('../item-widget/window-manager');

const ITEM_TYPES = ['todo', 'memo', 'event'];

// 리스트 화면에서 아이템을 바탕화면으로 드래그해서 놓았을 때 여는 낱개 위젯.
// 포스트잇은 이미 postitWidget.ipc.js가 전담하고 있어서 여기서는 다루지 않는다.
module.exports = function registerItemWidgetIpc(ipcMain, repos) {
  function assertValidType(type) {
    if (!ITEM_TYPES.includes(type)) throw new Error('알 수 없는 항목 타입입니다: ' + type);
  }
  function repoFor(type) {
    if (type === 'todo') return repos.todos;
    if (type === 'memo') return repos.memos;
    return repos.events;
  }

  ipcMain.handle('itemWidget:open', (event, { type, id, x, y }) => {
    assertValidType(type);
    const record = repoFor(type).getById(id);
    if (!record) throw new Error('항목을 찾을 수 없습니다.');

    windowManager.openWidget({ type, id, x, y });
    return { opened: true };
  });

  ipcMain.handle('itemWidget:isOpen', (event, { type, id }) => {
    assertValidType(type);
    return windowManager.isOpen(type, id);
  });

  return { closeItemWidgetIfOpen: windowManager.closeIfOpen };
};
