import { escapeHtml, toast, errorToast, formatDueBadge, priorityBadge, emptyStateBlock, isUserTyping, debounce, formatRelative } from '../shared/ui-utils.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { registerEscClose } from '../shared/esc-close.js';
import { attachDragOut, DRAG_HANDLE_ICON } from '../shared/drag-out.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { attachDateQuickChips } from '../shared/date-quick-chips.js';
import { confirmSeriesScope } from '../shared/series-scope.js';
import { openCreateEventModal } from '../shared/create-event-modal.js';
import { openCreateTodoModal } from '../shared/create-todo-modal.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { startOfWeek, dateKey } from '../shared/date-utils.js';

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
const PLUS_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
const SMALL_TRASH_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

const EMPTY_MESSAGES = {
  all: { title: '할 일이 없어요', subtitle: 'Inbox에서 정리하거나 여기서 바로 추가해보세요' },
  today: { title: '오늘 마감인 할 일이 없어요', subtitle: '여유로운 하루네요' },
  upcoming: { title: '예정된 할 일이 없어요', subtitle: '마감일을 정해두면 여기 모여요' },
  favorite: { title: '중요 표시한 할 일이 없어요', subtitle: '별 아이콘을 눌러 중요한 일을 표시해보세요' },
  done: { title: '완료한 할 일이 아직 없어요', subtitle: '체크하면 여기에 모여요' },
};

const STATUS_LABEL = { todo: '해야 할 일', doing: '진행 중', done: '최근 완료' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const RECENT_DONE_CAP = 5; // 메인 "최근 완료" 컬럼에 한 번에 보이는 최대 개수
const ARCHIVE_HARD_CAP = 200; // 완료 기록 한 화면 최대(그 이상은 검색/기간으로 좁히도록)

// 완료 시각 → 짧은 표시. 1시간 내 "방금/N분 전", 오늘/어제는 시각, 그 이전은 M/D.
function doneWhen(ts) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 60) return formatRelative(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = dateKey(new Date());
  const key = dateKey(d);
  if (key === today) return `오늘 ${hm}`;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dateKey(y)) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 완료 기록 날짜 그룹 헤더 — "2026년 9월 8일 (화)"
function archiveDateLabel(key) {
  const d = new Date(key + 'T00:00:00');
  if (isNaN(d.getTime())) return '날짜 미상';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
}

// archiveMode(immediate|7d|30d|never) → "최근 완료"에 보일 가장 오래된 날짜(YYYY-MM-DD). never면 null.
function archiveCutoff(mode) {
  const d = new Date();
  if (mode === '7d') d.setDate(d.getDate() - 7);
  else if (mode === '30d') d.setDate(d.getDate() - 30);
  else if (mode === 'never') return null;
  else return dateKey(new Date()); // immediate = 오늘 완료분만
  return dateKey(d);
}

export async function mount(root, deepLinkId) {
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
      <button class="notes-new-btn" id="t-newModalBtn" title="새 할 일 (팝업으로 작성)">${PLUS_ICON}</button>
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

    <div class="todo-layout" id="t-mainLayout">
      <div class="todo-main">
        <div class="todo-filter-row">
          <div class="tabs" id="t-tabs">
            <button class="tab active" data-filter="all">전체</button>
            <button class="tab" data-filter="today">오늘</button>
            <button class="tab" data-filter="upcoming">예정</button>
            <button class="tab" data-filter="favorite">중요</button>
            <button class="tab" data-filter="archive">완료</button>
          </div>
          <select id="t-categoryFilter" class="select"><option value="">전체 카테고리</option></select>
        </div>

        <div id="t-list"><div class="empty">불러오는 중…</div></div>

        <a class="todo-archive-bar" id="t-archiveBar" href="#">
          <span>완료된 업무는 <b>완료 기록</b>에서 확인할 수 있어요.</span>
          <span class="todo-archive-bar-link">완료 기록 보기 →</span>
        </a>
      </div>

      <div class="todo-detail-panel" id="t-panel"></div>
    </div>

    <section class="todo-archive" id="t-archive" hidden>
      <div class="todo-archive-head">
        <button class="btn-icon" id="ta-back" title="할 일 목록으로">${CHEVRON_LEFT}</button>
        <div class="todo-archive-head-text">
          <h2>완료 기록</h2>
          <p>완료된 업무를 날짜별로 확인하고 검색할 수 있어요.</p>
        </div>
        <select id="ta-order" class="select">
          <option value="recent">최신순</option>
          <option value="oldest">오래된순</option>
        </select>
      </div>
      <input type="text" id="ta-search" class="input" placeholder="완료 항목 검색하기 (제목, 내용, 카테고리 등)" autocomplete="off" />
      <div class="todo-filter-row">
        <div class="tabs" id="ta-period">
          <button class="tab active" data-period="all">전체</button>
          <button class="tab" data-period="today">오늘</button>
          <button class="tab" data-period="week">이번 주</button>
          <button class="tab" data-period="month">이번 달</button>
          <button class="tab" data-period="custom">기간 선택</button>
        </div>
      </div>
      <div class="todo-archive-range" id="ta-customRange" hidden>
        <input type="date" id="ta-from" class="input" /> ~ <input type="date" id="ta-to" class="input" />
      </div>
      <div id="ta-list"><div class="empty">불러오는 중…</div></div>
    </section>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let categories = [];
  let allTodos = [];
  let currentFilter = 'all';
  let currentCategoryId = '';
  let currentView = 'board'; // 프로그램 전체에서 Todo는 기본적으로 칸반 보드로 시작 (요청에 따름)
  let busy = false; // 이중 클릭으로 같은 요청이 중복 발생하지 않도록
  let unmounted = false; // 비동기 콜백이 화면 전환 뒤에 도착했을 때 크래시 방지
  let selectedTodoId = null;
  let archiveMode = 'immediate'; // 완료 항목 보관 모드(설정에서) — "최근 완료" 컬럼에 보일 기간
  let screen = 'main'; // 'main' | 'archive'
  const archiveState = { keyword: '', period: 'all', from: null, to: null, order: 'recent' };
  const archiveCollapsedDates = new Set(); // 완료 기록에서 접어둔 날짜 그룹(세션 한정)
  const collapsedIds = new Set(); // 접어둔 카드(항목별 접기/펼치기) — 화면을 나가면 초기화되는 세션 상태
  const collapsedColumns = new Set(); // 접어둔 보드 컬럼 — "최근 완료"는 작아서 기본 펼침

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

  // 메인 화면은 "앞으로 해야 할 일" 공간 — 완료 항목은 제외한다(완료는 "최근 완료" 컬럼 / "완료 기록"에서).
  function applyFilters(todos) {
    let list = todos.filter((t) => !t.is_done);
    if (currentCategoryId) list = list.filter((t) => String(t.category_id) === String(currentCategoryId));
    if (currentFilter === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => t.due_date === today);
    } else if (currentFilter === 'upcoming') {
      const today = new Date().toISOString().slice(0, 10);
      list = list.filter((t) => t.due_date && t.due_date > today);
    } else if (currentFilter === 'favorite') {
      list = list.filter((t) => t.is_favorite);
    }
    return list;
  }

  // "최근 완료" 컬럼/섹션에 넣을 항목 — completed_at 최신순, 보관 모드 컷오프 이후, 최대 N개.
  function recentCompleted(cap = RECENT_DONE_CAP) {
    const cutoff = archiveCutoff(archiveMode); // null = 전부(never)
    let done = allTodos
      .filter((t) => t.is_done)
      .filter((t) => {
        if (currentCategoryId && String(t.category_id) !== String(currentCategoryId)) return false;
        if (!cutoff) return true;
        const when = (t.completed_at || t.updated_at || '').slice(0, 10);
        return when >= cutoff;
      })
      .sort((a, b) => (b.completed_at || b.updated_at || '').localeCompare(a.completed_at || a.updated_at || ''));
    const shownCap = archiveMode === 'never' ? 50 : cap;
    return { items: done.slice(0, shownCap), moreThanCap: done.length > shownCap };
  }

  function totalDoneCount() {
    return allTodos.filter((t) => t.is_done).length;
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

    const collapsed = collapsedIds.has(t.id);
    const collapseBtn = `<button class="btn-icon todo-collapse-btn ${collapsed ? '' : 'expanded'}" data-action="toggle-collapse" data-id="${t.id}" title="접기/펼치기">${CHEVRON_RIGHT}</button>`;

    if (boardMode) {
      return `
        <div class="kanban-card ${collapsed ? 'collapsed' : ''}" data-id="${t.id}">
          <div class="kanban-card-top">
            <input type="checkbox" class="kanban-card-check" data-action="toggle" data-id="${t.id}" ${t.is_done ? 'checked' : ''} title="완료" />
            <div class="kanban-card-badges">${catPill}${pri ? `<span class="badge badge-${pri.tone}">${pri.label}</span>` : ''}</div>
            <div class="kanban-card-top-right">
              ${collapseBtn}
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
      <div class="list-row todo-card ${t.is_done ? 'done' : ''} ${collapsed ? 'collapsed' : ''}" data-id="${t.id}">
        <input type="checkbox" data-action="toggle" data-id="${t.id}" ${t.is_done ? 'checked' : ''} />
        <div class="main">
          <div class="todo-card-title-row">
            <b>${escapeHtml(t.title)}</b>
            <button class="star-btn ${t.is_favorite ? 'active' : ''}" data-action="favorite" data-id="${t.id}" title="중요 표시">${t.is_favorite ? STAR_ICON : STAR_OUTLINE_ICON}</button>
          </div>
          <div class="meta">${catPill}${dueBadge}${pri ? `<span class="badge badge-${pri.tone}">${pri.label}</span>` : ''}</div>
        </div>
        <div class="actions">
          ${collapseBtn}
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
        if (e.target.closest('input,button')) return; // 체크박스/별표/삭제/이동/접기 버튼 클릭은 패널을 열지 않음
        openPanel(Number(card.dataset.id));
      });
    });

    // 항목별 접기/펼치기 — 다시 그리기 없이 그 카드 하나만 즉시 토글(collapsedIds는 세션 동안만 기억)
    container.querySelectorAll('[data-action="toggle-collapse"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const card = btn.closest('.todo-card,.kanban-card');
        if (collapsedIds.has(id)) collapsedIds.delete(id);
        else collapsedIds.add(id);
        const nowCollapsed = collapsedIds.has(id);
        card.classList.toggle('collapsed', nowCollapsed);
        btn.classList.toggle('expanded', !nowCollapsed);
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

  // "최근 완료"용 압축 행 (체크 해제하면 다시 활성으로 — bindCardActions의 toggle 재사용)
  function renderDoneRow(t) {
    const catPill = t.category_name
      ? `<span class="cat-pill" style="background:${t.color_hex};color:#fff;">${escapeHtml(t.category_name)}</span>`
      : '';
    return `
      <div class="todo-done-row" data-id="${t.id}">
        <input type="checkbox" data-action="toggle" data-id="${t.id}" checked title="완료 해제" />
        <span class="todo-done-row-title">${escapeHtml(t.title)}</span>
        ${catPill}
        <span class="todo-done-row-when">${doneWhen(t.completed_at || t.updated_at)}</span>
      </div>`;
  }

  function doneColumnFooter() {
    const total = totalDoneCount();
    if (!total) return '';
    return `<a class="todo-done-more" id="t-doneMore" href="#">완료 ${total}건 · 완료 기록 보기 →</a>`;
  }

  function renderList() {
    const listEl = $('t-list');
    const filtered = applyFilters(allTodos);
    const recent = recentCompleted();
    const activeHtml = filtered.length
      ? filtered.map((t) => renderCard(t, { boardMode: false })).join('')
      : emptyStateBlock({
          icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
          ...EMPTY_MESSAGES[currentFilter],
        });
    // 완료 섹션은 '전체' 탭에서만 곁들여 보여준다(다른 탭은 그 조건에 집중).
    const doneHtml =
      currentFilter === 'all' && recent.items.length
        ? `<div class="todo-recent-done">
             <div class="todo-recent-done-head"><span>최근 완료</span><span class="kanban-column-count">${recent.items.length}</span></div>
             ${recent.items.map(renderDoneRow).join('')}
             ${doneColumnFooter()}
           </div>`
        : '';
    listEl.innerHTML = activeHtml + doneHtml;
    bindCardActions(listEl);
    wireDoneMore(listEl);
  }

  function renderBoard() {
    const listEl = $('t-list');
    const filtered = applyFilters(allTodos);
    const columns = { todo: [], doing: [] };
    filtered.forEach((t) => {
      const s = t.status === 'doing' ? 'doing' : 'todo';
      columns[s].push(t);
    });
    const recent = recentCompleted();

    const activeCol = (status) => {
      const items = columns[status];
      const collapsed = collapsedColumns.has(status);
      return `
        <div class="kanban-column ${collapsed ? 'collapsed' : ''}">
          <div class="kanban-column-head">
            <button class="btn-icon todo-collapse-btn ${collapsed ? '' : 'expanded'}" data-action="toggle-column" data-status="${status}" title="컬럼 접기/펼치기">${CHEVRON_RIGHT}</button>
            <span class="kanban-column-title">${STATUS_LABEL[status]}</span>
            <span class="kanban-column-count">${items.length}</span>
          </div>
          <div class="kanban-column-body">
            ${items.length ? items.map((t) => renderCard(t, { boardMode: true })).join('') : `<div class="kanban-empty">없음</div>`}
          </div>
        </div>`;
    };

    const doneCollapsed = collapsedColumns.has('done');
    const doneCol = `
      <div class="kanban-column ${doneCollapsed ? 'collapsed' : ''}">
        <div class="kanban-column-head">
          <button class="btn-icon todo-collapse-btn ${doneCollapsed ? '' : 'expanded'}" data-action="toggle-column" data-status="done" title="컬럼 접기/펼치기">${CHEVRON_RIGHT}</button>
          <span class="kanban-column-title">최근 완료</span>
          <span class="kanban-column-count">${recent.items.length}</span>
          <a class="kanban-column-more" id="t-doneMoreHead" href="#" title="완료 기록 열기">더보기 ›</a>
        </div>
        <div class="kanban-column-body">
          ${recent.items.length ? recent.items.map(renderDoneRow).join('') : `<div class="kanban-empty">완료한 일이 여기 잠깐 모여요</div>`}
        </div>
        ${doneColumnFooter()}
      </div>`;

    listEl.innerHTML = `<div class="kanban-board">${activeCol('todo')}${activeCol('doing')}${doneCol}</div>`;
    bindCardActions(listEl);
    wireDoneMore(listEl);

    listEl.querySelectorAll('[data-action="toggle-column"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        const column = btn.closest('.kanban-column');
        if (collapsedColumns.has(status)) collapsedColumns.delete(status);
        else collapsedColumns.add(status);
        const nowCollapsed = collapsedColumns.has(status);
        column.classList.toggle('collapsed', nowCollapsed);
        btn.classList.toggle('expanded', !nowCollapsed);
      });
    });
  }

  function wireDoneMore(container) {
    container.querySelectorAll('#t-doneMore, #t-doneMoreHead').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        openArchive();
      });
    });
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
        <button class="btn-secondary" id="tp-toEvent" title="이 할 일 내용으로 일정을 등록해요">📅 일정으로 만들기</button>
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

    $('tp-toEvent').addEventListener('click', async () => {
      // 일정 생성 + Todo와의 연결을 서버에서 한 트랜잭션으로 처리(link 옵션)
      const newEvent = await openCreateEventModal({
        title: todo.title,
        memo: todo.memo || '',
        dueDate: todo.due_date || null,
        link: { type: 'todo', id: todo.id },
      });
      if (!newEvent) return; // 취소
      try {
        const fresh = await window.itda.todos.get(todo.id);
        renderPanel(fresh); // 연결된 항목 목록에 방금 만든 일정이 바로 보이도록 다시 그림
      } catch (e) {
        errorToast(e, '목록을 새로고침하지 못했어요');
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
    if (unmounted || !$('t-list')) return;
    try {
      archiveMode = (await window.itda.settings.get('todo_archive_mode')) || 'immediate';
    } catch (e) {
      archiveMode = 'immediate';
    }
    try {
      allTodos = await window.itda.todos.list({});
    } catch (e) {
      errorToast(e, '할 일 목록을 불러오지 못했어요');
      const le = $('t-list');
      if (le) le.innerHTML = emptyStateBlock({ title: '목록을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (unmounted || !$('t-list')) return;
    if (screen === 'archive') loadArchive();
    if (currentView === 'board') renderBoard();
    else renderList();
  }

  // ---------- 완료 기록 ----------
  function openArchive() {
    screen = 'archive';
    $('t-mainLayout').hidden = true;
    root.querySelector('.form-row').hidden = true;
    $('t-viewToggle').hidden = true;
    $('t-newModalBtn').hidden = true;
    $('t-archive').hidden = false;
    closePanel();
    $('ta-search').focus();
    loadArchive();
  }

  function closeArchive() {
    screen = 'main';
    $('t-archive').hidden = true;
    $('t-mainLayout').hidden = false;
    root.querySelector('.form-row').hidden = false;
    $('t-viewToggle').hidden = false;
    $('t-newModalBtn').hidden = false;
    root.querySelectorAll('#t-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.filter === currentFilter));
  }

  // 기간칩 → from/to(YYYY-MM-DD) 계산
  function resolveArchivePeriod() {
    const today = dateKey(new Date());
    if (archiveState.period === 'today') {
      archiveState.from = archiveState.to = today;
    } else if (archiveState.period === 'week') {
      archiveState.from = dateKey(startOfWeek(new Date()));
      archiveState.to = today;
    } else if (archiveState.period === 'month') {
      const d = new Date();
      archiveState.from = dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
      archiveState.to = today;
    } else if (archiveState.period === 'custom') {
      archiveState.from = $('ta-from').value || null;
      archiveState.to = $('ta-to').value || null;
    } else {
      archiveState.from = archiveState.to = null;
    }
  }

  async function loadArchive() {
    if (unmounted) return;
    resolveArchivePeriod();
    let res;
    try {
      res = await window.itda.todos.listCompleted({
        keyword: archiveState.keyword.trim() || null,
        from: archiveState.from,
        to: archiveState.to,
        order: archiveState.order,
      });
    } catch (e) {
      errorToast(e, '완료 기록을 불러오지 못했어요');
      return;
    }
    if (unmounted || screen !== 'archive') return;
    renderArchive(res.items || []);
  }

  function renderArchive(items) {
    const listEl = $('ta-list');
    if (!items.length) {
      listEl.innerHTML = emptyStateBlock({
        title: archiveState.keyword.trim() ? '검색 결과가 없어요' : '완료한 업무가 없어요',
        subtitle: archiveState.keyword.trim() ? '다른 검색어나 기간으로 찾아보세요' : '할 일을 체크하면 여기에 날짜별로 쌓여요',
      });
      return;
    }
    const capped = items.slice(0, ARCHIVE_HARD_CAP);
    // 날짜별 그룹 (입력이 이미 정렬돼 있으므로 순서 유지)
    const groups = [];
    const idx = {};
    capped.forEach((t) => {
      const key = (t.archived_at || '').slice(0, 10) || '날짜미상';
      if (idx[key] === undefined) {
        idx[key] = groups.length;
        groups.push({ key, items: [] });
      }
      groups[idx[key]].items.push(t);
    });

    const kwNote = archiveState.keyword.trim() ? `<div class="todo-archive-count">검색 결과 ${items.length}건</div>` : '';
    listEl.innerHTML =
      kwNote +
      groups
        .map((g) => {
          const collapsed = archiveCollapsedDates.has(g.key);
          return `
        <div class="todo-archive-group ${collapsed ? 'collapsed' : ''}" data-date="${g.key}">
          <button class="todo-archive-group-head" data-action="toggle-date">
            <span class="todo-collapse-btn ${collapsed ? '' : 'expanded'}">${CHEVRON_RIGHT}</span>
            <span>${g.key === '날짜미상' ? '날짜 미상' : archiveDateLabel(g.key)}</span>
            <span class="kanban-column-count">${g.items.length}건</span>
          </button>
          <div class="todo-archive-group-body">
            ${g.items.map(renderArchiveRow).join('')}
          </div>
        </div>`;
        })
        .join('') +
      (items.length > ARCHIVE_HARD_CAP
        ? `<div class="todo-archive-count">${ARCHIVE_HARD_CAP}건까지 표시했어요. 검색어나 기간으로 좁혀보세요.</div>`
        : '');

    listEl.querySelectorAll('[data-action="toggle-date"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.todo-archive-group');
        const key = group.dataset.date;
        if (archiveCollapsedDates.has(key)) archiveCollapsedDates.delete(key);
        else archiveCollapsedDates.add(key);
        group.classList.toggle('collapsed', archiveCollapsedDates.has(key));
        btn.querySelector('.todo-collapse-btn').classList.toggle('expanded', !archiveCollapsedDates.has(key));
      });
    });
    listEl.querySelectorAll('.todo-archive-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input,button')) return;
        openArchivePanel(Number(row.dataset.id));
      });
    });
    listEl.querySelectorAll('.todo-archive-row [data-action="toggle"]').forEach((cb) => {
      cb.addEventListener('change', async () => {
        try {
          await window.itda.todos.toggle(Number(cb.dataset.id));
          await refresh();
        } catch (e) {
          cb.checked = true;
          errorToast(e, '상태를 변경하지 못했어요');
        }
      });
    });
  }

  function renderArchiveRow(t) {
    const catPill = t.category_name
      ? `<span class="cat-pill" style="background:${t.color_hex};color:#fff;">${escapeHtml(t.category_name)}</span>`
      : '';
    const hm = (t.archived_at || '').slice(11, 16);
    return `
      <div class="todo-archive-row" data-id="${t.id}">
        <input type="checkbox" data-action="toggle" data-id="${t.id}" checked title="완료 해제" />
        <span class="todo-archive-row-title">${escapeHtml(t.title)}</span>
        ${catPill}
        <span class="todo-archive-row-time">${hm}</span>
      </div>`;
  }

  // 완료 기록에서 항목 클릭 → 메인 레이아웃으로 돌아가 상세 패널을 연다(기존 openPanel 재사용).
  async function openArchivePanel(id) {
    closeArchive();
    await openPanel(id);
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

  // 상단 빠른 추가 행과 별개로, "+" 팝업으로도 새 할 일을 만들 수 있다 — 이미 있는
  // Todo 전환 팝업(create-todo-modal.js)을 그대로 재사용(Esc/취소 버튼으로만 닫힘).
  async function openNewTodoModal() {
    const newTodo = await openCreateTodoModal({});
    if (!newTodo) return; // 취소
    await refresh();
  }
  $('t-newModalBtn').addEventListener('click', openNewTodoModal);

  // 일정/메모 화면과 동일하게, 입력 중이 아닐 때 '+' 로도 새 할 일 팝업 열기
  const handleQuickAddKey = (e) => {
    if (e.key !== '+' || e.metaKey || e.ctrlKey || e.altKey || isUserTyping()) return;
    e.preventDefault();
    openNewTodoModal();
  };
  document.addEventListener('keydown', handleQuickAddKey);
  setScreenShortcuts('Todo', [{ label: '새 할 일', keys: '+' }]);

  root.querySelectorAll('#t-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.filter === 'archive') {
        openArchive();
        return;
      }
      root.querySelectorAll('#t-tabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      refresh();
    });
  });

  // ---------- 완료 기록 화면 이벤트 ----------
  $('ta-back').addEventListener('click', closeArchive);
  $('t-archiveBar').addEventListener('click', (e) => {
    e.preventDefault();
    openArchive();
  });
  const debouncedArchive = debounce(loadArchive, 200);
  $('ta-search').addEventListener('input', (e) => {
    archiveState.keyword = e.target.value;
    debouncedArchive();
  });
  $('ta-order').addEventListener('change', (e) => {
    archiveState.order = e.target.value;
    loadArchive();
  });
  root.querySelectorAll('#ta-period .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('#ta-period .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      archiveState.period = tab.dataset.period;
      $('ta-customRange').hidden = archiveState.period !== 'custom';
      if (archiveState.period !== 'custom') loadArchive();
    });
  });
  const onArchiveDate = () => {
    if (archiveState.period === 'custom') loadArchive();
  };
  $('ta-from').addEventListener('change', onArchiveDate);
  $('ta-to').addEventListener('change', onArchiveDate);

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
  const unsubscribeEsc = registerEscClose(
    () => selectedTodoId !== null || screen === 'archive',
    () => (screen === 'archive' ? closeArchive() : closePanel())
  );

  await loadCategories();
  await refresh();

  // 딥링크: #/todo/archive → 완료 기록, #/todo/<id> → 그 Todo 상세(필터에 안 걸려도 보이게 '전체'로)
  if (deepLinkId === 'archive') {
    openArchive();
  } else {
    const id = Number(deepLinkId);
    if (Number.isInteger(id) && id > 0) {
      currentFilter = 'all';
      root.querySelectorAll('#t-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.filter === 'all'));
      renderList();
      openPanel(id);
    }
  }

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
    unmounted = true;
    unsubscribeEsc();
    offDataChanged?.();
    debouncedRefresh.cancel(); // 언마운트 직전 브로드캐스트로 걸린 타이머 정리
    document.removeEventListener('keydown', handleQuickAddKey);
    setScreenShortcuts(null, []);
  };
}
