import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../../shared/rich-text.js';

function deriveTitle(m) {
  if (m.title && m.title.trim()) return m.title.trim();
  const firstLine = stripHtmlToPlainText(m.content || '').split('\n')[0].trim();
  return firstLine || '새로운 메모';
}

async function mount() {
  const root = document.getElementById('widget-root');
  let memos = [];
  try {
    memos = await window.itda.memos.recent(4);
  } catch (e) {
    /* 빈 목록으로 폴백 */
  }

  const bodyHtml = memos.length
    ? `<div class="bw-list">
        ${memos
          .map(
            (m) => `
          <div class="bw-memo-row">
            <div class="bw-memo-row-head"><b>${escapeHtml(deriveTitle(m))}</b><span>${(m.updated_at || '').slice(11, 16)}</span></div>
            <div class="bw-memo-row-snippet">${escapeHtml(stripHtmlToPlainText(m.content || '').slice(0, 44))}</div>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="bw-empty">메모가 없어요</div>`;

  renderBoardWidgetShell(root, {
    title: '빠른 메모',
    bodyHtml,
    footerLabel: '메모 전체 보기',
    footerRoute: '#/memo',
  });
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'memo') mount();
});
