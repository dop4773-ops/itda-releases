/**
 * 창 진단 로그 — "위젯이 저절로 사라졌다" 같은 현상의 원인을 나중에 알 수 있게 창의 일생과 주변 사건을 한 줄씩 남긴다.
 * userData/logs/windows.log (설정 > 데이터 & 백업 > 로그 폴더). 창이 닫힐 때는 누가 닫았는지(우리 코드가 알린 이유,
 * 없으면 화면/OS가 닫은 것), 렌더러가 죽었는지·멈췄는지, 그 무렵 모니터가 바뀌었거나 절전/잠금이 있었는지를 같이 본다.
 * 한 줄이 작고 사건이 드물어서 평소엔 거의 안 쌓인다(256KB 넘으면 .1로 한 번 밀어냄).
 */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024;
const closeReasons = new WeakMap();

// 우리 쪽 코드가 창을 닫을 때 이유를 알려둔다 — 안 알린 close는 화면(window.close)이나 OS가 한 것
function noteClose(win, reason) {
  if (win) closeReasons.set(win, reason);
}

// 'file:///.../widget.html?type=memo-item&id=3' → 'widget:memo-item#3'
function labelOf(url) {
  try {
    const u = new URL(url);
    const page = path.basename(u.pathname, '.html') || 'unknown';
    const q = u.searchParams;
    const kind = q.get('type') || q.get('kind');
    return [page, kind].filter(Boolean).join(':') + (q.get('id') ? `#${q.get('id')}` : '');
  } catch (e) {
    return 'unknown';
  }
}

function formatLine(now, event, detail) {
  return `[${now.toISOString()}] ${event}${detail ? ` ${detail}` : ''}\n`;
}

function createWriter(dir) {
  const file = path.join(dir, 'windows.log');
  return (event, detail) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
      } catch (e) {
        /* 아직 없음 */
      }
      fs.appendFileSync(file, formatLine(new Date(), event, detail));
    } catch (e) {
      /* 진단 로그가 앱을 방해하면 안 된다 */
    }
  };
}

/** main.js에서 앱이 준비된 뒤 한 번 호출 */
function initWindowDiagnostics({ app, screen, powerMonitor, logDir, logError }) {
  const write = createWriter(logDir());

  app.on('browser-window-created', (_e, win) => {
    const born = Date.now();
    let label = 'window';
    const wc = win.webContents;
    wc.on('did-finish-load', () => (label = labelOf(wc.getURL())));
    // 화면 안의 window.close()는 'close' 이벤트 없이 바로 'closed'만 오므로 'closed'에서 기록한다.
    // 그땐 창이 이미 없어서 상태를 못 물어보니, 눈에 띄는 변화 때마다 마지막 상태를 적어 둔다.
    const st = { visible: false, focused: false, bounds: null };
    const snap = () => {
      if (!win.isDestroyed()) st.bounds = win.getBounds();
    };
    win.on('show', () => ((st.visible = true), snap()));
    win.on('hide', () => (st.visible = false));
    win.on('focus', () => (st.focused = true));
    win.on('blur', () => (st.focused = false));
    win.on('moved', snap);
    win.on('resized', snap);
    win.on('closed', () => {
      const reason = closeReasons.get(win) || 'screen-or-os'; // 화면의 window.close()·닫기 버튼·OS(Alt+F4, 작업 종료)
      write('closed', `${label} age=${Math.round((Date.now() - born) / 1000)}s by=${reason} visible=${st.visible} focused=${st.focused} bounds=${JSON.stringify(st.bounds)}`);
    });
    win.on('unresponsive', () => write('unresponsive', label));
    win.on('responsive', () => write('responsive', label));
    wc.on('did-fail-load', (_ev, code, desc, url) => write('did-fail-load', `${label} ${code} ${desc} ${url}`));
  });

  app.on('render-process-gone', (_e, wc, details) => {
    const msg = `${labelOf(wc.getURL())} reason=${details.reason} exitCode=${details.exitCode}`;
    write('render-process-gone', msg);
    logError('window', { message: `renderer gone: ${msg}` });
  });
  app.on('child-process-gone', (_e, details) => write('child-process-gone', `${details.type} reason=${details.reason} exitCode=${details.exitCode}`));
  app.on('before-quit', () => write('before-quit'));

  // 창이 사라진 것처럼 보이는 다른 원인 후보: 모니터 변경·해상도/배율 변경·절전·화면 잠금
  screen.on('display-added', () => write('display-added', `displays=${screen.getAllDisplays().length}`));
  screen.on('display-removed', () => write('display-removed', `displays=${screen.getAllDisplays().length}`));
  screen.on('display-metrics-changed', (_e, d, changed) => write('display-metrics-changed', `${d.id} ${changed.join(',')} ${JSON.stringify(d.workArea)}`));
  ['suspend', 'resume', 'lock-screen', 'unlock-screen'].forEach((ev) => powerMonitor.on(ev, () => write(ev)));
  write('start', `v${app.getVersion()} displays=${screen.getAllDisplays().length}`);
}

module.exports = { initWindowDiagnostics, noteClose, labelOf, formatLine };
