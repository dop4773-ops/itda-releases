/**
 * main/updater/index.js
 *
 * GitHub Releases 기반 자동 업데이트 모듈.
 *
 * 설계 원칙 (프로젝트 헌장 반영):
 *   - 업데이트 로직은 다른 기능과 결합하지 않는다 → main/ipc/* 도메인 핸들러와
 *     완전히 분리된 이 모듈 하나로 캡슐화한다. main.js는 initUpdater() 한 줄만 호출한다.
 *   - 알림은 방해하지 않는 방식으로, 필요한 정보만 준다 → 자동으로 다운로드/설치를
 *     강제하지 않는다. "확인"과 "다운로드"와 "재시작 설치"를 전부 사용자가 직접
 *     버튼을 눌러야만 진행되도록 만들어서, 병원 PC에서 사용자가 모르는 사이에
 *     네트워크를 쓰거나 갑자기 재시작되는 일이 없게 한다.
 *   - 로컬 우선: 개발 모드(패키징 안 된 상태로 소스에서 직접 실행)에서는
 *     electron-updater 자체가 정상 동작하지 않으므로(배포 메타파일이 없음),
 *     아예 아무 것도 하지 않고 "개발 모드" 상태만 응답한다.
 *
 * 렌더러 쪽 사용법 (settings.js 참고):
 *   window.itda.updater.getVersion()      → 현재 앱 버전 문자열
 *   window.itda.updater.checkNow()        → 업데이트 확인 시작 (결과는 아래 이벤트로 옴)
 *   window.itda.updater.downloadUpdate()  → 'available' 상태일 때 다운로드 시작
 *   window.itda.updater.quitAndInstall()  → 'downloaded' 상태일 때 재시작 후 설치
 *   window.itda.updater.onStatus(cb)      → 상태 변경을 실시간으로 받음
 *       cb({ status, version?, percent?, message? })
 *       status: 'dev-mode' | 'checking' | 'available' | 'not-available'
 *              | 'downloading' | 'downloaded' | 'error'
 */

function initUpdater(app, ipcMain, mainWindow) {
  ipcMain.handle('updater:getVersion', () => app.getVersion());

  // 개발 모드에서는 electron-updater를 아예 로드하지 않는다.
  // (패키징된 앱이 아니면 업데이트 메타데이터 URL 자체가 없어서 계속 에러만 남기 때문)
  if (!app.isPackaged) {
    ipcMain.handle('updater:checkNow', () => ({
      status: 'dev-mode',
      message: '개발 모드에서는 업데이트 확인을 지원하지 않아요. 패키징된 빌드에서만 동작합니다.',
    }));
    ipcMain.handle('updater:downloadUpdate', () => ({ status: 'dev-mode' }));
    ipcMain.handle('updater:quitAndInstall', () => ({ status: 'dev-mode' }));
    return;
  }

  // electron-updater는 패키징된 빌드에서만 의미가 있으므로 여기서(dev 모드 분기 이후)
  // 지연 require한다 — 개발 중에는 이 줄 자체가 실행되지 않는다.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false; // 사용자가 직접 "다운로드" 버튼을 눌러야만 받는다
  autoUpdater.autoInstallOnAppQuit = false; // 재시작도 사용자가 직접 눌러야만 한다

  function sendStatus(status, extra = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', { status, ...extra });
    }
  }

  autoUpdater.on('checking-for-update', () => sendStatus('checking'));
  autoUpdater.on('update-available', (info) => {
    // electron-updater가 GitHub Release 본문(설명란)을 releaseNotes로 자동으로 가져와준다.
    // 여러 버전을 건너뛰고 업데이트하는 경우 배열({version, note}[])로 오기도 해서, 문자열로 합쳐준다.
    const notes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes.map((n) => `v${n.version}\n${n.note || ''}`).join('\n\n')
      : info.releaseNotes || '';
    sendStatus('available', { version: info.version, releaseNotes: notes });
  });
  autoUpdater.on('update-not-available', () => sendStatus('not-available'));
  autoUpdater.on('error', (err) => {
    console.error('[itda:updater]', err);
    sendStatus('error', { message: err?.message || '알 수 없는 오류가 발생했어요.' });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendStatus('downloading', { percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => sendStatus('downloaded', { version: info.version }));

  ipcMain.handle('updater:checkNow', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { status: 'checked' };
    } catch (err) {
      return { status: 'error', message: err?.message || '업데이트 확인에 실패했어요.' };
    }
  });

  ipcMain.handle('updater:downloadUpdate', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: err?.message || '다운로드에 실패했어요.' };
    }
  });

  ipcMain.handle('updater:quitAndInstall', () => {
    autoUpdater.quitAndInstall();
    return { status: 'ok' };
  });

  // 앱 시작 몇 초 후 조용히 한 번 확인만 해둔다 (다운로드는 안 함).
  // 사용자가 나중에 설정 화면을 열어보면 이미 "새 버전 있음" 상태가 보이는 정도.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[itda:updater] 시작 시 자동 확인 실패:', err);
    });
  }, 5000);
}

module.exports = { initUpdater };
