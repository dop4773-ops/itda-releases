// main/db.js runLightweightMigrations — 원자성 / user_version 게이트 / 멱등성 / 데이터 백필
// better-sqlite3(네이티브)를 쓰므로 이 파일은 Electron의 Node ABI로 실행해야 한다 → `npm test` 참고.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runLightweightMigrations, SCHEMA_VERSION } = require('../main/db.js');
const { freshDb, SCHEMA, Database, registerSqlFunctions } = require('../scripts/test-helpers');

// 최신 상태 DB에서 "마이그레이션으로 추가되는 것들"을 되돌려 구버전 DB를 흉내낸다.
function oldDb() {
  const db = new Database(':memory:');
  registerSqlFunctions(db);
  db.exec(SCHEMA);
  db.exec('DROP INDEX IF EXISTS idx_todos_status');
  db.exec('DROP INDEX IF EXISTS idx_memos_folder');
  for (const t of ['item_links', 'memo_folders', 'memo_attachments', 'todo_subtasks', 'google_calendar_events']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.exec('ALTER TABLE todos DROP COLUMN status');
  db.exec('ALTER TABLE todos DROP COLUMN is_favorite');
  db.exec('ALTER TABLE memos DROP COLUMN folder_id');
  db.exec('ALTER TABLE memos DROP COLUMN is_locked');
  db.exec('ALTER TABLE postits DROP COLUMN category_id');
  // v3 이전: search_index가 FTS5였음 — 옛 형태로 되돌려 v3 마이그레이션이 실제로 돌게
  db.exec(`DROP TABLE IF EXISTS search_index`);
  db.exec(`CREATE VIRTUAL TABLE search_index USING fts5(entity_type, entity_id UNINDEXED, title, content, tokenize='unicode61')`);
  db.pragma('user_version = 0');
  return db;
}

const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const hasCol = (db, t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
const version = (db) => db.pragma('user_version', { simple: true });

test('구버전 DB → 마이그레이션 → 누락분 전부 복구 + 버전 스탬프', () => {
  const db = oldDb();
  runLightweightMigrations(db);
  for (const t of ['item_links', 'memo_folders', 'todo_subtasks', 'memo_attachments', 'google_calendar_events']) {
    assert.ok(hasTable(db, t), `${t} 테이블 생성됨`);
  }
  assert.ok(hasCol(db, 'todos', 'status'));
  assert.ok(hasCol(db, 'todos', 'is_favorite'));
  assert.ok(hasCol(db, 'todos', 'recurrence_rule'));
  assert.ok(hasCol(db, 'memos', 'folder_id'));
  assert.ok(hasCol(db, 'memos', 'is_locked'));
  assert.ok(hasCol(db, 'postits', 'category_id'));
  assert.equal(version(db), SCHEMA_VERSION);
  db.close();
});

test('user_version 게이트: 최신이면 두 번째 호출은 아무것도 안 함', () => {
  const db = oldDb();
  runLightweightMigrations(db);
  const v = version(db);
  runLightweightMigrations(db); // 게이트에서 즉시 return
  assert.equal(version(db), v);
  db.close();
});

test('신규(최신) DB는 스탬프가 있으면 마이그레이션을 건너뜀', () => {
  const db = freshDb();
  runLightweightMigrations(db);
  assert.equal(version(db), SCHEMA_VERSION);
  db.close();
});

test('v3: 구버전 FTS5 search_index → 일반 테이블(chosung 포함)로 재구축', () => {
  const db = oldDb();
  db.prepare("INSERT INTO todos (title) VALUES ('김부수 평가 메모')").run();
  runLightweightMigrations(db);
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'").get().sql;
  assert.ok(!sql.includes('fts5'), '일반 테이블로 바뀜');
  assert.ok(hasCol(db, 'search_index', 'chosung'));
  const row = db.prepare("SELECT title, chosung FROM search_index WHERE entity_type='todo'").get();
  assert.equal(row.chosung, 'ㄱㅂㅅ ㅍㄱ ㅁㅁ', '초성 채워짐');
  db.close();
});

test('is_done → status 백필 정확', () => {
  const db = oldDb();
  db.prepare("INSERT INTO todos (title, is_done) VALUES ('done-one', 1)").run();
  db.prepare("INSERT INTO todos (title, is_done) VALUES ('todo-one', 0)").run();
  runLightweightMigrations(db);
  const rows = db.prepare('SELECT title, status FROM todos ORDER BY title').all();
  assert.deepEqual(rows, [
    { title: 'done-one', status: 'done' },
    { title: 'todo-one', status: 'todo' },
  ]);
  db.close();
});

test('원자성: 도중에 실패하면 통째로 롤백 (user_version 0 유지, 부분 적용 없음)', () => {
  const db = oldDb();
  const realExec = db.exec.bind(db);
  let n = 0;
  db.exec = (sql) => {
    if (++n === 3) throw new Error('injected failure');
    return realExec(sql);
  };
  assert.throws(() => runLightweightMigrations(db), /injected failure/);
  db.exec = realExec;
  assert.equal(version(db), 0, '롤백되어 버전이 0으로 남음');
  assert.ok(!hasTable(db, 'item_links') || !hasCol(db, 'todos', 'status'), '부분 적용된 스키마가 없음');
  db.close();
});
