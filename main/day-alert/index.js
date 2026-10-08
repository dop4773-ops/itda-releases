/**
 * main/day-alert/index.js — "당일 알림": 알림을 켜 둔 일정/할 일을, 그날 처음 확인하는 시점에 작은 팝업창으로 알려준다.
 *   - 확인 시점: 앱을 켠 직후, 그리고 날짜가 바뀐 뒤 첫 1분 틱(자정 넘김·절전 복귀 포함). 한낮에 새로 만든 항목은 띄우지 않는다.
 *   - 창: 잇다 본 창과 별개(frameless·항상 위·포커스 안 뺏음)라 본 창이 트레이에 숨어 있어도 보인다.
 *   - "확인"을 누른 항목은 그날 다시 안 뜬다("나중에"는 다음에 켤 때 다시). 상태는 app_settings(day_alert_state)에 저장.
 * 설정: day_alert_enabled('0'이면 끔), day_alert_a(가운데 팝업, 기본 켬), day_alert_b(우하단 구석 카드, '1'이면 켬) — 둘 다 켜면 둘 다 뜬다.
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const createSettingsRepository = require('../repositories/settings.repository');

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 그날 알림 대상 — 일정(하루종일 포함, 여러 날 일정은 기간 중 매일)과 오늘 마감인 미완료 할 일
function collect(db, date) {
  const events = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.all_day, COALESCE(c.color_hex, e.color_hex) AS color_hex
       FROM events e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.remind_day = 1 AND date(e.start_at) <= date(?) AND date(e.end_at) >= date(?)
       ORDER BY e.all_day DESC, e.start_at, e.id`
    )
    .all(date, date)
    .map((e) => ({ key: `e:${e.id}`, id: e.id, title: e.title, allDay: !!e.all_day, time: e.all_day ? '' : String(e.start_at).slice(11, 16), color: e.color_hex || '' }));
  const todos = db
    .prepare(
      `SELECT id, title, due_time, priority FROM todos
       WHERE deleted_at IS NULL AND remind_day = 1 AND is_done = 0 AND due_date = ?
       ORDER BY due_time IS NULL, due_time, priority, id`
    )
    .all(date)
    .map((t) => ({ key: `t:${t.id}`, id: t.id, title: t.title, time: t.due_time || '', high: t.priority === 1 }));
  return { events, todos };
}

function initDayAlert(db, ipcMain) {
  const lockState = require('../shared/lock-state');
  const { noteClose } = require('../shared/window-diagnostics');
  const settings = createSettingsRepository(db);
  const wins = { a: null, b: null };
  let current = null; // 지금 창에 보여 주는 내용 { date, events, todos, pos, preview }
  let lastCheckedDate = null;

  const enabled = () => settings.get('day_alert_enabled') !== '0';
  const readState = () => {
    try {
      const s = JSON.parse(settings.get('day_alert_state') || '{}');
      return s.date === todayStr() ? { date: s.date, seen: Array.isArray(s.seen) ? s.seen : [] } : { date: todayStr(), seen: [] };
    } catch (e) {
      return { date: todayStr(), seen: [] };
    }
  };

  // 두 가지 모양 — a: 화면 가운데 팝업(목록 전체), b: 우하단 구석 카드(요약). 설정에서 각각 켜고 끄며, 둘 다 켜면 둘 다 뜬다.
  const styles = () => {
    const on = [];
    if (settings.get('day_alert_a') !== '0') on.push('a'); // 가운데 팝업 — 기본 켜짐
    if (settings.get('day_alert_b') === '1') on.push('b'); // 구석 카드 — 기본 꺼짐
    return on.length ? on : ['a'];
  };

  function boundsFor(kind, count) {
    const wa = screen.getPrimaryDisplay().workArea;
    const width = kind === 'a' ? 380 : 330;
    const height = kind === 'a' ? Math.min(560, 176 + count * 52) : 124 + Math.min(count, 3) * 36 + (count > 3 ? 30 : 0);
    const x = kind === 'a' ? wa.x + Math.round((wa.width - width) / 2) : wa.x + wa.width - width - 16;
    const y = kind === 'a' ? wa.y + Math.round((wa.height - height) / 2) : wa.y + wa.height - height - 16;
    return { x, y, width, height };
  }

  function showOne(kind) {
    const bounds = boundsFor(kind, lockState.isLocked() ? 0 : current.count); // 잠금 중엔 건수만 보여주므로 작게
    let w = wins[kind];
    if (w && !w.isDestroyed()) {
      w.setBounds(bounds);
      w.webContents.send('dayAlert:update');
      w.showInactive();
      return;
    }
    w = wins[kind] = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, '..', '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.setMenu(null);
    w.setAlwaysOnTop(true, 'floating');
    w.loadFile(path.join(__dirname, '..', '..', 'renderer', 'day-alert.html'), { query: { kind } });
    w.once('ready-to-show', () => !w.isDestroyed() && w.showInactive());
    w.on('closed', () => {
      if (wins[kind] === w) wins[kind] = null;
    });
  }

  const closeAll = () => ['a', 'b'].forEach((k) => wins[k] && !wins[k].isDestroyed() && (noteClose(wins[k], 'main:dayAlert'), wins[k].close()));

  function show(payload, kinds = styles()) {
    current = { ...payload, count: payload.events.length + payload.todos.length };
    kinds.forEach(showOne);
  }

  function check() {
    if (!enabled()) return;
    const date = todayStr();
    const { events, todos } = collect(db, date);
    const seen = new Set(readState().seen);
    const e = events.filter((x) => !seen.has(x.key));
    const t = todos.filter((x) => !seen.has(x.key));
    if (e.length || t.length) show({ date, events: e, todos: t, preview: false });
  }

  // 날짜가 바뀐 뒤 첫 틱에만 확인 — 앱 시작 직후 한 번, 이후엔 자정을 넘겼을 때(또는 절전에서 깬 다음 날)만
  function tick() {
    const date = todayStr();
    if (date === lastCheckedDate) return;
    lastCheckedDate = date;
    try {
      check();
    } catch (err) {
      console.error('[itda] 당일 알림 확인 실패:', err);
    }
  }
  setTimeout(tick, 6000).unref?.();
  setInterval(tick, 60 * 1000).unref?.();

  // 잠금 중엔 제목을 내보내지 않고 건수만 — 잠금이 풀리면 열려 있는 팝업을 다시 그린다
  ipcMain.handle('dayAlert:get', () => (current && lockState.isLocked() ? { ...current, locked: true, events: [], todos: [] } : current));
  lockState.onUnlock(() => current && ['a', 'b'].forEach((k) => wins[k] && !wins[k].isDestroyed() && showOne(k)));
  ipcMain.handle('dayAlert:close', (e) => {
    // 구석 카드(b)를 닫으면 그 창만, 가운데 팝업(a)을 닫으면 둘 다 — "나중에"는 다음에 켤 때 다시 알려준다
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w === wins.b && wins.a && !wins.a.isDestroyed()) w.close();
    else closeAll();
  });
  // 보여 준 항목을 오늘은 다시 안 띄운다(미리보기는 기록하지 않음)
  ipcMain.handle('dayAlert:ack', () => {
    if (current && !current.preview && !lockState.isLocked()) {
      const st = readState();
      const keys = new Set(st.seen);
      [...current.events, ...current.todos].forEach((x) => keys.add(x.key));
      settings.set('day_alert_state', JSON.stringify({ date: st.date, seen: [...keys] }));
    }
    closeAll();
  });
  // 구석 카드의 "모두 보기" — 가운데 팝업(전체 목록)을 연다
  ipcMain.handle('dayAlert:openFull', () => current && showOne('a'));
  // 설정의 "미리보기" — 실제 대상이 있으면 그걸(상태 기록 없이), 없으면 예시를 보여 준다
  ipcMain.handle('dayAlert:preview', () => {
    const date = todayStr();
    const real = collect(db, date);
    const sample = !real.events.length && !real.todos.length;
    show({
      date,
      preview: true,
      sample,
      events: sample ? [{ key: 'e:0', id: 0, title: '예시 · 하루종일 일정', allDay: true, time: '', color: '#BA7517' }] : real.events,
      todos: sample ? [{ key: 't:0', id: 0, title: '예시 · 오늘 마감 할 일', time: '', high: false }] : real.todos,
    });
  });

  return { checkNow: tick };
}

module.exports = { initDayAlert, collect };
