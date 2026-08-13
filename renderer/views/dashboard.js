import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping } from '../shared/ui-utils.js';
import { STICKY_COLORS } from '../shared/theme.js';
import { periodLabel, queryRange, groupByDateKey, buildMonthGridHtml, buildCompactAgendaHtml } from './calendar.js';
import { computeNotifications } from '../shared/notifications.js';
import { computeRecentActivity } from '../shared/recent-activity.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { getUserName } from '../shared/shell.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';
import { mountEventDetailModal } from '../shared/event-detail-modal.js';

const CATEGORY_FALLBACK_COLOR = 'var(--text-faint)';
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const CHEVRON_LEFT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
const CHEVRON_RIGHT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
const PIN_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const WIDGET_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;
const LINK_ROW_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07l1.5-1.5"/></svg>`;

const TYPE_META = {
  todo: { label: 'Todo', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`, route: '#/todo' },
  event: { label: '일정', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`, route: '#/calendar' },
  memo: { label: '메모', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>`, route: '#/memo' },
  postit: { label: '포스트잇', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6l3-2 3 2V3"/></svg>`, route: '#/postit' },
};

function greetingByHour(hour) {
  if (hour < 6) return { icon: '🌙', text: '늦은 밤이네요' };
  if (hour < 12) return { icon: '🌤️', text: '좋은 아침입니다' };
  if (hour < 18) return { icon: '☀️', text: '좋은 오후입니다' };
  return { icon: '🌆', text: '수고 많으셨어요' };
}

function formatDateLabel(d) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_LABELS[d.getDay()]})`;
}
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isSameDate(a, b) {
  return toDateKey(a) === toDateKey(b);
}

export async function mount(root) {
  const now = new Date();
  const greeting = greetingByHour(now.getHours());
  const userName = await getUserName();
  let viewDate = new Date();
  viewDate.setHours(0, 0, 0, 0);

  root.innerHTML = `
    <div class="dash-layout" id="d-layout">
      <div class="dash-main">
        <div class="dash-header">
          <div class="dash-greeting">
            <div class="dash-greeting-icon">${greeting.icon}</div>
            <div>
              <h1 id="d-greetingText">${greeting.text}, ${escapeHtml(userName)}님!</h1>
              <p>오늘도 화이팅하세요 💪</p>
            </div>
          </div>
          <div class="dash-header-actions">
            <div class="date-nav">
              <button class="btn-icon" id="d-datePrev">${CHEVRON_LEFT}</button>
              <span id="d-dateLabel">${formatDateLabel(viewDate)}</span>
              <button class="btn-icon" id="d-dateNext">${CHEVRON_RIGHT}</button>
            </div>
            <span class="dash-time" id="d-timeNow"></span>
            ${widgetLaunchButtonHtml('d-ddayWidgetBtn', 'D-DAY 위젯 열기')}
            <button class="btn" id="d-newBtn">+ 새로 만들기</button>
          </div>
        </div>

        <div class="summary-grid summary-grid-5">
          <div class="summary-card">
            <div class="top"><span class="dot" style="background:var(--cat-meeting)"></span>오늘 할 일</div>
            <div class="num" id="d-todoCount">-</div>
            <div id="d-todoSub" style="font-size:11.5px;color:var(--text-faint);"></div>
          </div>
          <div class="summary-card">
            <div class="top"><span class="dot" style="background:var(--cat-counsel)"></span>오늘 일정</div>
            <div class="num" id="d-eventCount">-</div>
          </div>
          <div class="summary-card">
            <div class="top"><span class="dot" style="background:var(--cat-edu)"></span>메모</div>
            <div class="num" id="d-memoCount">-</div>
          </div>
          <div class="summary-card">
            <div class="top"><span class="dot" style="background:var(--cat-outpatient)"></span>포스트잇</div>
            <div class="num" id="d-postitCount">-</div>
          </div>
          <div class="summary-card">
            <div class="top"><span class="dot" style="background:var(--danger)"></span>알림</div>
            <div class="num" id="d-notifCount">-</div>
          </div>
        </div>

        <div class="content-grid">
          <div class="panel">
            <div class="panel-head"><h3>오늘 할 일</h3><a class="btn-icon" href="#/todo">더보기 ›</a></div>
            <div id="d-todoList"></div>
            <div class="empty" id="d-todoEmpty" style="display:none;">할 일이 없어요. Inbox에서 바로 추가해보세요.</div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>오늘 일정</h3><a class="btn-icon" href="#/calendar">더보기 ›</a></div>
            <div id="d-eventList"></div>
            <div class="empty" id="d-eventEmpty" style="display:none;">일정이 없어요.</div>
          </div>
          <div>
            <div class="panel" style="margin-bottom:14px;">
              <div class="panel-head"><h3>최근 메모</h3><a class="btn-icon" href="#/memo">더보기 ›</a></div>
              <div id="d-memoList"></div>
              <div class="empty" id="d-memoEmpty" style="display:none;">메모가 없어요.</div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>고정 포스트잇</h3><a class="btn-icon" href="#/postit">더보기 ›</a></div>
              <div id="d-postitList"></div>
              <div class="empty" id="d-postitEmpty" style="display:none;">고정된 포스트잇이 없어요.</div>
            </div>
          </div>
        </div>

        <div class="panel dash-linked-panel">
          <div class="panel-head"><h3>연결된 업무</h3><a class="btn-icon" id="d-linkedMore" href="#/calendar">+ 연결하기</a></div>
          <div id="d-linkedRow"><div class="empty">불러오는 중…</div></div>
        </div>

        <div class="dash-bottom-grid">
          <div class="panel">
            <div class="panel-head"><h3>최근 활동</h3></div>
            <div id="d-activityList"></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>이번 주 요약</h3></div>
            <div id="d-weekSummary" class="week-summary-grid"></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>빠른 추가</h3></div>
            <div class="quick-add-grid">
              <a class="quick-add-btn" href="#/todo">+ Todo</a>
              <a class="quick-add-btn" href="#/calendar">+ 일정</a>
              <a class="quick-add-btn" href="#/memo">+ 메모</a>
              <a class="quick-add-btn" href="#/postit">+ 포스트잇</a>
            </div>
          </div>
        </div>

        <div class="inbox-bar">
          <input type="text" id="d-inboxInput" placeholder="오늘 받은 업무나 해야 할 일을 입력하세요…" />
          <kbd>어디서든 ⌘K</kbd>
          <button class="btn" id="d-inboxAddBtn">추가</button>
        </div>
      </div>

      <aside class="dash-side" id="d-side">
        <div class="panel side-cal-panel">
          <div class="panel-head">
            <h3>일정 (Calendar)</h3>
            <button class="btn-icon" id="d-calWidgetBtn" title="구글 캘린더 위젯 열기">${WIDGET_ICON}</button>
          </div>
          <div class="cal-toolbar">
            <div class="cal-nav">
              <button class="btn-secondary" id="d-calToday">오늘</button>
              <button class="btn-icon" id="d-calPrev">${CHEVRON_LEFT}</button>
              <span class="cal-period-label" id="d-calLabel"></span>
              <button class="btn-icon" id="d-calNext">${CHEVRON_RIGHT}</button>
            </div>
            <div class="tabs" id="d-calTabs">
              <button class="tab active" data-view="day">일</button>
              <button class="tab" data-view="week">주</button>
              <button class="tab" data-view="month">월</button>
            </div>
          </div>
          <div class="cal-filters">
            <label><input type="checkbox" id="d-calShowMine" checked /> 내 일정</label>
            <label><input type="checkbox" id="d-calShowGoogle" checked /> 구글 캘린더 <span class="filter-note">읽기전용</span></label>
          </div>
          <div class="side-cal-grid" id="d-calGrid"><div class="empty">불러오는 중…</div></div>
        </div>

        <div class="panel side-postit-panel">
          <div class="panel-head"><h3>포스트잇</h3><a class="btn-icon" href="#/postit">+ 새 포스트잇</a></div>
          <div class="side-postit-grid" id="d-postitGrid"></div>
        </div>
      </aside>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);

  // 일정 상세/수정 팝업 — 캘린더 화면으로 이동하지 않고 대시보드 안에서 바로 뜨도록
  // calendar.js와 동일한 모달을 재사용(renderer/shared/event-detail-modal.js)한다.
  // 수정/삭제가 성공하면 "오늘 일정" 목록과 우측 미니 캘린더를 둘 다 다시 불러온다.
  const eventDetailModal = mountEventDetailModal(root, {
    onChange: () => {
      loadEvents();
      loadSideCalendar();
    },
  });

  // ================= 헤더: 시계 / 날짜 네비게이터 / 다크모드 토글 / 새로 만들기 =================
  function renderClock() {
    const el = $('d-timeNow');
    if (!el) return;
    const n = new Date();
    el.textContent = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  }
  renderClock();
  const clockTimer = setInterval(renderClock, 30000);

  $('d-newBtn').addEventListener('click', () => {
    document.getElementById('fab')?.click(); // 기존 ⌘K 빠른입력 모달 재사용
  });
  bindWidgetLaunchButton(root, 'd-ddayWidgetBtn', 'dday');

  function refreshDateLabel() {
    $('d-dateLabel').textContent = formatDateLabel(viewDate);
  }
  async function stepDate(dir) {
    viewDate.setDate(viewDate.getDate() + dir);
    viewDate = new Date(viewDate);
    refreshDateLabel();
    await Promise.allSettled([loadTodos(), loadEvents()]);
  }
  $('d-datePrev').addEventListener('click', () => stepDate(-1));
  $('d-dateNext').addEventListener('click', () => stepDate(1));

  // ================= 좌측: 요약 카드 + 할일/일정/메모/포스트잇 목록 =================
  // 목록의 각 행을 클릭하면 해당 화면으로 이동한다(개별 항목 딥링크는 아직 없어서
  // 그 항목이 속한 화면으로 이동 — 검색결과/연결된업무 등 앱 전체에서 쓰는 것과 동일한 패턴).
  function bindDashRowNav(container) {
    container.querySelectorAll('.dash-row-link').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('input,button,a')) return; // 체크박스 등 자체 동작이 있는 요소는 제외
        location.hash = row.dataset.nav;
      });
    });
  }

  async function loadTodos() {
    const dateStr = toDateKey(viewDate);
    let todos;
    try {
      todos = await window.itda.todos.list({ fromDate: dateStr, toDate: dateStr });
    } catch (e) {
      errorToast(e, '할 일을 불러오지 못했어요');
      return;
    }
    const doneCount = todos.filter((t) => t.is_done).length;
    $('d-todoCount').textContent = `${todos.length}건`;
    $('d-todoSub').textContent = `진행 중 ${todos.length - doneCount} · 완료 ${doneCount}`;

    const listEl = $('d-todoList');
    const emptyEl = $('d-todoEmpty');
    if (todos.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = todos
      .map(
        (t) => `
        <div class="todo-row ${t.is_done ? 'done' : ''} dash-row-link" data-nav="#/todo">
          <input type="checkbox" data-id="${t.id}" ${t.is_done ? 'checked' : ''} />
          <span class="cat" style="background:${t.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(t.title)}</span>
          <span class="due">${isSameDate(viewDate, new Date()) ? '오늘' : dateStr.slice(5)}</span>
        </div>`
      )
      .join('');
    bindDashRowNav(listEl);
    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', async (e) => {
        e.stopPropagation();
        const prevChecked = !e.target.checked;
        try {
          await window.itda.todos.toggle(Number(e.target.dataset.id));
          loadTodos();
        } catch (err) {
          e.target.checked = prevChecked;
          errorToast(err, '상태를 변경하지 못했어요');
        }
      });
    });
  }

  async function loadEvents() {
    const dateStr = toDateKey(viewDate);
    let events;
    try {
      events = await window.itda.events.range({ fromDate: dateStr, toDate: dateStr });
    } catch (e) {
      errorToast(e, '일정을 불러오지 못했어요');
      return;
    }
    $('d-eventCount').textContent = `${events.length}건`;
    const listEl = $('d-eventList');
    const emptyEl = $('d-eventEmpty');
    if (events.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = events
      .map(
        (e) => `
        <div class="todo-row dash-row-link" data-id="${e.id}">
          <span class="cat" style="background:${e.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(e.title)}</span>
          <span class="due">${(e.start_at || '').slice(11, 16)}</span>
        </div>`
      )
      .join('');
    listEl.querySelectorAll('.dash-row-link').forEach((row) => {
      row.addEventListener('click', () => {
        const evt = events.find((e) => e.id === Number(row.dataset.id));
        if (evt) eventDetailModal.openDetail({ ...evt, source: 'local' });
      });
    });
  }

  async function loadMemos() {
    let memos;
    try {
      memos = await window.itda.memos.recent(5);
    } catch (e) {
      errorToast(e, '메모를 불러오지 못했어요');
      return;
    }
    $('d-memoCount').textContent = `${memos.length}건`;
    const listEl = $('d-memoList');
    const emptyEl = $('d-memoEmpty');
    if (memos.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = memos
      .map((m) => `<div class="todo-row dash-row-link" data-nav="#/memo"><span class="txt">${escapeHtml(m.title || stripHtmlToPlainText(m.content))}</span></div>`)
      .join('');
    bindDashRowNav(listEl);
  }

  // "고정 포스트잇" — 이미지의 상단 패널은 고정(핀)된 것만 보여준다(우측 사이드 패널과 역할 구분)
  async function loadPinnedPostits() {
    let postits;
    try {
      postits = await window.itda.postits.list();
    } catch (e) {
      errorToast(e, '포스트잇을 불러오지 못했어요');
      return;
    }
    $('d-postitCount').textContent = `${postits.length}건`;
    const pinned = postits.filter((p) => p.is_pinned);
    const listEl = $('d-postitList');
    const emptyEl = $('d-postitEmpty');
    if (pinned.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = pinned
      .slice(0, 5)
      .map((p) => `<div class="todo-row dash-row-link" data-nav="#/postit"><span class="txt">${escapeHtml(p.title || stripHtmlToPlainText(p.content))}</span></div>`)
      .join('');
    bindDashRowNav(listEl);
  }

  let inboxBusy = false;
  async function handleInboxSubmit() {
    if (inboxBusy) return;
    const input = $('d-inboxInput');
    const content = input.value.trim();
    if (!content) return;
    inboxBusy = true;
    try {
      await window.itda.inbox.add(content);
      input.value = '';
      toast('Inbox에 저장했어요');
    } catch (err) {
      errorToast(err, '저장하지 못했어요');
    } finally {
      inboxBusy = false;
    }
  }
  $('d-inboxAddBtn').addEventListener('click', handleInboxSubmit);
  $('d-inboxInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleInboxSubmit();
  });

  // ================= 연결된 업무 — 오늘 첫 일정에 연결된 항목들을 보여줌 =================
  async function loadLinkedRow() {
    const rowEl = $('d-linkedRow');
    let todayEvents;
    try {
      todayEvents = await window.itda.events.today();
    } catch (e) {
      rowEl.innerHTML = emptyStateBlock({ title: '불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (todayEvents.length === 0) {
      rowEl.innerHTML = `<div class="empty">오늘 일정이 없어서 표시할 연결 항목이 없어요.</div>`;
      $('d-linkedMore').href = '#/calendar';
      return;
    }
    const anchor = todayEvents[0];
    let links;
    try {
      links = await window.itda.links.listFor({ type: 'event', id: anchor.id });
    } catch (e) {
      rowEl.innerHTML = emptyStateBlock({ title: '불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (links.length === 0) {
      rowEl.innerHTML = `<div class="empty">"${escapeHtml(anchor.title)}" 일정에 연결된 항목이 없어요.</div>`;
      return;
    }
    const anchorCard = `
      <div class="linked-card linked-anchor">
        <div class="linked-card-type">${TYPE_META.event.icon}<span>일정</span></div>
        <b>${escapeHtml(anchor.title)}</b>
        <span>${(anchor.start_at || '').slice(11, 16)}</span>
      </div>`;
    const linkedCards = links
      .map(
        (l) => `
        <span class="linked-connector">${LINK_ROW_ICON}</span>
        <a class="linked-card" href="${TYPE_META[l.type]?.route || '#/dashboard'}">
          <div class="linked-card-type">${TYPE_META[l.type]?.icon || ''}<span>${TYPE_META[l.type]?.label || l.type}</span></div>
          <b>${escapeHtml(l.label || '(제목 없음)')}</b>
        </a>`
      )
      .join('');
    rowEl.innerHTML = `<div class="linked-row-inner">${anchorCard}${linkedCards}</div>`;
  }

  // ================= 최근 활동 / 이번 주 요약 =================
  async function loadRecentActivity() {
    const listEl = $('d-activityList');
    let items;
    try {
      items = await computeRecentActivity();
    } catch (e) {
      listEl.innerHTML = emptyStateBlock({ title: '불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty">최근 활동이 없어요.</div>`;
      return;
    }
    listEl.innerHTML = items
      .map(
        (a) => `
        <div class="activity-row">
          <span class="activity-dot activity-dot-${a.type}"></span>
          <span class="activity-text">${escapeHtml(a.text)}</span>
          <em>${a.relative}</em>
        </div>`
      )
      .join('');
  }

  function startOfWeek(d) {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // 월요일 시작
    const start = new Date(d);
    start.setDate(d.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  async function loadWeekSummary() {
    const el = $('d-weekSummary');
    const weekStart = startOfWeek(new Date());
    const weekStartStr = toDateKey(weekStart);
    const todayStr = toDateKey(new Date());

    let todos = [];
    let events = [];
    let memos = [];
    try {
      [todos, events, memos] = await Promise.all([
        window.itda.todos.list({}),
        window.itda.events.range({ fromDate: weekStartStr, toDate: todayStr }),
        window.itda.memos.list({}),
      ]);
    } catch (e) {
      el.innerHTML = emptyStateBlock({ title: '불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }

    const doneThisWeek = todos.filter((t) => t.is_done && t.completed_at && t.completed_at.slice(0, 10) >= weekStartStr).length;
    const inProgress = todos.filter((t) => !t.is_done).length;
    const eventsThisWeek = events.length;
    const memosThisWeek = memos.filter((m) => m.created_at && m.created_at.slice(0, 10) >= weekStartStr).length;

    const stats = [
      { label: '완료된 Todo', value: doneThisWeek, color: 'var(--success)' },
      { label: '진행 중 Todo', value: inProgress, color: 'var(--brand)' },
      { label: '이번 주 일정', value: eventsThisWeek, color: '#8A5CD1' },
      { label: '작성한 메모', value: memosThisWeek, color: '#DB8B24' },
    ];
    el.innerHTML = stats
      .map(
        (s) => `
        <div class="week-stat">
          <span class="week-stat-num">${s.value}개</span>
          <span class="week-stat-label">${s.label}</span>
          <span class="week-stat-bar" style="background:${s.color}"></span>
        </div>`
      )
      .join('');
  }

  // ================= 우측: 캘린더 위젯 (renderer/views/calendar.js의 렌더링 함수 재사용) =================
  let calView = 'day';
  let calAnchor = new Date();
  calAnchor.setHours(0, 0, 0, 0);
  let showMine = true;
  let showGoogle = true;

  async function fetchMergedEvents(fromDate, toDate) {
    const [localResult, googleResult] = await Promise.allSettled([
      window.itda.events.range({ fromDate, toDate }),
      window.itda.googleCalendar.range({ fromDate, toDate }),
    ]);
    if (localResult.status !== 'fulfilled') throw localResult.reason;
    const local = showMine ? localResult.value.map((e) => ({ ...e, source: 'local' })) : [];
    const google = showGoogle && googleResult.status === 'fulfilled' ? googleResult.value.map((e) => ({ ...e, source: 'google' })) : [];
    return [...local, ...google];
  }

  async function loadSideCalendar() {
    $('d-calLabel').textContent = periodLabel(calView, calAnchor);
    const area = $('d-calGrid');
    let events;
    try {
      const { fromDate, toDate } = queryRange(calView, calAnchor);
      events = await fetchMergedEvents(fromDate, toDate);
    } catch (e) {
      errorToast(e, '일정을 불러오지 못했어요');
      area.innerHTML = emptyStateBlock({ title: '일정을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    const byDate = groupByDateKey(events);

    if (calView === 'month') {
      area.innerHTML = buildMonthGridHtml(calAnchor, byDate, { compact: true });
      area.querySelectorAll('.month-cell').forEach((cell) => bindDayJump(cell));
    } else {
      area.innerHTML = buildCompactAgendaHtml(calAnchor, byDate, calView === 'week' ? 7 : 1);
      area.querySelectorAll('.agenda-more').forEach((btn) => {
        btn.addEventListener('click', () => {
          const hiddenRows = btn.previousElementSibling;
          const expanded = hiddenRows.classList.toggle('expanded');
          btn.textContent = expanded ? '접기' : btn.dataset.label;
        });
      });
      // 캘린더 화면으로 이동하지 않고, 여기서 바로 일정 상세 팝업을 띄운다.
      // 구글 일정(읽기전용)은 상세 모달을 열어도 수정/삭제 버튼이 숨겨진다(event-detail-modal.js에서 처리).
      area.querySelectorAll('.agenda-row').forEach((row) => {
        row.addEventListener('click', () => {
          const evt = events.find((e) => e.id === Number(row.dataset.id) && (row.dataset.source === 'google' ? e.source === 'google' : e.source !== 'google'));
          if (evt) eventDetailModal.openDetail(evt);
        });
      });
    }
  }

  function bindDayJump(cell) {
    cell.addEventListener('click', () => {
      const [y, m, d] = cell.dataset.date.split('-').map(Number);
      calAnchor = new Date(y, m - 1, d);
      calView = 'day';
      root.querySelectorAll('#d-calTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'day'));
      loadSideCalendar();
    });
  }

  // 예전엔 이 버튼이 인라인 미니 달력을 펼쳤지만, 이제 실제 "구글 캘린더" 플로팅 위젯을
  // 직접 여는 버튼으로 바꿨다 — 위젯이 이미 있는데 대시보드 안에 미니달력을 또 두는 게 중복이라 판단.
  $('d-calWidgetBtn').addEventListener('click', async () => {
    try {
      await window.itda.widgets.open('google-calendar-mini');
    } catch (e) {
      errorToast(e, '위젯을 열지 못했어요');
    }
  });

  function stepCal(dir) {
    if (calView === 'month') calAnchor.setMonth(calAnchor.getMonth() + dir);
    else if (calView === 'week') calAnchor.setDate(calAnchor.getDate() + dir * 7);
    else calAnchor.setDate(calAnchor.getDate() + dir);
    calAnchor = new Date(calAnchor);
    loadSideCalendar();
  }
  $('d-calPrev').addEventListener('click', () => stepCal(-1));
  $('d-calNext').addEventListener('click', () => stepCal(1));
  $('d-calToday').addEventListener('click', () => {
    calAnchor = new Date();
    calAnchor.setHours(0, 0, 0, 0);
    loadSideCalendar();
  });
  $('d-calTabs').querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $('d-calTabs').querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      calView = tab.dataset.view;
      loadSideCalendar();
    });
  });
  $('d-calShowMine').addEventListener('change', (e) => {
    showMine = e.target.checked;
    loadSideCalendar();
  });
  $('d-calShowGoogle').addEventListener('change', (e) => {
    showGoogle = e.target.checked;
    loadSideCalendar();
  });

  // ================= 우측: 포스트잇 미니 그리드 =================
  async function loadSidePostits() {
    const grid = $('d-postitGrid');
    let postits;
    try {
      postits = await window.itda.postits.list();
    } catch (e) {
      errorToast(e, '포스트잇을 불러오지 못했어요');
      grid.innerHTML = emptyStateBlock({ title: '포스트잇을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    if (postits.length === 0) {
      grid.innerHTML = `<div class="empty side-postit-empty">포스트잇이 없어요. 새로 만들어보세요.</div>`;
      return;
    }
    grid.innerHTML = postits
      .slice(0, 4)
      .map(
        (p) => `
        <a class="side-postit-card" href="#/postit" style="background:${p.color_hex || STICKY_COLORS[0]}" data-id="${p.id}">
          <div class="sp-top">
            <b>${escapeHtml(p.title || '제목 없음')}</b>
            ${p.is_pinned ? `<span class="pin-icon">${PIN_ICON}</span>` : ''}
          </div>
          <p>${escapeHtml(stripHtmlToPlainText(p.content || ''))}</p>
          <div class="sp-meta">${formatRelative(p.updated_at)}</div>
        </a>`
      )
      .join('');
  }

  // 알림 카드(요약)는 전역 상단바가 이미 계산하는 로직을 그대로 재사용
  async function loadNotifCard() {
    try {
      const items = await computeNotifications();
      $('d-notifCount').textContent = `${items.length}건`;
    } catch (e) {
      $('d-notifCount').textContent = '-';
    }
  }

  await Promise.allSettled([
    loadTodos(),
    loadEvents(),
    loadMemos(),
    loadPinnedPostits(),
    loadSideCalendar(),
    loadSidePostits(),
    loadNotifCard(),
    loadLinkedRow(),
    loadRecentActivity(),
    loadWeekSummary(),
  ]);

  // 다른 창(위젯 등)에서 데이터가 바뀌면 대시보드의 관련 카드만 골라서 새로고침한다.
  // 대시보드는 읽기 전용 요약 위주라 isUserTyping 가드 없이 바로 반영해도 안전하다.
  // 여러 항목이 짧은 시간 안에 연달아 바뀔 수 있어서(일괄삭제 등), 바뀐 entity 종류를 모아뒀다가
  // 짧은 조용한 구간이 지나면 그 종류들에 해당하는 카드만 한 번씩만 새로고침한다(단순 debounce와
  // 다르게 종류를 계속 누적해서, 마지막 한 번만 이기는 게 아니라 그동안 바뀐 게 다 반영되게 한다).
  let pendingEntities = new Set();
  let flushTimer = null;
  const scheduleDashboardRefresh = (entity) => {
    pendingEntities.add(entity);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const entities = pendingEntities;
      pendingEntities = new Set();
      if (entities.has('todo')) loadTodos();
      if (entities.has('event')) loadEvents();
      if (entities.has('memo')) loadMemos();
      if (entities.has('postit')) {
        loadPinnedPostits();
        loadSidePostits();
      }
      if (entities.has('link')) loadLinkedRow();
      if (['todo', 'event', 'memo', 'postit', 'inbox'].some((t) => entities.has(t))) {
        loadRecentActivity();
        loadNotifCard();
      }
    }, 200);
  };
  const offDataChanged = window.itda.onDataChanged(({ entity }) => scheduleDashboardRefresh(entity));

  return () => {
    clearInterval(clockTimer);
    eventDetailModal.destroy();
    clearTimeout(flushTimer);
    offDataChanged?.();
  };
}
