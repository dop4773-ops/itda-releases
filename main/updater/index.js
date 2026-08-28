/**
 * main/updater/index.js
 *
 * GitHub Releases 기반 자동 업데이트 모듈.
 *
 * 설계 원칙 (프로젝트 헌장 반영):
 *   - 업데이트 로직은 다른 기능과 결합하지 않는다 → main/ipc/* 도메인 핸들러와
 *     완전히 분리된 이 모듈 하나로 캡슐화한다. main.js는 initUpdater() 한 줄만 호출한다.
 *   - 모드는 설정(update_mode) 하나로 관리한다 — 기본값은 '수동'(병원 업무 특성상 진료 중
 *     갑자기 꺼졌다 켜지는 걸 막기 위해, 사용자가 명시적으로 "지금 확인"을 눌렀을 때만 확인한다).
 *     '자동'을 켜면 백그라운드에서 주기적으로 조용히 확인하고, 다운로드가 끝나는 그 순간 사람
 *     개입 없이 바로 조용히 설치하고 재시작까지 마친다(창을 닫거나 뭘 누를 때까지 기다리지
 *     않음 — "자동"이라면 끝까지 자동이어야 한다는 피드백 반영). 두 모드 다 "다운로드"만큼은
 *     확인이 시작되면(수동 클릭이든 자동 주기든) 자동으로 진행된다(autoDownload=true 고정) —
 *     확인과 다운로드 사이에 또 버튼을 눌러야 하면 번거로우니까. 모드가 가르는 건 "확인이
 *     언제 시작되는가"(자동 주기적 vs 수동 클릭)와 "다운로드 완료 후 설치가 곧장 조용히
 *     되는가, 재시작 확인 팝업을 거치는가" 두 가지뿐이다.
 *   - 로컬 우선: 개발 모드(패키징 안 된 상태로 소스에서 직접 실행)에서는
 *     electron-updater 자체가 정상 동작하지 않으므로(배포 메타파일이 없음),
 *     아예 아무 것도 하지 않고 "개발 모드" 상태만 응답한다.
 *   - quitAndInstall 직전엔 항상 두 가지를 먼저 한다: (1) 열려있는 모든 창의 대기 중인
 *     자동저장을 강제로 끝내고(타이핑 중이던 내용 유실 방지), (2) 지금 열려있는 위젯들을
 *     스냅샷 떠서 재시작 후 main.js가 그대로 다시 열게 한다 — main/widget-restore 참고.
 *
 * 렌더러 쪽 사용법 (settings.js, update-overlay.js 참고):
 *   window.itda.updater.getVersion()      → 현재 앱 버전 문자열
 *   window.itda.updater.checkNow()        → 업데이트 확인 시작 (결과는 아래 이벤트로 옴)
 *   window.itda.updater.quitAndInstall()  → 'downloaded' 상태일 때 재시작 후 설치
 *   window.itda.updater.getReleaseLog()   → GitHub Releases 목록(버전/날짜/노트) — electron-updater와
 *                                          무관하게 순수 조회라 개발 모드에서도 동작한다.
 *   window.itda.updater.onStatus(cb)      → 상태 변경을 실시간으로 받음
 *       cb({ status, version?, percent?, message? })
 *       status: 'dev-mode' | 'checking' | 'available' | 'not-available'
 *              | 'downloading' | 'downloaded' | 'error'
 */

const https = require('https');
const { BrowserWindow } = require('electron');
const { snapshotOpenWidgets } = require('../widget-restore');

// 창(BrowserWindow)마다 자동저장 디바운스 타이머가 독립적으로 돌고 있어서(renderer/shared/
// pending-saves.js), quitAndInstall 직전엔 열려있는 모든 창(메인 창 + 포스트잇/메모 등
// 낱개 위젯 창)에 "지금 당장 저장해" 신호를 보내고 잠깐 기다린 뒤에 설치를 진행한다.
// executeJavaScript가 그 창의 페이지 스크립트 전역(window.__itdaFlushPendingSaves)을 그대로
// 호출하는 방식이라 별도 IPC 채널이 필요 없다 — 함수가 없거나(아직 로딩 전 등) 실행 중
// 오류가 나도 그 창 하나만 못 미루고 넘어가게 각각 캐치한다.
const FLUSH_TIMEOUT_MS = 1500; // 창 하나가 응답이 없어도 설치가 무한정 안 늦춰지게 상한
async function flushAllWindowsThenInstall() {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  await Promise.all(
    windows.map((win) =>
      Promise.race([
        win.webContents
          .executeJavaScript('window.__itdaFlushPendingSaves ? window.__itdaFlushPendingSaves() : null')
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
      ])
    )
  );
}

// package.json의 build.publish(owner/repo)와 동일한 저장소 — GitHub Releases 공개 API는
// 인증 없이 조회 가능하고, User-Agent 헤더가 없으면 GitHub가 403으로 거부하므로 꼭 넣는다.
const RELEASES_REPO = 'dop4773-ops/itda-releases';
const RELEASES_API_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=15`;
// api.github.com이 병원 프록시에 막혀도(github.com만 허용) 이 Atom 피드는 열리는 경우가 많다 — 폴백용.
const RELEASES_ATOM_URL = `https://github.com/${RELEASES_REPO}/releases.atom`;

// 리다이렉트 따라가기 + 타임아웃 + 상태코드별 메시지. GitHub는 User-Agent 없으면 403이라 꼭 넣는다.
function httpGet(url, { redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'itda-app', Accept: 'application/vnd.github+json' }, timeout: 12000 },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          resolve(httpGet(new URL(res.headers.location, url).toString(), { redirects: redirects - 1 }));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
            reject(new Error('GitHub 요청 한도에 걸렸어요. 잠시 후(약 1시간 뒤) 다시 시도해주세요.'));
          } else {
            reject(new Error(`GitHub 응답 오류 (${res.statusCode})`));
          }
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }
    );
    req.on('timeout', () => req.destroy(new Error('요청 시간이 초과됐어요. 네트워크 상태를 확인해주세요.')));
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const text = await httpGet(url);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('응답을 해석하지 못했어요.');
  }
}

// GitHub Releases Atom 피드 → [{version, publishedAt, notes}] (HTML 태그는 걷어내 평문으로)
function parseReleasesAtom(xml) {
  const entries = xml.split('<entry>').slice(1);
  return entries.map((e) => {
    const pick = (re) => (e.match(re) || [, ''])[1];
    const title = pick(/<title>([\s\S]*?)<\/title>/);
    const updated = pick(/<updated>([\s\S]*?)<\/updated>/);
    let content = pick(/<content[^>]*>([\s\S]*?)<\/content>/);
    // Atom content는 HTML이 엔티티로 한 번 더 감싸여 온다(&lt;p&gt;…) — 먼저 엔티티를 풀고,
    // 그다음 태그를 걷어내야 평문이 된다(순서 반대면 <p>가 그대로 남는다).
    content = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#3[49];/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/<\/(p|li|ul|div|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '· ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { version: title.trim(), publishedAt: updated.trim(), notes: content };
  });
}

function initUpdater(app, ipcMain, mainWindow, settings) {
  ipcMain.handle('updater:getVersion', () => app.getVersion());
  ipcMain.handle('updater:getReleasesRepo', () => RELEASES_REPO);

  // GitHub Releases 목록 조회는 electron-updater(패키징 전용)와 무관한 순수 HTTP 조회라
  // dev/packaged 모드 구분 없이 항상 동작한다 — 그래서 아래 dev-mode 분기보다 앞에 둔다.
  ipcMain.handle('updater:getReleaseLog', async () => {
    try {
      const releases = await fetchJson(RELEASES_API_URL);
      return releases.map((r) => ({
        version: r.tag_name || r.name || '',
        publishedAt: r.published_at || '',
        notes: r.body || '',
      }));
    } catch (apiErr) {
      // api.github.com 실패(프록시 차단/요청 한도 등) — github.com Atom 피드로 한 번 더 시도
      console.error('[itda:updater] releases API 실패, Atom 폴백 시도:', apiErr.message);
      try {
        return parseReleasesAtom(await httpGet(RELEASES_ATOM_URL));
      } catch (atomErr) {
        console.error('[itda:updater] Atom 폴백도 실패:', atomErr.message);
        throw apiErr; // 원래 에러 메시지를 사용자에게
      }
    }
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
    ipcMain.handle('updater:quitAndInstall', () => ({ status: 'dev-mode' }));
    return;
  }

  // electron-updater는 패키징된 빌드에서만 의미가 있으므로 여기서(dev 모드 분기 이후)
  // 지연 require한다 — 개발 중에는 이 줄 자체가 실행되지 않는다.
  const { autoUpdater } = require('electron-updater');
  // 확인이 시작되면(수동 클릭이든 자동 주기든) 다운로드까지는 항상 자동으로 진행 — 모드가
  // 가르는 건 "확인이 언제 시작되는가"와 "설치가 조용히 되는가"뿐, 다운로드 버튼을 따로 두지 않는다.
  autoUpdater.autoDownload = true;
  // autoInstallOnAppQuit는 켜 둔다(안전망) — performSilentInstall()의 quitAndInstall이 어떤
  // 이유로든 실패해도, 사용자가 트레이에서 "완전히 종료"하거나 PC를 재부팅할 때 대기 중인
  // 업데이트가 마저 적용된다. oneClick NSIS라 설치창이 뜨지 않아 예전의 "설치창 깜빡임"
  // 우려는 없다("자동인데 결국 설치가 안 된다"는 피드백이 더 중요).
  autoUpdater.autoInstallOnAppQuit = true;

  // 설정(update_mode)을 매번 새로 읽는다 — 앱이 켜져 있는 동안 사용자가 이 설정을 바꿀 수도
  // 있으니, 시작 시점에 한 번 캐시해두면 그 이후 변경을 못 따라간다. 값이 없으면(신규 설치
  // 직후) '수동'이 기본값 — 병원 업무 중 예고 없이 꺼졌다 켜지는 걸 막기 위해 안전한 쪽을 기본으로.
  const getMode = () => (settings.get('update_mode') === 'auto' ? 'auto' : 'manual');

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
  let installTriggered = false;

  // 자동 설치+재시작을 최대한 확실하게 — 과거엔 quitAndInstall만 호출했는데,
  //  (a) 이벤트 핸들러 안에서 곧바로 부르면 electron-updater가 무시하는 경우가 있고,
  //  (b) 트레이 상주 앱이라 메인 창 'close'가 preventDefault로 막혀 app.quit() 시퀀스가
  //      중단되면 설치가 영영 안 걸린다.
  // 그래서: 스냅샷/플러시 실패가 설치를 막지 않게 감싸고 → 다음 tick에 → 모든 창을 destroy로
  // (close 핸들러를 우회) 강제로 닫고 → quitAndInstall → 그래도 몇 초 안에 안 죽으면 app.exit().
  async function performSilentInstall() {
    if (installTriggered) return;
    installTriggered = true;
    app.isQuittingItda = true;
    try {
      snapshotOpenWidgets(settings);
    } catch (e) {
      console.error('[itda:updater] 위젯 스냅샷 실패(무시하고 설치 진행):', e.message);
    }
    try {
      await flushAllWindowsThenInstall();
    } catch (e) {
      console.error('[itda:updater] 자동저장 플러시 실패(무시하고 설치 진행):', e.message);
    }
    setImmediate(() => {
      try {
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.destroy();
        });
      } catch (e) {
        /* 창 파괴 실패해도 설치는 시도 */
      }
      try {
        autoUpdater.quitAndInstall(true, true); // isSilent, isForceRunAfter
      } catch (e) {
        console.error('[itda:updater] quitAndInstall 호출 실패:', e.message);
      }
      // quitAndInstall이 어떤 이유로든 프로세스를 못 끝내면, 5초 뒤 app.quit()으로 한 번 더 —
      // autoInstallOnAppQuit=true라 이때라도 대기 중인 설치가 적용된다. 그래도 안 죽으면 강제 종료.
      setTimeout(() => {
        try {
          app.quit();
        } catch (e) {
          /* noop */
        }
        setTimeout(() => app.exit(0), 3000);
      }, 5000);
    });
  }

  autoUpdater.on('update-downloaded', (info) => {
    updateReadyToInstall = true;
    sendStatus('downloaded', { version: info.version });
    // 자동 모드면 다운로드가 끝나는 즉시 사람 개입 없이 설치+재시작.
    if (getMode() === 'auto') performSilentInstall();
  });

  // 다운로드 완료 즉시 설치가 못 걸린 경우(수동→자동 전환 등)를 위한 보조 — 창을 닫을 때 한 번 더.
  if (mainWindow) {
    mainWindow.on('close', () => {
      if (!updateReadyToInstall || getMode() !== 'auto') return;
      performSilentInstall();
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

  ipcMain.handle('updater:quitAndInstall', async () => {
    // 수동 모드에서 사용자가 재시작 버튼을 직접 눌러도, 다른 창(위젯 등)에 아직 안 끝난
    // 자동저장이 있을 수 있으니 마찬가지로 먼저 플러시하고, 열려있던 위젯도 스냅샷 떠둔다.
    snapshotOpenWidgets(settings);
    await flushAllWindowsThenInstall();
    autoUpdater.quitAndInstall();
    return { status: 'ok' };
  });

  // 앱 시작 몇 초 후 조용히 한 번 확인해둔다 — 자동 모드일 때만. 수동 모드는 백그라운드 확인을
  // 아예 안 해서, 사용자가 설정 화면에서 "지금 확인"을 직접 눌러야만 확인/다운로드가 시작된다
  // ("업데이트 확인" 버튼 자체는 모드와 무관하게 항상 동작 — 위 updater:checkNow 핸들러 참고).
  if (getMode() === 'auto') {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[itda:updater] 시작 시 자동 확인 실패:', err);
      });
    }, 5000);
  }

  // 시작할 때 한 번만 확인하고 끝나면, 트레이에 상주한 채 며칠씩 안 꺼지는 이 앱 특성상
  // 그 사이에 나온 새 릴리스는 앱을 재시작하기 전까진 영영 모르게 된다 — 실제로 이것 때문에
  // "분명 배포했는데 업데이트가 안 되는 것 같다"는 문제가 있었다. 그래서 켜져 있는 동안
  // 주기적으로도 다시 확인한다(자동 모드일 때만).
  const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간마다
  setInterval(() => {
    if (getMode() !== 'auto') return;
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[itda:updater] 주기적 확인 실패:', err);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { initUpdater };
