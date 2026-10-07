// 입퇴원 "보충 입력"(성별·나이·진단·이동수단) — 저장소 + 전달 문구 반영 + 일정 메모에는 안 들어감
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../main/messenger/format');
const createMessengerRepository = require('../main/repositories/messenger.repository');

function repo() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf8'));
  const r = createMessengerRepository(db);
  const today = new Date().toISOString().slice(0, 10);
  const item = (ext, extra = {}) => ({ source: 'admission', ext_id: ext, kind: 'admission', date: today, end_date: null, patient: '김영자', rm: 'RM8', ward: '5병동', room: '504', to_ward: '', to_room: '', time_text: '오후1시', time_text2: '', note: '', reason: '', revision: 1, ...extra });
  return { db, r, today, item };
}

test('보충 입력 저장·조회·비우면 삭제, 없는 항목엔 저장 안 함', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  assert.equal(r.setSupplement('admission', 'zzz', { gender: '여' }), false);
  r.setSupplement('admission', 'a1', { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' });
  assert.deepEqual(r.supplementsBetween(today, today)['admission:a1'], { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' });
  r.setSupplement('admission', 'a1', {});
  assert.deepEqual(r.supplementsBetween(today, today), {});
});

test('전달 문구에는 사람 줄 아래 한 줄로 들어가고, 일정 메모(supplements 없이 호출)에는 안 들어간다', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  r.setSupplement('admission', 'a1', { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' });
  const items = r.itemsBetween(today, today);
  const withSup = F.buildDaySummary('admission', today, items, { nameMode: 'mask', supplements: r.supplementsBetween(today, today) });
  assert.match(withSup.auto, /RM8 504호 김○자님\n여\/75세 · 진단 요추 골절 · 이동수단 휠체어\n오후 ?1시/);
  const calendar = F.buildDaySummary('admission', today, items, { nameMode: 'mask' });
  assert.ok(!/요추|휠체어|75세/.test(calendar.auto));
});

test('일부만 입력해도 그것만 표시하고, 아무것도 없으면 빈 문자열', () => {
  assert.equal(F.supplementLine({ gender: '', age: 80, diagnosis: '', transport: '' }), '80세');
  assert.equal(F.supplementLine({ gender: '남', age: null, diagnosis: '뇌졸중', transport: '' }), '남 · 진단 뇌졸중');
  assert.equal(F.supplementLine(null), '');
});

test('오래됐거나 항목이 사라진 보충 입력은 정리된다', () => {
  const { r, today, item, db } = repo();
  r.upsertItem(item('new'));
  r.upsertItem(item('old', { date: '2020-01-01' }));
  r.setSupplement('admission', 'new', { age: 70 });
  r.setSupplement('admission', 'old', { age: 80 });
  db.prepare("INSERT INTO messenger_supplements (source, ext_id, age) VALUES ('admission','ghost',60)").run();
  assert.equal(r.purgeSupplements(), 2);
  assert.deepEqual(Object.keys(r.supplementsBetween(today, today)), ['admission:new']);
});
