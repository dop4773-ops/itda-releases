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

test('랭킹: 같은 매치 품질이면 최근에 고친 항목이 위로', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const oldOne = repos.memos.insert({ title: '김부수 예전 메모', content: 'x' });
  const newOne = repos.memos.insert({ title: '김부수 최근 메모', content: 'y' });
  db.prepare("UPDATE memos SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(oldOne.id);
  db.prepare("UPDATE memos SET updated_at = datetime('now','localtime') WHERE id = ?").run(newOne.id);
  const hits = repos.search.query('김부수');
  assert.equal(hits[0].entity_id, newOne.id, '최근 고친 게 먼저');
});

test('본문 매치엔 snippet(검색어 주변 문구) 포함', () => {
  const repos = createRepositories(freshDb());
  repos.memos.insert({
    title: '9월 회의록',
    content: '<p>여러 안건 논의 후 김부수 환자 보호자 상담을 9월 10일로 잡기로 함</p>',
  });
  const hits = repos.search.query('김부수');
  assert.equal(hits[0].matchedIn, 'content');
  assert.ok(hits[0].snippet.includes('김부수'), 'snippet에 검색어 포함');
  assert.ok(!hits[0].snippet.includes('<'), 'HTML 태그 제거됨');
});

test('indexedByKeys: 살아있는 항목만 입력 순서대로', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const a = repos.todos.insert({ title: '할일A' });
  const b = repos.memos.insert({ title: '메모B', content: '' });
  const gone = repos.todos.insert({ title: '삭제될' });
  repos.todos.softDelete(gone.id);
  const out = repos.search.indexedByKeys([
    { type: 'memo', id: b.id },
    { type: 'todo', id: gone.id },
    { type: 'todo', id: a.id },
  ]);
  assert.deepEqual(
    out.map((r) => `${r.entity_type}:${r.entity_id}`),
    [`memo:${b.id}`, `todo:${a.id}`]
  );
});

test('recentItems: updated_at 최신순으로 타입 섞어 반환, 소프트삭제 제외', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.todos.insert({ title: '먼저 만든 할일' });
  repos.memos.insert({ title: '중간 메모', content: 'x' });
  // updated_at을 명시적으로 올려 최신으로 만든다 (트리거는 UPDATE 시 자동 갱신)
  const p = repos.postits.insert({ content: '가장 최근 포스트잇' });
  // updated_at을 명시 값으로 바꾸면 트리거(WHEN old.updated_at = new.updated_at)는 안 돈다
  db.prepare("UPDATE postits SET updated_at = '2099-01-01 00:00:00' WHERE id = ?").run(p.id);
  const del = repos.todos.insert({ title: '삭제될 할일' });
  repos.todos.softDelete(del.id);

  const items = repos.search.recentItems(8);
  assert.ok(items.length >= 3);
  assert.ok(!items.some((i) => i.title === '삭제될 할일'), '소프트삭제 제외');
  assert.equal(items[0].title, '가장 최근 포스트잇', 'updated_at 최신이 최상단');
  assert.ok(new Set(items.map((i) => i.entity_type)).size >= 2, '타입이 섞여있음');
});

test('isChosungQuery', () => {
  assert.equal(isChosungQuery('ㄱㅂㅅ'), true);
  assert.equal(isChosungQuery('ㄱ ㅂㅅ'), true);
  assert.equal(isChosungQuery('김부수'), false);
  assert.equal(isChosungQuery('ㄱ부수'), false);
  assert.equal(isChosungQuery(''), false);
});
