import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';

async function mount() {
  const root = document.getElementById('widget-root');
  let events = [];
  try {
    events = await window.itda.events.today();
  } catch (e) {
    /* 조용히 빈 목록으로 — 위젯은 작은 창이라 에러 화면보다 "일정 없음"으로 보이는 게 낫다 */
  }

  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}.${today.getDate()} (${['일', '월', '화', '수', '목', '금', '토'][today.getDay()]})`;

  const bodyHtml = events.length
    ? `<div class="bw-timeline">
        ${events
          .map(
            (e) => `
          <div class="bw-timeline-row">
            <span class="bw-timeline-dot" style="background:${e.color_hex || 'var(--bw-faint)'}"></span>
            <span class="bw-timeline-time">${e.all_day ? '종일' : (e.start_at || '').slice(11, 16)}</span>
            <span class="bw-timeline-main">
              <b>${escapeHtml(e.title)}</b>
              ${e.location ? `<em>${escapeHtml(e.location)}</em>` : ''}
            </span>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="bw-empty">오늘 일정이 없어요</div>`;

  renderBoardWidgetShell(root, {
    title: '오늘 일정',
    headerRight: `<span class="bw-date">${dateLabel}</span>`,
    bodyHtml,
    footerLabel: '전체 일정 보기',
    footerRoute: '#/calendar',
  });
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'event') mount();
});
