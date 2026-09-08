// todos.repository.listCompleted / countCompleted — 완료 기록 화면 데이터
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { freshDb } = require('../scripts/test-helpers');

function doneAt(db, id, ts) {
  db.prepare('UPDATE todos SET is_done = 1, status = ?, completed_at = ? WHERE id = ?').run('done', ts, id);
}

test('listCompleted: 완료된 것만, 소프트삭제 제외, archived_at 채움', () => {
  const repos = createRepositories(freshDb());
  const a = repos.todos.insert({ title: '완료 A' });
  const b = repos.todos.insert({ title: '완료 B' });
  const open = repos.todos.insert({ title: '미완료' });
  const gone = repos.todos.insert({ title: '완료했지만 삭제됨' });
  repos.todos.setDone(a.id, 1);
  repos.todos.setDone(b.id, 1);
  repos.todos.setDone(gone.id, 1);
  repos.todos.softDelete(gone.id);

  const out = repos.todos.listCompleted();
  const titles = out.map((t) => t.title).sort();
  assert.deepEqual(titles, ['완료 A', '완료 B']);
  assert.ok(!titles.includes('미완료'));
  assert.ok(out.every((t) => t.archived_at), 'archived_at 채워짐');
  assert.equal(repos.todos.countCompleted(), 2);
  void open;
});

test('listCompleted: 기간(from/to)은 completed_at 날짜 기준', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const t1 = repos.todos.insert({ title: '9월 1일 완료' });
  const t2 = repos.todos.insert({ title: '9월 20일 완료' });
  const t3 = repos.todos.insert({ title: '10월 5일 완료' });
  doneAt(db, t1.id, '2026-09-01 10:00:00');
  doneAt(db, t2.id, '2026-09-20 14:00:00');
  doneAt(db, t3.id, '2026-10-05 09:00:00');

  const sep = repos.todos.listCompleted({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(sep.map((t) => t.title).sort(), ['9월 1일 완료', '9월 20일 완료']);
});

test('listCompleted: keyword는 제목·메모·카테고리명', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const cat = repos.categories.insert({ name: '행정ZZ', colorHex: '#333' });
  const t1 = repos.todos.insert({ title: '인수인계 정리', categoryId: cat.id });
  const t2 = repos.todos.insert({ title: '회의록 작성', memo: '인수인계 관련 언급' });
  const t3 = repos.todos.insert({ title: '무관한 일' });
  [t1, t2, t3].forEach((t) => repos.todos.setDone(t.id, 1));

  assert.equal(repos.todos.listCompleted({ keyword: '인수인계' }).length, 2);
  assert.equal(repos.todos.listCompleted({ keyword: '행정ZZ' }).length, 1);
});

test('listCompleted: order recent/oldest, completed_at 없으면 updated_at 대체', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const older = repos.todos.insert({ title: '오래된 완료' });
  const newer = repos.todos.insert({ title: '최근 완료' });
  const noTs = repos.todos.insert({ title: 'completed_at 없음' });
  doneAt(db, older.id, '2026-01-01 00:00:00');
  doneAt(db, newer.id, '2026-09-01 00:00:00');
  // completed_at은 비우고 is_done만 — updated_at으로 대체돼야 함
  db.prepare("UPDATE todos SET is_done = 1, status = 'done', completed_at = NULL, updated_at = '2026-05-01 00:00:00' WHERE id = ?").run(noTs.id);

  const recent = repos.todos.listCompleted({ order: 'recent' }).map((t) => t.title);
  assert.deepEqual(recent, ['최근 완료', 'completed_at 없음', '오래된 완료']);
  const oldest = repos.todos.listCompleted({ order: 'oldest' }).map((t) => t.title);
  assert.deepEqual(oldest, ['오래된 완료', 'completed_at 없음', '최근 완료']);
});
