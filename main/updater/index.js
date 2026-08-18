/**
 * main/updater/index.js
 *
 * GitHub Releases 기반 자동 업데이트 모듈.
 *
 * 설계 원칙 (프로젝트 헌장 반영):
 *   - 업데이트 로직은 다른 기능과 결합하지 않는다 → main/ipc/* 도메인 핸들러와
 *     완전히 분리된 이 모듈 하나로 캡슐화한다. main.js는 initUpdater() 한 줄만 호출한다.
 *   - 다운로드/설치는 조용히 자동으로 진행하되, "일하는 도중 갑자기 재시작"만은 피한다 →
 *     새 버전이 있으면 백그라운드에서 자동으로 다운로드하고(autoDownload), 설치는 사용자가
 *     직접 "재시작 후 설치"를 누르지 않아도 창을 닫는(트레이로 내려가는) 바로 그 순간
 *     조용히 적용된다. 이 앱은 트레이 상주형이라 "완전히 종료"를 거의 안 눌러서, electron-updater
 *     기본값인 autoInstallOnAppQuit만으로는 사실상 설치될 기회가 없었다 — 그래서 mainWindow의
 *     'close' 이벤트(= 사용자가 X를 눌러 자리를 비우려는 시점)를 직접 감지해서, 그때 마침
 *     설치할 업데이트가 준비돼 있으면 숨기는 대신 조용히 재시작+설치한다(autoInstallOnAppQuit은
 *     끄고 이 close 리스너 하나로만 트리거 — 둘 다 켜두면 설치 경로가 겹쳐서 설치창이 잠깐
 *     보이는 원인이 됐었다). 설치창 자체가 안 뜨는 건 package.json의 nsis.oneClick:true도
 *     필요하다 — assisted(oneClick:false) 인스톨러는 isSilent=true로 불러도 일부 UI가
 *     남아서 뜬다. 일하는 도중에는 창을 안 닫으니 방해받지 않고, 사용자 입장에서는 다음에
 *     창을 열면 이미 최신 버전인 것처럼 느껴진다. 설정 화면의 "지금 재시작해서 설치" 버튼은
 *     당장 적용하고 싶은 사람을 위한 선택지로만 남겨둔다.
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

function initUpdater(app, ipcMain, mainWindow, settings) {
  ipcMain.handle('updater:getVersion', () => app.getVersion());

  // 개발 모드에서는 electron-updater를 아예 로드하지 않는다.
  // (패키징된 앱이 아니면 업데이트 메타데이터 URL 자체가 없어서 계속 에러만 남기 때문)
  if (!app.isPackaged) {
    ipcMain.handle('updater:checkNow', () => {
      const status = {
        status: 'dev-mode',
        message: '개발 모드에서는 업데이트 확인을 지원하지 않아요. 패키징된 빌드에서만 동작합니다.',
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:status', status);
      }
      return status;
    });
    ipcMain.handle('updater:downloadUpdate', () => ({ status: 'dev-mode' }));
    ipcMain.handle('updater:quitAndInstall', () => ({ status: 'dev-mode' }));
    return;
  }

  // electron-updater는 패키징된 빌드에서만 의미가 있으므로 여기서(dev 모드 분기 이후)
  // 지연 require한다 — 개발 중에는 이 줄 자체가 실행되지 않는다.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true; // 새 버전이 확인되면 바로 백그라운드에서 다운로드
  // autoInstallOnAppQuit(기본값 true)은 일부러 꺼둔다 — 아래 mainWindow 'close' 리스너가
  // isSilent=true로 직접 quitAndInstall을 호출하는데, 둘 다 켜져 있으면 app.quit() 시퀀스
  // 중에 electron-updater 내부의 기본(비-silent) 설치 경로가 같이 걸려서 설치창이 잠깐
  // 보이는 원인이 될 수 있었다. 이 앱은 close 리스너가 설치 시점을 전담하므로 하나만 켠다.
  autoUpdater.autoInstallOnAppQuit = false;

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
  let updateReadyToInstall = false;
  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    sendStatus('downloaded', { version: info.version });
  });

  // 창을 닫아서(트레이로 내려가서) 안 보이게 되는 바로 그 시점 — 마침 설치할 업데이트가
  // 준비돼 있으면 그냥 숨기지 않고 조용히 재시작+설치한다. main.js의 close 핸들러(숨기기)보다
  // 나중에 등록돼서 나중에 실행되므로, 여기서 종료로 확정하면 숨기기 대신 실제로 꺼지고
  // isForceRunAfter=true라 설치 후 자동으로 다시 켜진다.
  if (mainWindow) {
    mainWindow.on('close', () => {
      if (!updateReadyToInstall) return;
      app.isQuittingItda = true;
      autoUpdater.quitAndInstall(true, true);
    });
  }

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

  // 앱 시작 몇 초 후 조용히 한 번 확인해둔다 — autoDownload=true라 새 버전이 있으면
  // 이 시점에 백그라운드 다운로드까지 바로 시작된다. 사용자가 나중에 설정 화면을 열어보면
  // 이미 "다운로드 중/완료" 상태가 보이는 정도. 설정(update_auto_check)에서 꺼뒀으면
  // 이 자동 확인만 건너뛴다 — "업데이트 확인" 버튼을 직접 누르는 건 이 설정과 무관하게
  // 항상 동작한다(위 updater:checkNow 핸들러 참고).
  const autoCheckEnabled = settings.get('update_auto_check') !== '0';
  if (autoCheckEnabled) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[itda:updater] 시작 시 자동 확인 실패:', err);
      });
    }, 5000);
  }
}

module.exports = { initUpdater };
