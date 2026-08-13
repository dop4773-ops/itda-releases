import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';

function computeDday(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays === 0) return 'D-DAY';
  return diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`;
}

async function mount() {
  const root = document.getElementById('widget-root');
  const todayStr = new Date().toISOString().slice(0, 10);
  let todos = [];
  let events = [];
  try {
    [todos, events] = await Promise.all([
      window.itda.todos.list({ isDone: false }),
      window.itda.events.range({ fromDate: todayStr, toDate: '2100-01-01' }),
    ]);
  } catch (e) {
    /* 빈 목록으로 폴백 */
  }

  const items = [
    ...todos.filter((t) => t.due_date && t.due_date >= todayStr).map((t) => ({ title: t.title, date: t.due_date })),
    ...events.map((e) => ({ title: e.title, date: (e.start_at || '').slice(0, 10) })),
  ]
    .filter((i) => i.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const bodyHtml = items.length
    ? `<div class="bw-list">
        ${items
          .map(
            (i) => `
          <div class="bw-dday-row">
            <div><b>${escapeHtml(i.title)}</b><span>${i.date}</span></div>
            <em>${computeDday(i.date)}</em>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="bw-empty">다가오는 일정이 없어요</div>`;

  renderBoardWidgetShell(root, {
    title: 'D-DAY',
    bodyHtml,
    footerLabel: '전체 일정 보기',
    footerRoute: '#/calendar',
  });
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'event') mount();
});
