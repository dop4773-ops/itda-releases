import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { buildMonthGridHtml, queryRange, groupByDateKey } from '../calendar.js';

async function mount() {
  const root = document.getElementById('widget-root');
  const anchor = new Date();
  let events = [];
  try {
    const { fromDate, toDate } = queryRange('month', anchor);
    const [local, google] = await Promise.all([
      window.itda.events.range({ fromDate, toDate }),
      window.itda.googleCalendar.range({ fromDate, toDate }).catch(() => []),
    ]);
    events = [...local, ...google];
  } catch (e) {
    /* 빈 달력으로 폴백 */
  }
  const byDate = groupByDateKey(events);

  renderBoardWidgetShell(root, {
    title: '구글 캘린더 (읽기 전용)',
    bodyHtml: `<div class="bw-mini-cal">${buildMonthGridHtml(anchor, byDate, { compact: true })}</div>`,
    footerLabel: '잇다 캘린더 열기',
    footerRoute: '#/calendar',
  });
}

mount();
