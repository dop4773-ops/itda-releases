const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerPostitsIpc(ipcMain, repos, { closeWidgetIfOpen } = {}) {
  const { postits } = repos;

  ipcMain.handle('postits:list', () => {
    return postits.list();
  });

  ipcMain.handle('postits:get', (event, id) => {
    return postits.getById(id);
  });

  ipcMain.handle('postits:add', (event, { title, content, colorHex, categoryId, posX, posY, width, height }) => {
    assertNonEmpty(content, '포스트잇 내용을 입력해주세요.');
    const result = postits.insert({ title, content: content.trim(), colorHex, categoryId, posX, posY, width, height });
    broadcastDataChanged('postit', result.id);
    return result;
  });

  ipcMain.handle(
    'postits:update',
    (event, { id, title, content, colorHex, categoryId, posX, posY, width, height, opacity }) => {
      const p = postits.getById(id);
      if (!p) throw new Error('포스트잇을 찾을 수 없습니다.');
      postits.update({
        id,
        title: title ?? p.title,
        content: content ?? p.content,
        colorHex: colorHex ?? p.color_hex,
        categoryId: categoryId !== undefined ? categoryId : p.category_id,
        posX: posX ?? p.pos_x,
        posY: posY ?? p.pos_y,
        width: width ?? p.width,
        height: height ?? p.height,
        opacity: opacity ?? p.opacity,
      });
      broadcastDataChanged('postit', id);
      return { id };
    }
  );

  ipcMain.handle('postits:togglePin', (event, id) => {
    const p = postits.getById(id);
    if (!p) return null;
    const next = p.is_pinned ? 0 : 1;
    postits.setPinned(id, next);
    broadcastDataChanged('postit', id);
    return { id, is_pinned: next };
  });

  ipcMain.handle('postits:toggleAlwaysOnTop', (event, id) => {
    const p = postits.getById(id);
    if (!p) return null;
    const next = p.is_always_on_top ? 0 : 1;
    postits.setAlwaysOnTop(id, next);
    broadcastDataChanged('postit', id);
    return { id, is_always_on_top: next };
  });

  ipcMain.handle('postits:delete', (event, id) => {
    postits.softDelete(id);
    closeWidgetIfOpen?.(id); // 목록에서 삭제(휴지통행)하면 열려있던 위젯 창도 같이 닫기
    broadcastDataChanged('postit', id);
    return { id };
  });
};
