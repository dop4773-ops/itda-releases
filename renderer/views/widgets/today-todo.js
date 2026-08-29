import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { escapeHtml, errorToast } from '../../shared/ui-utils.js';
import { attachContextMenu } from '../../shared/context-menu.js';

async function mount() {
  const root = document.getElementById('widget-root');
  let todos = [];
  try {
    todos = await window.itda.todos.today();
  } catch (e) {
    /* 빈 목록으로 폴백 */
  }
  let adding = false;

  function render() {
    const addRowHtml = adding
      ? `<div class="bw-inline-add"><input type="text" id="bw-newTodoInput" placeholder="할 일 입력 후 Enter…" /></div>`
      : '';
    const bodyHtml =
      addRowHtml +
      (todos.length
        ? `<div class="bw-list">
          ${todos
            .map(
              (t) => `
            <label class="bw-check-row" data-id="${t.id}">
              <input type="checkbox" data-id="${t.id}" />
              <span>${escapeHtml(t.title)}</span>
              <em>${t.due_date ? '오늘' : '마감없음'}</em>
            </label>`
            )
            .join('')}
        </div>`
        : !adding
          ? `<div class="bw-empty">오늘 할 일이 없어요</div>`
          : '');

    renderBoardWidgetShell(root, {
      title: '오늘 할 일',
      headerRight: `<button class="bw-icon-btn" id="bw-addTodo" title="새 할 일">+</button>`,
      bodyHtml,
      footerLabel: '전체 Todo 보기',
      footerRoute: '#/todo',
    });

    document.getElementById('bw-addTodo').addEventListener('click', () => {
      adding = true;
      render();
      setTimeout(() => document.getElementById('bw-newTodoInput')?.focus(), 30);
    });

    root.querySelectorAll('.bw-check-row[data-id]').forEach((row) => {
      const tid = Number(row.dataset.id);
      const t = todos.find((x) => x.id === tid);
      attachContextMenu(row, () => ({ type: 'todo', id: tid, dueDate: t?.due_date || null, isDone: !!t?.is_done }), {
        onDeleted: async () => {
          todos = await window.itda.todos.today().catch(() => todos);
          render();
        },
      });
    });

    const newInput = document.getElementById('bw-newTodoInput');
    if (newInput) {
      newInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
          adding = false;
          render();
          return;
        }
        if (e.key !== 'Enter') return;
        const title = newInput.value.trim();
        if (!title) return;
        try {
          const todayStr = new Date().toISOString().slice(0, 10);
          await window.itda.todos.add({ title, dueDate: todayStr });
          adding = false;
          todos = await window.itda.todos.today();
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

    // 체크하면 취소선으로 남기지 않고 목록에서 바로 사라지게 한다(위젯의 취지는
    // "오늘 남은 일" 확인이라, 완료된 건 더 이상 여기 있을 이유가 없음)
    root.querySelectorAll('.bw-check-row input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const id = Number(cb.dataset.id);
        try {
          await window.itda.todos.toggle(id);
          todos = todos.filter((t) => t.id !== id);
          render();
        } catch (e) {
          cb.checked = false;
          errorToast(e, '상태를 변경하지 못했어요');
        }
      });
    });
  }

  render();
}

mount();

window.itda.onDataChanged(({ entity }) => {
  if (entity === 'todo') mount();
});
