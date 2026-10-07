// 메신저 → 잇다 동기화 엔진(main/messenger/sync.js) — 가짜 메신저 DB를 실제로 바꿔 가며 시나리오 검증
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const createRepositories = require('../main/repositories');
const { freshDb } = require('../scripts/test-helpers');
const { createFakeMessengerDb } = require('../scripts/fake-messenger-db');
const { openMessengerDb, readAll } = require('../main/messenger/reader');
const { runSync } = require('../main/messenger/sync');
const { sanitize } = require('../main/messenger/config');
const F = require('../main/messenger/format');

const TODAY = new Date(2026, 9, 7, 9, 0); // 2026-10-07

function setup(t, cfg = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-test-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'messenger.db');
  createFakeMessengerDb(file, { today: TODAY });
  const db = freshDb();
  const repos = createRepositories(db);
  const config = sanitize({ enabled: true, ...cfg });
  const read = (win) => {
    const h = openMessengerDb(file);
    try {
      return readAll(h.db, win);
    } finally {
      h.close();
    }
  };
  const run = (extra = {}, conf = config) => runSync({ itdaDb: db, repos, config: conf, read, now: TODAY, ...extra });
  const mod = (sql, ...args) => {
    const m = new Database(file);
    m.prepare(sql).run(...args);
    m.close();
  };
  const evs = () => repos.events.range('2000-01-01', '2100-01-01');
  const titles = () => evs().map((e) => e.title).sort();
  return { db, repos, config, run, mod, evs, titles, file };
}

test('처음 불러오기: 입원/퇴원은 날짜별 "N명" 종일 일정, 외출·외박은 항목별, 삭제·취소는 제외', (t) => {
  const s = setup(t);
  const r = s.run();
  assert.equal(r.stats.added, 7);
  assert.deepEqual(s.titles(), [
    '입원 1명', // 한 달 뒤(기간 안, 10/7+30)
    '입원 2명', // 10/8
    '입원 3명', // 10/7 (삭제된 1건 제외)
    '퇴원 1명', // 10/6
    '퇴원 2명', // 10/7
    '외박 · 7병동 705호 한○윤님',
    '외출 · 4병동 411호 윤○윤님',
  ].sort());
  const adm = s.evs().find((e) => e.title === '입원 3명');
  assert.equal(adm.all_day, 1);
  assert.equal(adm.start_at, '2026-10-07 00:00:00');
  const sp = F.splitMemo(adm.memo);
  assert.match(sp.auto, /^10\/7일\(수\)\nRM8 504호 김○람님\n뇌출혈/);
  assert.equal(sp.user, '');
  assert.ok(!s.evs().some((e) => /서지우|서○우|임도현/.test(e.memo + e.title)), '취소·삭제된 항목은 일정이 되면 안 됨');
});

test('다시 불러와도 변화 없음(멱등) + 기록이 남는다', (t) => {
  const s = setup(t);
  s.run();
  const r = s.run();
  assert.deepEqual(r.stats, { added: 0, updated: 0, removed: 0, conflicts: 0, dismissed: 0, itemsNew: 0, itemsChanged: 0, itemsGone: 0 });
  assert.equal(s.repos.messenger.listLog(10).length, 2);
});

test('메신저에서 삭제 → 인원·메모 갱신, 마지막 한 명이 삭제되면 그 날 일정이 사라진다(휴지통)', (t) => {
  const s = setup(t);
  s.run();
  s.mod("UPDATE admission_discharge_entries SET is_deleted = 1, revision = revision + 1 WHERE event_id = 'fake-adm-02'");
  let r = s.run();
  assert.equal(r.stats.updated, 1);
  const adm = s.evs().find((e) => e.title === '입원 2명' && e.start_at.startsWith('2026-10-07'));
  assert.ok(adm, '입원 3명 → 2명으로 제목이 바뀜');
  assert.ok(!F.splitMemo(adm.memo).auto.includes('RM6 411호'));
  s.mod("UPDATE admission_discharge_entries SET is_deleted = 1 WHERE event_id IN ('fake-adm-04','fake-adm-05')"); // 10/7 퇴원 전부
  r = s.run();
  assert.equal(r.stats.removed, 1);
  assert.ok(!s.evs().some((e) => e.title === '퇴원 2명'));
  const trashed = s.db.prepare("SELECT COUNT(*) c FROM events WHERE deleted_at IS NOT NULL").get().c;
  assert.equal(trashed, 1, '지운 일정은 휴지통(소프트 삭제)으로');
});

test('외출 취소 → 일정 삭제, 메신저에서 수정(시간) → 일정 시간 갱신', (t) => {
  const s = setup(t);
  s.run();
  const before = s.evs().find((e) => e.title.startsWith('외출'));
  assert.equal(before.start_at, '2026-10-08 13:00:00');
  s.mod("UPDATE outing_schedules SET departure_time = '14:30', revision = 2 WHERE schedule_id = 'fake-out-02'");
  let r = s.run();
  assert.equal(r.stats.updated, 1);
  assert.equal(s.evs().find((e) => e.title.startsWith('외출')).start_at, '2026-10-08 14:30:00');
  s.mod("UPDATE outing_schedules SET is_cancelled = 1 WHERE schedule_id = 'fake-out-02'");
  r = s.run();
  assert.equal(r.stats.removed, 1);
  assert.ok(!s.evs().some((e) => e.title.startsWith('외출')));
});

test('큰 삭제 보호: 한 번에 5건 이상 지워야 하면 적용하지 않고 확인을 요청, 확인하면 적용', (t) => {
  const s = setup(t);
  s.run();
  const before = s.evs().length;
  s.mod('UPDATE admission_discharge_entries SET is_deleted = 1');
  s.mod('UPDATE outing_schedules SET is_deleted = 1');
  let r = s.run();
  assert.ok(r.pending.deletes.length >= 5, `확인 필요 ${r.pending.deletes.length}건`);
  assert.equal(r.stats.removed, 0);
  assert.equal(s.evs().length, before, '확인 전에는 일정이 그대로');
  r = s.run({ confirm: { deletes: true } });
  assert.equal(r.pending.deletes.length, 0);
  assert.equal(r.stats.removed, before);
  assert.equal(s.evs().length, 0);
});

test('메신저 표에서 아예 사라진 항목(DB 복원·정리 의심)은 자동 삭제하지 않고 확인 요청', (t) => {
  const s = setup(t);
  s.run();
  s.mod("DELETE FROM admission_discharge_entries WHERE event_id = 'fake-adm-07'"); // 10/8 입원 2건 중 1건이 흔적 없이 사라짐
  let r = s.run();
  assert.deepEqual(r.pending.vanished.map((v) => v.ext_id), ['fake-adm-07']);
  assert.equal(s.evs().filter((e) => e.title === '입원 2명').length, 1, '확인 전에는 그대로(10/8은 여전히 2명)');
  r = s.run({ confirm: { vanished: true } });
  assert.equal(r.stats.itemsGone, 1);
  assert.ok(s.evs().some((e) => e.title === '입원 1명' && e.start_at.startsWith('2026-10-08')));
});

test('사용자가 일정을 지우면 되살리지 않는다(dismissed), 다시 불러와도 그대로', (t) => {
  const s = setup(t);
  s.run();
  const e = s.evs().find((x) => x.title === '입원 3명');
  s.repos.events.softDelete(e.id);
  let r = s.run();
  assert.equal(r.stats.dismissed, 1);
  r = s.run();
  assert.equal(r.stats.added, 0);
  assert.ok(!s.evs().some((x) => x.title.startsWith('입원 3명')));
  // 메신저가 바뀌어도 되살아나지 않음
  s.mod("UPDATE admission_discharge_entries SET is_deleted = 1 WHERE event_id = 'fake-adm-01'");
  s.run();
  assert.ok(!s.evs().some((x) => x.start_at.startsWith('2026-10-07') && x.title.startsWith('입원')));
});

test('사용자가 고친 일정은 덮어쓰지 않고 충돌로만 센다 / 내 메모 영역은 갱신해도 보존', (t) => {
  const s = setup(t);
  s.run();
  const e = s.evs().find((x) => x.title === '입원 3명');
  const sp = F.splitMemo(e.memo);
  // 내 메모 영역에만 적기 → 충돌 아님, 메신저 변경 시 자동 영역만 갱신되고 내 메모는 보존
  s.repos.events.update({ id: e.id, title: e.title, categoryId: null, location: null, startAt: e.start_at, endAt: e.end_at, allDay: 1, memo: F.composeMemo(sp.auto, '내 메모 보존'), colorHex: null, textColor: null });
  s.mod("UPDATE admission_discharge_entries SET is_deleted = 1 WHERE event_id = 'fake-adm-02'");
  let r = s.run();
  assert.equal(r.stats.conflicts, 0);
  const e2 = s.repos.events.getById(e.id);
  assert.equal(e2.title, '입원 2명');
  assert.equal(F.splitMemo(e2.memo).user, '내 메모 보존');
  // 제목을 직접 고치면 충돌 — 이후 메신저가 바뀌어도 덮어쓰지 않는다
  s.repos.events.update({ id: e.id, title: '내가 바꾼 제목', categoryId: null, location: null, startAt: e2.start_at, endAt: e2.end_at, allDay: 1, memo: e2.memo, colorHex: null, textColor: null });
  s.mod("UPDATE admission_discharge_entries SET is_deleted = 1 WHERE event_id = 'fake-adm-03'");
  r = s.run();
  assert.equal(r.stats.conflicts, 1);
  assert.equal(s.repos.events.getById(e.id).title, '내가 바꾼 제목');
});

test('이름 표시: 더 엄격하게 바꾸면 저장된 이름부터 즉시 가리고 일정을 다시 만든다, 덜 엄격하게 바꾸면 다시 읽어 채운다', (t) => {
  const s = setup(t);
  s.run(); // mask
  const stored = () => s.db.prepare("SELECT patient FROM messenger_items WHERE ext_id = 'fake-adm-01'").get().patient;
  assert.equal(stored(), '김○람');
  const hide = sanitize({ enabled: true, nameMode: 'hide' });
  s.repos.messenger.scrubNames('hide');
  assert.equal(stored(), '', '숨김이면 DB에 이름이 남지 않음');
  let r = s.run({ skipRead: true }, hide);
  assert.ok(r.stats.updated >= 3, `일정 ${r.stats.updated}건 다시 만들어짐`);
  const adm = s.evs().find((e) => e.title === '입원 3명');
  assert.ok(!/김|○/.test(F.splitMemo(adm.memo).auto), '메모에 이름 없음');
  const full = sanitize({ enabled: true, nameMode: 'full' });
  r = s.run({}, full); // 다시 읽어서 채움
  assert.equal(stored(), '김가람');
  assert.match(F.splitMemo(s.evs().find((e) => e.title === '입원 3명').memo).auto, /RM8 504호 김가람님/);
});

test('병동 필터: 내 병동(5병동)만 — 다른 병동 항목은 일정이 되지 않는다', (t) => {
  const s = setup(t, { wards: ['5'] });
  s.run();
  const all = s.evs().map((e) => e.title + '|' + e.memo).join('\n');
  assert.ok(/RM8 504호/.test(all) && /RM7 506호/.test(all));
  assert.ok(!/RM6 411호|RM4 802호|RM9 903호|705호/.test(all));
});

test('카테고리: 종류별로 지정, 설정을 바꾸면 따라가고 사용자가 직접 바꾼 건 건드리지 않는다', (t) => {
  const s = setup(t);
  const cA = s.repos.categories.insert({ name: '입원관리', colorHex: '#6C8CF5' }).id;
  const cB = s.repos.categories.insert({ name: '입원2', colorHex: '#E67C73' }).id;
  const cMine = s.repos.categories.insert({ name: '내가고름', colorHex: '#33B679' }).id;
  s.run({}, sanitize({ enabled: true, kinds: { admission: { categoryId: cA } } }));
  const adm = () => s.evs().filter((e) => e.title.startsWith('입원'));
  assert.ok(adm().every((e) => e.category_id === cA));
  assert.ok(s.evs().filter((e) => e.title.startsWith('퇴원')).every((e) => e.category_id === null));
  const mine = adm()[0];
  s.repos.events.update({ id: mine.id, title: mine.title, categoryId: cMine, location: null, startAt: mine.start_at, endAt: mine.end_at, allDay: 1, memo: mine.memo, colorHex: null, textColor: null });
  s.run({}, sanitize({ enabled: true, kinds: { admission: { categoryId: cB } } }));
  assert.equal(s.repos.events.getById(mine.id).category_id, cMine, '사용자가 직접 바꾼 카테고리는 유지');
  assert.ok(adm().filter((e) => e.id !== mine.id).every((e) => e.category_id === cB), '나머지는 설정을 따라감');
});

test('기간·종류 설정: 기간 밖(한 달 뒤)은 안 불러오고, 꺼둔 종류는 일정이 안 되며 나중에 끄면 사라진다', (t) => {
  const s = setup(t, { futureDays: 10 });
  s.run();
  assert.ok(!s.evs().some((e) => e.start_at.startsWith('2026-11-06')));
  assert.equal(s.evs().filter((e) => e.title.startsWith('외')).length, 2);
  const off = sanitize({ enabled: true, futureDays: 10, kinds: { outing: { on: false } } });
  // 일정 2건/6건(33%)이 지워지는 변경이라 평소 실행에선 큰 삭제 보호선에 걸린다
  const guarded = s.run({}, off);
  assert.equal(guarded.pending.deletes.length, 2);
  assert.equal(s.evs().filter((e) => e.title.startsWith('외')).length, 2);
  // 사용자가 설정을 바꾼 직후(trigger 'config')의 실행은 의도된 삭제라 확인을 이미 받은 것으로 본다
  s.run({ trigger: 'config', confirm: { deletes: true } }, off);
  assert.equal(s.evs().filter((e) => e.title.startsWith('외')).length, 0);
});

test('알 수 없는 입원/퇴원 구분값은 결과에 모아서 알려준다', (t) => {
  const s = setup(t);
  s.mod("INSERT INTO admission_discharge_entries (event_id,event_date,event_type,patient_name,ward,author_id,created_utc,updated_utc) VALUES ('x','2026-10-07','전원','가상','5병동','u','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')");
  assert.deepEqual(s.run().unknownAdmissionTypes, ['전원']);
});
