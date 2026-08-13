import { renderBoardWidgetShell, fitWidgetToContent } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../../shared/rich-text.js';

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

  let memo;
  try {
    memo = await window.itda.memos.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!memo) {
    root.innerHTML = `<div class="widget-error">삭제된 메모예요</div>`;
    return;
  }

  const plain = stripHtmlToPlainText(memo.content || '');
  const title = (memo.title && memo.title.trim()) || plain.split('\n')[0].trim() || '새로운 메모';
  const bodyText = memo.title && memo.title.trim() ? plain : plain.split('\n').slice(1).join(' ');

  const bodyHtml = `
    <div style="font-size:12px;font-weight:600;color:var(--bw-text);margin-bottom:4px;">${escapeHtml(title)}</div>
    <div style="font-size:11.5px;line-height:1.5;color:var(--bw-soft);white-space:pre-wrap;word-break:break-word;">${escapeHtml(bodyText) || '<span style="color:var(--bw-faint);">내용 없음</span>'}</div>
  `;

  renderBoardWidgetShell(root, {
    title: '메모',
    bodyHtml,
    footerLabel: '메모에서 열기',
    footerRoute: '#/memo',
  });
  fitWidgetToContent(root);
}

mount();

window.itda.onDataChanged(({ entity, id: changedId }) => {
  if (entity === 'memo' && changedId === getIdFromQuery()) mount();
});
