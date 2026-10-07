const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { listBackups, isBackupName, backupBeforeRestore } = require('../main/auto-backup');
const { inspectBackupFile } = require('../main/ipc/data.ipc');

const schema = fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'itda-rs-'));
function makeDb(file, { version = 11, todos = 2 } = {}) {
  const db = new Database(file);
  db.exec(schema);
  for (let i = 0; i < todos; i++) db.prepare('INSERT INTO todos (title) VALUES (?)').run('할 일 ' + i);
  db.pragma(`user_version = ${version}`);
  return db;
}

test('정상 백업은 건수와 함께 통과', () => {
  const dir = tmp();
  makeDb(path.join(dir, 'ok.db')).close();
  const r = inspectBackupFile(path.join(dir, 'ok.db'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.counts.todos, 2);
});

test('잇다 백업이 아니거나 더 새로운 버전이거나 깨진 파일은 거절', () => {
  const dir = tmp();
  const other = new Database(path.join(dir, 'other.db'));
  other.exec('CREATE TABLE x(a)');
  other.close();
  assert.match(inspectBackupFile(path.join(dir, 'other.db')).error, /잇다의 백업 파일이 아니에요/);
  makeDb(path.join(dir, 'new.db'), { version: 99 }).close();
  assert.match(inspectBackupFile(path.join(dir, 'new.db')).error, /더 새로운 버전/);
  fs.writeFileSync(path.join(dir, 'junk.db'), 'not a database at all');
  assert.strictEqual(inspectBackupFile(path.join(dir, 'junk.db')).ok, false);
  assert.strictEqual(inspectBackupFile(path.join(dir, 'missing.db')).ok, false);
});

test('목록: 잇다 백업 파일만 최신순으로, 이름 검사는 경로 조작을 막는다', () => {
  const dir = tmp();
  const touch = (n, t) => {
    fs.writeFileSync(path.join(dir, n), 'x');
    fs.utimesSync(path.join(dir, n), t, t);
  };
  touch('itda-auto-2026-10-01T03-00-00-000Z.db', 1000);
  touch('itda-premigrate-v10-2026-10-05T01-00-00-000Z.db', 3000);
  touch('itda-prerestore-2026-10-03T01-00-00-000Z.db', 2000);
  touch('random.db', 4000);
  touch('itda-auto-notes.txt', 4000);
  const list = listBackups(dir);
  assert.deepStrictEqual(list.map((b) => b.kind), ['premigrate', 'prerestore', 'auto']);
  assert.ok(isBackupName('itda-auto-2026-10-01T03-00-00-000Z.db'));
  for (const bad of ['../itda-auto-x.db', 'itda-auto-/../x.db', 'a\\itda-auto-x.db', 'random.db', 'itda-auto-x.sqlite']) assert.ok(!isBackupName(bad), bad);
});

test('복원 직전 사본: 현재 데이터가 담기고 최근 3개만 남는다', () => {
  const dir = tmp();
  const db = makeDb(path.join(dir, 'live.db'), { todos: 3 });
  let last;
  for (let i = 0; i < 5; i++) {
    last = backupBeforeRestore(db, path.join(dir, 'bk'));
    fs.utimesSync(last, 1000 + i, 1000 + i);
  }
  assert.strictEqual(fs.readdirSync(path.join(dir, 'bk')).length, 3);
  const copy = new Database(last, { readonly: true });
  assert.strictEqual(copy.prepare('SELECT COUNT(*) n FROM todos').get().n, 3);
});
