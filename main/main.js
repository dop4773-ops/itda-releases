const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { initDb } = require('./db');
const registerIpcHandlers = require('./ipc');
const { initUpdater } = require('./updater');
const { initGlobalShortcut } = require('./global-shortcut');
const { initTray } = require('./tray');
const { initAutoBackup } = require('./auto-backup');
const { attachExternalLinkHandler } = require('./shared/external-links');
const createSettingsRepository = require('./repositories/settings.repository');
const { restoreOpenWidgets } = require('./widget-restore');
const { initErrorLogging } = require('./logger');

// 예상 못한 예외/거부를 콘솔 + userData/logs/error.log 에 남긴다(크래시보다 로그+복구 우선).
// renderer 쪽 에러도 preload가 'itda:log-error'로 보내면 여기서 같은 파일에 기록.
initErrorLogging();

let mainWindow;
let db;
app.isQuittingItda = false; // 트레이 메뉴의 "완전히 종료"를 눌렀을 때만 true — 그 전까진 창을 닫아도 트레이에 남음

// 병원 PC에서 아이콘을 실수로 여러 번 클릭해도 같은 assistant.db를 여러 창이 동시에 열지 않도록
// 단일 인스턴스로 강제한다. 두 번째 실행은 즉시 종료되고, 기존 창이 있으면 앞으로 가져온다.
const gotLock = app.requestSingleInstanceLock();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#F5F6F8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, // renderer는 절대 Node API에 직접 접근하지 않음
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 위젯 창(postit-widget/window-manager.js)과 동일하게 네이티브 메뉴를 뗀다 — 이 앱은 UI를
  // 전부 자체 사이드바/화면으로 만들어서 File/Edit/View 같은 기본 메뉴가 필요 없고, 특히
  // Alt 키를 renderer의 "단축키 목록 보기" 제스처(shell.js initAltShortcutOverlay)로 쓰려면
  // 네이티브 메뉴가 Alt를 먼저 가로채 메뉴 포커스로 써버리지 않게 꺼둬야 한다.
  mainWindow.setMenu(null);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  attachExternalLinkHandler(mainWindow); // 메모/포스트잇 자동 하이퍼링크 클릭 시 OS 기본 브라우저로 열기

  // renderer 프로세스가 죽거나(크래시) 응답 없음 상태가 되어도 앱 전체가 조용히
  // 먹통되지 않도록 최소한 콘솔에 남기고, 필요하면 재로드할 수 있게 로그를 남긴다.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[itda] renderer 프로세스 종료:', details.reason);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[itda] renderer 응답 없음 (unresponsive)');
  });

  // 트레이 상주: "닫기(X)"를 눌러도 앱이 완전히 종료되지 않고 트레이에 남아있는다.
  // 위젯(포스트잇 등)이 열려있는 상태에서 실수로 메인 창을 닫아 다 같이 꺼지는 일을 막기 위함.
  // 트레이 메뉴의 "완전히 종료"를 눌렀을 때(app.isQuittingItda === true)만 진짜로 닫는다.
  mainWindow.on('close', (event) => {
    if (!app.isQuittingItda) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // 개발 중 디버깅용 (배포 빌드에서는 주석 처리)
  // mainWindow.webContents.openDevTools();
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

if (!gotLock) {
  // 이미 다른 인스턴스가 떠 있음 — 이 인스턴스는 아무 창도 열지 않고 즉시 종료
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    try {
      db = initDb();
    } catch (err) {
      // DB 초기화 실패는 앱을 켤 수 없는 치명적 상황 — 조용히 죽지 않고
      // 사용자에게 알린 뒤 종료한다 (병원 PC에서 원인 파악이 가능하도록)
      console.error('[itda] 데이터베이스 초기화 실패:', err);
      dialog.showErrorBox(
        '잇다를 시작할 수 없어요',
        `데이터베이스를 여는 중 오류가 발생했습니다.\n\n${err.message}\n\n` +
          `병원 PC라면 check_windows_env.ps1로 환경을 먼저 점검해주세요.`
      );
      app.quit();
      return;
    }

    const { openWidgetByType, openPostitById } = registerIpcHandlers(ipcMain, db, () => mainWindow);
    createWindow();
    initUpdater(app, ipcMain, mainWindow, createSettingsRepository(db)); // 다른 기능과 결합하지 않는 독립 모듈 — main/updater/index.js 참고
    initGlobalShortcut(app, () => mainWindow, createSettingsRepository(db)); // 마찬가지로 독립 모듈 — main/global-shortcut/index.js 참고
    initTray(app, () => mainWindow, showMainWindow); // 마찬가지로 독립 모듈 — main/tray/index.js 참고
    initAutoBackup(db, createSettingsRepository(db)); // 마찬가지로 독립 모듈 — main/auto-backup/index.js 참고
    // 위젯은 사용자가 직접 켜기 전에는 절대 자동으로 열리지 않는다(의도적 설계).
    // 위치/크기는 여전히 기억되지만(widget_bounds:*), "다시 켜기"는 사용자가 직접 해야 함.
    // 단, 자동 업데이트로 재시작된 직후만 예외 — 재시작 직전에 열려있던 위젯을 그대로
    // 되살린다(main/widget-restore 참고). 스냅샷이 없으면(=업데이트 재시작이 아니면)
    // 아무 일도 안 일어나 위 원칙 그대로 유지된다.
    restoreOpenWidgets({ settings: createSettingsRepository(db), openBoardWidgetByType: openWidgetByType, openPostitById });

    app.on('activate', () => {
      showMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (db) db.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
