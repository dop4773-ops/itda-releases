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
 *   window.itda.updater.getReleaseLog()   → GitHub Releases 목록(버전/날짜/노트) — electron-updater와
 *                                          무관하게 순수 조회라 개발 모드에서도 동작한다.
 *   window.itda.updater.onStatus(cb)      → 상태 변경을 실시간으로 받음
 *       cb({ status, version?, percent?, message? })
 *       status: 'dev-mode' | 'checking' | 'available' | 'not-available'
 *              | 'downloading' | 'downloaded' | 'error'
 */

const https = require('https');

// package.json의 build.publish(owner/repo)와 동일한 저장소 — GitHub Releases 공개 API는
// 인증 없이 조회 가능하고, User-Agent 헤더가 없으면 GitHub가 403으로 거부하므로 꼭 넣는다.
const RELEASES_API_URL = 'https://api.github.com/repos/dop4773-ops/itda-releases/releases?per_page=15';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'itda-app', Accept: 'application/vnd.github+json' } }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`GitHub API 오류 (${res.statusCode})`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('응답을 해석하지 못했어요.'));
          }
        });
      })
      .on('error', reject);
  });
}

function initUpdater(app, ipcMain, mainWindow, settings) {
  ipcMain.handle('updater:getVersion', () => app.getVersion());

  // GitHub Releases 목록 조회는 electron-updater(패키징 전용)와 무관한 순수 HTTP 조회라
  // dev/packaged 모드 구분 없이 항상 동작한다 — 그래서 아래 dev-mode 분기보다 앞에 둔다.
  ipcMain.handle('updater:getReleaseLog', async () => {
    const releases = await fetchJson(RELEASES_API_URL);
    return releases.map((r) => ({
      version: r.tag_name || r.name || '',
      publishedAt: r.published_at || '',
      notes: r.body || '',
    }));
  });

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
  // 설정(update_mode)에 따라 "자동"(다운로드까지 조용히 자동 진행) / "수동"(확인만 하고 다운로드는
  // 사용자가 버튼을 눌러야 시작) 을 고른다. electron-updater는 checkForUpdates() 시점의
  // autoDownload 값으로 동작을 정하므로, 확인을 시작하기 직전마다 이 값을 최신 설정으로 맞춰둔다.
  const syncAutoDownloadFlag = () => {
    autoUpdater.autoDownload = settings.get('update_mode') !== 'manual';
  };
  syncAutoDownloadFlag();
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
      // 수동 모드는 다운로드뿐 아니라 설치 시점도 사용자가 버튼으로 직접 결정하길 원해서
      // 만든 모드라, 여기서 조용히 설치해버리면 그 의도와 어긋난다 — 자동 모드에서만 적용.
      if (settings.get('update_mode') === 'manual') return;
      app.isQuittingItda = true;
      autoUpdater.quitAndInstall(true, true);
    });
  }

  ipcMain.handle('updater:checkNow', async () => {
    try {
      syncAutoDownloadFlag();
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

  // 설정(update_auto_check)을 매번 새로 읽는다 — 앱이 켜져 있는 동안 사용자가 이 설정을
  // 바꿀 수도 있으니, 시작 시점에 한 번 캐시해두면 그 이후 변경을 못 따라간다.
  const isAutoCheckEnabled = () => settings.get('update_auto_check') !== '0';

  // 앱 시작 몇 초 후 조용히 한 번 확인해둔다 — 이 시점의 업데이트 모드가 "자동"이면 새 버전을
  // 백그라운드 다운로드까지 바로 시작하고, "수동"이면 확인만 하고 멈춘다(사용자가 설정 화면에서
  // 직접 "업데이트" 버튼을 눌러야 다운로드가 시작됨). 설정에서 꺼뒀으면 이 자동 확인만 건너뛴다 —
  // "업데이트 확인" 버튼을 직접 누르는 건 이 설정과 무관하게 항상 동작한다(위 updater:checkNow 핸들러 참고).
  if (isAutoCheckEnabled()) {
    setTimeout(() => {
      syncAutoDownloadFlag();
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[itda:updater] 시작 시 자동 확인 실패:', err);
      });
    }, 5000);
  }

  // 시작할 때 한 번만 확인하고 끝나면, 트레이에 상주한 채 며칠씩 안 꺼지는 이 앱 특성상
  // 그 사이에 나온 새 릴리스는 앱을 재시작하기 전까진 영영 모르게 된다 — 실제로 이것 때문에
  // "분명 배포했는데 업데이트가 안 되는 것 같다"는 문제가 있었다. 그래서 켜져 있는 동안
  // 주기적으로도 다시 확인한다.
  const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간마다
  setInterval(() => {
    if (!isAutoCheckEnabled()) return;
    syncAutoDownloadFlag();
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[itda:updater] 주기적 확인 실패:', err);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { initUpdater };
