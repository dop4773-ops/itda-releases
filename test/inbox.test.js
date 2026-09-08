// inbox.repository / inbox.ipc — 여러 줄 추가 / 별표 / 전환 표시
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { freshDb } = require('../scripts/test-helpers');

test('insertMany: 줄마다 항목 하나, 빈 줄 무시', () => {
  const repos = createRepositories(freshDb());
  const { ids } = repos.inbox.insertMany(['첫 줄', '  ', '둘째 줄', '']);
  assert.equal(ids.length, 2);
  const all = repos.inbox.list(false);
  assert.deepEqual(all.map((i) => i.content).sort(), ['둘째 줄', '첫 줄']);
});

test('setFavorite 토글', () => {
  const repos = createRepositories(freshDb());
  const { id } = repos.inbox.insert('별표 테스트');
  assert.equal(repos.inbox.list(false)[0].is_favorite, 0);
  repos.inbox.setFavorite(id, 1);
  assert.equal(repos.inbox.list(false)[0].is_favorite, 1);
  repos.inbox.setFavorite(id, 0);
  assert.equal(repos.inbox.list(false)[0].is_favorite, 0);
});

test('markProcessed 후에도 list(false)에 남고 processed_type이 채워진다', () => {
  const repos = createRepositories(freshDb());
  const { id } = repos.inbox.insert('전환될 항목');
  const todo = repos.todos.insert({ title: '전환될 항목' });
  repos.inbox.markProcessed({ id, type: 'todo', refId: todo.id });
  const row = repos.inbox.list(false).find((i) => i.id === id);
  assert.equal(row.is_processed, 1);
  assert.equal(row.processed_type, 'todo');
  assert.equal(row.processed_ref_id, todo.id);
  assert.equal(repos.inbox.list(true).length, 0, '미처리 목록에선 빠짐');
});
