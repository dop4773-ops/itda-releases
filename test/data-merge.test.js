// 데이터 병합/JSON 가져오기의 중복 제외 (main/ipc/data.ipc.js importAllTables)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { importAllTables } = require('../main/ipc/data.ipc');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf8'));
  return db;
}
const count = (db, t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;

const backup = () => ({
  categories: [],
  todos: [
    { id: 1, title: '보고서 작성', due_date: '2026-10-10', due_time: null },
    { id: 2, title: '새 할 일', due_date: null },
    { id: 3, title: '휴지통에 있던 일', deleted_at: '2026-10-01 10:00:00' },
  ],
  todo_subtasks: [{ todo_id: 1, title: '자료 모으기' }, { todo_id: 2, title: '하위 A' }],
  todo_tags: [{ todo_id: 1, tag: '중요' }],
  events: [
    { id: 1, title: '회의', start_at: '2026-10-08 09:00:00', end_at: '2026-10-08 10:00:00', all_day: 0 },
    { id: 2, title: '회의', start_at: '2026-10-09 09:00:00', end_at: '2026-10-09 10:00:00', all_day: 0 },
  ],
  memos: [{ id: 1, title: '메모', content: '<p>같은 내용</p>' }, { id: 2, title: '메모', content: '<p>다른 내용</p>' }],
  postits: [{ id: 1, title: null, content: '포스트잇' }],
  inbox_items: [{ id: 1, content: '빠른 입력' }, { id: 2, content: '새 입력' }],
  item_links: [{ a_type: 'todo', a_id: 1, b_type: 'event', b_id: 1 }],
  holidays: [],
});

function seed(db) {
  db.prepare("INSERT INTO todos (title, due_date) VALUES ('보고서 작성', '2026-10-10')").run();
  db.prepare("INSERT INTO events (title, start_at, end_at, all_day) VALUES ('회의', '2026-10-08 09:00:00', '2026-10-08 10:00:00', 0)").run();
  db.prepare("INSERT INTO memos (title, content) VALUES ('메모', '<p>같은 내용</p>')").run();
  db.prepare("INSERT INTO postits (content) VALUES ('포스트잇')").run();
  db.prepare("INSERT INTO inbox_items (content) VALUES ('빠른 입력')").run();
}

test('이미 있는 항목은 건너뛰고 새 것만 추가한다', () => {
  const db = freshDb();
  seed(db);
  const { counts, skipped } = importAllTables(db, backup());
  assert.deepStrictEqual([counts.todos, counts.events, counts.memos, counts.postits, counts.inbox_items], [1, 1, 1, 0, 1]);
  assert.deepStrictEqual([skipped.todos, skipped.events, skipped.memos, skipped.postits, skipped.inbox_items], [1, 1, 1, 1, 1]);
  assert.strictEqual(count(db, 'todos'), 2);
  assert.strictEqual(count(db, 'events'), 2);
});

test('건너뛴 Todo의 하위 할 일·태그는 가져오지 않고, 새 Todo의 것은 가져온다', () => {
  const db = freshDb();
  seed(db);
  importAllTables(db, backup());
  assert.deepStrictEqual(db.prepare('SELECT title FROM todo_subtasks').all().map((r) => r.title), ['하위 A']);
  assert.strictEqual(count(db, 'todo_tags'), 0);
});

test('백업 안의 휴지통 항목은 되살리지 않고, 기존 항목에 연결은 이어붙인다', () => {
  const db = freshDb();
  seed(db);
  const { counts, skipped } = importAllTables(db, backup());
  assert.strictEqual(skipped.trashed, 1);
  assert.ok(!db.prepare("SELECT 1 FROM todos WHERE title = '휴지통에 있던 일'").get());
  assert.strictEqual(counts.item_links, 1); // 둘 다 기존 항목으로 매핑돼 연결이 생김
});

test('같은 파일을 두 번 병합해도 두 번째는 아무것도 추가되지 않는다', () => {
  const db = freshDb();
  importAllTables(db, backup());
  const before = ['todos', 'events', 'memos', 'postits', 'inbox_items'].map((t) => count(db, t));
  const second = importAllTables(db, backup());
  assert.deepStrictEqual(['todos', 'events', 'memos', 'postits', 'inbox_items'].map((t) => count(db, t)), before);
  assert.strictEqual(second.counts.todos + second.counts.events + second.counts.memos + second.counts.postits + second.counts.inbox_items, 0);
});
