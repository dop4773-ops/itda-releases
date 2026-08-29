import { renderBoardWidgetShell, fitWidgetToContent } from '../../shared/widget-ui.js';
import { escapeHtml, errorToast } from '../../shared/ui-utils.js';
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

  let todo;
  try {
    todo = await window.itda.todos.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!todo) {
    root.innerHTML = `<div class="widget-error">삭제된 항목이에요</div>`;
    return;
  }

  function render() {
    const bodyHtml = `
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
        <input type="checkbox" id="ti-check" style="width:13px;height:13px;accent-color:#6C8CF5;flex-shrink:0;margin-top:2px;" ${todo.status === 'done' ? 'checked' : ''} />
        <span style="font-size:12px;color:var(--bw-text);${todo.status === 'done' ? 'color:var(--bw-faint);text-decoration:line-through;' : ''}line-height:1.5;word-break:break-word;">${escapeHtml(todo.title)}</span>
      </label>
      ${todo.due_date ? `<div class="bw-date" style="margin-top:6px;">마감 ${escapeHtml(todo.due_date)}</div>` : ''}
      ${todo.memo ? `<div style="font-size:11.5px;line-height:1.5;color:var(--bw-soft);margin-top:8px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(todo.memo)}</div>` : ''}
    `;
    renderBoardWidgetShell(root, {
      title: '할 일',
      bodyHtml,
      footerLabel: '전체 Todo 보기',
      footerRoute: '#/todo',
    });
    fitWidgetToContent(root);

    attachContextMenu(root.querySelector('.board-widget-body'), () => ({ type: 'todo', id, dueDate: todo.due_date || null, isDone: todo.status === 'done' }), { onDeleted: () => window.close() });

    document.getElementById('ti-check').addEventListener('change', async (e) => {
      try {
        const result = await window.itda.todos.toggle(id);
        todo.status = result.status;
      } catch (err) {
        e.target.checked = !e.target.checked;
        errorToast(err, '상태를 변경하지 못했어요');
      }
    });
  }

  render();
}

mount();

// 메인 창(Todo 화면)이나 다른 위젯에서 이 항목이 바뀌면 통째로 다시 불러와 그린다.
// 이 위젯은 체크박스 하나뿐이라 다시 그려도 입력 중인 게 끊길 걱정이 없다.
window.itda.onDataChanged(({ entity, id: changedId }) => {
  if (entity === 'todo' && changedId === getIdFromQuery()) mount();
});
