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
