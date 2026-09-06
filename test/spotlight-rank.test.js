// 빠른찾기(Spotlight) 결과 정렬: (0) 정확히 일치 → (1) 큰 카테고리(부분 일치) → (2) 개별 항목.
// spotlight.js는 window 의존 ESM이라 통째로 require 못 함 — 정렬 규칙만 1:1로 옮겨 검증한다.
// ⚠ spotlight.js의 categoryRank / rebuildItems 정렬을 바꾸면 여기도 같이 바꿀 것.
const { test } = require('node:test');
const assert = require('node:assert/strict');

function categoryRank(c, k) {
  if (!k) return 1;
  const label = c.label.toLowerCase();
  const kwTokens = (c.kw || '').toLowerCase().split(/\s+/).filter(Boolean);
  const labelWords = label.split(/[·・\s()]+/).filter(Boolean);
  if (label === k || labelWords.includes(k) || kwTokens.includes(k)) return 0;
  if (label.includes(k) || kwTokens.some((t) => t.includes(k))) return 1;
  return null;
}
// rebuildItems의 최종 정렬: 카테고리 먼저 concat → _rank, 그다음 삽입순
function finalOrder(categoryEntries, itemEntries) {
  return [...categoryEntries, ...itemEntries]
    .map((e, i) => ({ ...e, _i: i }))
    .sort((a, b) => a._rank - b._rank || a._i - b._i)
    .map((e) => e.label);
}

const SCREENS = [
  { label: '설정 · 업데이트', kw: '설정 업데이트 버전 최신', route: '#/settings/update' },
  { label: '설정 · 편의 기능', kw: '설정 편의기능 자동추천', route: '#/settings/convenience' },
  { label: '설정', kw: 'settings 설정 환경설정', route: '#/settings' },
  { label: 'Todo (할 일)', kw: 'todo 투두 할일', route: '#/todo' },
];

test('categoryRank: 라벨 단어/키워드 정확 일치 = 0', () => {
  assert.equal(categoryRank(SCREENS[0], '업데이트'), 0); // 라벨 단어 "업데이트"
  assert.equal(categoryRank(SCREENS[2], '설정'), 0); // 라벨 전체 일치
  assert.equal(categoryRank(SCREENS[1], '자동추천'), 0); // 키워드 토큰 정확
});

test('categoryRank: 부분 일치 = 1, 무관 = null', () => {
  assert.equal(categoryRank(SCREENS[0], '업뎃'), null);
  assert.equal(categoryRank(SCREENS[0], '버전'), 0); // kw 토큰 "버전" 정확
  assert.equal(categoryRank(SCREENS[3], 'do'), 1); // "todo" 부분
  assert.equal(categoryRank(SCREENS[3], 'xyz'), null);
});

test('정렬: 정확 카테고리 > 부분 카테고리 > 항목, 항목 중 제목정확은 최상단', () => {
  // "업데이트" 검색: 카테고리 "설정 · 업데이트"(0), "설정"(kw에 없음→null 걸러짐)
  const k = '업데이트';
  const cats = SCREENS.map((c) => ({ label: c.label, _rank: categoryRank(c, k) })).filter((c) => c._rank !== null);
  const items = [
    { label: '업데이트', _rank: 0 }, // 제목이 검색어와 정확히 같은 메모
    { label: '업데이트 관련 회의록', _rank: 2 },
  ];
  const order = finalOrder(cats, items);
  // rank0: [설정 · 업데이트(카테고리, 먼저 삽입), 업데이트(항목)] → rank2: [회의록]
  assert.deepEqual(order, ['설정 · 업데이트', '업데이트', '업데이트 관련 회의록']);
});

test('정렬: 정확히 일치하는 항목이 부분일치 카테고리보다 위', () => {
  const cats = [{ label: '설정 · 편의 기능', _rank: 1 }]; // "편의" 부분일치
  const items = [{ label: '편의', _rank: 0 }]; // 제목 정확
  assert.deepEqual(finalOrder(cats, items), ['편의', '설정 · 편의 기능']);
});
