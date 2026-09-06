// 검색 재편 S2 — "관련 항목": 직접 일치 항목의 연결/같은-태그 항목을 모아준다
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { relatedFor } = require('../main/ipc/search.ipc');
const { canonicalizeLink } = require('../main/ipc/_shared');
const { freshDb } = require('../scripts/test-helpers');

test('연결된 항목 + 같은 태그 항목을 관련으로, 직접일치·중복은 제외', () => {
  const repos = createRepositories(freshDb());
  const cat = repos.categories.insert({ name: '재활', colorHex: '#4FB897' });

  const memoA = repos.memos.insert({ title: '김부수 평가 메모', content: 'x', categoryId: cat.id });
  const todoB = repos.todos.insert({ title: '치료계획 확인' }); // 연결 대상
  const memoC = repos.memos.insert({ title: '재활 일지', content: 'y', categoryId: cat.id }); // 같은 태그
  const memoD = repos.memos.insert({ title: '무관한 메모', content: 'z' });

  repos.links.insertIgnore(canonicalizeLink('memo', memoA.id, 'todo', todoB.id));

  const direct = repos.search.query('김부수'); // memoA만 매치
  assert.equal(direct.length, 1);
  assert.equal(direct[0].entity_id, memoA.id);

  const related = relatedFor(repos, direct);
  const keys = related.map((r) => `${r.entity_type}:${r.entity_id}`);
  assert.ok(keys.includes(`todo:${todoB.id}`), '연결된 todo 포함');
  assert.ok(keys.includes(`memo:${memoC.id}`), '같은 태그 memo 포함');
  assert.ok(!keys.includes(`memo:${memoA.id}`), '직접일치 자신은 제외');
  assert.ok(!keys.includes(`memo:${memoD.id}`), '무관한 항목 제외');

  const linkRow = related.find((r) => r.entity_id === todoB.id);
  assert.equal(linkRow.relatedReason, 'link');
  const tagRow = related.find((r) => r.entity_id === memoC.id);
  assert.equal(tagRow.relatedReason, 'tag');
  assert.equal(tagRow.tagName, '재활');
});

test('완전삭제/휴지통 상대는 관련 항목에 안 뜬다', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const memoA = repos.memos.insert({ title: '앵커 메모 김부수', content: 'x' });
  const trashedTodo = repos.todos.insert({ title: '휴지통 갈 할일' });
  const goneMemo = repos.memos.insert({ title: '곧 완전삭제', content: '' });
  repos.links.insertIgnore(canonicalizeLink('memo', memoA.id, 'todo', trashedTodo.id));
  repos.links.insertIgnore(canonicalizeLink('memo', memoA.id, 'memo', goneMemo.id));
  repos.todos.softDelete(trashedTodo.id); // 휴지통
  db.prepare('DELETE FROM memos WHERE id = ?').run(goneMemo.id); // 완전삭제

  const keys = relatedFor(repos, repos.search.query('김부수')).map((r) => `${r.entity_type}:${r.entity_id}`);
  assert.ok(!keys.includes(`todo:${trashedTodo.id}`), '휴지통 항목 제외');
  assert.ok(!keys.includes(`memo:${goneMemo.id}`), '완전삭제 항목 제외');
});
