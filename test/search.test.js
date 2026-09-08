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
  repos.memos.insert({ title: '홍길동 평가 메모', content: '홍길동 환자의 인지평가 결과 정리' });
  repos.todos.insert({ title: '홍길동 치료계획 확인', memo: '치료계획 자료 준비' });
  repos.memos.insert({ title: '9월 재활치료 진행현황', content: '이번 달 홍길동 포함 재활 현황' });
  repos.todos.insert({ title: '회의 준비', memo: '3층 회의실' });
  return repos;
}

test('한글 부분일치: "길동"(2글자)로도 "홍길동..." 를 찾는다 (FTS5로는 안 됐음)', () => {
  const hits = seeded().search.query('길동');
  assert.ok(hits.length >= 3);
  assert.ok(hits.every((h) => (h.title + h.content).includes('길동')));
});

test('띄어쓰기 무관: "홍 길동" == "홍길동"', () => {
  const a = seeded().search.query('홍 길동').map((h) => h.entity_id).sort();
  const b = seeded().search.query('홍길동').map((h) => h.entity_id).sort();
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3);
});

test('랭킹: 제목 일치가 본문 일치보다 위', () => {
  const hits = seeded().search.query('홍길동');
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

test('초성 검색: "ㅎㄱㄷ" → "홍길동..." (제목만)', () => {
  const hits = seeded().search.query('ㅎㄱㄷ');
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((h) => chosung(h.title).replace(/\s/g, '').includes('ㅎㄱㄷ')));
  assert.ok(hits.some((h) => h.matchedIn === 'chosung' || h.matchedIn === 'title'));
});

test('타입 필터', () => {
  const onlyTodo = seeded().search.query('홍길동', { types: ['todo'] });
  assert.ok(onlyTodo.length >= 1);
  assert.ok(onlyTodo.every((h) => h.entity_type === 'todo'));
});

test('소프트삭제된 항목은 검색에서 빠진다', () => {
  const repos = seeded();
  const t = repos.todos.insert({ title: '곧 삭제될 홍길동 할일' });
  assert.ok(repos.search.query('곧 삭제될').length === 1);
  repos.todos.softDelete(t.id);
  assert.equal(repos.search.query('곧 삭제될').length, 0);
});

test('normalizeQuery: 공백 정리 + 꼬리말 제거', () => {
  assert.equal(normalizeQuery('  홍길동   '), '홍길동');
  assert.equal(normalizeQuery('홍길동님'), '홍길동');
  assert.equal(normalizeQuery('홍길동 환자'), '홍길동');
  assert.equal(normalizeQuery('홍 길동'), '홍 길동'); // 내부 공백은 유지(엔진이 두 형태 다 시도)
});

test('기간 필터: dateFrom/dateTo 밖의 항목과 날짜 없는 항목 제외', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.todos.insert({ title: '홍길동 오늘 할일', dueDate: '2026-09-06' });
  repos.todos.insert({ title: '홍길동 지난주 할일', dueDate: '2026-08-30' });
  repos.todos.insert({ title: '홍길동 기한없는 할일' }); // due_date NULL
  const inRange = repos.search.query('홍길동', { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
  assert.deepEqual(inRange.map((h) => h.title), ['홍길동 오늘 할일']);
});

test('상태 필터: status는 Todo에만 적용, 다른 타입은 통과', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const done = repos.todos.insert({ title: '홍길동 완료 할일' });
  repos.todos.setStatus(done.id, 'done');
  repos.todos.insert({ title: '홍길동 미완료 할일' });
  repos.memos.insert({ title: '홍길동 메모', content: 'x' });
  const openOnly = repos.search.query('홍길동', { status: 'open' });
  const titles = openOnly.map((h) => h.title).sort();
  assert.ok(titles.includes('홍길동 미완료 할일'));
  assert.ok(titles.includes('홍길동 메모'), '메모는 상태 필터와 무관하게 통과');
  assert.ok(!titles.includes('홍길동 완료 할일'));
});

test('랭킹: 같은 매치 품질이면 최근에 고친 항목이 위로', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const oldOne = repos.memos.insert({ title: '홍길동 예전 메모', content: 'x' });
  const newOne = repos.memos.insert({ title: '홍길동 최근 메모', content: 'y' });
  db.prepare("UPDATE memos SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(oldOne.id);
  db.prepare("UPDATE memos SET updated_at = datetime('now','localtime') WHERE id = ?").run(newOne.id);
  const hits = repos.search.query('홍길동');
  assert.equal(hits[0].entity_id, newOne.id, '최근 고친 게 먼저');
});

test('본문 매치엔 snippet(검색어 주변 문구) 포함', () => {
  const repos = createRepositories(freshDb());
  repos.memos.insert({
    title: '9월 회의록',
    content: '<p>여러 안건 논의 후 홍길동 환자 보호자 상담을 9월 10일로 잡기로 함</p>',
  });
  const hits = repos.search.query('홍길동');
  assert.equal(hits[0].matchedIn, 'content');
  assert.ok(hits[0].snippet.includes('홍길동'), 'snippet에 검색어 포함');
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

test('태그 필터: tag 옵션 주면 그 카테고리 항목만 (대소문자 무관, inbox 제외)', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const cat = repos.categories.insert({ name: '재활ZZ', colorHex: '#123456' });
  const m1 = repos.memos.insert({ title: '홍길동 재활 메모', content: 'x' });
  repos.memos.insert({ title: '홍길동 무관 메모', content: 'y' }); // 태그 없음
  db.prepare('UPDATE memos SET category_id = ? WHERE id = ?').run(cat.id, m1.id);
  const hits = repos.search.query('홍길동', { tag: '재활zz' });
  assert.deepEqual(hits.map((h) => h.entity_id), [m1.id]);
  assert.equal(repos.search.query('홍길동', { tag: '없는태그' }).length, 0);
});

test('browse: 검색어 없이 타입/태그로만 최근순 나열', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const cat = repos.categories.insert({ name: '프로젝트ZZ', colorHex: '#abcdef' });
  const t1 = repos.todos.insert({ title: '태그된 할일' });
  repos.todos.insert({ title: '태그 없는 할일' });
  const mm = repos.memos.insert({ title: '태그된 메모', content: '' });
  db.prepare('UPDATE todos SET category_id = ? WHERE id = ?').run(cat.id, t1.id);
  db.prepare('UPDATE memos SET category_id = ? WHERE id = ?').run(cat.id, mm.id);

  const onlyMemo = repos.search.browse({ type: 'memo' });
  assert.ok(onlyMemo.length >= 1 && onlyMemo.every((r) => r.entity_type === 'memo'));

  const byTag = repos.search.browse({ tag: '프로젝트ZZ' });
  const keys = byTag.map((r) => `${r.entity_type}:${r.entity_id}`).sort();
  assert.deepEqual(keys, [`memo:${mm.id}`, `todo:${t1.id}`].sort());

  assert.deepEqual(repos.search.browse({ tag: '없음' }), []);
});

test('일정 결과에 start_at/all_day가 붙는다 (목록에서 날짜 표시용)', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.events.insert({ title: '재활 회의', startAt: '2026-09-10 14:00', endAt: '2026-09-10 15:00' });
  const hits = repos.search.query('재활 회의');
  const ev = hits.find((h) => h.entity_type === 'event');
  assert.ok(ev, '일정이 검색됨');
  assert.equal(ev.eventStart, '2026-09-10 14:00');
  assert.equal(ev.eventAllDay, false);
  // browse / recentItems 경로에도
  assert.equal(repos.search.browse({ type: 'event' })[0].eventStart, '2026-09-10 14:00');
});

test('searchPaged: items + total + typeCounts, 페이지네이션(offset/limit)', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  for (let i = 0; i < 25; i++) repos.memos.insert({ title: `그랜드라운딩 메모 ${i}`, content: 'x' });
  repos.todos.insert({ title: '그랜드라운딩 명단' });
  repos.events.insert({ title: '그랜드라운딩 회의', startAt: '2026-09-05 10:00', endAt: '2026-09-05 11:00' });

  const p1 = repos.search.searchPaged('그랜드라운딩', { limit: 10, offset: 0 });
  assert.equal(p1.items.length, 10);
  assert.equal(p1.total, 27);
  assert.equal(p1.typeCounts.memo, 25);
  assert.equal(p1.typeCounts.todo, 1);
  assert.equal(p1.typeCounts.event, 1);

  const p2 = repos.search.searchPaged('그랜드라운딩', { limit: 10, offset: 20 });
  assert.equal(p2.items.length, 7);
});

test('searchPaged: 유형탭 개수는 필터와 무관하게 전체 기준', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  repos.memos.insert({ title: '회의록 A', content: 'x' });
  repos.memos.insert({ title: '회의록 B', content: 'y' });
  repos.todos.insert({ title: '회의록 준비' });

  const onlyTodo = repos.search.searchPaged('회의록', { types: ['todo'] });
  assert.equal(onlyTodo.items.length, 1);
  assert.equal(onlyTodo.total, 1, 'total은 필터 적용 후');
  assert.equal(onlyTodo.typeCounts.memo, 2, 'typeCounts는 필터 무관 전체');
  assert.equal(onlyTodo.typeCounts.todo, 1);
});

test('searchPaged: sort recent/oldest는 updated_at 기준, 결과 행에 카테고리 붙음', () => {
  const db = freshDb();
  const repos = createRepositories(db);
  const cat = repos.categories.insert({ name: '행정ZZ', colorHex: '#334455' });
  const a = repos.memos.insert({ title: '보고 예전', content: 'x' });
  const b = repos.memos.insert({ title: '보고 최근', content: 'y' });
  db.prepare('UPDATE memos SET category_id = ? WHERE id = ?').run(cat.id, b.id);
  db.prepare("UPDATE memos SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(a.id);
  db.prepare("UPDATE memos SET updated_at = '2026-09-01 00:00:00' WHERE id = ?").run(b.id);

  const recent = repos.search.searchPaged('보고', { sort: 'recent' });
  assert.equal(recent.items[0].entity_id, b.id);
  assert.equal(recent.items[0].categoryName, '행정ZZ');
  assert.equal(recent.items[0].categoryColor, '#334455');

  const oldest = repos.search.searchPaged('보고', { sort: 'oldest' });
  assert.equal(oldest.items[0].entity_id, a.id);
});

test('isChosungQuery', () => {
  assert.equal(isChosungQuery('ㅎㄱㄷ'), true);
  assert.equal(isChosungQuery('ㄱ ㅂㅅ'), true);
  assert.equal(isChosungQuery('홍길동'), false);
  assert.equal(isChosungQuery('ㅎ길동'), false);
  assert.equal(isChosungQuery(''), false);
});
