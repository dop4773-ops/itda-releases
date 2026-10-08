const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { cleanupTargets, runCleanup } = require('../main/ipc/data.ipc');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf8'));
  return db;
}
const NOW = new Date(2026, 9, 8, 12, 0, 0); // 2026-10-08

test('N개월 지난 완료 할 일과 지난 일정만 대상 — 미완료·최근·반복·이미 휴지통은 제외', () => {
  const db = freshDb();
  const todo = (title, status, completed, deleted = null) => db.prepare('INSERT INTO todos (title, status, is_done, completed_at, deleted_at) VALUES (?, ?, ?, ?, ?)').run(title, status, status === 'done' ? 1 : 0, completed, deleted);
  todo('오래된 완료', 'done', '2026-03-01 10:00:00');
  todo('최근 완료', 'done', '2026-09-20 10:00:00');
  todo('오래됐지만 미완료', 'todo', null);
  todo('이미 휴지통', 'done', '2026-01-01 10:00:00', '2026-02-01 00:00:00');
  const ev = (title, end, rule = null) => db.prepare('INSERT INTO events (title, start_at, end_at, all_day, recurrence_rule) VALUES (?, ?, ?, 0, ?)').run(title, end, end, rule);
  ev('지난 일정', '2026-02-10 10:00');
  ev('최근 일정', '2026-10-01 10:00');
  ev('오래된 반복', '2026-01-05 10:00', 'weekly');
  ev('앞으로 일정', '2026-12-01 10:00');
  const t = cleanupTargets(db, 6, NOW); // 기준: 2026-04-08
  assert.strictEqual(t.todos.length, 1);
  assert.strictEqual(t.events.length, 1);
  assert.strictEqual(db.prepare('SELECT title FROM todos WHERE id = ?').get(t.todos[0]).title, '오래된 완료');
  assert.strictEqual(db.prepare('SELECT title FROM events WHERE id = ?').get(t.events[0]).title, '지난 일정');
});

test('정리하면 삭제가 아니라 휴지통(deleted_at)으로 가고, 다시 하면 대상이 없다', () => {
  const db = freshDb();
  db.prepare("INSERT INTO todos (title, status, is_done, completed_at) VALUES ('옛날 완료', 'done', 1, '2020-01-01 10:00:00')").run();
  const r = runCleanup(db, 3);
  assert.strictEqual(r.todos, 1);
  assert.ok(db.prepare("SELECT deleted_at FROM todos WHERE title = '옛날 완료'").get().deleted_at);
  assert.deepStrictEqual(cleanupTargets(db, 3).todos, []);
});
