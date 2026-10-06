/**
 * 가짜 MiraeLanMessenger DB 생성기 — 메신저 연동(main/messenger)을 실제 병원 데이터 없이 개발·테스트하기 위한 것.
 * 표 구조(DDL)는 MiraeLanMessenger 0.3.539 실행파일에서 읽은 실제 정의를 그대로 옮겼다(입퇴원/외출외박/병동이동/
 * 전달 기록). messages 등 개인 대화 표는 "읽지 않는다"를 검증할 수 있게 일부 컬럼만 흉내 낸 가짜를 넣는다.
 * 값(구분 문자열·시간 형식·비고)은 추정이라, 실제 DB를 확인하면 여기도 같이 맞춘다. 이름·내용은 전부 가상이다.
 *
 * 사용(테스트 밖에서 직접 만들 때 — better-sqlite3가 Electron ABI라 Electron을 Node 모드로 실행):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/fake-messenger-db.js /tmp/fake-messenger.db
 */
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DDL = {
  admission_discharge_entries: `CREATE TABLE IF NOT EXISTS admission_discharge_entries( event_id TEXT PRIMARY KEY, event_date TEXT NOT NULL, event_type TEXT NOT NULL, patient_name TEXT NOT NULL, rm TEXT NOT NULL DEFAULT '', ward TEXT NOT NULL, room TEXT NOT NULL DEFAULT '', event_time TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL, author_device_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', created_utc TEXT NOT NULL, updated_utc TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, last_editor_id TEXT NOT NULL DEFAULT '', last_editor_name TEXT NOT NULL DEFAULT '' )`,
  admission_discharge_deliveries: `CREATE TABLE IF NOT EXISTS admission_discharge_deliveries( event_id TEXT NOT NULL, recipient_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', delivered_utc TEXT NULL, updated_utc TEXT NOT NULL, PRIMARY KEY(event_id,recipient_id), FOREIGN KEY(event_id) REFERENCES admission_discharge_entries(event_id) ON DELETE CASCADE )`,
  outing_schedules: `CREATE TABLE IF NOT EXISTS outing_schedules( schedule_id TEXT PRIMARY KEY, schedule_date TEXT NOT NULL, schedule_end_date TEXT NULL, patient_name TEXT NOT NULL, rm TEXT NOT NULL DEFAULT '', ward TEXT NOT NULL, room TEXT NOT NULL, category TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', departure_time TEXT NOT NULL DEFAULT '', return_time TEXT NOT NULL DEFAULT '', is_guardian_only INTEGER NOT NULL DEFAULT 0, is_cancelled INTEGER NOT NULL DEFAULT 0, cancelled_utc TEXT NULL, cancelled_by_id TEXT NOT NULL DEFAULT '', cancelled_by_name TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL, author_device_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', created_utc TEXT NOT NULL, updated_utc TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, last_editor_id TEXT NOT NULL DEFAULT '', last_editor_name TEXT NOT NULL DEFAULT '', change_history_json TEXT NOT NULL DEFAULT '[]', deleted_change_history_ids_json TEXT NOT NULL DEFAULT '[]' )`,
  outing_schedule_deliveries: `CREATE TABLE IF NOT EXISTS outing_schedule_deliveries( schedule_id TEXT NOT NULL, recipient_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', delivered_utc TEXT NULL, updated_utc TEXT NOT NULL, delivered_revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(schedule_id, recipient_id), FOREIGN KEY(schedule_id) REFERENCES outing_schedules(schedule_id) ON DELETE CASCADE )`,
  ward_transfers: `CREATE TABLE IF NOT EXISTS ward_transfers( transfer_id TEXT PRIMARY KEY, transfer_date TEXT NOT NULL, transfer_time TEXT NOT NULL DEFAULT '', patient_name TEXT NOT NULL, from_ward TEXT NOT NULL, from_room TEXT NOT NULL, to_ward TEXT NOT NULL, to_room TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL, author_device_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '', created_utc TEXT NOT NULL, updated_utc TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, last_editor_id TEXT NOT NULL DEFAULT '', last_editor_name TEXT NOT NULL DEFAULT '' )`,
  ward_transfer_deliveries: `CREATE TABLE IF NOT EXISTS ward_transfer_deliveries( transfer_id TEXT NOT NULL, recipient_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', delivered_utc TEXT NULL, updated_utc TEXT NOT NULL, PRIMARY KEY(transfer_id,recipient_id), FOREIGN KEY(transfer_id) REFERENCES ward_transfers(transfer_id) ON DELETE CASCADE )`,
  // 아래 둘은 "절대 읽지 않는 표"를 검증하려고 일부 컬럼만 흉내 낸 가짜
  messages: `CREATE TABLE IF NOT EXISTS messages( message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_name TEXT NOT NULL, body TEXT NOT NULL, created_utc TEXT NOT NULL )`,
  meeting_reservations: `CREATE TABLE IF NOT EXISTS meeting_reservations( reservation_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, booking_date TEXT NOT NULL, start_minute INTEGER NOT NULL, end_minute INTEGER NOT NULL, owner_user_id TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, version_key TEXT NOT NULL, payload_json TEXT NOT NULL )`,
};

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (base, offset) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 같은 표에서 특정 컬럼을 뺀 DDL — 메신저 버전이 바뀌어 컬럼이 없어진 상황을 흉내(호환성 검사 테스트용)
function ddlWithout(table, columns) {
  let sql = DDL[table];
  for (const c of columns) sql = sql.replace(new RegExp(`\\s${c} [A-Z]+(?: NOT NULL| NULL)?(?: DEFAULT [^,]+?)?,`), '');
  return sql;
}

/**
 * @param {string} file 만들 DB 경로(이미 있으면 덮어쓴다)
 * @param {{today?: Date, wal?: boolean, typeStyle?: 'ko'|'en', dropColumns?: Record<string,string[]>}} opts
 * @returns 만든 DB 요약(시나리오별 id) — 테스트가 기대값을 계산하는 데 쓴다
 */
function createFakeMessengerDb(file, { today = new Date(), wal = true, typeStyle = 'ko', dropColumns = {} } = {}) {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
  const db = new Database(file);
  if (wal) db.pragma('journal_mode = WAL');
  for (const [table, sql] of Object.entries(DDL)) db.exec(dropColumns[table] ? ddlWithout(table, dropColumns[table]) : sql);

  const skip = (table) => !!dropColumns[table]; // 컬럼을 뺀 표는 데이터를 넣지 않는다(호환성 검사만 보면 됨)
  const T = (n) => dayKey(today, n);
  const stamp = `${T(-2)}T09:00:00Z`;
  const IN = typeStyle === 'en' ? 'Admission' : '입원';
  const OUT = typeStyle === 'en' ? 'Discharge' : '퇴원';

  const addAdm = skip('admission_discharge_entries') ? null : db.prepare(
    `INSERT INTO admission_discharge_entries (event_id,event_date,event_type,patient_name,rm,ward,room,event_time,note,author_id,author_name,created_utc,updated_utc,revision,is_deleted)
     VALUES (@id,@date,@type,@name,@rm,@ward,@room,@time,@note,'u-nurse1','가상간호사',@stamp,@stamp,@rev,@del)`
  );
  const adm = (id, date, type, name, rm, ward, room, time, note = '', rev = 1, del = 0) =>
    skip('admission_discharge_entries') || addAdm.run({ id, date, type, name, rm, ward, room, time, note, stamp, rev, del });
  adm('fake-adm-01', T(0), IN, '김가람', 'RM8', '5병동', '504호', '13:00', '뇌출혈 / 타병원 수술 후 재입원 · 자차 입원예정 (M/78)');
  adm('fake-adm-02', T(0), IN, '이나래', 'RM6', '4병동', '411호', '오전(시간미정)');
  adm('fake-adm-03', T(0), IN, '박하늘', 'RM4', '8병동', '802호', '15:00', '(M/71)', 3); // 수정 이력이 있는 항목(revision 3)
  adm('fake-adm-04', T(0), OUT, '최다온', 'RM7', '5병동', '506호', '10:00', '자택 퇴원');
  adm('fake-adm-05', T(0), OUT, '정하람', 'RM9', '9병동', '903호', '오전(시간미정)');
  adm('fake-adm-06', T(0), IN, '오한결', 'RM5', '7병동', '705호', '14:00', '', 2, 1); // 메신저에서 삭제된 항목
  adm('fake-adm-07', T(1), IN, '강서준', 'RM6', '4병동', '402호', '11:00');
  adm('fake-adm-08', T(1), IN, '문지아', 'RM8', '5병동', '510호', '16:00', '보호자 동행');
  adm('fake-adm-09', T(-1), OUT, '백이든', 'RM4', '8병동', '808호', '09:30');
  adm('fake-adm-10', T(30), IN, '류하준', 'RM7', '9병동', '901호', '13:00'); // 한 달 뒤 — 기간 필터 확인용

  const addOut = skip('outing_schedules') ? null : db.prepare(
    `INSERT INTO outing_schedules (schedule_id,schedule_date,schedule_end_date,patient_name,rm,ward,room,category,reason,departure_time,return_time,is_cancelled,is_deleted,author_id,author_name,created_utc,updated_utc,revision)
     VALUES (@id,@date,@end,@name,@rm,@ward,@room,@cat,@reason,@dep,@ret,@cancel,@del,'u-nurse1','가상간호사',@stamp,@stamp,@rev)`
  );
  const out = (id, date, end, name, rm, ward, room, cat, reason, dep, ret, cancel = 0, del = 0, rev = 1) =>
    skip('outing_schedules') || addOut.run({ id, date, end, name, rm, ward, room, cat, reason, dep, ret, cancel, del, stamp, rev });
  out('fake-out-01', T(0), T(2), '한서윤', 'RM5', '7병동', '705호', '외박', '가족행사', '10:00', '17:00');
  out('fake-out-02', T(1), null, '윤도윤', 'RM6', '4병동', '411호', '외출', '외진', '13:00', '16:00');
  out('fake-out-03', T(0), null, '서지우', 'RM8', '5병동', '504호', '외출', '개인용무', '14:00', '17:00', 1); // 취소됨
  out('fake-out-04', T(2), null, '임도현', 'RM9', '9병동', '903호', '외출', '', '10:00', '12:00', 0, 1); // 삭제됨

  const addTr = skip('ward_transfers') ? null : db.prepare(
    `INSERT INTO ward_transfers (transfer_id,transfer_date,transfer_time,patient_name,from_ward,from_room,to_ward,to_room,note,author_id,author_name,created_utc,updated_utc,is_deleted)
     VALUES (@id,@date,@time,@name,@fw,@fr,@tw,@tr,@note,'u-nurse1','가상간호사',@stamp,@stamp,@del)`
  );
  if (!skip('ward_transfers')) {
  addTr.run({ id: 'fake-tr-01', date: T(0), time: '14:00', name: '장하윤', fw: '4병동', fr: '403호', tw: '5병동', tr: '502호', note: '병실 조정', stamp, del: 0 });
  addTr.run({ id: 'fake-tr-02', date: T(1), time: '', name: '신우진', fw: '8병동', fr: '801호', tw: '9병동', tr: '905호', note: '', stamp, del: 1 });
  }

  // 읽으면 안 되는 표들 — 가짜 대화와 회의실 예약
  const addMsg = db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?)');
  addMsg.run('fake-m1', 'c1', 'u-1', '가상직원A', '(가짜) 점심 같이 드실래요?', stamp);
  addMsg.run('fake-m2', 'c1', 'u-2', '가상직원B', '(가짜) 오후 회진 준비 부탁드려요', stamp);
  db.prepare('INSERT INTO meeting_reservations VALUES (?,?,?,?,?,?,?,?,?)').run('fake-mr-1', 'room-A', T(0), 840, 900, 'u-1', 0, 'v1', '{"title":"(가짜) 주간 회의"}');

  const summary = { file, today: T(0), counts: { admissions: 10, outings: 4, transfers: 2, messages: 2 } };
  db.close();
  return summary;
}

module.exports = { createFakeMessengerDb, DDL };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: electron(ELECTRON_RUN_AS_NODE=1) scripts/fake-messenger-db.js <만들 파일 경로>');
    process.exit(1);
  }
  console.log(JSON.stringify(createFakeMessengerDb(target), null, 2));
}
