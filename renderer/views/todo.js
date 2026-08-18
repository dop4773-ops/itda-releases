import { escapeHtml, toast, errorToast, formatDueBadge, priorityBadge, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { registerEscClose } from '../shared/esc-close.js';
import { attachDragOut, DRAG_HANDLE_ICON } from '../shared/drag-out.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { attachDateQuickChips } from '../shared/date-quick-chips.js';
import { confirmSeriesScope } from '../shared/series-scope.js';

const TODO_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`;
const RECURRENCE_LABEL = { daily: '매일', weekly: '매주', monthly: '매월' };
const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const STAR_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`;
const STAR_OUTLINE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`;
const LIST_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const BOARD_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="6" height="9" rx="1"/><rect x="19" y="4" width="2" height="5" rx="1"/></svg>`;
const CHEVRON_RIGHT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg>`;
const CHEVRON_LEFT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6"/></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const SMALL_TRASH_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

const EMPTY_MESSAGES = {
  all: { title: '할 일이 없어요', subtitle: 'Inbox에서 정리하거나 여기서 바로 추가해보세요' },
  today: { title: '오늘 마감인 할 일이 없어요', subtitle: '여유로운 하루네요' },
  upcoming: { title: '예정된 할 일이 없어요', subtitle: '마감일을 정해두면 여기 모여요' },
  favorite: { title: '중요 표시한 할 일이 없어요', subtitle: '별 아이콘을 눌러 중요한 일을 표시해보세요' },
  done: { title: '완료한 할 일이 아직 없어요', subtitle: '체크하면 여기에 모여요' },
};

const STATUS_LABEL = { todo: '해야 할 일', doing: '진행 중', done: '완료' };

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-purple">${TODO_ICON}</div>
        <div><h1>Todo</h1><p>할 일을 추가하고 카테고리·마감일로 관리하세요.</p></div>
      </div>
      <div class="view-toggle" id="t-viewToggle">
        <button class="view-toggle-btn" data-view="list" title="목록">${LIST_VIEW_ICON}</button>
        <button class="view-toggle-btn active" data-view="board" title="보드">${BOARD_VIEW_ICON}</button>
      </div>
      ${widgetLaunchButtonHtml('t-widgetBtn', '오늘 할 일 위젯 열기')}
    </div>

    <div class="form-row">
      <input type="text" id="t-title" class="input" style="flex:1;min-width:200px;" placeholder="할 일 제목" />
      <select id="t-category" class="select"></select>
      <input type="date" id="t-due" class="input" />
      <select id="t-priority" class="select">
        <option value="1">높음</option>
        <option value="2" selected>보통</option>
        <option value="3">낮음</option>
      </select>
      <button class="btn" id="t-addBtn">추가</button>
    </div>

    <div class="todo-layout">
      <div class="todo-main">
        <div class="todo-filter-row">
          <div class="tabs" id="t-tabs">
            <button class="tab active" data-filter="all">전체</button>
            <button class="tab" data-filter="today">오늘</button>
            <button class="tab" data-filter="upcoming">예정</button>
            <button class="tab" data-filter="favorite">중요</button>
            <button class="tab" data-filter="done">완료</button>
          </div>
          <select id="t-categoryFilter" class="select"><option value="">전체 카테고리</option></select>
        </div>

        <div id="t-list"><div class="empty">불러오는 중…</div></div>
      </div>

      <div class="todo-detail-panel" id="t-panel"></div>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let categories = [];
  let allTodos = [];
  let currentFilter = 'all';
  let currentCategoryId = '';
  let currentView = 'board'; // 프로그램 전체에서 Todo는 기본적으로 칸반 보드로 시작 (요청에 따름)
  let busy = false; // 이중 클릭으로 같은 요청이 중복 발생하지 않도록
  let selectedTodoId = null;

  async function loadCategories() {
    try {
      categories = await window.itda.categories.list();
      const options = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      $('t-category').innerHTML = `<option value="">카테고리 없음</option>` + options;
      $('t-categoryFilter').innerHTML = `<option value="">전체 카테고리</option>` + options;
    } catch (e) {
      errorToast(e, '카테고리를 불러오지 못했어요');
    }
  }

  function applyFilters(todos) {
    let list = todos;
    if (currentCategoryId) list = list.filter((t) => String(t.category_id) === String(currentCategoryId));
    if (currentFilter === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => t.due_date === today);
    } else if (currentFilter === 'upcoming') {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => t.due_date && t.due_date > today && !t.is_done);
    } else if (currentFilter === 'favorite') {
      list = list.filter((t) => t.is_favorite);
    } else if (currentFilter === 'done') {
      list = list.filter((t) => t.is_done);
    }
    return list;
  }

  function cardBadges(t) {
    const due = formatDueBadge(t.due_date, !!t.is_done);
    const pri = priorityBadge(t.priority);
    return { due, pri };
  }

  function renderCard(t, { boardMode = false } = {}) {
    const { due, pri } = cardBadges(t);
    const catPill = t.category_name
      ? `<span class="cat-pill" style="background:${t.color_hex};color:#fff;">${escapeHtml(t.category_name)}</span>`
      : '';
    const dueBadge =
      !t.is_done && (due.tone === 'danger' || due.tone === 'brand')
        ? `<span class="badge badge-${due.tone}">${due.label}</span>`
        : t.is_done
        ? ''
        : `<span class="badge badge-neutral">${due.label}</span>`;

    if (boardMode) {
      return `
        <div class="kanban-card" data-id="${t.id}">
          <div class="kanban-card-top">
            <input type="checkbox" class="kanban-card-check" data-action="toggle" data-id="${t.id}" ${t.is_done ? 'checked' : ''} title="완료" />
            <div class="kanban-card-badges">${catPill}${pri ? `<span class="badge badge-${pri.tone}">${pri.label}</span>` : ''}</div>
            <div class="kanban-card-top-right">
              <span class="drag-handle" data-drag-id="${t.id}" title="드래그해서 바탕화면에 놓으면 작은 위젯으로 열려요">${DRAG_HANDLE_ICON}</span>
              <button class="star-btn ${t.is_favorite ? 'active' : ''}" data-action="favorite" data-id="${t.id}" title="중요 표시">${t.is_favorite ? STAR_ICON : STAR_OUTLINE_ICON}</button>
            </div>
          </div>
          <b class="kanban-card-title ${t.is_done ? 'done' : ''}">${escapeHtml(t.title)}</b>
          <div class="kanban-card-bottom">
            ${dueBadge || '<span></span>'}
            <div class="kanban-move-btns">
              ${t.status !== 'todo' ? `<button class="btn-icon" data-action="move-prev" data-id="${t.id}" title="이전 단계로">${CHEVRON_LEFT}</button>` : ''}
              ${t.status !== 'done' ? `<button class="btn-icon" data-action="move-next" data-id="${t.id}" title="다음 단계로">${CHEVRON_RIGHT}</button>` : ''}
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="list-row todo-card ${t.is_done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" data-action="toggle" data-id="${t.id}" ${t.is_done ? 'checked' : ''} />
        <div class="main">
          <div class="todo-card-title-row">
            <b>${escapeHtml(t.title)}</b>
            <button class="star-btn ${t.is_favorite ? 'active' : ''}" data-action="favorite" data-id="${t.id}" title="중요 표시">${t.is_favorite ? STAR_ICON : STAR_OUTLINE_ICON}</button>
          </div>
          <div class="meta">${catPill}${dueBadge}${pri ? `<span class="badge badge-${pri.tone}">${pri.label}</span>` : ''}</div>
        </div>
        <div class="actions">
          <span class="drag-handle" data-drag-id="${t.id}" title="드래그해서 바탕화면에 놓으면 작은 위젯으로 열려요">${DRAG_HANDLE_ICON}</span>
          <button class="btn-icon" data-action="delete" data-id="${t.id}" title="삭제">${TRASH_ICON}</button>
        </div>
      </div>`;
  }

  function bindCardActions(container) {
    container.querySelectorAll('[data-action="toggle"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const prevChecked = !cb.checked;
        try {
          await window.itda.todos.toggle(Number(cb.dataset.id));
          await refresh();
        } catch (e) {
          cb.checked = prevChecked;
          errorToast(e, '상태를 변경하지 못했어요');
        }
      });
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.todos.delete(Number(btn.dataset.id));
          toast('휴지통으로 이동했어요');
          await refresh();
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });
    });
    container.querySelectorAll('[data-action="favorite"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.todos.toggleFavorite(Number(btn.dataset.id));
          await refresh();
        } catch (e) {
          errorToast(e, '중요 표시를 변경하지 못했어요');
        }
      });
    });
    container.querySelectorAll('[data-action="move-next"],[data-action="move-prev"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const todo = allTodos.find((t) => t.id === id);
        if (!todo) return;
        const order = ['todo', 'doing', 'done'];
        const idx = order.indexOf(todo.status || 'todo');
        const dir = btn.dataset.action === 'move-next' ? 1 : -1;
        const nextStatus = order[idx + dir];
        if (!nextStatus) return;
        try {
          await window.itda.todos.setStatus({ id, status: nextStatus });
          await refresh();
        } catch (e) {
          errorToast(e, '상태를 변경하지 못했어요');
        }
      });
    });

    container.querySelectorAll('.todo-card,.kanban-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('input,button')) return; // 체크박스/별표/삭제/이동 버튼 클릭은 패널을 열지 않음
        openPanel(Number(card.dataset.id));
      });
    });

    // 카드를 바탕화면으로 드래그해서 놓으면 낱개 위젯으로 열림 (손잡이 아이콘에만 적용)
    container.querySelectorAll('.drag-handle[data-drag-id]').forEach((handle) => {
      attachDragOut(handle, () => ({ type: 'todo', id: Number(handle.dataset.dragId) }));
    });

    // 우클릭 컨텍스트 메뉴 (기한없는 Todo는 빠른 날짜 액션도 추가 / 연결/위젯으로 보기/삭제)
    container.querySelectorAll('.todo-card,.kanban-card').forEach((card) => {
      attachContextMenu(
        card,
        () => {
          const id = Number(card.dataset.id);
          const t = allTodos.find((x) => x.id === id);
          return { type: 'todo', id, dueDate: t?.due_date || null, isDone: !!t?.is_done };
        },
        {
          onDeleted: (item) => {
            if (selectedTodoId === item.id) closePanel();
            refresh();
          },
          onPickDate: async (item) => {
            await openPanel(item.id);
            const dueInput = $('tp-due');
            if (dueInput?.showPicker) dueInput.showPicker();
            else dueInput?.focus();
          },
        }
      );
    });
  }

  function renderList() {
    const listEl = $('t-list');
    const filtered = applyFilters(allTodos);
    if (filtered.length === 0) {
      listEl.innerHTML = emptyStateBlock({
        icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
        ...EMPTY_MESSAGES[currentFilter],
      });
      return;
    }
    listEl.innerHTML = filtered.map((t) => renderCard(t, { boardMode: false })).join('');
    bindCardActions(listEl);
  }

  function renderBoard() {
    const listEl = $('t-list');
    const filtered = applyFilters(allTodos);
    const columns = { todo: [], doing: [], done: [] };
    filtered.forEach((t) => {
      const s = ['todo', 'doing', 'done'].includes(t.status) ? t.status : t.is_done ? 'done' : 'todo';
      columns[s].push(t);
    });

    listEl.innerHTML = `
      <div class="kanban-board">
        ${Object.entries(columns)
          .map(
            ([status, items]) => `
          <div class="kanban-column">
            <div class="kanban-column-head">
              <span class="kanban-column-title">${STATUS_LABEL[status]}</span>
              <span class="kanban-column-count">${items.length}</span>
            </div>
            <div class="kanban-column-body">
              ${items.length ? items.map((t) => renderCard(t, { boardMode: true })).join('') : `<div class="kanban-empty">없음</div>`}
            </div>
          </div>`
          )
          .join('')}
      </div>`;
    bindCardActions(listEl);
  }

  // ---------- 상세 패널 ----------
  async function openPanel(id) {
    selectedTodoId = id;
    root.querySelector('.todo-layout')?.classList.add('panel-open');
    $('t-panel').innerHTML = `<div class="empty">불러오는 중…</div>`;
    try {
      const todo = await window.itda.todos.get(id);
      if (!todo || todo.deleted_at) {
        closePanel();
        return;
      }
      renderPanel(todo);
    } catch (e) {
      errorToast(e, '상세 정보를 불러오지 못했어요');
      closePanel();
    }
  }

  function closePanel() {
    selectedTodoId = null;
    root.querySelector('.todo-layout')?.classList.remove('panel-open');
    $('t-panel').innerHTML = '';
  }

  function renderPanel(todo) {
    const categoryOptions =
      `<option value="">카테고리 없음</option>` +
      categories.map((c) => `<option value="${c.id}" ${todo.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

    const subtasksHtml = (todo.subtasks || [])
      .map(
        (s) => `
        <div class="subtask-row ${s.is_done ? 'done' : ''}" data-subtask-id="${s.id}">
          <input type="checkbox" data-action="subtask-toggle" data-id="${s.id}" ${s.is_done ? 'checked' : ''} />
          <span>${escapeHtml(s.title)}</span>
          <button class="btn-icon" data-action="subtask-delete" data-id="${s.id}" title="삭제">${SMALL_TRASH_ICON}</button>
        </div>`
      )
      .join('');

    $('t-panel').innerHTML = `
      <div class="panel-head">
        <span class="panel-eyebrow">할 일 상세</span>
        <button class="btn-icon" id="tp-close" title="닫기">${CLOSE_ICON}</button>
      </div>

      <input type="text" id="tp-title" class="input panel-title-input" value="${escapeHtml(todo.title)}" />

      <div class="panel-field-grid">
        <label>카테고리<select id="tp-category" class="select">${categoryOptions}</select></label>
        <label>마감일<input type="date" id="tp-due" class="input" value="${todo.due_date || ''}" /></label>
        <label>우선순위
          <select id="tp-priority" class="select">
            <option value="1" ${todo.priority === 1 ? 'selected' : ''}>높음</option>
            <option value="2" ${todo.priority === 2 ? 'selected' : ''}>보통</option>
            <option value="3" ${todo.priority === 3 ? 'selected' : ''}>낮음</option>
          </select>
        </label>
        <label>상태
          <select id="tp-status" class="select">
            <option value="todo" ${todo.status === 'todo' ? 'selected' : ''}>해야 할 일</option>
            <option value="doing" ${todo.status === 'doing' ? 'selected' : ''}>진행 중</option>
            <option value="done" ${todo.status === 'done' ? 'selected' : ''}>완료</option>
          </select>
        </label>
        <label>반복
          ${
            todo.recurrence_parent_id
              ? `<div class="badge badge-neutral" style="align-self:flex-start;">${RECURRENCE_LABEL[todo.recurrence_rule] || '반복'} 시리즈의 일부</div>`
              : todo.recurrence_rule
                ? `<div class="badge badge-neutral" style="align-self:flex-start;">${RECURRENCE_LABEL[todo.recurrence_rule]} (원본)</div>`
                : `<select id="tp-recurrence" class="select" ${todo.due_date ? '' : 'disabled title="먼저 마감일을 정해주세요"'}>
                <option value="">안 함</option>
                <option value="daily">매일</option>
                <option value="weekly">매주 같은 요일</option>
                <option value="monthly">매월 같은 날짜</option>
              </select>`
          }
        </label>
      </div>

      <label class="panel-section-label">설명</label>
      <textarea id="tp-memo" class="input panel-memo" placeholder="메모를 남겨보세요">${escapeHtml(todo.memo || '')}</textarea>

      <label class="panel-section-label">하위 할 일</label>
      <div class="subtask-list" id="tp-subtaskList">${subtasksHtml || '<div class="subtask-empty">하위 할 일이 없어요</div>'}</div>
      <div class="subtask-add-row">
        <input type="text" id="tp-subtaskInput" class="input" placeholder="하위 할 일 추가 후 Enter" />
      </div>

      <label class="panel-section-label">🔗 연결된 항목</label>
      <div id="tp-links"></div>

      <div class="panel-footer">
        <span class="panel-meta">생성일: ${(todo.created_at || '').slice(0, 10)}</span>
        <button class="btn-secondary panel-delete-btn" id="tp-delete">${TRASH_ICON} 삭제</button>
      </div>
    `;

    bindPanelEvents(todo);
    mountLinksWidget($('tp-links'), { type: 'todo', id: todo.id });
  }

  function bindPanelEvents(todo) {
    const panel = $('t-panel');

    $('tp-close').addEventListener('click', closePanel);

    async function saveField(payload) {
      try {
        await window.itda.todos.update({ id: todo.id, ...payload });
        await refresh(); // 목록/보드의 배지도 즉시 동기화
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
      }
    }

    let titleTimer = null;
    $('tp-title').addEventListener('input', (e) => {
      clearTimeout(titleTimer);
      const value = e.target.value;
      titleTimer = setTimeout(() => {
        if (!value.trim()) return;
        saveField({ title: value });
      }, 500);
    });

    $('tp-category').addEventListener('change', (e) => {
      saveField({ categoryId: e.target.value ? Number(e.target.value) : null });
    });
    $('tp-due').addEventListener('change', (e) => {
      saveField({ dueDate: e.target.value || null });
    });
    attachDateQuickChips($('tp-due'));

    const recurrenceSelect = $('tp-recurrence');
    if (recurrenceSelect) {
      recurrenceSelect.addEventListener('change', async () => {
        const rule = recurrenceSelect.value;
        if (!rule) return; // "안 함"으로 되돌리는 건 아직 지원 안 함(반복 켜는 것만)
        try {
          await window.itda.todos.setRecurrence({ id: todo.id, rule });
          toast(`${RECURRENCE_LABEL[rule]} 반복으로 설정했어요`);
          await openPanel(todo.id); // 부모 상태가 바뀌었으니 패널을 다시 그려서 "반복 중" 배지로 바꿈
          await refresh();
        } catch (e) {
          errorToast(e, '반복을 설정하지 못했어요');
          recurrenceSelect.value = '';
        }
      });
    }
    $('tp-priority').addEventListener('change', (e) => {
      saveField({ priority: Number(e.target.value) });
    });
    $('tp-status').addEventListener('change', async (e) => {
      try {
        await window.itda.todos.setStatus({ id: todo.id, status: e.target.value });
        await refresh();
      } catch (err) {
        errorToast(err, '상태를 변경하지 못했어요');
      }
    });

    let memoTimer = null;
    $('tp-memo').addEventListener('input', (e) => {
      clearTimeout(memoTimer);
      const value = e.target.value;
      memoTimer = setTimeout(() => saveField({ memo: value }), 500);
    });

    panel.querySelectorAll('[data-action="subtask-toggle"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        try {
          await window.itda.todoSubtasks.toggle(Number(cb.dataset.id));
          const fresh = await window.itda.todos.get(todo.id);
          renderPanel(fresh);
        } catch (e) {
          errorToast(e, '하위 할 일을 변경하지 못했어요');
        }
      });
    });
    panel.querySelectorAll('[data-action="subtask-delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.todoSubtasks.delete(Number(btn.dataset.id));
          const fresh = await window.itda.todos.get(todo.id);
          renderPanel(fresh);
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });
    });

    $('tp-subtaskInput').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const value = e.target.value.trim();
      if (!value) return;
      try {
        await window.itda.todoSubtasks.add({ todoId: todo.id, title: value });
        const fresh = await window.itda.todos.get(todo.id);
        renderPanel(fresh);
      } catch (err) {
        errorToast(err, '하위 할 일을 추가하지 못했어요');
      }
    });

    $('tp-delete').addEventListener('click', async () => {
      const isRecurring = !!(todo.recurrence_rule || todo.recurrence_parent_id);
      let scope = 'this';
      if (isRecurring) {
        const picked = await confirmSeriesScope($('tp-delete'));
        if (!picked) return; // 취소
        scope = picked;
      }
      try {
        if (scope === 'following') await window.itda.todos.deleteSeries({ id: todo.id, scope: 'following' });
        else await window.itda.todos.delete(todo.id);
        toast(scope === 'following' ? '이후 반복 항목을 모두 휴지통으로 옮겼어요' : '휴지통으로 이동했어요');
        closePanel();
        await refresh();
      } catch (e) {
        errorToast(e, '삭제하지 못했어요');
      }
    });
  }

  async function refresh() {
    try {
      allTodos = await window.itda.todos.list({});
    } catch (e) {
      errorToast(e, '할 일 목록을 불러오지 못했어요');
      $('t-list').innerHTML = emptyStateBlock({ title: '목록을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (currentView === 'board') renderBoard();
    else renderList();
  }

  async function handleAdd() {
    if (busy) return;
    const titleInput = $('t-title');
    const title = titleInput.value.trim();
    if (!title) {
      toast('할 일 제목을 입력해주세요.');
      titleInput.focus();
      return;
    }
    const categoryId = $('t-category').value ? Number($('t-category').value) : null;
    const dueDate = $('t-due').value || null;
    const priority = Number($('t-priority').value);

    busy = true;
    $('t-addBtn').disabled = true;
    try {
      await window.itda.todos.add({ title, categoryId, dueDate, priority });
      titleInput.value = '';
      $('t-due').value = '';
      await refresh();
    } catch (e) {
      errorToast(e, '할 일을 추가하지 못했어요');
    } finally {
      busy = false;
      $('t-addBtn').disabled = false;
    }
  }

  $('t-addBtn').addEventListener('click', handleAdd);
  $('t-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdd();
  });

  root.querySelectorAll('#t-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('#t-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      refresh();
    });
  });

  $('t-categoryFilter').addEventListener('change', (e) => {
    currentCategoryId = e.target.value;
    refresh();
  });

  root.querySelectorAll('#t-viewToggle .view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('#t-viewToggle .view-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      refresh();
    });
  });

  bindWidgetLaunchButton(root, 't-widgetBtn', 'today-todo');
  const unsubscribeEsc = registerEscClose(() => selectedTodoId !== null, closePanel);

  await loadCategories();
  await refresh();

  // 위젯(낱개 todo-item 창 등)이나 다른 창에서 이 화면의 todo가 바뀌었을 때 목록에 반영.
  // 지금 사용자가 뭔가 입력 중이면(제목 입력창 등) 그 순간엔 미루고 다음 변경 때 반영한다.
  // debounce: 체크박스 토글 등 이 화면 자신이 만든 액션도 브로드캐스트로 되돌아와 이중 새로고침을
  // 만들 수 있어서, 짧은 시간 안의 연속 호출은 하나로 합친다.
  const debouncedRefresh = debounce(refresh, 200);
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'todo') return;
    if (isUserTyping()) return;
    debouncedRefresh();
  });

  return () => {
    unsubscribeEsc();
    offDataChanged?.();
  };
}
