const { BrowserWindow } = require('electron');

/**
 * 위젯(포스트잇/낱개항목/보드류)은 전부 메인 창과 별도의 BrowserWindow, 즉 별도의 렌더러
 * 프로세스라서 한쪽에서 수정해도 다른 쪽엔 자동으로 반영되지 않는다(서로 다른 JS 메모리 공간).
 * DB에 쓰기가 일어날 때마다 지금 열려있는 모든 창에 "무엇이 바뀌었는지" 알려주고,
 * 각 창(렌더러)이 자기가 보여주고 있는 데이터와 관련 있으면 알아서 새로고침하도록 한다.
 *
 * entity: 'todo' | 'event' | 'memo' | 'postit' | 'inbox' | 'category' | 'link'
 * id: 영향을 받은 레코드의 id (링크처럼 특정 하나로 못 좁히는 경우 null)
 */
function broadcastDataChanged(entity, id = null) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('itda:data-changed', { entity, id });
    }
  });
}

module.exports = { broadcastDataChanged };
