// 메신저 연동 주변부 — 주기 판단(scheduler.isDue), 설정 정리(config), DB 자동 찾기(detect)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDue } = require('../main/messenger/scheduler');
const cfgStore = require('../main/messenger/config');
const { findMessengerDbs } = require('../main/messenger/detect');
const { freshDb } = require('../scripts/test-helpers');
const createRepositories = require('../main/repositories');

const base = (schedule) => cfgStore.sanitize({ enabled: true, dbPath: 'x.db', schedule });
const at = (h, m = 0, day = 7) => new Date(2026, 9, day, h, m);

test('주기: 수동은 안 돌고, 켤 때는 한 번만, 간격은 지났을 때만, 매일은 시각 이후 하루 한 번', () => {
  assert.equal(isDue(base({ mode: 'manual' }), {}, at(9)), false);
  assert.equal(isDue(base({ mode: 'start' }), { ranOnStart: false }, at(9)), true);
  assert.equal(isDue(base({ mode: 'start' }), { ranOnStart: true }, at(9)), false);
  const iv = base({ mode: 'interval', everyMin: 30 });
  assert.equal(isDue(iv, { lastRunAt: 0 }, at(9)), true);
  assert.equal(isDue(iv, { lastRunAt: at(9).getTime() }, at(9, 29)), false);
  assert.equal(isDue(iv, { lastRunAt: at(9).getTime() }, at(9, 30)), true);
  const daily = base({ mode: 'daily', dailyAt: '08:00' });
  assert.equal(isDue(daily, { lastDailyKey: '' }, at(7, 59)), false);
  assert.equal(isDue(daily, { lastDailyKey: '' }, at(8, 0)), true);
  assert.equal(isDue(daily, { lastDailyKey: '2026-10-07' }, at(15)), false, '오늘 이미 돌았으면 안 돎');
  assert.equal(isDue(daily, { lastDailyKey: '2026-10-07' }, at(8, 0, 8)), true, '다음 날은 다시');
});

test('주기: 연동이 꺼져 있거나 DB 경로가 없으면 어떤 모드든 안 돈다', () => {
  assert.equal(isDue(cfgStore.sanitize({ enabled: false, dbPath: 'x', schedule: { mode: 'interval' } }), {}, at(9)), false);
  assert.equal(isDue(cfgStore.sanitize({ enabled: true, dbPath: '', schedule: { mode: 'interval' } }), {}, at(9)), false);
});

test('설정 정리: 이상한 값은 기본값으로, 병동/RM은 쉼표 목록, 범위 밖 숫자는 되돌림', () => {
  const c = cfgStore.sanitize({ enabled: 'yes', nameMode: '??', wards: '5병동, 8병동,,', rms: ['rm8'], pastDays: -3, futureDays: 9999, schedule: { mode: 'x', everyMin: 1, dailyAt: '25:00' }, kinds: { admission: { on: false, categoryId: '7' } } });
  assert.equal(c.enabled, false);
  assert.equal(c.nameMode, 'mask');
  assert.deepEqual(c.wards, ['5병동', '8병동']);
  assert.deepEqual(c.rms, ['RM8']);
  assert.equal(c.pastDays, 3);
  assert.equal(c.futureDays, 30);
  assert.deepEqual(c.schedule, { mode: 'manual', everyMin: 30, dailyAt: '08:00' });
  assert.equal(c.kinds.admission.on, false);
  assert.equal(c.kinds.admission.categoryId, null, '숫자가 아닌 카테고리 값은 무시');
  assert.equal(c.kinds.transfer.on, false, '병동이동은 기본 꺼짐');
});

test('설정 저장은 일부만 바꿔도 나머지를 유지하고, 깨진 저장값은 기본값으로 읽는다', () => {
  const { settings } = createRepositories(freshDb());
  assert.equal(cfgStore.load(settings).enabled, false);
  cfgStore.save(settings, { enabled: true, kinds: { outing: { categoryId: 4 } } });
  const c = cfgStore.save(settings, { nameMode: 'hide', schedule: { mode: 'daily' } });
  assert.equal(c.enabled, true);
  assert.equal(c.kinds.outing.categoryId, 4);
  assert.equal(c.nameMode, 'hide');
  assert.deepEqual(c.schedule, { mode: 'daily', everyMin: 30, dailyAt: '08:00' });
  settings.set('messenger_config', '{깨짐');
  assert.equal(cfgStore.load(settings).nameMode, 'mask');
});

test('자동 찾기: 이름에 Mirae/messenger/미래가 든 폴더 아래의 messenger.db만 찾고, 다른 폴더는 무시', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-test-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mk = (...p) => {
    const f = path.join(root, ...p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
    return f;
  };
  const hit1 = mk('MiraeLanMessenger', 'messenger.db');
  const hit2 = mk('미래워크', 'data', 'messenger.db');
  mk('OtherApp', 'messenger.db');
  mk('MiraeLanMessenger', 'history.db');
  const found = findMessengerDbs([root, path.join(root, 'nope')]).map((f) => f.path).sort();
  assert.deepEqual(found, [hit1, hit2].sort());
});
