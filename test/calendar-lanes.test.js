const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'calendar-lanes.js'), 'utf8')).toString('base64'));

const ev = (id, s, e) => ({ id, title: `e${id}`, all_day: 1, start_at: `${s} 00:00:00`, end_at: `${e} 23:59:59` });
const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
const byDateOf = (events) => {
  const m = new Map();
  events.forEach((e) => {
    for (const k of week) if (k >= e.start_at.slice(0, 10) && k <= e.end_at.slice(0, 10)) m.set(k, [...(m.get(k) || []), e]);
  });
  return m;
};

test('여러 날 일정은 모든 날에서 같은 줄 — 2일 휴가가 끝나도 3일 휴가가 위로 안 올라간다', async () => {
  const { layoutMultiDayLanes } = await load();
  const two = ev(1, '2026-10-05', '2026-10-06'); // 월~화
  const three = ev(2, '2026-10-06', '2026-10-08'); // 화~목
  const lanes = layoutMultiDayLanes(week, byDateOf([two, three]));
  const laneOf = (k, e) => lanes.get(k).indexOf(e);
  assert.strictEqual(laneOf('2026-10-06', two), 0);
  assert.strictEqual(laneOf('2026-10-06', three), 1);
  // 3일 휴가는 화·수·목 모두 같은 줄
  const l = laneOf('2026-10-06', three);
  assert.strictEqual(laneOf('2026-10-07', three), l);
  assert.strictEqual(laneOf('2026-10-08', three), l);
  // 수요일엔 2일 휴가 자리가 빈 줄(null)로 남아 3일 휴가가 아래줄에 그대로 있다
  assert.strictEqual(lanes.get('2026-10-07')[0], null);
  assert.strictEqual(lanes.get('2026-10-07')[1], three);
});

test('겹치지 않는 일정은 같은 줄을 재사용하고, 일정 없는 날은 빈 목록', async () => {
  const { layoutMultiDayLanes } = await load();
  const a = ev(1, '2026-10-04', '2026-10-05');
  const b = ev(2, '2026-10-07', '2026-10-08');
  const lanes = layoutMultiDayLanes(week, byDateOf([a, b]));
  assert.strictEqual(lanes.get('2026-10-04')[0], a);
  assert.strictEqual(lanes.get('2026-10-07')[0], b);
  assert.deepStrictEqual(lanes.get('2026-10-10'), []);
});

test('주를 넘어 이어지는 일정은 보이는 구간만 계산', async () => {
  const { layoutMultiDayLanes } = await load();
  const long = ev(1, '2026-09-28', '2026-10-20');
  const lanes = layoutMultiDayLanes(week, byDateOf([long]));
  week.forEach((k) => assert.strictEqual(lanes.get(k)[0], long));
});
