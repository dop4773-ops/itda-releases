const { app, dialog, BrowserWindow, Notification } = require('electron');
const path = require('node:path');
const { broadcastDataChanged } = require('../broadcast');
const cfgStore = require('../messenger/config');
const { openMessengerDb, checkCompat, readAll, MessengerError } = require('../messenger/reader');
const { runSync, windowOf } = require('../messenger/sync');
const { findMessengerDbs } = require('../messenger/detect');
const { startMessengerScheduler } = require('../messenger/scheduler');
const F = require('../messenger/format');
const { pendingNotice } = require('../messenger/notify');
const { forceShowAndFocus } = require('../shared/window-focus');

const STRICT = { full: 0, mask: 1, hide: 2 };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = function registerMessengerIpc(ipcMain, repos, db, getMainWindow = () => null) {
  const { settings, messenger } = repos;
  let running = false;

  // 자동 실행이 확인 필요로 멈췄을 때 OS 알림 — 같은 대상이면 한 번만, 클릭하면 설정의 메신저 연동으로 간다.
  // 창이 닫혀 트레이에 있어도 뜬다. 직접 실행(수동/설정 변경)은 화면에서 바로 보이므로 알리지 않는다.
  function notifyPending(summary, trigger) {
    try {
      const notice = pendingNotice(summary.pending);
      if (!notice) {
        if (settings.get('messenger_pending_notified')) settings.set('messenger_pending_notified', '');
        return;
      }
      if (trigger !== 'auto' || settings.get('messenger_pending_notified') === notice.key || !Notification.isSupported()) return;
      settings.set('messenger_pending_notified', notice.key);
      const n = new Notification({ title: notice.title, body: notice.body });
      n.on('click', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        forceShowAndFocus(win);
        win.webContents.send('itda:navigate', '#/settings/messenger');
      });
      n.show();
    } catch (e) {
      console.error('[itda] 메신저 확인 필요 알림 실패:', e.message);
    }
  }

  // 메신저를 읽어 잇다 일정에 반영. 읽기 실패는 던지지 않고 {ok:false}로 — 자동 실행이 조용히 넘어갈 수 있게.
  function syncOnce({ trigger = 'manual', confirm = {}, skipRead = false } = {}) {
    const config = cfgStore.load(settings);
    if (!config.enabled) return { ok: false, error: '메신저 연동이 꺼져 있어요.' };
    if (!skipRead && !config.dbPath) return { ok: false, error: '메신저 DB 파일을 먼저 정해주세요.' };
    if (running) return { ok: false, error: '이미 불러오는 중이에요.' };
    running = true;
    try {
      const read = (win) => {
        const h = openMessengerDb(config.dbPath);
        try {
          return readAll(h.db, win);
        } finally {
          h.close();
        }
      };
      const summary = runSync({ itdaDb: db, repos, config, read, trigger, confirm, skipRead });
      broadcastDataChanged('event');
      notifyPending(summary, trigger);
      return { ok: true, summary };
    } catch (e) {
      const error = e instanceof MessengerError ? e.message : `불러오지 못했어요: ${e.message}`;
      messenger.addLog(trigger, { at: new Date().toISOString(), trigger, error });
      return { ok: false, code: e.code, error };
    } finally {
      running = false;
    }
  }

  const getWin = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;

  ipcMain.handle('messenger:getConfig', () => cfgStore.load(settings));

  // 설정 저장. 표시/범위가 바뀌면 바로 일정에 반영한다(이름을 더 엄격하게 바꾸면 저장된 이름부터 즉시 가림 —
  // 메신저를 못 읽어도 되도록 다시 읽지 않고 일정만 다시 만든다).
  ipcMain.handle('messenger:setConfig', (event, patch) => {
    const prev = cfgStore.load(settings);
    const next = cfgStore.save(settings, patch || {});
    let result = null;
    if (next.enabled && prev.enabled) {
      if (STRICT[next.nameMode] > STRICT[prev.nameMode]) {
        messenger.scrubNames(next.nameMode);
        result = syncOnce({ trigger: 'config', skipRead: true });
      } else {
        const scope = (c) => ({ k: c.kinds, w: c.wards, r: c.rms, p: c.pastDays, f: c.futureDays, n: c.nameMode, d: c.dbPath });
        if (!same(scope(prev), scope(next))) result = syncOnce({ trigger: 'config', confirm: { deletes: true } }); // 방금 바꾼 설정으로 인한 삭제는 의도된 것
      }
    } else if (next.enabled && !prev.enabled && next.dbPath) {
      result = syncOnce({ trigger: 'config' });
    }
    return { config: next, result };
  });

  ipcMain.handle('messenger:detect', () => {
    const roots = [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.PROGRAMDATA, app.getPath('documents')];
    return findMessengerDbs(roots);
  });

  ipcMain.handle('messenger:chooseDb', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
      title: '메신저 DB 파일(messenger.db) 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite DB', extensions: ['db'] }, { name: '모든 파일', extensions: ['*'] }],
    });
    return canceled || !filePaths[0] ? null : filePaths[0];
  });

  // 연결 테스트 — 읽을 수 있는지, 구조가 맞는지, 기간 안에 몇 건인지만 알려준다(이름 등 내용은 돌려주지 않음).
  ipcMain.handle('messenger:test', (event, filePath) => {
    const config = cfgStore.load(settings);
    const target = String(filePath || config.dbPath || '');
    try {
      const h = openMessengerDb(target);
      try {
        const compat = checkCompat(h.db);
        const counts = { admissions: 0, outings: 0, transfers: 0 };
        let unknownTypes = [];
        if (compat.ok) {
          const r = readAll(h.db, windowOf(new Date(), config));
          counts.admissions = r.admissions.filter((a) => !a.deleted).length;
          counts.outings = r.outings.filter((o) => !o.deleted && !o.cancelled).length;
          counts.transfers = r.transfers.filter((t) => !t.deleted).length;
          unknownTypes = r.unknownAdmissionTypes;
        }
        return { ok: compat.ok, mode: h.mode, file: path.basename(target), compat, counts, unknownTypes };
      } finally {
        h.close();
      }
    } catch (e) {
      return { ok: false, error: e instanceof MessengerError ? e.message : `읽지 못했어요: ${e.message}` };
    }
  });

  // 위젯용 — 기간 안의 활성 항목을 화면에 그릴 모양으로(이름은 표시 모드대로 가려서) 돌려준다.
  ipcMain.handle('messenger:items', (event, { fromDate, toDate, viewMode } = {}) => {
    const config = cfgStore.load(settings);
    if (!config.enabled) return { enabled: false, items: [] };
    const mode = F.stricterMode(['full', 'mask', 'hide'].includes(viewMode) ? viewMode : config.nameMode, config.nameMode);
    const sups = messenger.supplementsBetween(String(fromDate), String(toDate));
    const items = messenger
      .itemsBetween(String(fromDate), String(toDate))
      .map((it) => F.widgetRow(it, mode, sups[`${it.source}:${it.ext_id}`]))
      .sort((a, b) => a.date.localeCompare(b.date) || a.timeKey - b.timeKey || a.ward.localeCompare(b.ward) || a.room.localeCompare(b.room));
    return { enabled: true, storedMode: config.nameMode, mode, kinds: Object.fromEntries(cfgStore.GROUPS.map((g) => [g, config.kinds[g].on])), items };
  });

  // 전달용 문구(채팅에 붙여넣기) — 위젯에 보이는 이름 표시 그대로, 형식은 설정의 "전달용 문구 형식"(템플릿)대로
  const COPY_KEY = 'messenger_copy_format';
  const loadCopyFormat = () => {
    try {
      return F.sanitizeCopyFormat(JSON.parse(settings.get(COPY_KEY) || '{}'));
    } catch (e) {
      return F.sanitizeCopyFormat({});
    }
  };
  ipcMain.handle('messenger:copyText', (event, { date, kind, viewMode } = {}) => {
    if (kind !== 'admission' && kind !== 'discharge') return { text: '' };
    const config = cfgStore.load(settings);
    const mode = F.stricterMode(['full', 'mask', 'hide'].includes(viewMode) ? viewMode : config.nameMode, config.nameMode);
    const items = messenger.itemsBetween(String(date), String(date)).filter((it) => it.kind === kind);
    if (!items.length) return { text: '' };
    return { text: F.buildCopyText(kind, String(date), items, { nameMode: mode, supplements: messenger.supplementsBetween(String(date), String(date)), format: loadCopyFormat() }) };
  });

  // 형식 설정 화면용 — 현재 형식·기본값·쓸 수 있는 토큰, 저장, 예시 미리보기(가상 환자라 실제 데이터와 무관)
  ipcMain.handle('messenger:getCopyFormat', () => ({ format: loadCopyFormat(), defaults: F.DEFAULT_COPY_FORMAT, tokens: F.COPY_TOKENS }));
  ipcMain.handle('messenger:setCopyFormat', (event, format) => {
    const clean = F.sanitizeCopyFormat(format);
    settings.set(COPY_KEY, JSON.stringify(clean));
    return clean;
  });
  ipcMain.handle('messenger:previewCopy', (event, { format, kind } = {}) => {
    const config = cfgStore.load(settings);
    const day = '2026-10-07';
    const sample = [
      { source: 's', ext_id: '1', kind: 'admission', date: day, patient: '김영자', rm: 'RM8', ward: '5병동', room: '504', time_text: '오후1시', note: '뇌출혈 / 타병원 수술 후 재입원', time_text2: '' },
      { source: 's', ext_id: '2', kind: 'admission', date: day, patient: '박철수', rm: 'RM4', ward: '8병동', room: '802', time_text: '오후3시', note: '', time_text2: '' },
    ];
    const supplements = { 's:1': { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' } };
    return { text: F.buildCopyText(kind === 'discharge' ? 'discharge' : 'admission', day, sample, { nameMode: config.nameMode, supplements, format }) };
  });

  // 입퇴원 환자별 보충 입력 저장 — 입력값은 길이·형식을 정리해서 저장하고, 모두 비우면 지운다
  ipcMain.handle('messenger:setSupplement', (event, { id, gender, age, diagnosis, transport } = {}) => {
    const [source, ...rest] = String(id || '').split(':');
    const extId = rest.join(':');
    const item = source && extId ? messenger.getItem(source, extId) : null;
    if (!item || (item.kind !== 'admission' && item.kind !== 'discharge')) throw new Error('입원·퇴원 항목만 보충 입력을 할 수 있어요.');
    const n = age === '' || age == null ? null : Math.round(Number(age));
    if (n != null && !(n >= 0 && n <= 120)) throw new Error('나이는 0~120 사이로 입력해주세요.');
    messenger.setSupplement(source, extId, {
      gender: gender === '남' || gender === '여' ? gender : '',
      age: n,
      diagnosis: String(diagnosis || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      transport: String(transport || '').replace(/\s+/g, ' ').trim().slice(0, 20),
    });
    return { ok: true };
  });

  ipcMain.handle('messenger:syncNow', () => syncOnce({ trigger: 'manual' }));
  ipcMain.handle('messenger:applyPending', (event, { deletes = false, vanished = false } = {}) =>
    syncOnce({ trigger: 'manual', confirm: { deletes: !!deletes, vanished: !!vanished } })
  );
  ipcMain.handle('messenger:status', () => ({ log: messenger.listLog(50) }));

  return {
    startMessengerScheduler: () => startMessengerScheduler({ getConfig: () => cfgStore.load(settings), run: (trigger) => syncOnce({ trigger }) }),
  };
};
