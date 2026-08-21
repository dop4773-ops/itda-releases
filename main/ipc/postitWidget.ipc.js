const windowManager = require('../postit-widget/window-manager');

module.exports = function registerPostitWidgetIpc(ipcMain, repos) {
  // 포스트잇 낱개 위젯을 여는 실제 로직 — 정상적인 "열기" IPC와, 자동 업데이트 재시작 후
  // 위젯을 다시 켜는 main/widget-restore가 둘 다 이걸 쓴다(중복 구현 방지).
  function openPostitById(id, { dropPos } = {}) {
    const postit = repos.postits.getById(id);
    if (!postit) throw new Error('포스트잇을 찾을 수 없습니다.');
    const rawOpacity = repos.settings.get('widget_opacity');
    const opacity = rawOpacity ? Number(rawOpacity) : 1;

    windowManager.openWidget(postit, {
      // 창 위치/크기가 바뀔 때마다 DB에 반영 — 다른 필드는 그 사이 바뀌었을 수 있으니
      // 매번 최신값을 다시 읽어서 merge한다(오래된 값으로 덮어쓰지 않도록)
      onBoundsChange: (postitId, bounds) => {
        const current = repos.postits.getById(postitId);
        if (!current) return; // 그 사이 삭제됐을 수 있음
        repos.postits.update({
          id: postitId,
          title: current.title,
          content: current.content,
          colorHex: current.color_hex,
          posX: bounds.posX,
          posY: bounds.posY,
          width: bounds.width,
          height: bounds.height,
          opacity: current.opacity,
        });
      },
      dropPos,
      opacity,
    });
  }

  ipcMain.handle('postitWidget:open', (event, arg) => {
    // 기존 호출부(숫자 id만 넘김)와 드래그앤드롭 신규 호출부({id,x,y}) 둘 다 지원
    const id = typeof arg === 'object' && arg !== null ? arg.id : arg;
    const dropPos = typeof arg === 'object' && arg !== null && arg.x != null ? { x: arg.x, y: arg.y } : null;
    openPostitById(id, { dropPos });
    return { opened: true };
  });

  ipcMain.handle('postitWidget:isOpen', (event, id) => windowManager.isOpen(id));

  ipcMain.handle('postitWidget:toggleAlwaysOnTop', (event, id) => {
    const postit = repos.postits.getById(id);
    if (!postit) throw new Error('포스트잇을 찾을 수 없습니다.');
    const next = postit.is_always_on_top ? 0 : 1;
    repos.postits.setAlwaysOnTop(id, next);
    windowManager.setAlwaysOnTop(id, !!next);
    return { id, is_always_on_top: next };
  });

  return { closeWidgetIfOpen: windowManager.closeIfOpen, openPostitById };
};
