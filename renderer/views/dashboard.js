import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping } from '../shared/ui-utils.js';
import { STICKY_COLORS } from '../shared/theme.js';
import { periodLabel, queryRange, groupByDateKey, buildMonthGridHtml, buildCompactAgendaHtml } from './calendar.js';
import { computeNotifications } from '../shared/notifications.js';
import { computeRecentActivity } from '../shared/recent-activity.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { getUserName, setScreenShortcuts } from '../shared/shell.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';
import { mountEventDetailModal } from '../shared/event-detail-modal.js';
import { getPreset, GRID_COLS, DEFAULT_PRESET_ID, LAYOUT_PRESETS } from '../shared/dashboard-layouts.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { promptText } from '../shared/text-prompt.js';
import { registerEscClose } from '../shared/esc-close.js';
import {
  BLOCK_TYPES,
  BLOCK_CATEGORIES,
  BLOCK_VARIANTS,
  blockCategory,
  makeBlockId,
  renderBlockElement,
  paintBlock,
  tickBlock,
  openBlockConfig,
  closeBlockConfig,
  readImageDownscaled,
} from '../shared/dashboard-blocks.js';

// 대시보드 전체 테마 · 카드별 테마 · 꾸미기 블록 테마 — 전부 이 하나의 팔레트를 쓴다.
// id가 곧 CSS의 [data-dashtheme] / [data-cardtheme] 값.
const DASH_THEMES = [
  { id: 'default', label: '기본', swatch: 'var(--surface)' },
  { id: 'warm', label: '따뜻한', swatch: '#f0e6d6' },
  { id: 'mono', label: '모노', swatch: '#e9e9e9' },
  { id: 'dark', label: '다크', swatch: '#26262e' },
  { id: 'glass', label: '유리', swatch: 'rgba(255,255,255,.5)' },
  { id: 'yellow', label: '노랑', swatch: '#fff6d9' },
  { id: 'blue', label: '블루', swatch: '#e8f0ff' },
  { id: 'mint', label: '민트', swatch: '#e4f6ee' },
  { id: 'pink', label: '핑크', swatch: '#fdeef2' },
];

// 대시보드 스타일 프리셋 (설정 > 대시보드) — 카드 표면·여백·라운드·그림자·기본 강조색·배경을
// 한 세트로 바꾼다. 전역 UI 테마(html[data-uitheme])와 독립적이고 대시보드에만 적용된다.
// 실제 스타일은 styles.css의 .dash-layout[data-dashstyle="<id>"] 규칙에 있다.
export const DASHBOARD_STYLE_PRESETS = [
  { id: 'default', label: '기본', hint: '앱 테마 그대로' },
  { id: 'minimal', label: 'Minimal', hint: '넓은 여백 · 그림자 없음' },
  { id: 'soft', label: 'Soft', hint: '큰 라운드 · 은은한 톤' },
  { id: 'glass', label: 'Glass', hint: '반투명 · 블러' },
  { id: 'paper', label: 'Paper', hint: '종이 질감 · 얇은 테두리' },
  { id: 'command', label: 'Command', hint: '좁은 간격 · 고밀도' },
  { id: 'cozy', label: 'Cozy', hint: '따뜻한 색감 · 부드러운 카드' },
];

// 대시보드 카드 표시 여부 (설정 > 화면 > 대시보드 구성) — id는 각 패널의 #d-card-<id> 엘리먼트와 대응.
// 설정 화면이 같은 목록을 그대로 써서 카드가 추가/변경돼도 한 곳만 고치면 됨.
export const DASHBOARD_CARDS = [
  { id: 'workCenter', label: '오늘의 업무센터', default: true },
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
const EDIT_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>`;
const PLUS_MINI_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
const RESET_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.7 3L3 9"/><path d="M3 4v5h5"/></svg>`;

const TYPE_META = {
  todo: { label: 'Todo', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`, route: '#/todo' },
  event: { label: '일정', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`, route: '#/calendar' },
  memo: { label: '메모', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>`, route: '#/memo' },
  postit: { label: '포스트잇', icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6l3-2 3 2V3"/></svg>`, route: '#/postit' },
};

function greetingByHour(hour) {
  // 윈도우 Segoe UI Emoji에서 흑백으로 렌더되던 ☀️/🌤️ 대신 항상 컬러로 나오는 이모지로 교체
  if (hour < 6) return { icon: '🌙', text: '늦은 밤이네요' };
  if (hour < 12) return { icon: '🌅', text: '좋은 아침입니다' };
  if (hour < 18) return { icon: '🌞', text: '좋은 오후입니다' };
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
      <div class="dash-bg" id="d-bg"></div>
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
            <button class="btn-icon" id="d-layoutEditBtn" title="레이아웃 편집 (E)">${EDIT_ICON}</button>
            <button class="btn-icon" id="d-sideToggle" title="사이드 패널 열기 (S)">${CHEVRON_LEFT}</button>
            <button class="btn" id="d-newBtn">+ 새로 만들기</button>
          </div>
        </div>

        <button class="summary-collapsed-bar" id="d-summaryExpand" style="display:none;">▾ 요약 카드 펼치기</button>
        <div class="summary-grid summary-grid-5" id="d-summaryGrid" title="우클릭: 카드 선택 · 접기">
          <div class="summary-card tone-purple" data-sum="todo" data-nav="#/todo" title="더블클릭하면 Todo로 이동해요">
            <div class="top"><span class="dot" style="background:var(--tone-purple-fg)"></span>오늘 할 일</div>
            <div class="num" id="d-todoCount">-</div>
            <div id="d-todoSub" style="font-size:11.5px;color:var(--text-faint);"></div>
          </div>
          <div class="summary-card tone-green" data-sum="event" data-nav="#/calendar" title="더블클릭하면 일정으로 이동해요">
            <div class="top"><span class="dot" style="background:var(--tone-green-fg)"></span>오늘 일정</div>
            <div class="num" id="d-eventCount">-</div>
          </div>
          <div class="summary-card tone-yellow" data-sum="memo" data-nav="#/memo" title="더블클릭하면 메모로 이동해요">
            <div class="top"><span class="dot" style="background:var(--tone-yellow-fg)"></span>메모</div>
            <div class="num" id="d-memoCount">-</div>
          </div>
          <div class="summary-card tone-pink" data-sum="postit" data-nav="#/postit" title="더블클릭하면 포스트잇으로 이동해요">
            <div class="top"><span class="dot" style="background:var(--tone-pink-fg)"></span>포스트잇</div>
            <div class="num" id="d-postitCount">-</div>
          </div>
          <div class="summary-card tone-blue" data-sum="notif" id="d-notifSummaryCard" title="더블클릭하면 알림 목록을 열어요">
            <div class="top"><span class="dot" style="background:var(--tone-blue-fg)"></span>알림</div>
            <div class="num" id="d-notifCount">-</div>
          </div>
        </div>

        <div class="dash-edit-bar" id="d-editBar" style="display:none;">
          <span class="dash-edit-presets">
            <button class="btn-secondary" id="d-addWidgetBtn">＋ 위젯 추가</button>
            <button class="btn-secondary" id="d-bgBtn">🎨 배경</button>
            <label class="dash-edit-opacity" title="위젯 배경 투명도 (0 = 완전 투명)">배경 투명도
              <input type="range" id="d-opacityRange" min="0" max="100" step="5" value="100" />
            </label>
            <label class="dash-edit-opacity" title="투명한 배경을 흐릿하게(간유리). 끄면 뒤 배경이 그대로 선명하게 비쳐요">
              <input type="checkbox" id="d-glassEnable" checked />흐림
            </label>
            ${LAYOUT_PRESETS.map((p) => `<button class="btn-secondary" data-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
            <button class="btn-secondary" id="d-arrangeBtn" title="위젯 자동 정렬">🧹 자동 정리 ▾</button>
            <button class="btn-secondary" id="d-layoutBtn" title="배치·워크스페이스 저장/불러오기">💾 저장 ▾</button>
            <button class="btn-secondary" id="d-layoutResetBtn" title="기본 배치로 되돌리기">${RESET_ICON} 기본 배치로 복원</button>
          </span>
          <button class="btn" id="d-editDoneBtn">완료</button>
        </div>

        <div class="dash-widget-grid" id="d-widgetGrid">
          <div class="panel dash-widget dash-workcenter" id="d-card-workCenter" data-card="workCenter">
            <div class="panel-head">
              <span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span>
              <h3>오늘의 업무센터</h3>
              <button class="btn-icon wc-collapse-btn" id="d-wcCollapse" title="접기 / 펼치기">${CHEVRON_LEFT}</button>
            </div>
            <div class="wc-body" id="d-wcBody">
              <div class="wc-stats">
                <button class="wc-stat" data-nav="#/todo" title="Todo로 이동">
                  <span class="wc-stat-num" id="d-wcTodoCount">-</span>
                  <span class="wc-stat-label">오늘 할 일</span>
                </button>
                <button class="wc-stat" data-nav="#/calendar" title="일정으로 이동">
                  <span class="wc-stat-num" id="d-wcEventCount">-</span>
                  <span class="wc-stat-label">오늘 일정</span>
                </button>
              </div>
              <div class="wc-cols">
                <div class="wc-col">
                  <div class="wc-col-head">중요 할 일 <span class="wc-col-hint">★ 즐겨찾기 · ! 높음</span></div>
                  <div id="d-wcTodoList" class="wc-list"></div>
                </div>
                <div class="wc-col">
                  <div class="wc-col-head">오늘 일정</div>
                  <div id="d-wcEventList" class="wc-list"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="panel dash-widget" id="d-card-todo" data-card="todo">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>오늘 할 일</h3><a class="btn-icon" href="#/todo">더보기 ›</a></div>
            <div id="d-todoList"></div>
            <div class="empty" id="d-todoEmpty" style="display:none;">할 일이 없어요. Inbox에서 바로 추가해보세요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-event" data-card="event">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>오늘 일정</h3><a class="btn-icon" href="#/calendar">더보기 ›</a></div>
            <div id="d-eventList"></div>
            <div class="empty" id="d-eventEmpty" style="display:none;">일정이 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-memo" data-card="memo">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>최근 메모</h3><a class="btn-icon" href="#/memo">더보기 ›</a></div>
            <div id="d-memoList"></div>
            <div class="empty" id="d-memoEmpty" style="display:none;">메모가 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-postit" data-card="postit">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>고정 포스트잇</h3><a class="btn-icon" href="#/postit">더보기 ›</a></div>
            <div id="d-postitList"></div>
            <div class="empty" id="d-postitEmpty" style="display:none;">고정된 포스트잇이 없어요.</div>
          </div>
          <div class="panel dash-widget" id="d-card-linked" data-card="linked">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>연결된 업무</h3><a class="btn-icon" id="d-linkedMore" href="#/calendar">+ 연결하기</a></div>
            <div id="d-linkedRow"><div class="empty">불러오는 중…</div></div>
          </div>
          <div class="panel dash-widget" id="d-card-activity" data-card="activity">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>최근 활동</h3></div>
            <div id="d-activityList"></div>
          </div>
          <div class="panel dash-widget" id="d-card-weekSummary" data-card="weekSummary">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>이번 주 요약</h3></div>
            <div id="d-weekSummary" class="week-summary-grid"></div>
          </div>
          <div class="panel dash-widget" id="d-card-quickAdd" data-card="quickAdd">
            <div class="panel-head"><span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP_ICON}</span><h3>빠른 추가</h3></div>
            <div class="quick-add-grid">
              <a class="quick-add-btn" href="#/todo">+ Todo</a>
              <a class="quick-add-btn" href="#/calendar">+ 일정</a>
              <a class="quick-add-btn" href="#/memo">+ 메모</a>
              <a class="quick-add-btn" href="#/postit">+ 포스트잇</a>
            </div>
          </div>
        </div>

      </div>

      <div class="dash-side-backdrop" id="d-sideBackdrop"></div>

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

      <div class="dash-add-backdrop" id="d-addBackdrop"></div>
      <aside class="dash-add-panel" id="d-addPanel">
        <div class="dash-add-head">
          <b>위젯 추가</b>
          <button class="btn-icon" id="d-addClose" title="닫기">✕</button>
        </div>
        <div class="dash-theme-row" id="d-themeRow">
          <span class="dash-theme-label">테마</span>
          ${DASH_THEMES.map((t) => `<button class="dash-theme-swatch" data-theme-id="${t.id}" title="${escapeHtml(t.label)}" style="background:${t.swatch}"></button>`).join('')}
        </div>
        <div class="tabs dash-add-tabs">
          <button class="tab active" data-addtab="deco">꾸미기</button>
          <button class="tab" data-addtab="work">업무</button>
        </div>
        <div class="dash-add-body" id="d-addBodyDeco"></div>
        <div class="dash-add-body" id="d-addBodyWork" style="display:none;"></div>
        <p class="dash-add-foot">추가한 위젯은 편집 모드에서 드래그해 옮기고 크기를 바꿀 수 있어요.</p>
      </aside>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);

  // 카드 on/off (설정에서 저장한 JSON 하나로 관리). 사이드 패널 카드가 둘 다 꺼져 있으면
  // 우측 패널을 열 이유가 없으므로 헤더의 "사이드 패널 열기" 버튼을 숨긴다.
  // 위젯 레이아웃 상태(dashboard_layout)와 사이드 패널 열림 상태(dashboard_side_open)는
  // 서로 완전히 독립적이다 — 하나를 바꿔도 다른 하나엔 영향이 없다.
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

    const anySideCard = !!(config.sideCalendar || config.sidePostit);
    $('d-sideToggle').style.display = anySideCard ? '' : 'none';
    return config;
  }
  await applyDashboardCardConfig();

  // ================= 우측 사이드 패널 — 화면을 밀지 않는 슬라이드 오버레이 =================
  // 예전엔 flex 컬럼이라 열고 닫을 때마다 위젯 그리드 폭이 바뀌었다 — 이제 위에 겹쳐 떠서
  // 위젯 레이아웃엔 전혀 영향을 주지 않는다(요청: "사이드바 상태와 위젯 레이아웃 상태를 분리").
  function initSidePanel() {
    const panel = $('d-side');
    const backdrop = $('d-sideBackdrop');
    const btn = $('d-sideToggle');
    let open = false;
    const apply = () => {
      panel.classList.toggle('open', open);
      backdrop.classList.toggle('open', open);
      btn.classList.toggle('active', open);
      btn.title = open ? '사이드 패널 닫기' : '사이드 패널 열기';
    };
    const setOpen = (next) => {
      open = next;
      apply();
      window.itda.settings.set({ key: 'dashboard_side_open', value: open ? '1' : '0' }).catch(() => {});
    };
    window.itda.settings
      .get('dashboard_side_open')
      .then((v) => {
        open = v === '1';
        apply();
      })
      .catch(() => {});
    btn.addEventListener('click', () => setOpen(!open));
    backdrop.addEventListener('click', () => setOpen(false));
    return { close: () => setOpen(false) };
  }
  initSidePanel();

  let addPanelEscUnsub = null; // 위젯 추가 패널 ESC 핸들러 해제용

  // ================= 대시보드 배경 + 테마 =================
  let bgPop = null;
  let dashOpenBgPop = null; // 빈 공간 우클릭 메뉴에서 커서 위치에 배경 팝업을 열기 위한 핸들
  const closeBgPop = () => {
    bgPop?.remove();
    bgPop = null;
    document.removeEventListener('mousedown', onBgOutside, true);
  };
  function onBgOutside(e) {
    if (bgPop && !bgPop.contains(e.target)) closeBgPop();
  }
  async function initBackgroundAndTheme() {
    const layout = $('d-layout');
    const bgEl = $('d-bg');

    // 대시보드 스타일 프리셋 — 전역 UI 테마와 별개로 대시보드만의 분위기(카드 표면·여백·
    // 라운드·그림자·기본 강조색·배경)를 한 번에 바꾼다. CSS가 .dash-layout[data-dashstyle]로 처리.
    try {
      const sp = await window.itda.settings.get('dashboard_style_preset');
      if (DASHBOARD_STYLE_PRESETS.some((p) => p.id === sp && p.id !== 'default')) layout.dataset.dashstyle = sp;
      else delete layout.dataset.dashstyle;
    } catch (e) {
      /* none */
    }

    let theme = 'default';
    try {
      theme = (await window.itda.settings.get('dashboard_theme')) || 'default';
    } catch (e) {
      /* default */
    }
    const applyTheme = () => layout.setAttribute('data-dashtheme', theme);
    applyTheme();
    $('d-themeRow')
      .querySelectorAll('[data-theme-id]')
      .forEach((b) => {
        b.classList.toggle('active', b.dataset.themeId === theme);
        b.addEventListener('click', () => {
          theme = b.dataset.themeId;
          $('d-themeRow')
            .querySelectorAll('[data-theme-id]')
            .forEach((x) => x.classList.toggle('active', x === b));
          applyTheme();
          window.itda.settings.set({ key: 'dashboard_theme', value: theme }).catch(() => {});
        });
      });

    let bg = { type: 'none' };
    try {
      const raw = await window.itda.settings.get('dashboard_bg');
      if (raw) bg = JSON.parse(raw);
    } catch (e) {
      /* none */
    }
    const BG_PATTERNS = ['dot', 'grid', 'paper'];
    const setBgImageSrc = (src) => {
      bgEl.style.backgroundImage = src ? `url("${src}")` : '';
      // 채우기: cover(꽉 채움, 잘림) / contain(전체 보이게, 여백). 확대가 과하다는 요청으로 contain 선택지 추가.
      bgEl.style.backgroundSize = bg.fit === 'contain' ? 'contain' : 'cover';
    };
    const applyBg = () => {
      bgEl.style.backgroundImage = '';
      bgEl.style.backgroundColor = '';
      bgEl.style.backgroundSize = '';
      bgEl.classList.remove('pat-dot', 'pat-grid', 'pat-paper');
      if (bg.type === 'color' && bg.color) bgEl.style.backgroundColor = bg.color;
      else if (bg.type === 'image') {
        if (bg.dataUrl) setBgImageSrc(bg.dataUrl); // 구버전 저장(설정에 base64)
        else if (bg.imageFile) {
          window.itda.dashboardImages?.get(bg.imageFile).then((url) => {
            if (url && bg.type === 'image' && bg.imageFile) setBgImageSrc(url);
          }).catch(() => {});
        }
      } else if (BG_PATTERNS.includes(bg.type)) {
        bgEl.classList.add('pat-' + bg.type);
        if (bg.color) bgEl.style.backgroundColor = bg.color; // 패턴 아래 기본색(선택)
      }
    };
    applyBg();

    const openBgPop = (anchorRect) => {
      closeBgPop();
      const r = anchorRect || $('d-bgBtn').getBoundingClientRect();
      const pop = document.createElement('div');
      pop.className = 'dash-block-config';
      pop.innerHTML = `
        <label class="cfg-row">종류
          <select class="select" id="bg-type">
            <option value="none">없음</option>
            <option value="color">단색</option>
            <option value="dot">도트 패턴</option>
            <option value="grid">격자 패턴</option>
            <option value="paper">노트(가로줄)</option>
            <option value="image">이미지</option>
          </select>
        </label>
        <label class="cfg-row" id="bg-colorRow">색상<input type="color" id="bg-color" value="${bg.color || '#f0e6d6'}" /></label>
        <label class="cfg-row" id="bg-imageRow">이미지 파일<input type="file" accept="image/*" id="bg-file" /></label>
        <label class="cfg-row" id="bg-fitRow">채우기
          <select class="select" id="bg-fit">
            <option value="cover">꽉 채움 (잘릴 수 있음)</option>
            <option value="contain">전체 보이게 (여백)</option>
          </select>
        </label>
        <p class="cfg-note">배경은 이 대시보드 화면에만 적용돼요. 패턴은 아주 옅게 들어가요.</p>`;
      document.body.appendChild(pop);
      bgPop = pop;
      pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
      pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
      setTimeout(() => document.addEventListener('mousedown', onBgOutside, true), 0);

      const typeSel = pop.querySelector('#bg-type');
      typeSel.value = bg.type || 'none';
      const sync = () => {
        const v = typeSel.value;
        pop.querySelector('#bg-colorRow').style.display = v === 'color' || BG_PATTERNS.includes(v) ? '' : 'none';
        pop.querySelector('#bg-imageRow').style.display = v === 'image' ? '' : 'none';
        pop.querySelector('#bg-fitRow').style.display = v === 'image' ? '' : 'none';
      };
      pop.querySelector('#bg-fit').value = bg.fit || 'cover';
      sync();
      const commit = () => {
        applyBg();
        window.itda.settings.set({ key: 'dashboard_bg', value: JSON.stringify(bg) }).catch(() => {});
      };
      typeSel.addEventListener('change', () => {
        bg.type = typeSel.value;
        sync();
        commit();
      });
      pop.querySelector('#bg-color').addEventListener('input', (e) => {
        bg.color = e.target.value;
        // 패턴을 고른 상태면 그 아래 기본색으로 쓰고, 아니면 단색으로 전환
        if (!BG_PATTERNS.includes(bg.type)) {
          bg.type = 'color';
          typeSel.value = 'color';
        }
        sync();
        commit();
      });
      pop.querySelector('#bg-fit').addEventListener('change', (e) => {
        bg.fit = e.target.value;
        commit();
      });
      pop.querySelector('#bg-file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          // 배경은 화면 전체에 깔리므로 4K까지 원본 유지(3840px). 작은 사진은 재인코딩 없이 원본 그대로.
          // 설정 JSON 비대화 방지를 위해 파일 저장소(dashboard-images/)에 저장.
          const dataUrl = await readImageDownscaled(f, 3840);
          const oldFile = bg.imageFile;
          if (window.itda.dashboardImages?.save) {
            const res = await window.itda.dashboardImages.save({ dataUrl });
            bg.imageFile = res?.name || '';
            bg.dataUrl = '';
            if (oldFile && oldFile !== bg.imageFile) window.itda.dashboardImages.delete(oldFile).catch(() => {});
          } else {
            bg.dataUrl = dataUrl; // 구버전 폴백
          }
          bg.type = 'image';
          typeSel.value = 'image';
          sync();
          commit();
        } catch (err) {
          errorToast(err, '이미지를 불러오지 못했어요');
        }
      });
    };
    $('d-bgBtn').addEventListener('click', () => openBgPop());
    dashOpenBgPop = openBgPop;
  }
  await initBackgroundAndTheme();

  // ================= 위젯 그리드: 12칸 그리드 스냅 + 편집 모드 =================
  // 저장하는 좌표는 픽셀이 아니라 그리드 칸 단위 {x,y,w,h}(요청: "Grid 좌표만 저장").
  // 편집 모드(헤더 연필 버튼)일 때만 드래그·리사이즈가 활성화되고, 그 외엔 읽기 전용.
  async function initWidgetGrid() {
    const grid = $('d-widgetGrid');
    const widgets = Array.from(grid.querySelectorAll('.dash-widget'));
    const widgetById = new Map(widgets.map((w) => [w.dataset.card, w]));
    let editing = false;
    const isVisible = (w) => w.style.display !== 'none';
    const visibleIds = () => widgets.filter(isVisible).map((w) => w.dataset.card);

    let presetId = DEFAULT_PRESET_ID;
    let positions = {};
    try {
      const raw = await window.itda.settings.get('dashboard_layout');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.widgets) {
          presetId = parsed.preset || DEFAULT_PRESET_ID;
          positions = parsed.widgets;
        }
      }
    } catch (e) {
      // 없거나(신규) 깨졌으면 프리셋으로 새로 계산
    }
    // 예전 버전은 픽셀 좌표(x가 수백 px)로 저장했다 — 그리드 칸(0~11)을 벗어나는 값이 하나라도
    // 있으면 옛 형식으로 보고 통째로 버리고 프리셋으로 다시 깐다.
    const looksLegacy = Object.values(positions).some((p) => !p || p.w > GRID_COLS || p.x > GRID_COLS || p.h > 20);
    if (looksLegacy) positions = {};

    function fillMissing() {
      const missing = visibleIds().filter((id) => !positions[id]);
      if (!missing.length) return [];
      const computed = getPreset(presetId).compute(visibleIds());
      missing.forEach((id) => {
        positions[id] = computed[id] || { x: 0, y: 0, w: 4, h: 2 };
      });
      return missing;
    }
    const filledIds = fillMissing();

    function applyPosition(cardId) {
      const el = widgetById.get(cardId);
      const p = positions[cardId];
      if (!el || !p) return;
      el.style.gridColumn = `${p.x + 1} / span ${p.w}`;
      el.style.gridRow = `${p.y + 1} / span ${p.h}`;
    }
    function applyAll() {
      widgets.forEach((w) => applyPosition(w.dataset.card));
    }

    // 겹침 방지 — movedId는 자리를 지키고, 겹치는 다른 위젯을 아래로 밀어낸다(연쇄).
    // compact(위로 당기기)는 하지 않는다: 사용자가 놔둔 빈 공간을 존중.
    const rectsOverlap = (a, b) =>
      a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    function resolveCollisions(movedId) {
      const ids = widgets
        .filter((w) => w.style.display !== 'none')
        .map((w) => w.dataset.card)
        .filter((id) => positions[id]);
      let guard = 0;
      let moved = true;
      while (moved && guard++ < 300) {
        moved = false;
        for (const a of ids) {
          for (const b of ids) {
            if (a === b || !rectsOverlap(positions[a], positions[b])) continue;
            let victim;
            if (a === movedId) victim = b;
            else if (b === movedId) victim = a;
            else {
              const pa = positions[a];
              const pb = positions[b];
              victim = pa.y < pb.y || (pa.y === pb.y && pa.x <= pb.x) ? b : a;
            }
            const keeper = victim === a ? b : a;
            positions[victim].y = positions[keeper].y + positions[keeper].h;
            moved = true;
          }
        }
      }
    }
    // 저장된 배치에 없던(새로 추가된 기본 카드 등) 카드가 기존 카드와 겹치면 아래로 밀어낸다 —
    // 안 그러면 첫 로드에서 상단 카드와 포개진다. (여기서 실행 — rectsOverlap 초기화 이후)
    filledIds.forEach((id) => resolveCollisions(id));
    applyAll();

    function persist() {
      window.itda.settings
        .set({ key: 'dashboard_layout', value: JSON.stringify({ preset: presetId, widgets: positions }) })
        .catch(() => {});
    }
    persist();

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // 드래그 중엔 카드 자체를 옮기지 않고(리플로우 피드백 루프 → 윈도우에서 덜덜거림/아래로 안 늘어남),
    // 놓일 자리를 점선 고스트로만 보여주고 마우스를 뗄 때 한 번만 반영한다.
    let ghost = null;
    function showGhost(x, y, w, h) {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'dash-drop-ghost';
        grid.appendChild(ghost);
      }
      ghost.style.gridColumn = `${x + 1} / span ${w}`;
      ghost.style.gridRow = `${y + 1} / span ${h}`;
    }
    function clearGhost() {
      ghost?.remove();
      ghost = null;
    }

    // 포인터가 창 위/아래 끝에 닿으면 본문을 자동 스크롤 — 화면보다 큰 배치로 늘릴 수 있게.
    const scroller = grid.closest('.main') || document.scrollingElement;
    let scrollRAF = null;
    let scrollVel = 0;
    function autoScrollTick() {
      if (scrollVel && scroller) {
        scroller.scrollTop += scrollVel;
        scrollRAF = requestAnimationFrame(autoScrollTick);
      } else {
        scrollRAF = null;
      }
    }
    function updateAutoScroll(clientY) {
      const M = 56;
      if (clientY < M) scrollVel = -Math.ceil((M - clientY) / 5);
      else if (clientY > window.innerHeight - M) scrollVel = Math.ceil((clientY - (window.innerHeight - M)) / 5);
      else scrollVel = 0;
      if (scrollVel && !scrollRAF) scrollRAF = requestAnimationFrame(autoScrollTick);
    }
    function stopAutoScroll() {
      scrollVel = 0;
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
      scrollRAF = null;
    }

    let activeMove = null;
    let activeUp = null;
    function startDrag(onMove, onUp) {
      activeMove = onMove;
      activeUp = (ev) => {
        document.removeEventListener('mousemove', activeMove);
        document.removeEventListener('mouseup', activeUp);
        activeMove = null;
        activeUp = null;
        document.body.style.userSelect = '';
        stopAutoScroll();
        clearGhost();
        onUp(ev);
      };
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', activeMove);
      document.addEventListener('mouseup', activeUp);
    }

    // 드래그 시작 시 셀 크기를 한 번만 잰다(드래그 중엔 폭이 안 바뀌므로 다시 안 잰다 = 리플로우 없음).
    function cellStride() {
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.columnGap) || 14;
      const rowH = parseFloat(cs.gridAutoRows) || 108;
      const colW = (grid.clientWidth - gap * (GRID_COLS - 1)) / GRID_COLS;
      return { sx: colW + gap, sy: rowH + gap };
    }

    // 한 위젯(업무 카드든 꾸미기 블록이든)에 그립 이동 + 우하단 리사이즈 핸들을 건다.
    // 런타임에 새로 추가되는 블록에도 그대로 다시 불러 쓸 수 있게 함수로 뺐다.
    function wireWidget(widget) {
      const grip = widget.querySelector('.dash-widget-grip');
      const cardId = widget.dataset.card;
      grip?.addEventListener('mousedown', (e) => {
        if (!editing) return;
        e.preventDefault();
        const p = positions[cardId];
        if (!p) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startScroll = scroller ? scroller.scrollTop : 0;
        const start = { ...p };
        const { sx, sy } = cellStride();
        widget.classList.add('dragging');
        let target = { ...p };
        showGhost(p.x, p.y, p.w, p.h);
        startDrag(
          (ev) => {
            // 자동 스크롤로 그리드가 움직인 만큼도 이동량에 더해준다(화면보다 큰 배치로 옮길 때 정확).
            const scrollDelta = scroller ? scroller.scrollTop - startScroll : 0;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY + scrollDelta;
            widget.style.transform = `translate(${dx}px, ${dy}px)`;
            target = {
              x: clamp(start.x + Math.round(dx / sx), 0, GRID_COLS - p.w),
              y: Math.max(0, start.y + Math.round(dy / sy)),
            };
            showGhost(target.x, target.y, p.w, p.h);
            updateAutoScroll(ev.clientY);
          },
          () => {
            widget.classList.remove('dragging');
            widget.style.transform = '';
            p.x = target.x;
            p.y = target.y;
            resolveCollisions(cardId);
            applyAll();
            persist();
          }
        );
      });

      const handle = document.createElement('span');
      handle.className = 'dash-widget-resize';
      handle.title = '드래그해서 크기 조절';
      widget.appendChild(handle);
      handle.addEventListener('mousedown', (e) => {
        if (!editing) return;
        e.preventDefault();
        e.stopPropagation();
        const p = positions[cardId];
        if (!p) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const start = { ...p };
        const { sx, sy } = cellStride();
        widget.classList.add('dragging');
        let target = { ...p };
        showGhost(p.x, p.y, p.w, p.h);
        startDrag(
          (ev) => {
            const dCol = Math.round((ev.clientX - startX) / sx);
            const dRow = Math.round((ev.clientY - startY) / sy);
            target = { w: clamp(start.w + dCol, 2, GRID_COLS - p.x), h: clamp(start.h + dRow, 1, 30) };
            showGhost(p.x, p.y, target.w, target.h);
            updateAutoScroll(ev.clientY);
          },
          () => {
            widget.classList.remove('dragging');
            p.w = target.w;
            p.h = target.h;
            resolveCollisions(cardId);
            applyAll();
            persist();
          }
        );
      });
    }
    widgets.forEach(wireWidget);

    // 새 위젯을 놓을 자리 — 위에서부터 훑어서 안 겹치는 첫 칸에 넣는다(top-down first-fit).
    function placeFirstFit(id, size) {
      const w = Math.min(size?.w || 4, GRID_COLS);
      const h = size?.h || 2;
      const occ = widgets
        .filter((el) => el.style.display !== 'none' && el.dataset.card !== id && positions[el.dataset.card])
        .map((el) => positions[el.dataset.card]);
      const fits = (x, y) => !occ.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y);
      for (let y = 0; y < 200; y++) {
        for (let x = 0; x <= GRID_COLS - w; x++) {
          if (fits(x, y)) {
            positions[id] = { x, y, w, h };
            return;
          }
        }
      }
      positions[id] = { x: 0, y: 0, w, h };
    }

    // --- 편집 모드 토글 + 프리셋 + 복원 ---
    function setEditing(on) {
      editing = on;
      grid.classList.toggle('editing', on);
      $('d-editBar').style.display = on ? '' : 'none';
      $('d-layoutEditBtn').classList.toggle('active', on);
    }
    function applyPreset(id) {
      presetId = id;
      positions = getPreset(id).compute(visibleIds());
      applyAll();
      persist();
    }

    // "레이아웃 자동 정리" — 6가지 정렬. grid/compact은 y까지 바꿔 겹침 없이 다시 깔고,
    // left/center/even/distribute는 "같은 y에 있는 위젯 = 한 줄"로 보고 그 줄 안에서 x만 재배치한다.
    // ponytail: 한 줄 폭 합이 12칸을 넘으면 겹칠 수 있음 — 그런 배치는 grid/compact로 먼저 정리하는 걸 권장.
    function arrangeLayout(mode) {
      const list = widgets
        .filter((w) => w.style.display !== 'none' && positions[w.dataset.card])
        .map((w) => ({ id: w.dataset.card, p: positions[w.dataset.card] }));
      if (!list.length) return;

      if (mode === 'grid') {
        const ordered = [...list].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
        let x = 0;
        let y = 0;
        let rowH = 0;
        ordered.forEach(({ p }) => {
          const w = Math.min(p.w, GRID_COLS);
          if (x > 0 && x + w > GRID_COLS) {
            x = 0;
            y += rowH;
            rowH = 0;
          }
          p.x = x;
          p.y = y;
          p.w = w;
          x += w;
          rowH = Math.max(rowH, p.h);
        });
      } else if (mode === 'compact') {
        const ordered = [...list].sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
        const placed = [];
        ordered.forEach(({ p }) => {
          let y = 0;
          while (placed.some((q) => p.x < q.x + q.w && p.x + p.w > q.x && y < q.y + q.h && y + p.h > q.y)) y++;
          p.y = y;
          placed.push({ x: p.x, y, w: p.w, h: p.h });
        });
      } else {
        const rows = new Map();
        list.forEach((it) => {
          if (!rows.has(it.p.y)) rows.set(it.p.y, []);
          rows.get(it.p.y).push(it);
        });
        for (const items of rows.values()) {
          items.sort((a, b) => a.p.x - b.p.x);
          const totalW = items.reduce((s, it) => s + it.p.w, 0);
          const free = Math.max(0, GRID_COLS - totalW);
          if (mode === 'left') {
            let x = 0;
            items.forEach((it) => { it.p.x = x; x += it.p.w; });
          } else if (mode === 'center') {
            let x = Math.floor(free / 2);
            items.forEach((it) => { it.p.x = x; x += it.p.w; });
          } else if (mode === 'even') {
            const gap = free / (items.length + 1);
            let acc = gap;
            items.forEach((it) => { it.p.x = Math.round(acc); acc += it.p.w + gap; });
          } else if (mode === 'distribute') {
            if (items.length === 1) {
              items[0].p.x = Math.floor(free / 2);
            } else {
              const gap = free / (items.length - 1);
              let acc = 0;
              items.forEach((it) => { it.p.x = Math.round(acc); acc += it.p.w + gap; });
              const last = items[items.length - 1];
              last.p.x = GRID_COLS - last.p.w;
            }
          }
          items.forEach((it) => { it.p.x = clamp(it.p.x, 0, GRID_COLS - it.p.w); });
        }
      }
      applyAll();
      persist();
    }
    $('d-layoutEditBtn').addEventListener('click', () => setEditing(!editing));
    $('d-editDoneBtn').addEventListener('click', () => setEditing(false));
    $('d-editBar').querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPreset(btn.dataset.preset);
        toast('레이아웃을 바꿨어요');
      });
    });
    $('d-layoutResetBtn').addEventListener('click', () => {
      applyPreset(DEFAULT_PRESET_ID);
      toast('기본 배치로 되돌렸어요');
    });

    return {
      destroy: () => {
        if (activeMove) document.removeEventListener('mousemove', activeMove);
        if (activeUp) document.removeEventListener('mouseup', activeUp);
        stopAutoScroll();
        clearGhost();
        document.body.style.userSelect = '';
      },
      isEditing: () => editing,
      setEditing,
      persist,
      arrangeLayout,
      // 지금 화면의 위젯 위치/크기만 복사(레이아웃 저장용). 스타일/투명도와는 무관.
      snapshotLayout: () => JSON.parse(JSON.stringify(positions)),
      // 저장해둔 레이아웃을 지금 바로 반영. 없는 카드는 프리셋으로 채운다.
      applyCustomLayout: (saved) => {
        positions = JSON.parse(JSON.stringify(saved || {}));
        fillMissing();
        widgets.filter((w) => w.style.display !== 'none').forEach((w) => resolveCollisions(w.dataset.card));
        applyAll();
        persist();
      },
      // 런타임에 추가된 블록 엘리먼트를 그리드에 편입: 위치 잡고 드래그/리사이즈 배선.
      attach: (el, size) => {
        widgets.push(el);
        widgetById.set(el.dataset.card, el);
        if (!positions[el.dataset.card]) placeFirstFit(el.dataset.card, size);
        wireWidget(el);
        resolveCollisions(el.dataset.card);
        applyAll();
        persist();
      },
      detach: (el) => {
        const id = el.dataset.card;
        const i = widgets.indexOf(el);
        if (i >= 0) widgets.splice(i, 1);
        widgetById.delete(id);
        delete positions[id];
        persist();
        el.remove();
      },
      // 꺼져 있던 업무 카드를 다시 켤 때 — 저장된 위치가 없으면 맨 아래에 새로 잡아준다.
      ensurePosition: (el, size) => {
        const id = el.dataset.card;
        if (positions[id]) return;
        placeFirstFit(id, size);
        resolveCollisions(id);
        applyAll();
        persist();
      },
    };
  }

  // ================= 위젯 표현 방식 (같은 데이터를 다른 형태로 보여주기) =================
  // dashboard_widget_views = { todo: 'list'|'compact'|'focus'|'progress', ... }
  const TODO_VIEWS = [
    ['list', '리스트'],
    ['compact', '컴팩트'],
    ['focus', '포커스'],
    ['progress', '진행률'],
  ];
  const EVENT_VIEWS = [
    ['list', '리스트'],
    ['compact', '컴팩트'],
    ['next', '다음 일정'],
  ];
  const MEMO_VIEWS = [
    ['list', '리스트'],
    ['snippet', '미리보기'],
    ['compact', '컴팩트'],
  ];
  const POSTIT_VIEWS = [
    ['list', '리스트'],
    ['grid', '그리드'],
  ];
  let widgetViews = {};
  try {
    widgetViews = JSON.parse((await window.itda.settings.get('dashboard_widget_views')) || '{}') || {};
  } catch (e) {
    widgetViews = {};
  }
  const getWidgetView = (cardId, allowed) => (allowed.some(([v]) => v === widgetViews[cardId]) ? widgetViews[cardId] : allowed[0][0]);
  function setWidgetView(cardId, view) {
    widgetViews[cardId] = view;
    window.itda.settings.set({ key: 'dashboard_widget_views', value: JSON.stringify(widgetViews) }).catch(() => {});
  }
  // 카드별 지원하는 표현 방식 + 바꿨을 때 다시 그릴 함수(우클릭 메뉴에서 씀).
  const CARD_VIEWS = { todo: TODO_VIEWS, event: EVENT_VIEWS, memo: MEMO_VIEWS, postit: POSTIT_VIEWS };
  const CARD_VIEW_RELOAD = {
    todo: () => loadTodos(),
    event: () => loadEvents(),
    memo: () => loadMemos(),
    postit: () => loadPinnedPostits(),
  };

  // ================= 꾸미기 블록 (시계/사진/텍스트/링크 …) =================
  // dashboard_blocks = [{id,type,config}]  — 위치/크기는 업무 카드와 똑같이 dashboard_layout에 저장.
  let blocks = [];
  const blockEls = new Map(); // id -> DOM 엘리먼트
  try {
    const raw = await window.itda.settings.get('dashboard_blocks');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) blocks = arr.filter((b) => b && b.id && BLOCK_TYPES[b.type]);
  } catch (e) {
    blocks = [];
  }
  function persistBlocks() {
    window.itda.settings
      .set({ key: 'dashboard_blocks', value: JSON.stringify(blocks.map((b) => ({ id: b.id, type: b.type, config: b.config }))) })
      .catch(() => {});
  }

  // initWidgetGrid가 초기 위젯으로 인식하도록 그 호출 전에 블록 DOM을 먼저 그리드에 넣는다.
  for (const b of blocks) {
    const el = renderBlockElement(b);
    $('d-widgetGrid').appendChild(el);
    blockEls.set(b.id, el);
  }

  const widgetGrid = await initWidgetGrid();

  // 블록 안에서(메모지 등) config가 바뀌면 저장
  let blockCfgSaveTimer = null;
  $('d-widgetGrid').addEventListener('block-config-change', () => {
    clearTimeout(blockCfgSaveTimer);
    blockCfgSaveTimer = setTimeout(persistBlocks, 300);
  });

  function wireBlockTools(el, block) {
    el.querySelector('[data-act="config"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openBlockConfig(el, block, (newCfg) => {
        block.config = newCfg;
        paintBlock(el, block);
        persistBlocks();
        restartBlockTick();
      });
    });
    el.querySelector('[data-act="duplicate"]').addEventListener('click', (e) => {
      e.stopPropagation();
      duplicateBlock(block);
    });
    el.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      removeBlock(block);
    });
  }
  blocks.forEach((b) => wireBlockTools(blockEls.get(b.id), b));

  function addBlock(type, configOverride) {
    const def = BLOCK_TYPES[type];
    if (!def) return;
    const block = { id: makeBlockId(), type, config: configOverride || JSON.parse(JSON.stringify(def.defaultConfig || {})) };
    blocks.push(block);
    const el = renderBlockElement(block);
    $('d-widgetGrid').appendChild(el);
    blockEls.set(block.id, el);
    wireBlockTools(el, block);
    widgetGrid.attach(el, def.defaultSize);
    customization?.attachBlockMenu(el);
    persistBlocks();
    if (!widgetGrid.isEditing()) widgetGrid.setEditing(true);
    restartBlockTick();
    toast(`${def.label} 위젯을 추가했어요`);
  }
  function duplicateBlock(src) {
    const block = { id: makeBlockId(), type: src.type, config: JSON.parse(JSON.stringify(src.config || {})) };
    blocks.push(block);
    const el = renderBlockElement(block);
    $('d-widgetGrid').appendChild(el);
    blockEls.set(block.id, el);
    wireBlockTools(el, block);
    widgetGrid.attach(el, BLOCK_TYPES[src.type]?.defaultSize);
    customization?.attachBlockMenu(el);
    persistBlocks();
    restartBlockTick();
  }
  function removeBlock(block) {
    closeBlockConfig();
    // 저장해둔 사진 파일도 같이 정리
    if (block.type === 'image' && block.config?.imageFile) {
      window.itda.dashboardImages?.delete(block.config.imageFile).catch(() => {});
    }
    const el = blockEls.get(block.id);
    const i = blocks.indexOf(block);
    if (i >= 0) blocks.splice(i, 1);
    if (el) widgetGrid.detach(el);
    blockEls.delete(block.id);
    persistBlocks();
    restartBlockTick();
  }

  // 실시간 갱신이 필요한 블록(시계/날짜/날씨/스톱워치)이 있을 때만 1초 타이머를 돈다.
  const TICKING_TYPES = ['clock', 'dateCard', 'flipCalendar', 'weather', 'miniTool', 'countdown'];
  let blockTickTimer = null;
  function tickAllBlocks() {
    blocks.forEach((b) => {
      const el = blockEls.get(b.id);
      if (el) tickBlock(el, b);
    });
  }
  function restartBlockTick() {
    clearInterval(blockTickTimer);
    blockTickTimer = null;
    if (blocks.some((b) => TICKING_TYPES.includes(b.type))) {
      tickAllBlocks();
      blockTickTimer = setInterval(tickAllBlocks, 1000);
    }
  }
  restartBlockTick();

  // ---- "위젯 추가" 패널 ----
  function initAddPanel() {
    const panel = $('d-addPanel');
    const backdrop = $('d-addBackdrop');
    const setOpen = (v) => {
      panel.classList.toggle('open', v);
      backdrop.classList.toggle('open', v);
    };
    $('d-addWidgetBtn').addEventListener('click', () => {
      setOpen(true);
      if (!widgetGrid.isEditing()) widgetGrid.setEditing(true);
    });
    $('d-addClose').addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    // ESC: 상세(미리보기)면 목록으로, 목록이면 패널 닫기
    addPanelEscUnsub = registerEscClose(
      () => panel.classList.contains('open'),
      () => {
        if (decoBody.querySelector('#d-decoBack')) renderDecoList();
        else setOpen(false);
      }
    );
    panel.querySelectorAll('[data-addtab]').forEach((t) => {
      t.addEventListener('click', () => {
        panel.querySelectorAll('[data-addtab]').forEach((x) => x.classList.toggle('active', x === t));
        $('d-addBodyWork').style.display = t.dataset.addtab === 'work' ? '' : 'none';
        $('d-addBodyDeco').style.display = t.dataset.addtab === 'deco' ? '' : 'none';
      });
    });

    // 꾸미기 탭 — 카테고리 + 검색으로 종류를 고르면, 바로 추가하지 않고 미리보기를 보여주고
    // "이 위젯 추가" 버튼을 누를 때 추가한다(요청: 종류를 고르고 추가).
    const decoBody = $('d-addBodyDeco');
    const decoGroups = BLOCK_CATEGORIES.map((cat) => ({
      cat,
      items: Object.entries(BLOCK_TYPES).filter(([type]) => blockCategory(type) === cat.id),
    })).filter((g) => g.items.length);

    function renderDecoList() {
      decoBody.innerHTML = `
        <input type="search" class="input dash-add-search" id="d-decoSearch" placeholder="꾸미기 검색…" autocomplete="off" />
        <div class="dash-add-groups">
          ${decoGroups
            .map(
              (g) => `<div class="dash-add-group">
                <div class="dash-add-group-label">${escapeHtml(g.cat.label)}</div>
                ${g.items
                  .map(
                    ([type, def]) =>
                      `<button class="dash-add-item" data-blocktype="${type}" data-name="${escapeHtml(def.label)}"><span class="dash-add-item-icon">${def.icon}</span>${escapeHtml(def.label)}<span class="dash-add-item-go">›</span></button>`
                  )
                  .join('')}
              </div>`
            )
            .join('')}
        </div>`;
      decoBody.querySelectorAll('[data-blocktype]').forEach((b) => b.addEventListener('click', () => renderDecoDetail(b.dataset.blocktype)));
      $('d-decoSearch').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        decoBody.querySelectorAll('.dash-add-group').forEach((grp) => {
          let any = false;
          grp.querySelectorAll('[data-blocktype]').forEach((btn) => {
            const hit = !q || btn.dataset.name.toLowerCase().includes(q) || btn.dataset.blocktype.toLowerCase().includes(q);
            btn.style.display = hit ? '' : 'none';
            if (hit) any = true;
          });
          grp.style.display = any ? '' : 'none';
        });
      });
    }

    function renderDecoDetail(type) {
      const def = BLOCK_TYPES[type];
      if (!def) return renderDecoList();
      const variants = BLOCK_VARIANTS[type];
      const baseCfg = () => JSON.parse(JSON.stringify(def.defaultConfig || {}));
      let selected = variants ? variants.options[0][0] : null;

      decoBody.innerHTML = `
        <button class="dash-add-back" id="d-decoBack">‹ 목록으로</button>
        <div class="dash-add-detail-name"><span class="dash-add-item-icon">${def.icon}</span>${escapeHtml(def.label)}${variants ? ' · 스타일 고르기' : ''}</div>
        ${variants ? `<div class="dash-add-variants" id="d-decoVariants"></div>` : `<div class="dash-add-preview" id="d-decoPreview"></div>`}
        <p class="dash-add-foot" style="margin:0;">추가한 뒤 위젯의 ⚙ 아이콘에서 더 바꿀 수 있어요.</p>
        <button class="btn" id="d-decoAdd" style="width:100%;">＋ 이 위젯 추가</button>`;

      const mountPreview = (host, cfg) => {
        const b = { id: 'preview-' + type, type, config: cfg };
        const el = renderBlockElement(b);
        el.classList.add('dash-add-preview-block');
        host.appendChild(el);
        try {
          tickBlock(el, b);
        } catch (e) {
          /* 미리보기 tick 실패는 무시 */
        }
      };

      if (variants) {
        const wrap = $('d-decoVariants');
        wrap.innerHTML = variants.options
          .map(
            ([v, label]) =>
              `<button class="dash-add-variant" data-v="${escapeHtml(String(v))}"><span class="dash-add-variant-prev"></span><span class="dash-add-variant-label">${escapeHtml(label)}</span></button>`
          )
          .join('');
        wrap.querySelectorAll('[data-v]').forEach((btn) => {
          mountPreview(btn.querySelector('.dash-add-variant-prev'), { ...baseCfg(), [variants.key]: btn.dataset.v });
          btn.classList.toggle('active', btn.dataset.v === selected);
          btn.addEventListener('click', () => {
            selected = btn.dataset.v;
            wrap.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('active', x === btn));
          });
        });
      } else {
        mountPreview($('d-decoPreview'), baseCfg());
      }

      $('d-decoBack').addEventListener('click', renderDecoList);
      $('d-decoAdd').addEventListener('click', () => {
        addBlock(type, variants ? { ...baseCfg(), [variants.key]: selected } : baseCfg());
        renderDecoList();
      });
    }

    renderDecoList();

    // 업무 탭 — 카드 on/off (설정 화면의 dashboard_cards와 같은 값을 씀)
    (async () => {
      const body = $('d-addBodyWork');
      const defaults = Object.fromEntries(DASHBOARD_CARDS.map((c) => [c.id, c.default]));
      let cfg = { ...defaults };
      try {
        const raw = await window.itda.settings.get('dashboard_cards');
        if (raw) cfg = { ...defaults, ...JSON.parse(raw) };
      } catch (e) {
        /* 기본값 */
      }
      body.innerHTML = DASHBOARD_CARDS.map(
        (c) =>
          `<label class="dash-add-toggle"><span>${escapeHtml(c.label)}</span><input type="checkbox" data-card-toggle="${c.id}" ${cfg[c.id] ? 'checked' : ''} /></label>`
      ).join('');
      body.querySelectorAll('[data-card-toggle]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          const id = cb.dataset.cardToggle;
          cfg[id] = cb.checked;
          await window.itda.settings.set({ key: 'dashboard_cards', value: JSON.stringify(cfg) }).catch(() => {});
          const el = $(`d-card-${id}`);
          if (el) el.style.display = cb.checked ? '' : 'none';
          if (id === 'sideCalendar' || id === 'sidePostit') {
            $('d-sideToggle').style.display = cfg.sideCalendar || cfg.sidePostit ? '' : 'none';
          } else if (cb.checked && el) {
            widgetGrid.ensurePosition(el, id === 'workCenter' ? { w: 12, h: 3 } : { w: 4, h: 2 });
            if (id === 'workCenter') loadWorkCenter();
          }
        });
      });
    })();
  }
  initAddPanel();

  // ================= 레이아웃 자동 정리 메뉴 + 편집 모드 빈 공간 우클릭 메뉴 =================
  const ARRANGE_MODES = [
    { m: 'grid', label: '⊞ 그리드 정렬' },
    { m: 'compact', label: '⬆ 빈 공간 최적화' },
    { m: 'left', label: '⇤ 왼쪽 정렬' },
    { m: 'center', label: '↔ 가운데 정렬' },
    { m: 'even', label: '≡ 균등 간격' },
    { m: 'distribute', label: '⇹ 균등 분배' },
  ];
  let arrangeMenu = null;
  const closeArrangeMenu = () => {
    arrangeMenu?.remove();
    arrangeMenu = null;
    document.removeEventListener('mousedown', onArrangeOutside, true);
  };
  function onArrangeOutside(e) {
    if (arrangeMenu && !arrangeMenu.contains(e.target)) closeArrangeMenu();
  }
  function openArrangeMenu(x, y) {
    closeArrangeMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = ARRANGE_MODES.map((a) => `<button class="ctx-menu-item" data-arrange="${a.m}">${a.label}</button>`).join('');
    document.body.appendChild(menu);
    arrangeMenu = menu;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    setTimeout(() => document.addEventListener('mousedown', onArrangeOutside, true), 0);
    menu.querySelectorAll('[data-arrange]').forEach((b) => {
      b.addEventListener('click', () => {
        closeArrangeMenu();
        widgetGrid.arrangeLayout(b.dataset.arrange);
        toast('레이아웃을 정리했어요');
      });
    });
  }
  $('d-arrangeBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openArrangeMenu(r.left, r.bottom + 4);
  });

  // ---- 레이아웃(위젯 배치) 저장/불러오기 — 설정의 "배치 프리셋"과 같은 dashboard_custom_presets를 씀 ----
  const loadLayoutPresets = async () => {
    try {
      const raw = await window.itda.settings.get('dashboard_custom_presets');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };

  // ---- 워크스페이스: 배치 + 스타일(프리셋·헤더·배경·카드별·표현방식·테마·투명도·카드구성)을 한 세트로 ----
  const WS_KEYS = [
    'dashboard_layout',
    'dashboard_style_preset',
    'dashboard_header_style',
    'dashboard_bg',
    'dashboard_card_styles',
    'dashboard_widget_views',
    'dashboard_theme',
    'dashboard_widget_opacity',
    'dashboard_cards',
  ];
  const loadWorkspaces = async () => {
    try {
      const raw = await window.itda.settings.get('dashboard_workspaces');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };
  async function saveWorkspace(name) {
    const snap = {};
    for (const k of WS_KEYS) snap[k] = (await window.itda.settings.get(k)) || '';
    // 편집 중 최신 위치를 반영
    snap.dashboard_layout = JSON.stringify({ preset: 'flow', widgets: widgetGrid.snapshotLayout() });
    const list = await loadWorkspaces();
    list.push({ id: `ws-${Date.now()}`, label: name, snap });
    await window.itda.settings.set({ key: 'dashboard_workspaces', value: JSON.stringify(list) }).catch(() => {});
  }
  async function applyWorkspace(ws) {
    for (const k of WS_KEYS) {
      if (ws.snap[k] != null) await window.itda.settings.set({ key: k, value: ws.snap[k] });
    }
    toast(`"${ws.label}" 워크스페이스를 불러왔어요`);
    // 워크스페이스 설정들은 대시보드 mount 시점에 읽히므로, 대시보드 뷰만 다시 mount시킨다.
    // (전체 새로고침은 비밀번호 잠금 화면이 다시 떠서 피함)
    location.hash = '#/inbox';
    setTimeout(() => {
      location.hash = '#/dashboard';
    }, 60);
  }
  let layoutMenu = null;
  const closeLayoutMenu = () => {
    layoutMenu?.remove();
    layoutMenu = null;
    document.removeEventListener('mousedown', onLayoutMenuOutside, true);
  };
  function onLayoutMenuOutside(e) {
    if (layoutMenu && !layoutMenu.contains(e.target)) closeLayoutMenu();
  }
  async function openLayoutMenu(x, y) {
    closeLayoutMenu();
    const [presets, workspaces] = await Promise.all([loadLayoutPresets(), loadWorkspaces()]);
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    const layoutRows = presets.length
      ? presets
          .map(
            (p) =>
              `<button class="ctx-menu-item" data-apply-layout="${escapeHtml(p.id)}"><span>📐 ${escapeHtml(p.label)}</span><span class="ctx-menu-x" data-del-layout="${escapeHtml(p.id)}" title="삭제">✕</span></button>`
          )
          .join('')
      : '<div class="ctx-menu-empty">저장된 배치 없음</div>';
    const wsRows = workspaces.length
      ? workspaces
          .map(
            (w) =>
              `<button class="ctx-menu-item" data-apply-ws="${escapeHtml(w.id)}"><span>🗂 ${escapeHtml(w.label)}</span><span class="ctx-menu-x" data-del-ws="${escapeHtml(w.id)}" title="삭제">✕</span></button>`
          )
          .join('')
      : '<div class="ctx-menu-empty">저장된 워크스페이스 없음</div>';
    menu.innerHTML = `
      <div class="dcm-label">배치 (위치·크기만)</div>
      ${layoutRows}
      <button class="ctx-menu-item" data-act="save-layout">＋ 현재 배치 저장…</button>
      <div class="ctx-menu-divider"></div>
      <div class="dcm-label">워크스페이스 (배치 + 스타일 전체)</div>
      ${wsRows}
      <button class="ctx-menu-item" data-act="save-ws">＋ 현재 전체를 워크스페이스로 저장…</button>`;
    document.body.appendChild(menu);
    layoutMenu = menu;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    setTimeout(() => document.addEventListener('mousedown', onLayoutMenuOutside, true), 0);
    const reopen = () => {
      const r = $('d-layoutBtn').getBoundingClientRect();
      openLayoutMenu(r.left, r.bottom + 4);
    };

    menu.querySelectorAll('[data-apply-layout]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        if (e.target.closest('[data-del-layout]')) return;
        closeLayoutMenu();
        const p = (await loadLayoutPresets()).find((x) => x.id === b.dataset.applyLayout);
        if (p) {
          widgetGrid.applyCustomLayout(p.widgets);
          toast(`"${p.label}" 배치를 적용했어요`);
        }
      });
    });
    menu.querySelectorAll('[data-del-layout]').forEach((x) => {
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const remaining = (await loadLayoutPresets()).filter((p) => p.id !== x.dataset.delLayout);
        await window.itda.settings.set({ key: 'dashboard_custom_presets', value: JSON.stringify(remaining) }).catch(() => {});
        reopen();
      });
    });
    menu.querySelectorAll('[data-apply-ws]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        if (e.target.closest('[data-del-ws]')) return;
        closeLayoutMenu();
        const w = (await loadWorkspaces()).find((x) => x.id === b.dataset.applyWs);
        if (w) await applyWorkspace(w);
      });
    });
    menu.querySelectorAll('[data-del-ws]').forEach((x) => {
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const remaining = (await loadWorkspaces()).filter((w) => w.id !== x.dataset.delWs);
        await window.itda.settings.set({ key: 'dashboard_workspaces', value: JSON.stringify(remaining) }).catch(() => {});
        reopen();
      });
    });
    menu.querySelector('[data-act="save-layout"]').addEventListener('click', async () => {
      closeLayoutMenu();
      const name = await promptText($('d-layoutBtn'), { title: '배치 이름', placeholder: '예: 회의 준비용' });
      if (!name) return;
      const widgets = widgetGrid.snapshotLayout();
      if (!Object.keys(widgets).length) {
        toast('저장할 배치가 없어요');
        return;
      }
      const presetsNow = await loadLayoutPresets();
      presetsNow.push({ id: `custom-${Date.now()}`, label: name, widgets });
      await window.itda.settings.set({ key: 'dashboard_custom_presets', value: JSON.stringify(presetsNow) }).catch(() => {});
      toast('배치를 저장했어요');
    });
    menu.querySelector('[data-act="save-ws"]').addEventListener('click', async () => {
      closeLayoutMenu();
      const name = await promptText($('d-layoutBtn'), { title: '워크스페이스 이름', placeholder: '예: 집중 모드' });
      if (!name) return;
      await saveWorkspace(name);
      toast('워크스페이스를 저장했어요');
    });
  }
  $('d-layoutBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openLayoutMenu(r.left, r.bottom + 4);
  });

  let gridMenu = null;
  const closeGridMenu = () => {
    gridMenu?.remove();
    gridMenu = null;
    document.removeEventListener('mousedown', onGridMenuOutside, true);
  };
  function onGridMenuOutside(e) {
    if (gridMenu && !gridMenu.contains(e.target)) closeGridMenu();
  }
  // 대시보드 빈 공간(위젯 그리드의 빈 칸 + 그 아래 여백) 우클릭 — 편집 모드가 아니어도 뜬다.
  $('d-layout').addEventListener('contextmenu', (e) => {
    // 위젯/카드/헤더/요약/편집바/사이드패널/입력요소 위에서는 각자의 메뉴(또는 OS 기본)를 쓴다.
    if (e.target.closest('.dash-widget, .panel, .dash-header, .summary-grid, .summary-collapsed-bar, .dash-edit-bar, .dash-side, .dash-add-panel, .ctx-menu, input, button, a, select, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    closeGridMenu();
    const editing = widgetGrid.isEditing();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = editing
      ? `
      <button class="ctx-menu-item" data-g="add">＋ 위젯 추가</button>
      <button class="ctx-menu-item" data-g="bg">🎨 배경 바꾸기</button>
      <div class="ctx-menu-divider"></div>
      <button class="ctx-menu-item" data-g="arrange">🧹 레이아웃 자동 정리 ▸</button>
      <button class="ctx-menu-item" data-g="layout">💾 레이아웃 저장/불러오기 ▸</button>
      <button class="ctx-menu-item" data-g="reset">↺ 기본 배치로 복원</button>
      <div class="ctx-menu-divider"></div>
      <button class="ctx-menu-item" data-g="done">✓ 편집 완료</button>`
      : `
      <button class="ctx-menu-item" data-g="edit">✏️ 레이아웃 편집</button>
      <button class="ctx-menu-item" data-g="add">＋ 위젯 추가</button>
      <button class="ctx-menu-item" data-g="bg">🎨 배경 바꾸기</button>
      <button class="ctx-menu-item" data-g="layout">💾 레이아웃 저장/불러오기 ▸</button>`;
    document.body.appendChild(menu);
    gridMenu = menu;
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
    setTimeout(() => document.addEventListener('mousedown', onGridMenuOutside, true), 0);
    menu.querySelectorAll('[data-g]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.g;
        if (act === 'arrange' || act === 'layout') {
          const r = b.getBoundingClientRect();
          closeGridMenu();
          if (act === 'arrange') openArrangeMenu(r.right - 4, r.top);
          else openLayoutMenu(r.right - 4, r.top);
          return;
        }
        closeGridMenu();
        if (act === 'edit') $('d-layoutEditBtn').click();
        else if (act === 'add') $('d-addWidgetBtn').click();
        else if (act === 'bg') {
          if (dashOpenBgPop) dashOpenBgPop({ left: e.clientX, bottom: e.clientY });
          else $('d-bgBtn').click();
        }
        else if (act === 'reset') $('d-layoutResetBtn').click();
        else if (act === 'done') $('d-editDoneBtn').click();
      });
    });
  });

  // ================= 위젯 투명도 (편집 바 슬라이더) + 카드/블록별 테마·투명도(우클릭) + 요약 카드 =================
  // 카드·블록 우클릭 테마는 상단 대시보드 테마(DASH_THEMES)와 같은 팔레트를 쓴다. '기본'은 id ''.
  const CARD_THEMES = DASH_THEMES.map((t) => ({ id: t.id === 'default' ? '' : t.id, label: t.label, sw: t.swatch }));

  async function initCustomization() {
    const grid = $('d-widgetGrid');

    // --- 전체 위젯 투명도 + 흐림(간유리) ---
    // 투명도(--dash-op)는 항상 슬라이더 값 그대로 적용. glassEnabled는 "투명한 배경을 흐릿하게
    // 할지"만 결정 — 끄면 backdrop-filter blur / 글자 후광 없이 뒤 배경이 그대로 선명하게 비친다
    // ("완전 투명 ↔ 간유리" 토글). 설정키 dashboard_glass_enabled.
    let globalOp = 100;
    let glassEnabled = true;
    try {
      const rawOp = await window.itda.settings.get('dashboard_widget_opacity');
      // 주의: `Number(x) || 100`은 저장값이 '0'일 때 100으로 튕긴다(0이 falsy) — 0% 투명이 안 먹던 원인.
      const n = rawOp == null || rawOp === '' ? 100 : Number(rawOp);
      globalOp = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
      glassEnabled = (await window.itda.settings.get('dashboard_glass_enabled')) !== '0';
    } catch (e) {
      /* 기본값 */
    }
    const applyGlobalOp = () => {
      grid.style.setProperty('--dash-op', globalOp / 100);
      grid.classList.toggle('dash-translucent', glassEnabled && globalOp < 95);
    };
    applyGlobalOp();

    // 위젯 헤더 스타일 — 설정 > 대시보드의 전체값. 카드 우클릭에서 카드별로 덮어쓸 수 있고,
    // 최종 적용은 각 .dash-widget[data-headerstyle]로만 한다(카드별 > 전체).
    const HEADER_STYLES = ['minimal', 'accent', 'label', 'floating', 'hidden'];
    let globalHeaderStyle = '';
    try {
      const hs = await window.itda.settings.get('dashboard_header_style');
      if (HEADER_STYLES.includes(hs)) globalHeaderStyle = hs;
    } catch (e) {
      /* standard */
    }
    $('d-opacityRange').value = globalOp;
    $('d-opacityRange').addEventListener('input', (e) => {
      globalOp = Number(e.target.value);
      applyGlobalOp();
    });
    $('d-opacityRange').addEventListener('change', () => {
      window.itda.settings.set({ key: 'dashboard_widget_opacity', value: String(globalOp) }).catch(() => {});
    });
    const glassBox = $('d-glassEnable');
    glassBox.checked = glassEnabled;
    glassBox.addEventListener('change', () => {
      glassEnabled = glassBox.checked;
      applyGlobalOp();
      DASHBOARD_CARDS.forEach((c) => applyCardStyle(c.id));
      grid.querySelectorAll('.dash-block').forEach((el) => applyCardStyle(el.dataset.card));
      window.itda.settings.set({ key: 'dashboard_glass_enabled', value: glassEnabled ? '1' : '0' }).catch(() => {});
    });

    // --- 카드별 테마/투명도 ---
    let cardStyles = {};
    try {
      cardStyles = JSON.parse((await window.itda.settings.get('dashboard_card_styles')) || '{}') || {};
    } catch (e) {
      cardStyles = {};
    }
    const applyCardStyle = (id) => {
      const el = grid.querySelector(`.dash-widget[data-card="${id}"]`);
      if (!el) return;
      const s = cardStyles[id] || {};
      el.dataset.cardtheme = s.theme || '';
      if (s.opacity != null) el.style.setProperty('--dash-op', s.opacity / 100);
      else el.style.removeProperty('--dash-op');
      // 카드별 투명도가 낮으면 간유리 처리 — 단 "흐림" 토글이 켜져 있을 때만(글로벌은 .dash-translucent)
      el.classList.toggle('dash-card-translucent', glassEnabled && s.opacity != null && s.opacity < 95);

      // 테두리: 'none'(없음) / 'strong'(굵게) / #rrggbb(색) / 그 외=기본
      if (s.border === 'none') {
        el.style.borderWidth = '0';
        el.style.borderColor = '';
      } else if (s.border === 'strong') {
        el.style.borderWidth = '2px';
        el.style.borderStyle = 'solid';
        el.style.borderColor = '';
      } else if (/^#[0-9a-f]{6}$/i.test(s.border || '')) {
        el.style.borderWidth = '1.5px';
        el.style.borderStyle = 'solid';
        el.style.borderColor = s.border;
      } else {
        el.style.borderWidth = '';
        el.style.borderStyle = '';
        el.style.borderColor = '';
      }

      // 글자색: #rrggbb면 카드 하위 트리의 --text 계열을 통째로 그 색으로.
      if (/^#[0-9a-f]{6}$/i.test(s.textColor || '')) {
        el.style.setProperty('--text', s.textColor);
        el.style.setProperty('--text-soft', s.textColor);
        el.style.setProperty('--text-faint', s.textColor);
        el.style.color = s.textColor;
      } else {
        el.style.removeProperty('--text');
        el.style.removeProperty('--text-soft');
        el.style.removeProperty('--text-faint');
        el.style.color = '';
      }
      // 헤더 스타일: 카드별(s.header) > 전체(globalHeaderStyle). 'default'/'' = 기본형(속성 제거).
      const effHeader = s.header && s.header !== 'default' ? s.header : s.header === 'default' ? '' : globalHeaderStyle;
      if (HEADER_STYLES.includes(effHeader)) el.dataset.headerstyle = effHeader;
      else el.removeAttribute('data-headerstyle');
      // 강조색: 카드 하위 트리의 --brand만 바꾼다(표면색은 그대로). #rrggbb만 허용.
      if (/^#[0-9a-f]{6}$/i.test(s.accent || '')) {
        el.style.setProperty('--brand', s.accent);
        el.style.setProperty('--brand-soft', s.accent + '22');
      } else {
        el.style.removeProperty('--brand');
        el.style.removeProperty('--brand-soft');
      }
    };
    DASHBOARD_CARDS.forEach((c) => applyCardStyle(c.id));
    grid.querySelectorAll('.dash-block').forEach((el) => applyCardStyle(el.dataset.card));

    let cardMenu = null;
    const closeCardMenu = () => {
      cardMenu?.remove();
      cardMenu = null;
      document.removeEventListener('mousedown', onCardMenuOutside, true);
    };
    function onCardMenuOutside(e) {
      if (cardMenu && !cardMenu.contains(e.target)) closeCardMenu();
    }
    const HEADER_OPTS = [
      ['default', '기본'],
      ['minimal', '미니멀'],
      ['accent', '악센트'],
      ['label', '라벨'],
      ['floating', '플로팅'],
      ['hidden', '숨김'],
    ];
    function openCardMenu(x, y, cardId, isBlock) {
      closeCardMenu();
      const s = cardStyles[cardId] || {};
      const views = !isBlock && CARD_VIEWS[cardId];
      const curView = views ? getWidgetView(cardId, views) : null;
      const curHeader = s.header || 'default';
      const menu = document.createElement('div');
      menu.className = 'ctx-menu dash-card-menu';
      menu.innerHTML = `
        ${
          views
            ? `<div class="dcm-label">표현 방식</div>
               <div class="dcm-views">${views.map(([v, l]) => `<button class="dcm-view ${v === curView ? 'active' : ''}" data-view="${v}">${escapeHtml(l)}</button>`).join('')}</div>`
            : ''
        }
        ${
          isBlock
            ? ''
            : `<div class="dcm-label">헤더</div>
               <div class="dcm-views">${HEADER_OPTS.map(([v, l]) => `<button class="dcm-header ${v === curHeader ? 'active' : ''}" data-header="${v}">${escapeHtml(l)}</button>`).join('')}</div>
               <div class="dcm-label">강조색</div>
               <div class="dcm-accent">
                 <button class="dcm-accent-reset ${s.accent ? '' : 'active'}" data-accent="">기본</button>
                 <input type="color" class="dcm-accent-pick" value="${/^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#6c8cf5'}" />
               </div>`
        }
        <div class="dcm-label">테마</div>
        <div class="dcm-themes">
          ${CARD_THEMES.map((t) => `<button class="dcm-swatch ${(s.theme || '') === t.id ? 'active' : ''}" data-theme="${t.id}" title="${t.label}" style="background:${t.sw}"></button>`).join('')}
        </div>
        <div class="dcm-label">배경 투명도 <span class="dcm-opval">${s.opacity ?? 100}%</span></div>
        <input type="range" class="dcm-op" min="0" max="100" step="5" value="${s.opacity ?? 100}" />
        <div class="dcm-label">테두리</div>
        <div class="dcm-views">
          ${[['', '기본'], ['none', '없음'], ['strong', '굵게']].map(([v, l]) => `<button class="dcm-border ${(s.border || '') === v ? 'active' : ''}" data-border="${v}">${l}</button>`).join('')}
          <input type="color" class="dcm-border-pick" title="테두리 색" value="${/^#[0-9a-f]{6}$/i.test(s.border || '') ? s.border : '#c9ccd4'}" />
        </div>
        <div class="dcm-label">글자색</div>
        <div class="dcm-accent">
          <button class="dcm-text-reset ${/^#[0-9a-f]{6}$/i.test(s.textColor || '') ? '' : 'active'}" data-textcolor="">기본</button>
          <input type="color" class="dcm-text-pick" value="${/^#[0-9a-f]{6}$/i.test(s.textColor || '') ? s.textColor : '#2b2e3a'}" />
        </div>
        ${isBlock ? '' : `<div class="ctx-menu-divider"></div><button class="ctx-menu-item" data-act="hide">🙈 이 카드 숨기기</button>`}`;
      document.body.appendChild(menu);
      cardMenu = menu;
      menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
      menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
      setTimeout(() => document.addEventListener('mousedown', onCardMenuOutside, true), 0);

      const persist = () => window.itda.settings.set({ key: 'dashboard_card_styles', value: JSON.stringify(cardStyles) }).catch(() => {});
      const patchStyle = (patch) => {
        cardStyles[cardId] = { ...(cardStyles[cardId] || {}), ...patch };
        applyCardStyle(cardId);
      };
      menu.querySelectorAll('[data-view]').forEach((b) => {
        b.addEventListener('click', () => {
          menu.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
          setWidgetView(cardId, b.dataset.view);
          CARD_VIEW_RELOAD[cardId]?.();
        });
      });
      menu.querySelectorAll('[data-header]').forEach((b) => {
        b.addEventListener('click', () => {
          menu.querySelectorAll('[data-header]').forEach((x) => x.classList.toggle('active', x === b));
          patchStyle({ header: b.dataset.header === 'default' ? undefined : b.dataset.header });
          persist();
        });
      });
      const accentPick = menu.querySelector('.dcm-accent-pick');
      const accentReset = menu.querySelector('.dcm-accent-reset');
      accentPick?.addEventListener('input', () => {
        accentReset.classList.remove('active');
        patchStyle({ accent: accentPick.value });
      });
      accentPick?.addEventListener('change', persist);
      accentReset?.addEventListener('click', () => {
        accentReset.classList.add('active');
        patchStyle({ accent: undefined });
        persist();
      });
      menu.querySelectorAll('[data-theme]').forEach((b) => {
        b.addEventListener('click', () => {
          menu.querySelectorAll('[data-theme]').forEach((x) => x.classList.toggle('active', x === b));
          patchStyle({ theme: b.dataset.theme || undefined });
          persist();
        });
      });
      const opInput = menu.querySelector('.dcm-op');
      opInput.addEventListener('input', () => {
        menu.querySelector('.dcm-opval').textContent = `${opInput.value}%`;
        patchStyle({ opacity: Number(opInput.value) });
      });
      opInput.addEventListener('change', persist);

      // 테두리: 프리셋 버튼(기본/없음/굵게) + 색 선택
      const borderPick = menu.querySelector('.dcm-border-pick');
      const setBorderActive = (v) =>
        menu.querySelectorAll('[data-border]').forEach((b) => b.classList.toggle('active', b.dataset.border === v));
      menu.querySelectorAll('[data-border]').forEach((b) => {
        b.addEventListener('click', () => {
          setBorderActive(b.dataset.border);
          patchStyle({ border: b.dataset.border || undefined });
          persist();
        });
      });
      borderPick?.addEventListener('input', () => {
        setBorderActive(null);
        patchStyle({ border: borderPick.value });
      });
      borderPick?.addEventListener('change', persist);

      // 글자색: 기본 or 색 선택
      const textPick = menu.querySelector('.dcm-text-pick');
      const textReset = menu.querySelector('.dcm-text-reset');
      textPick?.addEventListener('input', () => {
        textReset.classList.remove('active');
        patchStyle({ textColor: textPick.value });
      });
      textPick?.addEventListener('change', persist);
      textReset?.addEventListener('click', () => {
        textReset.classList.add('active');
        patchStyle({ textColor: undefined });
        persist();
      });

      menu.querySelector('[data-act="hide"]')?.addEventListener('click', async () => {
        closeCardMenu();
        await toggleSummaryOrCard(cardId, false);
      });
    }

    grid.querySelectorAll('.dash-widget:not(.dash-block)').forEach((el) => {
      const cardId = el.id?.replace('d-card-', '');
      if (!cardId) return;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCardMenu(e.clientX, e.clientY, cardId, false);
      });
    });
    // 꾸미기 블록 우클릭 → 투명도만 (테마는 블록마다 ⚙ 설정에 따로 있음)
    const attachBlockMenu = (el) => {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCardMenu(e.clientX, e.clientY, el.dataset.card, true);
      });
    };
    grid.querySelectorAll('.dash-block').forEach(attachBlockMenu);

    // 업무 카드 숨기기(우클릭 메뉴) — dashboard_cards 설정과 같은 값 사용
    async function toggleSummaryOrCard(cardId, visible) {
      let cfg = {};
      try {
        cfg = JSON.parse((await window.itda.settings.get('dashboard_cards')) || '{}');
      } catch (e) {
        /* {} */
      }
      const defaults = Object.fromEntries(DASHBOARD_CARDS.map((c) => [c.id, c.default]));
      cfg = { ...defaults, ...cfg, [cardId]: visible };
      await window.itda.settings.set({ key: 'dashboard_cards', value: JSON.stringify(cfg) }).catch(() => {});
      const el = $(`d-card-${cardId}`);
      if (el) el.style.display = visible ? '' : 'none';
    }

    return { closeCardMenu, attachBlockMenu, applyCardStyle };
  }
  const customization = await initCustomization();

  // --- 상단 요약 카드: 접기/펼치기 + 카드 선택(우클릭) ---
  async function initSummaryRow() {
    const gridEl = $('d-summaryGrid');
    const expandBtn = $('d-summaryExpand');

    let collapsed = false;
    let cards = { todo: true, event: true, memo: true, postit: true, notif: true };
    try {
      collapsed = (await window.itda.settings.get('dashboard_summary_collapsed')) === '1';
      const raw = await window.itda.settings.get('dashboard_summary_cards');
      if (raw) cards = { ...cards, ...JSON.parse(raw) };
    } catch (e) {
      /* 기본값 */
    }
    const anyOn = () => Object.values(cards).some(Boolean);
    const isEditing = () => document.getElementById('d-widgetGrid')?.classList.contains('editing');
    // 그리드가 안 보이는 두 경우 — "접기"(collapsed)는 평상시에도 "▾ 펼치기" 바로 바로 복구.
    // "5개 전부 끔"(!anyOn)은 편집 액션이므로 **편집모드에서만** "▾ 다시 켜기" 바를 보여준다
    // (평상시엔 요약 영역이 그냥 비어있고, 편집모드 들어가면 복구 바가 뜬다).
    const applyState = () => {
      gridEl.querySelectorAll('[data-sum]').forEach((c) => {
        c.style.display = cards[c.dataset.sum] ? '' : 'none';
      });
      const allOff = !anyOn();
      gridEl.style.display = collapsed || allOff ? 'none' : '';
      gridEl.classList.toggle('summary-empty', allOff);
      const showBar = collapsed || (allOff && isEditing());
      expandBtn.style.display = showBar ? '' : 'none';
      expandBtn.textContent = allOff ? '▾ 요약 카드 다시 켜기' : '▾ 요약 카드 펼치기';
    };
    applyState();
    // 편집모드 토글(#d-widgetGrid의 .editing 클래스) 시 복구 바 노출 여부 다시 계산
    const widgetGridEl = document.getElementById('d-widgetGrid');
    const editObs = widgetGridEl ? new MutationObserver(() => applyState()) : null;
    editObs?.observe(widgetGridEl, { attributes: true, attributeFilter: ['class'] });

    expandBtn.addEventListener('click', () => {
      collapsed = false;
      // 다 꺼져 있으면 펼치기만으론 여전히 빈 화면이라, 이 경우엔 5개를 전부 다시 켠다.
      if (!anyOn()) {
        Object.keys(cards).forEach((k) => (cards[k] = true));
        window.itda.settings.set({ key: 'dashboard_summary_cards', value: JSON.stringify(cards) }).catch(() => {});
      }
      applyState();
      window.itda.settings.set({ key: 'dashboard_summary_collapsed', value: '0' }).catch(() => {});
    });

    let sumMenu = null;
    const closeSumMenu = () => {
      sumMenu?.remove();
      sumMenu = null;
      document.removeEventListener('mousedown', onSumOutside, true);
    };
    function onSumOutside(e) {
      if (sumMenu && !sumMenu.contains(e.target)) closeSumMenu();
    }
    gridEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      closeSumMenu();
      const LB = { todo: '오늘 할 일', event: '오늘 일정', memo: '메모', postit: '포스트잇', notif: '알림' };
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      menu.innerHTML =
        Object.keys(LB)
          .map(
            (k) => `<button class="ctx-menu-item" data-sc="${k}"><span>${cards[k] ? '☑' : '☐'}</span> ${LB[k]}</button>`
          )
          .join('') +
        `<div class="ctx-menu-divider"></div><button class="ctx-menu-item" data-sc-act="collapse">▴ 요약 카드 접기</button>`;
      document.body.appendChild(menu);
      sumMenu = menu;
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8)}px`;
      setTimeout(() => document.addEventListener('mousedown', onSumOutside, true), 0);
      menu.querySelectorAll('[data-sc]').forEach((b) => {
        b.addEventListener('click', () => {
          const k = b.dataset.sc;
          cards[k] = !cards[k];
          b.querySelector('span').textContent = cards[k] ? '☑' : '☐';
          applyState();
          window.itda.settings.set({ key: 'dashboard_summary_cards', value: JSON.stringify(cards) }).catch(() => {});
        });
      });
      menu.querySelector('[data-sc-act="collapse"]').addEventListener('click', () => {
        closeSumMenu();
        collapsed = true;
        applyState();
        window.itda.settings.set({ key: 'dashboard_summary_collapsed', value: '1' }).catch(() => {});
      });
    });

    return { closeSumMenu, destroy: () => editObs?.disconnect() };
  }
  const summaryRow = await initSummaryRow();


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

  // 상단 요약 카드 더블클릭 — 해당 화면으로 바로 이동. "알림"은 전용 화면이 없어서
  // 대신 전역 상단바의 알림 종(bell) 드롭다운을 그대로 열어준다(중복 구현 안 함).
  root.querySelectorAll('.summary-card[data-nav]').forEach((card) => {
    card.addEventListener('dblclick', () => {
      location.hash = card.dataset.nav;
    });
  });
  $('d-notifSummaryCard')?.addEventListener('dblclick', () => {
    document.getElementById('gt-bellBtn')?.click();
  });

  function refreshDateLabel() {
    $('d-dateLabel').textContent = formatDateLabel(viewDate);
  }
  async function stepDate(dir) {
    viewDate.setDate(viewDate.getDate() + dir);
    viewDate = new Date(viewDate);
    refreshDateLabel();
    await Promise.allSettled([loadTodos(), loadEvents(), loadWorkCenter()]);
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
    const openCount = todos.length - doneCount;
    $('d-todoCount').textContent = `${todos.length}건`;
    $('d-todoSub').textContent = `진행 중 ${openCount} · 완료 ${doneCount}`;

    const listEl = $('d-todoList');
    const emptyEl = $('d-todoEmpty');
    if (todos.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.className = '';

    const view = getWidgetView('todo', TODO_VIEWS);
    const dueLabel = isSameDate(viewDate, new Date()) ? '오늘' : dateStr.slice(5);
    const toggleTodo = async (id, checkboxEl) => {
      try {
        await window.itda.todos.toggle(id);
        loadTodos();
      } catch (err) {
        if (checkboxEl) checkboxEl.checked = !checkboxEl.checked;
        errorToast(err, '상태를 변경하지 못했어요');
      }
    };

    if (view === 'progress') {
      const pct = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;
      listEl.innerHTML = `
        <div class="todo-progress-view">
          <div class="tpv-bar"><div class="tpv-fill" style="width:${pct}%"></div></div>
          <div class="tpv-nums"><b>${pct}%</b><span>${doneCount}개 완료 · ${openCount}개 남음</span></div>
        </div>`;
      return;
    }

    if (view === 'focus') {
      const focus = todos.find((t) => !t.is_done) || todos[0];
      listEl.innerHTML = `
        <div class="todo-focus-view" data-id="${focus.id}">
          <span class="tfv-eyebrow">지금 집중할 일</span>
          <b class="tfv-title ${focus.is_done ? 'done' : ''}">${escapeHtml(focus.title)}</b>
          <span class="tfv-due">${focus.due_date ? focus.due_date.slice(5) : dueLabel}</span>
          <button class="btn-secondary tfv-done" data-id="${focus.id}">${focus.is_done ? '↩ 완료 취소' : '✓ 완료'}</button>
          ${openCount > 1 ? `<span class="tfv-more dash-row-link" data-nav="#/todo">그 외 ${openCount - 1}개 →</span>` : ''}
        </div>`;
      bindDashRowNav(listEl);
      listEl.querySelector('.tfv-done').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTodo(Number(e.currentTarget.dataset.id));
      });
      return;
    }

    // list / compact — 같은 마크업, compact는 CSS로 촘촘하게 + N개만 노출
    const LIMIT = view === 'compact' ? 4 : todos.length;
    const shown = todos.slice(0, LIMIT);
    if (view === 'compact') listEl.className = 'todo-view-compact';
    listEl.innerHTML =
      shown
        .map(
          (t) => `
        <div class="todo-row ${t.is_done ? 'done' : ''} dash-row-link" data-nav="#/todo" data-id="${t.id}">
          <input type="checkbox" data-id="${t.id}" ${t.is_done ? 'checked' : ''} />
          <span class="cat" style="background:${t.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(t.title)}</span>
          <span class="due">${dueLabel}</span>
        </div>`
        )
        .join('') +
      (todos.length > LIMIT ? `<a class="todo-more-link dash-row-link" data-nav="#/todo">+ ${todos.length - LIMIT}개 더보기</a>` : '');
    bindDashRowNav(listEl);
    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleTodo(Number(e.target.dataset.id), e.target);
      });
    });
    listEl.querySelectorAll('.todo-row').forEach((row) => {
      attachContextMenu(
        row,
        () => {
          const t = todos.find((x) => x.id === Number(row.dataset.id));
          return { type: 'todo', id: Number(row.dataset.id), dueDate: t?.due_date || null, isDone: !!t?.is_done };
        },
        { onDeleted: () => loadTodos() }
      );
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
    listEl.className = '';

    const openEvt = (id) => {
      const evt = events.find((e) => e.id === Number(id));
      if (evt) eventDetailModal.openDetail({ ...evt, source: 'local' });
    };
    const view = getWidgetView('event', EVENT_VIEWS);

    if (view === 'next') {
      const now = new Date();
      const next = events.find((e) => e.start_at && new Date(e.start_at) >= now) || events[0];
      const end = next.end_at ? ' – ' + next.end_at.slice(11, 16) : '';
      listEl.innerHTML = `
        <div class="todo-focus-view" data-id="${next.id}">
          <span class="tfv-eyebrow">다음 일정</span>
          <b class="tfv-title">${escapeHtml(next.title)}</b>
          <span class="tfv-due">${(next.start_at || '').slice(11, 16)}${end}</span>
          ${events.length > 1 ? `<span class="tfv-more dash-row-link" data-nav="#/calendar">그 외 ${events.length - 1}개 →</span>` : ''}
        </div>`;
      bindDashRowNav(listEl);
      listEl.querySelector('.todo-focus-view').addEventListener('click', (ev) => {
        if (!ev.target.closest('.tfv-more')) openEvt(next.id);
      });
      return;
    }

    const LIMIT = view === 'compact' ? 4 : events.length;
    if (view === 'compact') listEl.className = 'todo-view-compact';
    listEl.innerHTML =
      events
        .slice(0, LIMIT)
        .map(
          (e) => `
        <div class="todo-row event-row" data-id="${e.id}">
          <span class="cat" style="background:${e.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(e.title)}</span>
          <span class="due">${(e.start_at || '').slice(11, 16)}</span>
        </div>`
        )
        .join('') +
      (events.length > LIMIT ? `<a class="todo-more-link" id="d-eventMore">+ ${events.length - LIMIT}개 더보기</a>` : '');
    listEl.querySelector('#d-eventMore')?.addEventListener('click', () => {
      location.hash = '#/calendar';
    });
    listEl.querySelectorAll('.event-row').forEach((row) => {
      row.addEventListener('click', () => openEvt(row.dataset.id));
      attachContextMenu(row, () => ({ type: 'event', id: Number(row.dataset.id) }), { onDeleted: () => loadEvents() });
    });
  }

  // 오늘의 업무센터 — 기존 Todo/일정 데이터를 그대로 읽어 요약만 새로 그린다(신규 데이터 로직 없음).
  // 카운트/일정은 상단 날짜(viewDate)를 따르고, "중요 할 일"은 날짜와 무관하게 (즐겨찾기 OR 우선순위 높음) + 미완료.
  async function loadWorkCenter() {
    const card = $('d-card-workCenter');
    if (!card || card.style.display === 'none') return;
    const dateStr = toDateKey(viewDate);
    const [todayTodos, openTodos, events] = await Promise.all([
      window.itda.todos.list({ fromDate: dateStr, toDate: dateStr }).catch(() => []),
      window.itda.todos.list({ isDone: false }).catch(() => []), // ponytail: 미완료 전체를 받아 클라에서 추림 — 즐겨찾기+높음만 거르는 repo 필터는 필요해지면 추가
      window.itda.events.range({ fromDate: dateStr, toDate: dateStr }).catch(() => []),
    ]);

    // 중요 = 즐겨찾기 ★  또는  우선순위 '높음'(priority 1). 즐겨찾기 > 높음 > 마감일 순으로.
    const important = openTodos
      .filter((t) => t.is_favorite || t.priority === 1)
      .sort((a, b) => (b.is_favorite - a.is_favorite) || (a.priority - b.priority) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));

    $('d-wcTodoCount').textContent = todayTodos.length;
    $('d-wcEventCount').textContent = events.length;

    const todoListEl = $('d-wcTodoList');
    const toggleTodo = async (id, cb) => {
      try {
        await window.itda.todos.toggle(id);
        loadWorkCenter();
      } catch (err) {
        if (cb) cb.checked = !cb.checked;
        errorToast(err, '상태를 변경하지 못했어요');
      }
    };
    if (important.length === 0) {
      todoListEl.innerHTML = `<div class="wc-empty">즐겨찾기 ★ 또는 우선순위 높음인 미완료 할 일이 없어요</div>`;
    } else {
      todoListEl.innerHTML = important
        .slice(0, 6)
        .map(
          (t) => `
        <div class="todo-row dash-row-link" data-nav="#/todo" data-id="${t.id}">
          <input type="checkbox" data-id="${t.id}" />
          <span class="cat" style="background:${t.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(t.title)}</span>
          <span class="wc-flag">${t.is_favorite ? '★' : t.priority === 1 ? '!' : ''}</span>
          <span class="due">${t.due_date ? t.due_date.slice(5) : ''}</span>
        </div>`
        )
        .join('') +
        (important.length > 6 ? `<a class="todo-more-link dash-row-link" data-nav="#/todo">+ ${important.length - 6}개 더보기</a>` : '');
      bindDashRowNav(todoListEl);
      todoListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          toggleTodo(Number(e.target.dataset.id), e.target);
        });
      });
    }

    const evtListEl = $('d-wcEventList');
    if (events.length === 0) {
      evtListEl.innerHTML = `<div class="wc-empty">일정이 없어요</div>`;
    } else {
      evtListEl.innerHTML = events
        .slice(0, 6)
        .map(
          (e) => `
        <div class="todo-row event-row" data-id="${e.id}">
          <span class="cat" style="background:${e.color_hex || CATEGORY_FALLBACK_COLOR}"></span>
          <span class="txt">${escapeHtml(e.title)}</span>
          <span class="due">${e.all_day ? '종일' : (e.start_at || '').slice(11, 16)}</span>
        </div>`
        )
        .join('') +
        (events.length > 6 ? `<a class="todo-more-link" data-nav="#/calendar">+ ${events.length - 6}개 더보기</a>` : '');
      evtListEl.querySelectorAll('.event-row').forEach((row) => {
        row.addEventListener('click', () => {
          const evt = events.find((x) => x.id === Number(row.dataset.id));
          if (evt) eventDetailModal.openDetail({ ...evt, source: 'local' });
        });
      });
      evtListEl.querySelector('.todo-more-link')?.addEventListener('click', () => {
        location.hash = '#/calendar';
      });
    }
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
    listEl.className = '';
    const view = getWidgetView('memo', MEMO_VIEWS);

    if (view === 'snippet') {
      listEl.innerHTML = memos
        .map((m) => {
          const plain = stripHtmlToPlainText(m.content || '');
          const title = m.title || plain.split('\n')[0] || '(제목 없음)';
          const body = (m.title ? plain : plain.split('\n').slice(1).join(' ')).trim();
          return `<div class="memo-snippet-row dash-row-link" data-nav="#/memo" data-id="${m.id}">
            <b>${escapeHtml(title)}</b>${body ? `<p>${escapeHtml(body)}</p>` : ''}
          </div>`;
        })
        .join('');
    } else {
      if (view === 'compact') listEl.className = 'todo-view-compact';
      listEl.innerHTML = memos
        .map(
          (m) =>
            `<div class="todo-row dash-row-link" data-nav="#/memo" data-id="${m.id}"><span class="txt">${escapeHtml(m.title || stripHtmlToPlainText(m.content))}</span></div>`
        )
        .join('');
    }
    bindDashRowNav(listEl);
    listEl.querySelectorAll('.dash-row-link').forEach((row) => {
      attachContextMenu(row, () => ({ type: 'memo', id: Number(row.dataset.id) }), { onDeleted: () => loadMemos() });
    });
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
    listEl.className = '';
    const view = getWidgetView('postit', POSTIT_VIEWS);
    const shown = pinned.slice(0, view === 'grid' ? 6 : 5);

    if (view === 'grid') {
      listEl.className = 'postit-grid-view';
      listEl.innerHTML = shown
        .map(
          (p) => `<div class="postit-mini dash-row-link" data-nav="#/postit" data-id="${p.id}" style="background:${p.color_hex || STICKY_COLORS[0]}">
            <span>${escapeHtml(p.title || stripHtmlToPlainText(p.content || ''))}</span>
          </div>`
        )
        .join('');
    } else {
      listEl.innerHTML = shown
        .map(
          (p) =>
            `<div class="todo-row dash-row-link" data-nav="#/postit" data-id="${p.id}"><span class="txt">${escapeHtml(p.title || stripHtmlToPlainText(p.content))}</span></div>`
        )
        .join('');
    }
    bindDashRowNav(listEl);
    listEl.querySelectorAll('.dash-row-link').forEach((row) => {
      attachContextMenu(row, () => ({ type: 'postit', id: Number(row.dataset.id) }), {
        onDeleted: () => {
          loadPinnedPostits();
          loadSidePostits();
        },
      });
    });
  }

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
    grid.querySelectorAll('.side-postit-card').forEach((card) => {
      attachContextMenu(card, () => ({ type: 'postit', id: Number(card.dataset.id) }), {
        onDeleted: () => {
          loadSidePostits();
          loadPinnedPostits();
        },
      });
    });
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

  root.querySelectorAll('.wc-stat[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = btn.dataset.nav;
    });
  });

  // 업무센터 접기/펼치기 — 크기·위치는 다른 위젯과 똑같이 편집 모드에서 그립·핸들로 조절한다.
  (async () => {
    const wcCard = $('d-card-workCenter');
    const applyWcCollapsed = (c) => wcCard.classList.toggle('wc-collapsed', c);
    let wcCollapsed = (await window.itda.settings.get('dashboard_workcenter_collapsed')) === '1';
    applyWcCollapsed(wcCollapsed);
    $('d-wcCollapse').addEventListener('click', () => {
      wcCollapsed = !wcCollapsed;
      applyWcCollapsed(wcCollapsed);
      window.itda.settings.set({ key: 'dashboard_workcenter_collapsed', value: wcCollapsed ? '1' : '0' }).catch(() => {});
    });
  })();

  await Promise.allSettled([
    loadWorkCenter(),
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
  let unmounted = false;
  const scheduleDashboardRefresh = (entity) => {
    pendingEntities.add(entity);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      if (unmounted) return;
      const entities = pendingEntities;
      pendingEntities = new Set();
      if (entities.has('todo')) loadTodos();
      if (entities.has('event')) loadEvents();
      if (entities.has('todo') || entities.has('event')) loadWorkCenter();
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

  // ================= 대시보드 단축키 (Alt 누르면 안내 오버레이) =================
  setScreenShortcuts('대시보드', [
    { label: '새로 만들기', keys: 'N' },
    { label: '위젯 추가', keys: 'W' },
    { label: '레이아웃 편집', keys: 'E' },
    { label: '사이드 패널', keys: 'S' },
    { label: '이전 / 다음 날짜', keys: '← / →' },
    { label: '오늘로', keys: 'T' },
  ]);
  function handleDashKeys(e) {
    if (isUserTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.modal-overlay.open')) return;
    switch (e.key) {
      case 'n': case 'N': e.preventDefault(); $('d-newBtn').click(); break;
      case 'w': case 'W': e.preventDefault(); $('d-addWidgetBtn').click(); break;
      case 'e': case 'E': e.preventDefault(); $('d-layoutEditBtn').click(); break;
      case 's': case 'S':
        e.preventDefault();
        if ($('d-sideToggle').style.display !== 'none') $('d-sideToggle').click();
        break;
      case 't': case 'T':
        e.preventDefault();
        viewDate = new Date();
        viewDate.setHours(0, 0, 0, 0);
        refreshDateLabel();
        Promise.allSettled([loadTodos(), loadEvents(), loadWorkCenter()]);
        break;
      case 'ArrowLeft': e.preventDefault(); stepDate(-1); break;
      case 'ArrowRight': e.preventDefault(); stepDate(1); break;
      case 'Escape':
        if ($('d-addPanel')?.classList.contains('open')) break; // 위젯 추가 패널은 자체 ESC 처리
        // 열려있는 메뉴/팝오버가 있으면 그것부터 닫는다(각자의 바깥클릭 핸들러 재사용)
        if (document.querySelector('.ctx-menu, .dash-block-config')) {
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          e.preventDefault();
          break;
        }
        if (widgetGrid.isEditing()) {
          e.preventDefault();
          widgetGrid.setEditing(false);
        }
        break;
      default: break;
    }
  }
  document.addEventListener('keydown', handleDashKeys);

  return () => {
    unmounted = true;
    clearInterval(clockTimer);
    clearInterval(blockTickTimer);
    closeBlockConfig();
    closeBgPop();
    closeArrangeMenu();
    closeGridMenu();
    closeLayoutMenu();
    customization?.closeCardMenu();
    summaryRow?.closeSumMenu();
    summaryRow?.destroy();
    document.removeEventListener('keydown', handleDashKeys);
    addPanelEscUnsub?.();
    setScreenShortcuts(null, []);
    eventDetailModal.destroy();
    clearTimeout(flushTimer);
    offDataChanged?.();
    widgetGrid?.destroy();
  };
}
