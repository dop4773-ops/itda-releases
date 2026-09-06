// 통합검색 엔진 (search.repository) — 랭킹 / 일치이유 / 한글 부분일치 / 초성 / 정규화
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { normalizeQuery } = require('../main/shared/search-text');
const { chosung, isChosungQuery } = require('../main/shared/hangul');
const { freshDb } = require('../scripts/test-helpers');

function seeded() {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.memos.insert({ title: '김부수 평가 메모', content: '김부수 환자의 인지평가 결과 정리' });
  repos.todos.insert({ title: '김부수 치료계획 확인', memo: '치료계획 자료 준비' });
  repos.memos.insert({ title: '9월 재활치료 진행현황', content: '이번 달 김부수 포함 재활 현황' });
  repos.todos.insert({ title: '회의 준비', memo: '3층 회의실' });
  return repos;
}

test('한글 부분일치: "부수"(2글자)로도 "김부수..." 를 찾는다 (FTS5로는 안 됐음)', () => {
  const hits = seeded().search.query('부수');
  assert.ok(hits.length >= 3);
  assert.ok(hits.every((h) => (h.title + h.content).includes('부수')));
});

test('띄어쓰기 무관: "김 부수" == "김부수"', () => {
  const a = seeded().search.query('김 부수').map((h) => h.entity_id).sort();
  const b = seeded().search.query('김부수').map((h) => h.entity_id).sort();
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3);
});

test('랭킹: 제목 일치가 본문 일치보다 위', () => {
  const hits = seeded().search.query('김부수');
  const titleIdx = hits.findIndex((h) => h.matchedIn === 'title');
  const contentIdx = hits.findIndex((h) => h.matchedIn === 'content');
  assert.ok(titleIdx === 0);
  if (contentIdx !== -1) assert.ok(titleIdx < contentIdx);
});

test('일치이유(matchedIn) 표시', () => {
  const hits = seeded().search.query('인지평가'); // 메모 본문에만 있음
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].matchedIn, 'content');
});

test('초성 검색: "ㄱㅂㅅ" → "김부수..." (제목만)', () => {
  const hits = seeded().search.query('ㄱㅂㅅ');
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((h) => chosung(h.title).replace(/\s/g, '').includes('ㄱㅂㅅ')));
  assert.ok(hits.some((h) => h.matchedIn === 'chosung' || h.matchedIn === 'title'));
});

test('타입 필터', () => {
  const onlyTodo = seeded().search.query('김부수', { types: ['todo'] });
  assert.ok(onlyTodo.length >= 1);
  assert.ok(onlyTodo.every((h) => h.entity_type === 'todo'));
});

test('소프트삭제된 항목은 검색에서 빠진다', () => {
  const repos = seeded();
  const t = repos.todos.insert({ title: '곧 삭제될 김부수 할일' });
  assert.ok(repos.search.query('곧 삭제될').length === 1);
  repos.todos.softDelete(t.id);
  assert.equal(repos.search.query('곧 삭제될').length, 0);
});

test('normalizeQuery: 공백 정리 + 꼬리말 제거', () => {
  assert.equal(normalizeQuery('  김부수   '), '김부수');
  assert.equal(normalizeQuery('김부수님'), '김부수');
  assert.equal(normalizeQuery('김부수 환자'), '김부수');
  assert.equal(normalizeQuery('김 부수'), '김 부수'); // 내부 공백은 유지(엔진이 두 형태 다 시도)
});

test('기간 필터: dateFrom/dateTo 밖의 항목과 날짜 없는 항목 제외', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.todos.insert({ title: '김부수 오늘 할일', dueDate: '2026-09-06' });
  repos.todos.insert({ title: '김부수 지난주 할일', dueDate: '2026-08-30' });
  repos.todos.insert({ title: '김부수 기한없는 할일' }); // due_date NULL
  const inRange = repos.search.query('김부수', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.deepEqual(inRange.map((h) => h.title), ['김부수 오늘 할일']);
});

test('상태 필터: status는 Todo에만 적용, 다른 타입은 통과', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const done = repos.todos.insert({ title: '김부수 완료 할일' });
  repos.todos.setStatus(done.id, 'done');
  repos.todos.insert({ title: '김부수 미완료 할일' });
  repos.memos.insert({ title: '김부수 메모', content: 'x' });
  const openOnly = repos.search.query('김부수', { status: 'open' });
  const titles = openOnly.map((h) => h.title).sort();
  assert.ok(titles.includes('김부수 미완료 할일'));
  assert.ok(titles.includes('김부수 메모'), '메모는 상태 필터와 무관하게 통과');
  assert.ok(!titles.includes('김부수 완료 할일'));
});

test('isChosungQuery', () => {
  assert.equal(isChosungQuery('ㄱㅂㅅ'), true);
  assert.equal(isChosungQuery('ㄱ ㅂㅅ'), true);
  assert.equal(isChosungQuery('김부수'), false);
  assert.equal(isChosungQuery('ㄱ부수'), false);
  assert.equal(isChosungQuery(''), false);
});
