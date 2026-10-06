/**
 * MiraeLanMessenger DB 읽기 전용 접근 — 원칙: 메신저 원본은 절대 수정하지 않는다.
 *
 * 열기 방식(실험으로 확인한 SQLite 동작에 맞춤):
 *  - 메신저가 켜져 있으면(-wal 보조 파일이 있으면) 원본을 읽기 전용으로 그 자리에서 읽는다. 새 파일을 만들지 않고,
 *    SQLite 읽기 규칙상 -shm의 읽기 표식만 갱신된다(메신저 자신의 읽기 연결과 같은 동작). DB 본체·데이터는 안 바뀐다.
 *  - 메신저가 꺼져 있으면(보조 파일 없음) 읽기 전용으로 열어도 원본 폴더에 -shm/-wal이 남는다 → 원본은 SQLite로 열지
 *    않고, 파일을 임시 폴더에 복사해 그 복사본만 읽는다(끝나면 임시 폴더 삭제).
 *  - -journal(저장 중)이 있으면 일관된 상태가 아니므로 BUSY로 돌려보내 다음에 다시 시도한다.
 * 읽는 표는 아래 허용 목록뿐이다(messages 등 대화 표는 코드상 접근하지 않는다).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

class MessengerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 읽는 표와, 그 표에서 필요한 컬럼. 메신저 버전이 바뀌어 컬럼이 없어지면 checkCompat이 알려준다.
const SOURCES = {
  admission: {
    table: 'admission_discharge_entries',
    columns: ['event_id', 'event_date', 'event_type', 'patient_name', 'rm', 'ward', 'room', 'event_time', 'note', 'revision', 'is_deleted', 'updated_utc'],
  },
  outing: {
    table: 'outing_schedules',
    columns: ['schedule_id', 'schedule_date', 'schedule_end_date', 'patient_name', 'rm', 'ward', 'room', 'category', 'reason', 'departure_time', 'return_time', 'is_cancelled', 'is_deleted', 'revision', 'updated_utc'],
  },
  transfer: {
    table: 'ward_transfers',
    columns: ['transfer_id', 'transfer_date', 'transfer_time', 'patient_name', 'from_ward', 'from_room', 'to_ward', 'to_room', 'note', 'revision', 'is_deleted', 'updated_utc'],
  },
};

const day = (v) => String(v || '').slice(0, 10);

// 입원/퇴원 구분값은 실제 DB를 보기 전까지 추정 — 한글/영문 모두 받고, 모르는 값은 null로 돌려 집계에 따로 센다.
function admissionKind(type) {
  const t = String(type || '');
  if (/입원|admission|admit/i.test(t)) return 'admission';
  if (/퇴원|discharge/i.test(t)) return 'discharge';
  return null;
}

function copyAndOpen(dbPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-messenger-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const target = path.join(dir, 'snapshot.db');
    fs.copyFileSync(dbPath, target);
    if (fs.existsSync(`${dbPath}-wal`)) fs.copyFileSync(`${dbPath}-wal`, `${target}-wal`);
    // 복사본이라 쓰기 가능으로 열어도 원본과 무관 — WAL이 딸려 왔으면 열면서 복구된다.
    const db = new Database(target, { fileMustExist: true });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      db.close();
      throw new MessengerError('BUSY', '메신저가 저장하는 중이라 복사본이 온전하지 않아요. 잠시 후 다시 시도해주세요.');
    }
    return { db, mode: 'copy', close: () => (db.close(), cleanup()) };
  } catch (e) {
    cleanup();
    throw e;
  }
}

function openMessengerDb(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) throw new MessengerError('NOT_FOUND', '메신저 DB 파일을 찾을 수 없어요.');
  if (fs.existsSync(`${dbPath}-journal`)) throw new MessengerError('BUSY', '메신저가 저장하는 중이에요. 잠시 후 다시 시도해주세요.');
  if (fs.existsSync(`${dbPath}-wal`)) {
    try {
      const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 3000 });
      db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get(); // 실제로 읽히는지 확인(보조 파일만 남은 비정상 상태 대비)
      return { db, mode: 'in-place', close: () => db.close() };
    } catch (e) {
      /* 제자리 읽기가 안 되면 복사본으로 */
    }
  }
  return copyAndOpen(dbPath);
}

// 필요한 표/컬럼이 있는지 — 메신저 버전이 바뀌어 구조가 달라졌는지 확인한다(설정의 "연결 테스트"에 쓴다).
function checkCompat(db) {
  const sources = {};
  let ok = true;
  for (const [key, { table, columns }] of Object.entries(SOURCES)) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    const have = exists ? new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)) : new Set();
    const missing = exists ? columns.filter((c) => !have.has(c)) : ['(표 없음)'];
    sources[key] = { table, ok: missing.length === 0, missing };
    if (missing.length) ok = false;
  }
  return { ok, sources };
}

function readAdmissions(db, { fromDate, toDate }) {
  const unknownTypes = new Set();
  const rows = [];
  for (const r of db
    .prepare(
      `SELECT event_id, event_date, event_type, patient_name, rm, ward, room, event_time, note, revision, is_deleted, updated_utc
       FROM admission_discharge_entries WHERE event_date >= ? AND event_date <= ? ORDER BY event_date, event_time, event_id`
    )
    .all(fromDate, toDate)) {
    const kind = admissionKind(r.event_type);
    if (!kind) {
      unknownTypes.add(r.event_type);
      continue;
    }
    rows.push({
      source: 'admission',
      id: r.event_id,
      date: day(r.event_date),
      kind,
      patient: r.patient_name,
      rm: r.rm,
      ward: r.ward,
      room: r.room,
      timeText: r.event_time,
      note: r.note,
      revision: r.revision,
      deleted: !!r.is_deleted,
      cancelled: false,
      updatedUtc: r.updated_utc,
    });
  }
  return { rows, unknownTypes: [...unknownTypes] };
}

// 외출·외박은 기간(시작~종료)이 걸쳐 있어서, 조회 기간과 "겹치는" 것을 가져온다.
function readOutings(db, { fromDate, toDate }) {
  return db
    .prepare(
      `SELECT schedule_id, schedule_date, schedule_end_date, patient_name, rm, ward, room, category, reason, departure_time, return_time, is_cancelled, is_deleted, revision, updated_utc
       FROM outing_schedules
       WHERE schedule_date <= ? AND COALESCE(NULLIF(schedule_end_date, ''), schedule_date) >= ?
       ORDER BY schedule_date, schedule_id`
    )
    .all(toDate, fromDate)
    .map((r) => ({
      source: 'outing',
      id: r.schedule_id,
      date: day(r.schedule_date),
      endDate: day(r.schedule_end_date) || day(r.schedule_date),
      category: r.category,
      patient: r.patient_name,
      rm: r.rm,
      ward: r.ward,
      room: r.room,
      reason: r.reason,
      departureText: r.departure_time,
      returnText: r.return_time,
      revision: r.revision,
      deleted: !!r.is_deleted,
      cancelled: !!r.is_cancelled,
      updatedUtc: r.updated_utc,
    }));
}

function readTransfers(db, { fromDate, toDate }) {
  return db
    .prepare(
      `SELECT transfer_id, transfer_date, transfer_time, patient_name, from_ward, from_room, to_ward, to_room, note, revision, is_deleted, updated_utc
       FROM ward_transfers WHERE transfer_date >= ? AND transfer_date <= ? ORDER BY transfer_date, transfer_time, transfer_id`
    )
    .all(fromDate, toDate)
    .map((r) => ({
      source: 'transfer',
      id: r.transfer_id,
      date: day(r.transfer_date),
      timeText: r.transfer_time,
      patient: r.patient_name,
      fromWard: r.from_ward,
      fromRoom: r.from_room,
      toWard: r.to_ward,
      toRoom: r.to_room,
      note: r.note,
      revision: r.revision,
      deleted: !!r.is_deleted,
      cancelled: false,
      updatedUtc: r.updated_utc,
    }));
}

// 한 번의 읽기 트랜잭션 안에서 전부 읽는다 — 읽는 도중 메신저가 써도 같은 시점의 일관된 모습을 본다.
// 삭제/취소된 행도 포함해서 돌려준다(잇다 쪽 동기화가 "사라진 것"을 알아야 하므로).
function readAll(db, { fromDate, toDate }) {
  return db.transaction(() => {
    const adm = readAdmissions(db, { fromDate, toDate });
    return {
      admissions: adm.rows,
      unknownAdmissionTypes: adm.unknownTypes,
      outings: readOutings(db, { fromDate, toDate }),
      transfers: readTransfers(db, { fromDate, toDate }),
    };
  })();
}

module.exports = { openMessengerDb, checkCompat, readAll, readAdmissions, readOutings, readTransfers, MessengerError, SOURCES };
