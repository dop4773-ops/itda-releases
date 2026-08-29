import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml, errorToast } from '../../shared/ui-utils.js';
import { STICKY_COLORS } from '../../shared/theme.js';
import { stripHtmlToPlainText } from '../../shared/rich-text.js';
import { attachContextMenu } from '../../shared/context-menu.js';

async function mount() {
  const root = document.getElementById('widget-root');
  let postits = [];
  try {
    postits = await window.itda.postits.list();
  } catch (e) {
    /* 빈 목록으로 폴백 */
  }
  const top = [...postits].sort((a, b) => b.is_pinned - a.is_pinned).slice(0, 4);

  const bodyHtml = top.length
    ? `<div class="bw-postit-grid">
        ${top
          .map(
            (p) => `
          <div class="bw-postit-tile" style="background:${p.color_hex}" data-id="${p.id}">
            <div class="bw-postit-tile-content">${escapeHtml(stripHtmlToPlainText(p.content || '').slice(0, 44))}</div>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="bw-empty">포스트잇이 없어요</div>`;

  renderBoardWidgetShell(root, {
    title: '포스트잇',
    headerRight: `<button class="bw-icon-btn" id="bw-addPostit" title="새 포스트잇">+</button>`,
    bodyHtml,
    footerLabel: '전체 포스트잇 보기',
    footerRoute: '#/postit',
  });

  // 타일 클릭 -> 그 포스트잇만 개별 플로팅 위젯으로 열기 (이미 만들어둔 postitWidget 재사용)
  root.querySelectorAll('.bw-postit-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      window.itda.postitWidget.open(Number(tile.dataset.id));
    });
    attachContextMenu(tile, () => ({ type: 'postit', id: Number(tile.dataset.id) }), { onDeleted: () => mount() });
  });

  const addBtn = document.getElementById('bw-addPostit');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      try {
        const { id } = await window.itda.postits.add({ content: '새 포스트잇', colorHex: STICKY_COLORS[0] });
        await window.itda.postitWidget.open(id);
      } catch (e) {
        errorToast(e, '포스트잇을 추가하지 못했어요');
      }
    });
  }
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'postit') mount();
});
