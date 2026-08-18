import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping } from '../shared/ui-utils.js';
import { STICKY_COLORS } from '../shared/theme.js';
import { periodLabel, queryRange, groupByDateKey, buildMonthGridHtml, buildCompactAgendaHtml } from './calendar.js';
import { computeNotifications } from '../shared/notifications.js';
import { computeRecentActivity } from '../shared/recent-activity.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { getUserName } from '../shared/shell.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';
import { mountEventDetailModal } from '../shared/event-detail-modal.js';
import { getPreset } from '../shared/dashboard-layouts.js';

// 대시보드 카드 표시 여부 (설정 > 화면 > 대시보드 구성) — id는 각 패널의 #d-card-<id> 엘리먼트와 대응.
// 설정 화면이 같은 목록을 그대로 써서 카드가 추가/변경돼도 한 곳만 고치면 됨.
export const DASHBOARD_CARDS = [
  { id: 'todo', label: '오늘 할 일', default: true },
  { id: 'event', label: '오늘 일정', default: true },
  { id: 'memo', label: '최근 메모', default: true },
  { id: 'postit', label: '고정 포스트잇', default: true },
  { id: 'linked', label: '연결된 업무', default: true },
  { id: 'activity', label: '최근 활동', default: false },
  { id: 'weekSummary', label: '이번 주 요약', default: false },
  { id: 'quickAdd', label: '빠른 추가', default: true },
  { id: 'sideCalendar', label: '사이드 캘린더', default: true },
  { id: 'sidePostit', label: '사이드 포스트잇', default: true },
];

const CATEGORY_FALLBACK_COLOR = 'var(--text-faint)';
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const CHEVRON_LEFT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
const CHEVRON_RIGHT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
const PIN_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const WIDGET_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;
const LINK_ROW_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07l1.5-1.5"/></svg>`;
const GRIP_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>`;

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
          <div class="summary-card tone-purple">
            <div class="top"><span class="dot" style="background:var(--tone-purple-fg)"></span>오늘 할 일</div>
            <div class="num" id="d-todoCount">-</div>
            <div id="d-todoSub" style="font-size:11.5px;color:var(--text-faint);"></div>
          </div>
          <div class="summary-card tone-green">
            <div class="top"><span class="dot" style="background:var(--tone-green-fg)"></span>오늘 일정</div>
            <div class="num" id="d-eventCount">-</div>
          </div>
          <div class="summary-card tone-yellow">
            <div class="top"><span class="dot" style="background:var(--tone-yellow-fg)"></span>메모</div>
            <div class="num" id="d-memoCount">-</div>
          </div>
          <div class="summary-card tone-pink">
            <div class="top"><span class="dot" style="background:var(--tone-pink-fg)"></span>포스트잇</div>
            <div class="num" id="d-postitCount">-</div>
          </div>
          <div class="summary-card tone-blue">
            <div class="top"><span class="dot" style="background:var(--tone-blue-fg)"></span>알림</div>
            <div class="num" id="d-notifCount">-</div>
          </div>
        </div>

        <div class="dash-widget-grid" id="d-widgetGrid">
          <div class="panel dash-widget" id="d-card-todo" data-card="todo">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>오늘 할 일</h3><a class="btn-icon" href="#/todo">더보기 ›</a></div>
            <div id="d-todoList"></div>
            <div class="empty" id="d-todoEmpty" style="display:none;">할 일이 없어요. Inbox에서 바로 추가해보세요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-event" data-card="event">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>오늘 일정</h3><a class="btn-icon" href="#/calendar">더보기 ›</a></div>
            <div id="d-eventList"></div>
            <div class="empty" id="d-eventEmpty" style="display:none;">일정이 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-memo" data-card="memo">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>최근 메모</h3><a class="btn-icon" href="#/memo">더보기 ›</a></div>
            <div id="d-memoList"></div>
            <div class="empty" id="d-memoEmpty" style="display:none;">메모가 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-postit" data-card="postit">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>고정 포스트잇</h3><a class="btn-icon" href="#/postit">더보기 ›</a></div>
            <div id="d-postitList"></div>
            <div class="empty" id="d-postitEmpty" style="display:none;">고정된 포스트잇이 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-linked" data-card="linked">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>연결된 업무</h3><a class="btn-icon" id="d-linkedMore" href="#/calendar">+ 연결하기</a></div>
            <div id="d-linkedRow"><div class="empty">불러오는 중…</div></div>
          </div>
          <div class="panel dash-widget" id="d-card-activity" data-card="activity">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>최근 활동</h3></div>
            <div id="d-activityList"></div>
          </div>
          <div class="panel dash-widget" id="d-card-weekSummary" data-card="weekSummary">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>이번 주 요약</h3></div>
            <div id="d-weekSummary" class="week-summary-grid"></div>
          </div>
          <div class="panel dash-widget" id="d-card-quickAdd" data-card="quickAdd">
            <div class="panel-head"><span class="dash-widget-grip" draggable="true" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>빠른 추가</h3></div>
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

      <div class="dash-resizer" id="d-resizer" title="드래그해서 사이드 패널 폭 조절"></div>

      <aside class="dash-side" id="d-side">
        <div class="panel side-cal-panel" id="d-card-sideCalendar">
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

        <div class="panel side-postit-panel" id="d-card-sidePostit">
          <div class="panel-head"><h3>포스트잇</h3><a class="btn-icon" href="#/postit">+ 새 포스트잇</a></div>
          <div class="side-postit-grid" id="d-postitGrid"></div>
        </div>
      </aside>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);

  // 카드 on/off (설정에서 저장한 JSON 하나로 관리) — 데이터를 안 불러오는 최적화는 하지 않고
  // 단순히 숨긴다(로컬 SQLite라 비용이 작아서 그정도 절약은 안 해도 됨).
  // 위젯 그리드(flex-wrap)라 일부만 숨겨도 나머지가 자연스럽게 채워져서 별도 열 계산이 필요 없다.
  async function applyDashboardCardConfig() {
    const defaults = Object.fromEntries(DASHBOARD_CARDS.map((c) => [c.id, c.default]));
    let config = defaults;
    try {
      const raw = await window.itda.settings.get('dashboard_cards');
      if (raw) config = { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      // 저장된 값이 깨졌으면(수동 편집 등) 기본값으로 — 대시보드가 안 뜨는 것보다 나음
    }

    const setVisible = (id, visible) => {
      const el = $(id);
      if (el) el.style.display = visible ? '' : 'none';
    };
    DASHBOARD_CARDS.forEach((c) => setVisible(`d-card-${c.id}`, config[c.id]));

    $('d-layout').classList.toggle('side-collapsed', !(config.sideCalendar || config.sidePostit));
  }
  await applyDashboardCardConfig();

  // ================= 위젯 그리드: 자유 위치 이동 + 크기 조절 + 정렬 가이드 =================
  // 카드마다 {x,y,w,h}를 설정에 저장해서 다음에 열어도 유지한다. 처음 보거나(설치 직후) 새로
  // 켠 카드처럼 저장된 위치가 없는 카드는 현재 프리셋(기본형/2열형)으로 계산해서 채워 넣는다.
  async function initWidgetGrid() {
    const grid = $('d-widgetGrid');
    const widgets = Array.from(grid.querySelectorAll('.dash-widget'));
    const widgetById = new Map(widgets.map((w) => [w.dataset.card, w]));

    let presetId = 'flow';
    let positions = {};
    try {
      const raw = await window.itda.settings.get('dashboard_layout');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.widgets) {
          presetId = parsed.preset || 'flow';
          positions = parsed.widgets;
        }
      }
    } catch (e) {
      // 저장된 값이 없거나(신규 설치) 옛 버전 형식/깨진 값이면 프리셋으로 새로 계산
    }

    const visibleIds = widgets.filter((w) => w.style.display !== 'none').map((w) => w.dataset.card);
    const missingIds = visibleIds.filter((id) => !positions[id]);
    if (missingIds.length) {
      const containerWidth = grid.clientWidth || 1000;
      const computed = getPreset(presetId).compute(visibleIds, containerWidth);
      missingIds.forEach((id) => {
        positions[id] = computed[id];
      });
    }

    function applyPosition(cardId) {
      const w = widgetById.get(cardId);
      const p = positions[cardId];
      if (!w || !p) return;
      w.style.left = `${p.x}px`;
      w.style.top = `${p.y}px`;
      w.style.width = `${p.w}px`;
      w.style.height = `${p.h}px`;
    }
    widgets.forEach((w) => applyPosition(w.dataset.card));

    function recalcContainerHeight() {
      let maxBottom = 0;
      widgets.forEach((w) => {
        if (w.style.display === 'none') return;
        const p = positions[w.dataset.card];
        if (p) maxBottom = Math.max(maxBottom, p.y + p.h);
      });
      grid.style.height = `${maxBottom}px`;
    }
    recalcContainerHeight();

    function persist() {
      window.itda.settings.set({ key: 'dashboard_layout', value: JSON.stringify({ preset: presetId, widgets: positions }) }).catch(() => {});
    }
    persist(); // 방금 새로 채운 기본 위치도 다음엔 그대로 이어서 보이도록 저장해둔다

    // 크기: 네이티브 resize(모서리 드래그)로 바뀐 최종 크기를 ResizeObserver로 감지해 저장.
    // observe()는 관찰을 시작하자마자 "현재 크기"로 콜백을 한 번 더 주는데(스펙 동작), 이걸
    // 그대로 저장하면 손도 안 댄 카드까지 저장돼버리니 카드별로 이 최초 콜백 한 번은 무시한다.
    const observedOnce = new Set();
    let resizeTimer = null;
    const resizeObserver = new ResizeObserver((entries) => {
      let changed = false;
      entries.forEach((entry) => {
        const cardId = entry.target.dataset.card;
        if (!observedOnce.has(cardId)) {
          observedOnce.add(cardId);
          return;
        }
        // style.width/height는 전역 box-sizing:border-box라 테두리 포함 크기로 해석되므로,
        // contentRect(패딩 제외) 대신 borderBoxSize를 써야 저장했다가 다시 적용해도 안 줄어든다.
        const box = entry.borderBoxSize?.[0];
        const width = box ? box.inlineSize : entry.target.offsetWidth;
        const height = box ? box.blockSize : entry.target.offsetHeight;
        positions[cardId] = { ...positions[cardId], w: Math.round(width), h: Math.round(height) };
        changed = true;
      });
      if (!changed) return;
      recalcContainerHeight();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(persist, 400);
    });
    widgets.forEach((w) => resizeObserver.observe(w, { box: 'border-box' }));

    // 이동: 그립을 눌러서 자유롭게 끌 수 있고, 다른 카드와 가장자리/중심이 맞으면(파워포인트
    // 스마트 가이드처럼) 점선을 보여주고 그 위치에 딱 붙는다(스냅).
    const SNAP = 6;
    let guideEls = [];
    function clearGuides() {
      guideEls.forEach((el) => el.remove());
      guideEls = [];
    }
    function showGuide(axis, pos) {
      const el = document.createElement('div');
      el.className = `dash-guide dash-guide-${axis}`;
      el.style[axis === 'v' ? 'left' : 'top'] = `${pos}px`;
      grid.appendChild(el);
      guideEls.push(el);
    }
    // dragged를 (left, top)에 놨을 때 다른 카드들과의 가장자리/중심선 중 SNAP px 이내로 가장
    // 가까운 것을 하나 골라 그 좌표에 딱 맞춘다 — 가로/세로 축은 독립적으로 각각 계산한다.
    function computeSnap(dragged, left, top) {
      const w = dragged.offsetWidth;
      const h = dragged.offsetHeight;
      const dX = [left, left + w / 2, left + w];
      const dY = [top, top + h / 2, top + h];
      let bestX = null;
      let bestY = null;
      widgets.forEach((o) => {
        if (o === dragged || o.style.display === 'none') return;
        const ol = o.offsetLeft;
        const ot = o.offsetTop;
        const oX = [ol, ol + o.offsetWidth / 2, ol + o.offsetWidth];
        const oY = [ot, ot + o.offsetHeight / 2, ot + o.offsetHeight];
        dX.forEach((dx) => oX.forEach((ox) => {
          const diff = Math.abs(dx - ox);
          if (diff <= SNAP && (!bestX || diff < bestX.diff)) bestX = { diff, delta: ox - dx, pos: ox };
        }));
        dY.forEach((dy) => oY.forEach((oy) => {
          const diff = Math.abs(dy - oy);
          if (diff <= SNAP && (!bestY || diff < bestY.diff)) bestY = { diff, delta: oy - dy, pos: oy };
        }));
      });
      return {
        left: bestX ? left + bestX.delta : left,
        top: bestY ? top + bestY.delta : top,
        guideX: bestX ? bestX.pos : null,
        guideY: bestY ? bestY.pos : null,
      };
    }

    let activeOnMove = null;
    let activeOnUp = null;
    grid.querySelectorAll('.dash-widget-grip').forEach((grip) => {
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const widget = grip.closest('.dash-widget');
        const cardId = widget.dataset.card;
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = widget.offsetLeft;
        const startTop = widget.offsetTop;
        widget.classList.add('dragging');

        function onMove(ev) {
          const rawLeft = Math.max(0, startLeft + (ev.clientX - startX));
          const rawTop = Math.max(0, startTop + (ev.clientY - startY));
          const snap = computeSnap(widget, rawLeft, rawTop);
          widget.style.left = `${snap.left}px`;
          widget.style.top = `${snap.top}px`;
          clearGuides();
          if (snap.guideX != null) showGuide('v', snap.guideX);
          if (snap.guideY != null) showGuide('h', snap.guideY);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          activeOnMove = null;
          activeOnUp = null;
          widget.classList.remove('dragging');
          clearGuides();
          positions[cardId] = { ...positions[cardId], x: widget.offsetLeft, y: widget.offsetTop };
          recalcContainerHeight();
          persist();
        }
        activeOnMove = onMove;
        activeOnUp = onUp;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });

    return () => {
      resizeObserver.disconnect();
      if (activeOnMove) document.removeEventListener('mousemove', activeOnMove);
      if (activeOnUp) document.removeEventListener('mouseup', activeOnUp);
    };
  }
  const disconnectWidgetGrid = await initWidgetGrid();

  // ================= 사이드 패널(우측 캘린더/포스트잇) 폭 드래그 조절 =================
  const SIDE_WIDTH_MIN = 260;
  const SIDE_WIDTH_MAX = 560;
  const SIDE_WIDTH_DEFAULT = 336;
  let onResizerMove = null;
  let onResizerUp = null;

  async function initSideResizer() {
    const layout = $('d-layout');
    const resizer = $('d-resizer');
    let width = SIDE_WIDTH_DEFAULT;
    try {
      const raw = await window.itda.settings.get('dashboard_side_width');
      if (raw) width = Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, Number(raw) || SIDE_WIDTH_DEFAULT));
    } catch (e) {
      // 저장된 값이 없거나 깨졌으면 기본값 사용
    }
    layout.style.setProperty('--dash-side-w', `${width}px`);

    let startX = 0;
    let startWidth = width;
    onResizerMove = (e) => {
      const delta = startX - e.clientX; // 왼쪽으로 끌수록 사이드 패널이 넓어짐
      const next = Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, startWidth + delta));
      layout.style.setProperty('--dash-side-w', `${next}px`);
    };
    onResizerUp = () => {
      document.removeEventListener('mousemove', onResizerMove);
      document.removeEventListener('mouseup', onResizerUp);
      resizer.classList.remove('dragging');
      const finalWidth = parseInt(layout.style.getPropertyValue('--dash-side-w'), 10) || SIDE_WIDTH_DEFAULT;
      window.itda.settings.set({ key: 'dashboard_side_width', value: String(finalWidth) }).catch(() => {});
    };
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = parseInt(layout.style.getPropertyValue('--dash-side-w'), 10) || SIDE_WIDTH_DEFAULT;
      resizer.classList.add('dragging');
      document.addEventListener('mousemove', onResizerMove);
      document.addEventListener('mouseup', onResizerUp);
    });
  }
  await initSideResizer();

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
    if (onResizerMove) document.removeEventListener('mousemove', onResizerMove);
    if (onResizerUp) document.removeEventListener('mouseup', onResizerUp);
    disconnectWidgetGrid?.();
  };
}
