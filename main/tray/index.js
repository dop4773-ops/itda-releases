/**
 * main/tray/index.js
 *
 * 시스템 트레이 상주 모듈. 메인 창을 "닫기(X)"해도 앱이 완전히 종료되지 않고
 * 트레이에 남아있게 한다 — 위젯(포스트잇/보드형 위젯)이 열려있는 동안 실수로
 * 메인 창을 닫아서 위젯까지 같이 꺼지는 일이 없게 하기 위함(이전부터 계획된 동작).
 *
 * 설계 원칙 (updater/global-shortcut과 동일):
 *   - 다른 기능과 결합하지 않는 독립 모듈 → main.js는 initTray() 한 줄 + 창 close 이벤트에서
 *     한 조건 분기만 추가.
 *   - 진짜 종료(트레이 메뉴의 "종료", 또는 OS 전체 로그아웃/재시작)와 "그냥 창 닫기"를
 *     구분해야 하므로 app.isQuittingItda 플래그를 공유한다.
 *
 * 렌더러 쪽 사용법: 없음 — 순수 main 프로세스 UI(OS 트레이 아이콘)라 IPC 노출 대상 아님.
 */
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

/**
 * @param {import('electron').App} app
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 * @param {() => void} showMainWindow - 창을 보이거나(hide된 상태) 새로 만들어서(닫혀 없어진 상태) 앞으로 가져오는 함수
 */
function initTray(app, getMainWindow, showMainWindow) {
  app.whenReady().then(() => {
    const iconPath = path.join(__dirname, '..', '..', 'build', 'icons', 'tray-icon.png');
    let icon;
    try {
      icon = nativeImage.createFromPath(iconPath);
    } catch (err) {
      console.error('[itda] 트레이 아이콘 로드 실패 — 트레이 없이 계속 진행', err);
      return;
    }
    if (icon.isEmpty()) {
      console.error('[itda] 트레이 아이콘이 비어있음 — 트레이 없이 계속 진행');
      return;
    }

    tray = new Tray(icon);
    tray.setToolTip('잇다');

    const menu = Menu.buildFromTemplate([
      { label: '잇다 열기', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '완전히 종료',
        click: () => {
          app.isQuittingItda = true; // 창 close 핸들러가 "그냥 숨기기"가 아니라 진짜 종료로 처리하게
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);

    // Windows/Linux 관례 — 트레이 아이콘 좌클릭으로 바로 열기(우클릭은 메뉴)
    tray.on('click', () => showMainWindow());
  });

  // 메뉴의 "완전히 종료"가 아니라 Cmd+Q, OS 로그아웃 등 다른 경로로 종료될 때도
  // 창의 close 핸들러가 숨기지 않고 순순히 닫히도록 플래그를 맞춰준다.
  app.on('before-quit', () => {
    app.isQuittingItda = true;
  });
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}

module.exports = { initTray, destroyTray };
