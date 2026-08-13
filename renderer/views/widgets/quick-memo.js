import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml, errorToast } from '../../shared/ui-utils.js';
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
    headerRight: `<button class="bw-icon-btn" id="bw-addMemo" title="새 메모">+</button>`,
    bodyHtml,
    footerLabel: '메모 전체 보기',
    footerRoute: '#/memo',
  });

  const addBtn = document.getElementById('bw-addMemo');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        await window.itda.memos.add({ content: '' });
        await window.itda.widgets.openMainApp('#/memo'); // 메모는 개별 위젯이 없어서 메인 화면에서 이어 씀
      } catch (e) {
        errorToast(e, '메모를 추가하지 못했어요');
      }
    });
  }
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'memo') mount();
});
