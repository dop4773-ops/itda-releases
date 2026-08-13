const { BrowserWindow } = require('electron');

// 어떤 위젯 창(포스트잇 개별 위젯이든 보드형 위젯이든)에서 호출해도 event.sender로
// "이 요청을 보낸 창"을 찾아서 그 창에만 적용한다 — 위젯 타입/ID를 몰라도 되는 범용 방식.
module.exports = function registerWidgetControlsIpc(ipcMain) {
  ipcMain.handle('widgetControls:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
    return { ok: !!win };
  });

  ipcMain.handle('widgetControls:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
    return { ok: !!win };
  });
};
