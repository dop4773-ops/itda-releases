const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const createTodosRepository = require('../main/repositories/todos.repository');

test('마감일 일괄 변경: 지정한 것만 바뀌고 휴지통 항목은 안 바뀌며, 원래 날짜로 되돌릴 수 있다', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf8'));
  const repo = createTodosRepository(db);
  const a = repo.insert({ title: 'A', dueDate: '2026-10-01' }).id;
  const b = repo.insert({ title: 'B', dueDate: '2026-10-03' }).id;
  const c = repo.insert({ title: 'C', dueDate: '2026-10-02' }).id;
  repo.softDelete(c);
  const changed = repo.reschedule([{ id: a, dueDate: '2026-10-08' }, { id: b, dueDate: '2026-10-08' }, { id: c, dueDate: '2026-10-08' }]);
  assert.strictEqual(changed, 2);
  const due = (id) => db.prepare('SELECT due_date FROM todos WHERE id = ?').get(id).due_date;
  assert.deepStrictEqual([due(a), due(b), due(c)], ['2026-10-08', '2026-10-08', '2026-10-02']);
  repo.reschedule([{ id: a, dueDate: '2026-10-01' }, { id: b, dueDate: '2026-10-03' }]);
  assert.deepStrictEqual([due(a), due(b)], ['2026-10-01', '2026-10-03']);
});
