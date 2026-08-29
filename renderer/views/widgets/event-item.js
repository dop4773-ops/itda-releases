import { renderBoardWidgetShell, fitWidgetToContent } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';
import { attachContextMenu } from '../../shared/context-menu.js';

function getIdFromQuery() {
  return Number(new URLSearchParams(location.search).get('id'));
}

async function mount() {
  const root = document.getElementById('widget-root');
  const id = getIdFromQuery();

  if (!id) {
    root.innerHTML = `<div class="widget-error">잘못된 항목이에요</div>`;
    return;
  }

  let evt;
  try {
    evt = await window.itda.events.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!evt) {
    root.innerHTML = `<div class="widget-error">삭제된 일정이에요</div>`;
    return;
  }

  const timeLabel = evt.all_day
    ? `${(evt.start_at || '').slice(0, 10)} · 하루종일`
    : `${(evt.start_at || '').slice(0, 16).replace('T', ' ')} ~ ${(evt.end_at || '').slice(11, 16)}`;

  const bodyHtml = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      ${evt.color_hex ? `<span style="width:8px;height:8px;border-radius:50%;background:${evt.color_hex};flex-shrink:0;"></span>` : ''}
      <div style="font-size:12px;font-weight:600;color:var(--bw-text);">${escapeHtml(evt.title)}</div>
    </div>
    <div class="bw-date">${escapeHtml(timeLabel)}</div>
    ${evt.location ? `<div class="bw-date" style="margin-top:2px;">📍 ${escapeHtml(evt.location)}</div>` : ''}
    ${evt.memo ? `<div style="font-size:11.5px;line-height:1.5;color:var(--bw-soft);margin-top:8px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(evt.memo)}</div>` : ''}
  `;

  renderBoardWidgetShell(root, {
    title: '일정',
    bodyHtml,
    footerLabel: '캘린더에서 열기',
    footerRoute: '#/calendar',
  });
  fitWidgetToContent(root);

  attachContextMenu(root.querySelector('.board-widget-body'), () => ({ type: 'event', id }), { onDeleted: () => window.close() });
}

mount();

window.itda.onDataChanged(({ entity, id: changedId }) => {
  if (entity === 'event' && changedId === getIdFromQuery()) mount();
});
