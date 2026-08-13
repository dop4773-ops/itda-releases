const { shell } = require('electron');

// 메모/포스트잇 본문에 자동으로 붙는 하이퍼링크(target="_blank")나 그 외 어떤 이유로든
// 창이 새 창을 열려고 하면, Electron 안에 새 BrowserWindow를 띄우는 대신 OS 기본 브라우저로 보낸다.
// 메인 윈도우/위젯 윈도우 전부 동일하게 적용해야 하므로 여기 한 곳에 모아둔다.
function attachExternalLinkHandler(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 혹시라도 페이지 자체가 외부 URL로 이동하려는 시도(will-navigate)도 같은 방식으로 막고 리다이렉트
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
  });
}

module.exports = { attachExternalLinkHandler };
