const { shell } = require('electron');

// 윈도우 파일 경로(드라이브 문자 C:\... 또는 네트워크 공유 \\서버\공유\...) 판별.
// rich-text.js의 URL_PATTERN 중 파일 경로 부분과 같은 모양을 그대로 검사한다.
const WINDOWS_PATH_PATTERN = /^([A-Za-z]:\\|\\\\)/;

function openLink(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    shell.openExternal(url);
  } else if (WINDOWS_PATH_PATTERN.test(url)) {
    // 존재하지 않거나 열 수 없는 경로면 openPath가 에러 메시지를 반환하는데,
    // 여기선 별도 UI 알림 채널이 없어 콘솔에만 남긴다(치명적이지 않음 — 클릭 무반응으로 보일 뿐).
    shell.openPath(url).then((err) => {
      if (err) console.error('[itda] 파일 경로를 열지 못했어요:', url, err);
    });
  }
}

// 메모/포스트잇 본문에 자동으로 붙는 하이퍼링크(target="_blank")나 그 외 어떤 이유로든
// 창이 새 창을 열려고 하면, Electron 안에 새 BrowserWindow를 띄우는 대신 OS 기본 브라우저/
// 탐색기(파일 경로인 경우)로 보낸다. 메인 윈도우/위젯 윈도우 전부 동일하게 적용해야 하므로
// 여기 한 곳에 모아둔다.
function attachExternalLinkHandler(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });

  // 혹시라도 페이지 자체가 외부 URL로 이동하려는 시도(will-navigate)도 같은 방식으로 막고 리다이렉트
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url === current) return;
    event.preventDefault();
    openLink(url);
  });
}

module.exports = { attachExternalLinkHandler };
