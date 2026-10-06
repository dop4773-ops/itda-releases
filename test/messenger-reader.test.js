// 메신저 연동의 기초 — 가짜 메신저 DB 생성기 + 읽기 전용 접근(main/messenger/reader.js)
// 핵심 원칙 "메신저 원본은 절대 건드리지 않는다"를 켜짐/꺼짐 두 상황 모두에서 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { createFakeMessengerDb } = require('../scripts/fake-messenger-db');
const { openMessengerDb, checkCompat, readAll, MessengerError } = require('../main/messenger/reader');

const TODAY = new Date(2026, 9, 7); // 2026-10-07 고정(테스트 결정성)
const WINDOW = { fromDate: '2026-10-06', toDate: '2026-10-10' }; // 어제~모레+1

function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-test-msgr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'messenger.db');
  createFakeMessengerDb(file, { today: TODAY, ...opts });
  return { dir, file };
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const listing = (dir) => fs.readdirSync(dir).sort();
const withReader = (file, fn) => {
  const h = openMessengerDb(file);
  try {
    return fn(h);
  } finally {
    h.close();
  }
};

test('읽기: 입원/퇴원 구분, 삭제·취소 표시, 기간 겹침(외박)까지 정상', (t) => {
  const { file } = setup(t);
  const r = withReader(file, (h) => readAll(h.db, WINDOW));
  // T-1 퇴원 1 + T 6건(삭제 1 포함) + T+1 2건 = 9, 한 달 뒤(T+30)는 기간 밖
  assert.equal(r.admissions.length, 9);
  assert.equal(r.admissions.filter((a) => a.kind === 'admission' && !a.deleted && a.date === '2026-10-07').length, 3);
  assert.equal(r.admissions.filter((a) => a.kind === 'discharge' && a.date === '2026-10-07').length, 2);
  assert.deepEqual(r.admissions.filter((a) => a.deleted).map((a) => a.id), ['fake-adm-06']);
  assert.equal(r.admissions.find((a) => a.id === 'fake-adm-03').revision, 3);
  assert.equal(r.admissions.find((a) => a.id === 'fake-adm-02').timeText, '오전(시간미정)');
  const o = Object.fromEntries(r.outings.map((x) => [x.id, x]));
  assert.equal(Object.keys(o).length, 4);
  assert.equal(o['fake-out-01'].endDate, '2026-10-09'); // 3일에 걸친 외박
  assert.equal(o['fake-out-02'].endDate, '2026-10-08'); // 종료일이 없으면 시작일
  assert.equal(o['fake-out-03'].cancelled, true);
  assert.equal(o['fake-out-04'].deleted, true);
  assert.equal(r.transfers.length, 2);
  assert.equal(r.transfers.filter((x) => x.deleted).length, 1);
});

test('기간 필터: 한 달 뒤 항목만 있는 구간, 외박은 기간이 겹치면 시작 전 조회에도 포함', (t) => {
  const { file } = setup(t);
  const far = withReader(file, (h) => readAll(h.db, { fromDate: '2026-11-01', toDate: '2026-11-30' }));
  assert.deepEqual(far.admissions.map((a) => a.id), ['fake-adm-10']);
  assert.equal(far.outings.length, 0);
  const mid = withReader(file, (h) => readAll(h.db, { fromDate: '2026-10-09', toDate: '2026-10-09' }));
  assert.deepEqual(mid.outings.map((x) => x.id).sort(), ['fake-out-01', 'fake-out-04']); // 외박 마지막 날 + 삭제된 외출(T+2)
});

test('구분값: 영문(Admission/Discharge)도 같은 종류로, 모르는 값은 집계에서 따로', (t) => {
  const { file } = setup(t, { typeStyle: 'en' });
  const raw = new Database(file);
  raw.prepare("INSERT INTO admission_discharge_entries (event_id,event_date,event_type,patient_name,ward,author_id,created_utc,updated_utc) VALUES ('x','2026-10-07','기타','가상환자','5병동','u','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')").run();
  raw.close();
  const r = withReader(file, (h) => readAll(h.db, WINDOW));
  assert.equal(r.admissions.filter((a) => a.kind === 'admission' && a.date === '2026-10-07' && !a.deleted).length, 3);
  assert.deepEqual(r.unknownAdmissionTypes, ['기타']);
  assert.ok(!r.admissions.some((a) => a.id === 'x'));
});

test('호환성 검사: 정상 / 컬럼이 빠진 구조 / 표가 없는 DB', (t) => {
  const { file } = setup(t);
  assert.equal(withReader(file, (h) => checkCompat(h.db)).ok, true);

  const { file: broken } = setup(t, { dropColumns: { admission_discharge_entries: ['note'] } });
  const c = withReader(broken, (h) => checkCompat(h.db));
  assert.equal(c.ok, false);
  assert.deepEqual(c.sources.admission.missing, ['note']);
  assert.equal(c.sources.outing.ok, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-test-msgr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const empty = path.join(dir, 'empty.db');
  new Database(empty).close();
  const e = withReader(empty, (h) => checkCompat(h.db));
  assert.equal(e.ok, false);
  assert.deepEqual(e.sources.transfer.missing, ['(표 없음)']);
});

test('원본 불변(메신저 꺼짐): 복사본으로 읽고 폴더에 아무것도 안 남기며 임시 폴더도 지운다', (t) => {
  const { dir, file } = setup(t);
  const tmpBefore = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('itda-messenger-')).length;
  const before = { files: listing(dir), hash: sha(file), mtime: fs.statSync(file).mtimeMs };
  const mode = withReader(file, (h) => (readAll(h.db, WINDOW), h.mode));
  assert.equal(mode, 'copy');
  assert.deepEqual(listing(dir), before.files, '폴더에 -shm/-wal 같은 보조 파일이 생기면 안 됨');
  assert.equal(sha(file), before.hash);
  assert.equal(fs.statSync(file).mtimeMs, before.mtime);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('itda-messenger-')).length, tmpBefore, '임시 복사본 폴더는 지워져야 함');
});

test('원본 불변(메신저 켜짐): 제자리에서 읽되 아직 반영 안 된 최신 데이터까지 보고, 본체 파일·폴더는 그대로', (t) => {
  const { dir, file } = setup(t);
  const writer = new Database(file); // 켜져 있는 메신저 흉내 — 연결을 열어 둔 채 WAL에 체크포인트 안 된 변경을 만든다
  writer.pragma('journal_mode = WAL');
  writer.pragma('wal_autocheckpoint = 0');
  writer
    .prepare("INSERT INTO admission_discharge_entries (event_id,event_date,event_type,patient_name,ward,author_id,created_utc,updated_utc) VALUES ('fake-adm-99','2026-10-07','입원','방금등록','5병동','u','2026-10-07T01:00:00Z','2026-10-07T01:00:00Z')")
    .run();
  t.after(() => writer.close());
  assert.ok(fs.existsSync(`${file}-wal`), '켜짐 상태 전제: -wal 존재');
  const before = { files: listing(dir), hash: sha(file), mtime: fs.statSync(file).mtimeMs };
  const { mode, ids } = withReader(file, (h) => ({ mode: h.mode, ids: readAll(h.db, WINDOW).admissions.map((a) => a.id) }));
  assert.equal(mode, 'in-place');
  assert.ok(ids.includes('fake-adm-99'), 'WAL에만 있는 최신 항목까지 읽어야 함');
  assert.deepEqual(listing(dir), before.files);
  assert.equal(sha(file), before.hash);
  assert.equal(fs.statSync(file).mtimeMs, before.mtime);
});

test('허용 목록: 읽는 SQL은 입퇴원·외출외박·병동이동 표(와 구조 점검)만 건드리고 messages 등은 절대 안 읽는다', (t) => {
  const { file } = setup(t);
  const seen = [];
  withReader(file, (h) => {
    const orig = h.db.prepare.bind(h.db);
    h.db.prepare = (sql) => (seen.push(sql), orig(sql));
    checkCompat(h.db);
    readAll(h.db, WINDOW);
  });
  assert.ok(seen.length >= 6);
  const allowed = new Set(['admission_discharge_entries', 'outing_schedules', 'ward_transfers', 'sqlite_master']);
  for (const sql of seen) {
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi), ...sql.matchAll(/table_info\((\w+)\)/gi)].map((m) => m[1]);
    assert.ok(tables.length > 0, sql);
    for (const tb of tables) assert.ok(allowed.has(tb), `허용 안 된 표 접근: ${tb}`);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(sql), `쓰기 SQL 금지: ${sql}`);
  }
});

test('열기 실패: 파일 없음 → NOT_FOUND, 저장 중(-journal) → BUSY', (t) => {
  const { dir, file } = setup(t);
  assert.throws(() => openMessengerDb(path.join(dir, 'nope.db')), (e) => e instanceof MessengerError && e.code === 'NOT_FOUND');
  fs.writeFileSync(`${file}-journal`, 'x');
  assert.throws(() => openMessengerDb(file), (e) => e instanceof MessengerError && e.code === 'BUSY');
});
