const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerCategoriesIpc(ipcMain, repos) {
  const { categories } = repos;

  ipcMain.handle('categories:list', () => {
    return categories.list();
  });

  ipcMain.handle('categories:add', (event, { name, colorHex, textColor, sortOrder }) => {
    assertNonEmpty(name, '카테고리 이름을 입력해주세요.');
    assertNonEmpty(colorHex, '색상을 선택해주세요.');
    const result = categories.insert({ name: name.trim(), colorHex, textColor, sortOrder });
    broadcastDataChanged('category', result.id);
    return result;
  });

  ipcMain.handle('categories:update', (event, { id, name, colorHex, textColor, sortOrder }) => {
    const cat = categories.getById(id);
    if (!cat) throw new Error('카테고리를 찾을 수 없습니다.');
    categories.update({
      id,
      name: name ?? cat.name,
      colorHex: colorHex ?? cat.color_hex,
      textColor: textColor ?? cat.text_color,
      sortOrder: sortOrder ?? cat.sort_order,
    });
    broadcastDataChanged('category', id);
    return { id };
  });

  ipcMain.handle('categories:delete', (event, id) => {
    const cat = categories.getById(id);
    if (!cat) return { id };
    if (cat.is_system) throw new Error('기본 제공 카테고리는 삭제할 수 없습니다.');
    categories.remove(id);
    broadcastDataChanged('category', id);
    return { id };
  });

  // 태그 탐색(문서 7번) — "#태그" 클릭 시 이 태그를 쓰는 모든 항목(Todo/일정/메모/포스트잇)을 모아 보여준다.
  ipcMain.handle('categories:itemsFor', (event, id) => {
    const cat = categories.getById(id);
    if (!cat) throw new Error('카테고리를 찾을 수 없습니다.');
    return categories.itemsFor(id);
  });
};
