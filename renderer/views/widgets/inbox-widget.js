import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml, errorToast, formatRelative } from '../../shared/ui-utils.js';
import { attachContextMenu } from '../../shared/context-menu.js';

async function mount() {
  const root = document.getElementById('widget-root');
  let items = [];
  try {
    items = await window.itda.inbox.list({ onlyUnprocessed: true });
  } catch (e) {
    /* 빈 목록으로 폴백 */
  }
  let adding = false;

  function render() {
    const top = items.slice(0, 5);
    const addRowHtml = adding ? `<div class="bw-inline-add"><input type="text" id="bw-newInboxInput" placeholder="받은 업무 입력 후 Enter…" /></div>` : '';
    const bodyHtml =
      addRowHtml +
      (top.length
        ? `<div class="bw-list">
          ${top
            .map(
              (i) => `
          <div class="bw-inbox-row" data-id="${i.id}">
            <span class="bw-dot"></span>
            <span class="bw-inbox-text">${escapeHtml(i.content)}</span>
            <em>${formatRelative(i.created_at)}</em>
          </div>`
            )
            .join('')}
        </div>`
        : !adding
          ? `<div class="bw-empty">받은 업무가 없어요</div>`
          : '');

    renderBoardWidgetShell(root, {
      title: '받은 업무 (Inbox)',
      headerRight: `<button class="bw-icon-btn" id="bw-addInbox" title="새 항목">+</button>`,
      bodyHtml,
      footerLabel: '전체 Inbox 보기',
      footerRoute: '#/inbox',
    });

    document.getElementById('bw-addInbox').addEventListener('click', () => {
      adding = true;
      render();
      setTimeout(() => document.getElementById('bw-newInboxInput')?.focus(), 30);
    });

    root.querySelectorAll('.bw-inbox-row[data-id]').forEach((row) => {
      attachContextMenu(row, () => ({ type: 'inbox', id: Number(row.dataset.id) }), { linkOnly: true });
    });

    const newInput = document.getElementById('bw-newInboxInput');
    if (newInput) {
      newInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
          adding = false;
          render();
          return;
        }
        if (e.key !== 'Enter') return;
        const content = newInput.value.trim();
        if (!content) return;
        try {
          await window.itda.inbox.add(content);
          adding = false;
          items = await window.itda.inbox.list({ onlyUnprocessed: true });
          render();
        } catch (err) {
          errorToast(err, '추가하지 못했어요');
        }
      });
      newInput.addEventListener('blur', () => {
        adding = false;
        render();
      });
    }
  }

  render();
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'inbox') mount();
});
