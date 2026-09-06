// main/shared/recurrence.js — 간단 반복(매일/매주/매월) 발생일 생성
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateOccurrenceDates, WINDOW_DAYS } = require('../main/shared/recurrence');

test('daily: 시작일 다음날부터 WINDOW_DAYS까지, 시작일 자신은 제외', () => {
  const d = generateOccurrenceDates('2026-01-01', 'daily');
  assert.equal(d[0], '2026-01-02');
  assert.equal(d.length, WINDOW_DAYS); // +1..+180
  assert.equal(d.at(-1), '2026-06-30'); // 2026-01-01 + 180일
  assert.ok(!d.includes('2026-01-01'));
});

test('weekly: 7일 간격, 같은 요일 유지', () => {
  const d = generateOccurrenceDates('2026-01-01 09:30:00', 'weekly'); // 시각부는 무시
  assert.equal(d[0], '2026-01-08');
  assert.equal(d[1], '2026-01-15');
  assert.equal(Math.floor(WINDOW_DAYS / 7), d.length);
  for (const k of d) assert.equal(new Date(k + 'T00:00').getDay(), 4); // 2026-01-01은 목요일
});

test('monthly: 매번 "시작일 + N개월"을 처음부터 재계산 (오차 누적 없음)', () => {
  const d = generateOccurrenceDates('2026-01-15', 'monthly');
  assert.deepEqual(d.slice(0, 5), ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15']);
});

test('monthly: 그 달에 없는 날짜(1/31)는 말일로 당김, 그래도 누적 안 됨', () => {
  const d = generateOccurrenceDates('2026-01-31', 'monthly');
  // 2월은 28일 → 2/28로 당기지만, 3월은 다시 원래 31일 기준으로 3/31
  assert.equal(d[0], '2026-02-28');
  assert.equal(d[1], '2026-03-31');
  assert.equal(d[2], '2026-04-30');
  assert.equal(d[3], '2026-05-31');
});

test('알 수 없는 rule / 빈 rule → 빈 배열', () => {
  assert.deepEqual(generateOccurrenceDates('2026-01-01', 'yearly'), []);
  assert.deepEqual(generateOccurrenceDates('2026-01-01', null), []);
});
