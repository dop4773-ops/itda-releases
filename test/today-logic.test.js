const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'today-logic.js'), 'utf8')).toString('base64'));

test('타임라인: 종일 일정 → 시각순, 시각 없는 마감은 맨 뒤', async () => {
  const { buildTimeline } = await load();
  const rows = buildTimeline(
    [
      { id: 1, title: '회의', start_at: '2026-10-08 11:00:00', all_day: 0 },
      { id: 2, title: '라운딩', start_at: '2026-10-08 00:00:00', all_day: 1 },
      { id: 3, title: '평가', start_at: '2026-10-08 09:30:00', all_day: 0 },
    ],
    [{ id: 10, title: '보고서' }, { id: 11, title: '신청서', due_time: '10:00:00' }]
  );
  assert.deepStrictEqual(rows.map((r) => `${r.time}:${r.data.title}`), ['종일:라운딩', '09:30:평가', '10:00:신청서', '11:00:회의', '마감:보고서']);
});

test('지난 미완료: 오늘 이전만, 최근 7일은 목록·그 이전은 건수로', async () => {
  const { pickOverdue } = await load();
  const open = [
    { id: 1, title: '오늘', due_date: '2026-10-08' },
    { id: 2, title: '어제', due_date: '2026-10-07' },
    { id: 3, title: '일주일 전', due_date: '2026-10-01' },
    { id: 4, title: '더 전', due_date: '2026-09-20' },
    { id: 5, title: '기한 없음', due_date: null },
  ];
  const r = pickOverdue(open, '2026-10-08');
  assert.deepStrictEqual(r.recent.map((t) => t.title), ['일주일 전', '어제']);
  assert.strictEqual(r.older, 1);
});

test('일정 상태·다음 일정·주간 개수', async () => {
  const { eventState, nextUp, minutesText, weekKeys, countByDay } = await load();
  const e = (id, s, en, extra = {}) => ({ id, title: `e${id}`, all_day: 0, start_at: `2026-10-10 ${s}:00`, end_at: `2026-10-10 ${en}:00`, ...extra });
  const mins = (h, m) => h * 60 + m;
  assert.strictEqual(eventState(e(1, '09:00', '10:00'), mins(8, 0)), 'next');
  assert.strictEqual(eventState(e(1, '09:00', '10:00'), mins(9, 30)), 'now');
  assert.strictEqual(eventState(e(1, '09:00', '10:00'), mins(10, 0)), 'past');
  assert.strictEqual(eventState(e(2, '09:00', '09:00'), mins(9, 0)), 'now');
  assert.strictEqual(eventState(e(2, '09:00', '09:00'), mins(9, 1)), 'past');
  assert.strictEqual(eventState(e(3, '00:00', '23:59', { all_day: 1 }), mins(9, 0)), '');
  const list = [e(1, '09:00', '10:00'), e(2, '14:00', '15:00'), e(3, '16:00', '17:00')];
  const r = nextUp(list, mins(9, 30));
  assert.strictEqual(r.now.id, 1);
  assert.strictEqual(r.next.event.id, 2);
  assert.strictEqual(r.next.inMin, 270);
  assert.strictEqual(minutesText(270), '4시간 30분 뒤');
  assert.strictEqual(minutesText(45), '45분 뒤');
  assert.strictEqual(minutesText(0), '곧');
  const keys = weekKeys('2026-10-10'); // 토요일
  assert.deepStrictEqual([keys[0], keys[6]], ['2026-10-04', '2026-10-10']);
  const c = countByDay(keys, [{ all_day: 1, start_at: '2026-10-05 00:00:00', end_at: '2026-10-07 23:59:59' }, e(1, '09:00', '10:00')], [{ status: 'open', due_date: '2026-10-06' }, { status: 'done', due_date: '2026-10-06' }]);
  assert.deepStrictEqual(c['2026-10-06'], { events: 1, todos: 1 });
  assert.strictEqual(c['2026-10-10'].events, 1);
  assert.strictEqual(c['2026-10-04'].events, 0);
});
