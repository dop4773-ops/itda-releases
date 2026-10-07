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

// ---- 전달용 문구 형식(템플릿) ----
test('기본 형식은 예전 고정 형식과 글자 하나 다르지 않다', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1', { note: '뇌출혈 / 재입원\n자차 입원', time_text: '오후1시' }));
  r.upsertItem(item('a2', { patient: '박철수', rm: 'RM4', room: '802', time_text: '오후3시' }));
  r.setSupplement('admission', 'a1', { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' });
  const items = r.itemsBetween(today, today);
  const sups = r.supplementsBetween(today, today);
  for (const mode of ['full', 'mask', 'hide']) {
    const old = F.buildDaySummary('admission', today, items, { nameMode: mode, supplements: sups });
    assert.equal(F.buildCopyText('admission', today, items, { nameMode: mode, supplements: sups }), `${old.title}\n${old.auto}`, mode);
  }
});

test('템플릿: 토큰 순서·구분자를 바꾸고 빈 줄은 사라진다', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  r.setSupplement('admission', 'a1', { gender: '여', age: 75, diagnosis: '요추 골절' });
  const items = r.itemsBetween(today, today);
  const text = F.buildCopyText('admission', today, items, {
    nameMode: 'full',
    supplements: r.supplementsBetween(today, today),
    format: { header: '[{kind}] {count}명', person: '{ward} {room} {name}님 ({gender}/{age}) - {diagnosis} {transport}', gap: 'line' },
  });
  assert.equal(text, '[입원] 1명\n5병동 504호 김영자님 (여/75세) - 요추 골절');
});

test('이름이 숨김이면 님도 사라지고, 모르는 토큰은 그대로 남고, 길이·형식은 정리된다', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  const items = r.itemsBetween(today, today);
  const t = F.buildCopyText('admission', today, items, { nameMode: 'hide', format: { header: '', person: '{room} {name}님 {oops}', gap: 'blank' } });
  assert.equal(t, '504호 {oops}');
  const clean = F.sanitizeCopyFormat({ header: 'x'.repeat(999), person: 5, gap: 'weird' });
  assert.equal(clean.header.length, 300);
  assert.equal(clean.person, F.DEFAULT_COPY_FORMAT.person);
  assert.equal(clean.gap, 'blank');
});

test('환자 사이 간격: 빈 줄 / 줄바꿈', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  r.upsertItem(item('a2', { patient: '박철수', room: '802' }));
  const items = r.itemsBetween(today, today);
  const f = (gap) => F.buildCopyText('admission', today, items, { nameMode: 'full', format: { header: '', person: '{room} {name}님', gap } });
  assert.equal(f('blank'), '504호 김영자님\n\n802호 박철수님');
  assert.equal(f('line'), '504호 김영자님\n802호 박철수님');
});

test('값이 비어 구분자만 남으면 걷어내지만, 줄 머리표(-)는 그대로', () => {
  const { r, today, item } = repo();
  r.upsertItem(item('a1'));
  const items = r.itemsBetween(today, today);
  const t = (person) => F.buildCopyText('admission', today, items, { nameMode: 'full', format: { header: '', person, gap: 'blank' } });
  assert.equal(t('{room} {name}님 ({gender}/{age})'), '504호 김영자님');
  assert.equal(t('{room} {name}님 / {diagnosis}'), '504호 김영자님');
  assert.equal(t('{gender}/{age}\n- {room}'), '- 504호');
});
