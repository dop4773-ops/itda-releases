import { escapeHtml, toast, errorToast, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton, WIDGET_ICON } from '../shared/widget-launch-button.js';
import { registerEscClose } from '../shared/esc-close.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { attachDateQuickChips } from '../shared/date-quick-chips.js';
import { confirmSeriesScope } from '../shared/series-scope.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { promptText } from '../shared/text-prompt.js';
import {
  WEEKDAY_LABELS,
  dateKey as toKey,
  parseDateKey as parseKey,
  addDays,
  addMonths,
  startOfWeek,
  isSameDay,
  monthGridDates,
  minutesInDay,
} from '../shared/date-utils.js';

const CAL_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const CHEVRON_LEFT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
const CHEVRON_RIGHT = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
const CLOSE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const SMALL_TRASH_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

const HOUR_START = 6;
const HOUR_END = 22; // 06:00 ~ 22:00 그리드에 표시
const ROW_HEIGHT = 44;
const pad = (n) => String(n).padStart(2, '0');

// 아래 4개(periodLabel/queryRange/groupByDateKey/buildMonthGridHtml/buildTimeGridHtml)는
// 대시보드 우측 캘린더 위젯(dashboard.js)도 동일한 렌더링 로직을 재사용하도록 export한다.
export function periodLabel(view, anchor) {
  if (view === 'month') return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
  if (view === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return start.getMonth() === end.getMonth()
      ? `${start.getMonth() + 1}월 ${start.getDate()}일 - ${end.getDate()}일`
      : `${start.getMonth() + 1}월 ${start.getDate()}일 - ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }
  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월 ${anchor.getDate()}일 (${WEEKDAY_LABELS[anchor.getDay()]})`;
}

export function queryRange(view, anchor) {
  if (view === 'month') {
    const dates = monthGridDates(anchor);
    return { fromDate: toKey(dates[0]), toDate: toKey(dates[41]) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { fromDate: toKey(start), toDate: toKey(addDays(start, 6)) };
  }
  return { fromDate: toKey(anchor), toDate: toKey(anchor) };
}

export function groupByDateKey(events) {
  const map = new Map();
  const addToDay = (key, e) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  };

  events.forEach((e) => {
    // 하루종일 일정(휴가 등)이 여러 날에 걸쳐있으면, 시작일에만 표시되던 예전 버그를 고쳐서
    // start_at~end_at 사이 모든 날짜에 표시되게 한다. 시간이 정해진 일정은 기존처럼 시작일에만.
    if (e.all_day && e.start_at && e.end_at) {
      const startDate = (e.start_at || '').slice(0, 10);
      const endDate = (e.end_at || '').slice(0, 10);
      let cursor = new Date(startDate + 'T00:00:00');
      const last = new Date(endDate + 'T00:00:00');
      // 혹시라도 end가 start보다 앞서는 이상 데이터가 들어와도 무한루프에 빠지지 않도록 방어
      let guard = 0;
      while (cursor <= last && guard < 366) {
        addToDay(toKey(cursor), e);
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    } else {
      addToDay((e.start_at || '').slice(0, 10), e);
    }
  });
  return map;
}

// 순수 HTML 빌더 — 이벤트 바인딩 없이 마크업만 반환 (달력 화면 + 대시보드 위젯이 공유)
// compact:true면 대시보드 사이드 패널용 — pill을 늘어놓지 않고 "점 + 개수"만 표시해서
// 하루에 일정이 몇 개든 셀 높이가 항상 일정하게 유지된다(월 전체 높이가 안정적).
export function buildMonthGridHtml(anchor, byDate, { compact = false, alldayOrder = [] } = {}) {
  const today = new Date();
  const dates = monthGridDates(anchor);
  const weekdayHeaders = WEEKDAY_LABELS.map((w) => `<div class="month-weekday-header">${w}</div>`).join('');

  // 주/일 뷰와 동일하게 — 종일 일정은 사용자가 드래그로 정한 순서(alldayOrder)를 먼저 따르고
  // (없는 건 시작일시), 그 다음 시간 지정 일정이 시작시각 순으로. buildTimeGridHtml과 규칙 일치.
  const alldayIdx = (e) => {
    const i = alldayOrder.indexOf(e.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sortDayEvents = (list) => {
    const cmpStart = (a, b) => (a.start_at || '').localeCompare(b.start_at || '');
    const allday = list.filter((e) => e.all_day).sort((a, b) => alldayIdx(a) - alldayIdx(b) || cmpStart(a, b));
    const timed = list.filter((e) => !e.all_day).sort(cmpStart);
    return [...allday, ...timed];
  };

  const cells = dates
    .map((d) => {
      const key = toKey(d);
      const dayEvents = sortDayEvents(byDate.get(key) || []);
      const isOtherMonth = d.getMonth() !== anchor.getMonth();
      const isToday = isSameDay(d, today);

      if (compact) {
        const indicator =
          dayEvents.length > 0
            ? `<div class="month-compact-indicator" title="${dayEvents.length}개 일정"><span class="month-compact-dot"></span>${dayEvents.length}</div>`
            : '';
        return `
        <div class="month-cell month-cell-compact ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''}" data-date="${key}">
          <span class="date-num">${d.getDate()}</span>
          ${indicator}
        </div>`;
      }

      const visible = dayEvents.slice(0, 3);
      const overflow = dayEvents.length - visible.length;
      return `
      <div class="month-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''}" data-date="${key}">
        <span class="date-num">${d.getDate()}</span>
        ${visible
          .map(
            (e) =>
              `<div class="month-event-pill ${e.source === 'google' ? 'is-google' : ''}" style="background:${e.source === 'google' ? '#9AA5B1' : e.color_hex || 'var(--text-faint)'};color:${e.source === 'google' ? '#fff' : e.text_color || '#000'}" data-source="${e.source || 'local'}">${escapeHtml(e.title)}</div>`
          )
          .join('')}
        ${overflow > 0 ? `<div class="month-more">+${overflow}개 더보기</div>` : ''}
      </div>`;
    })
    .join('');

  return `<div class="month-grid ${compact ? 'month-grid-compact' : ''}">${weekdayHeaders}${cells}</div>`;
}

// 대시보드 사이드 패널 전용 — 상세 시간대 그리드 대신, 일정이 몇 개든 항상 일정한
// 높이를 유지하는 "간단 목록" 뷰. 하루에 일정이 많으면(구글 캘린더 동기화 등) 몇 개만
// 보여주고 "+N개 더보기"로 접었다 펼 수 있게 해서 카드 비율이 깨지지 않게 한다.
export function buildCompactAgendaHtml(anchor, byDate, dayCount, { maxVisible = 5 } = {}) {
  const today = new Date();
  const days = dayCount === 7 ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor];

  const rowHtml = (e) => {
    const isGoogle = e.source === 'google';
    const timeLabel = e.all_day ? '종일' : (e.start_at || '').slice(11, 16);
    return `
      <div class="agenda-row ${isGoogle ? 'is-google' : ''}" data-id="${e.id}" data-source="${isGoogle ? 'google' : 'local'}">
        <span class="agenda-dot" style="background:${isGoogle ? '#9AA5B1' : e.color_hex || 'var(--text-faint)'}"></span>
        <span class="agenda-time">${timeLabel}</span>
        <span class="agenda-title">${isGoogle ? '📅 ' : ''}${escapeHtml(e.title)}</span>
      </div>`;
  };

  const dayBlocks = days
    .map((d) => {
      const key = toKey(d);
      const dayEvents = (byDate.get(key) || []).slice().sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''));
      const dayLabel = dayCount === 7 ? `<div class="agenda-day-label ${isSameDay(d, today) ? 'is-today' : ''}">${WEEKDAY_LABELS[d.getDay()]} ${d.getDate()}</div>` : '';

      if (dayEvents.length === 0) {
        return `<div class="agenda-day-block">${dayLabel}<div class="agenda-empty">일정이 없어요</div></div>`;
      }

      const visible = dayEvents.slice(0, maxVisible).map(rowHtml).join('');
      const overflowEvents = dayEvents.slice(maxVisible);
      const overflowHtml =
        overflowEvents.length > 0
          ? `<div class="agenda-hidden-rows">${overflowEvents.map(rowHtml).join('')}</div>
             <button class="agenda-more" data-key="${key}" data-label="+${overflowEvents.length}개 더보기">+${overflowEvents.length}개 더보기</button>`
          : '';

      return `<div class="agenda-day-block">${dayLabel}${visible}${overflowHtml}</div>`;
    })
    .join('');

  return `<div class="compact-agenda ${dayCount === 7 ? 'is-week' : ''}">${dayBlocks}</div>`;
}

// 종일 행은 항상 모든 일정을 쌓아서 보여주고, 화면에서 차지하는 높이는 CSS(#c-gridArea .allday-row)의
// 사용자 조절 높이 + 내부 스크롤로 제어한다 — 그래서 종일 일정이 아무리 많아도 시간대 그리드가
// 아래로 밀리지 않는다("종일" 라벨을 눌러 접기/펼치기, 아래 모서리를 드래그해 높이 조절).
export function buildTimeGridHtml(anchor, byDate, dayCount, { deletable = true, alldayOrder = [], alldayCollapsed = false, alldayHeight = 0 } = {}) {
  // 종일 일정은 사용자가 드래그로 정한 순서(alldayOrder)를 우선하고, 순서가 없는 건 시작일시로.
  const alldayIdx = (e) => {
    const i = alldayOrder.indexOf(e.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const sortAllDay = (list) =>
    list.slice().sort((a, b) => alldayIdx(a) - alldayIdx(b) || (a.start_at || '').localeCompare(b.start_at || ''));
  const today = new Date();
  const days = dayCount === 7 ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor];
  const hourCount = HOUR_END - HOUR_START;
  const totalHeight = hourCount * ROW_HEIGHT;

  const dayHeaders = days
    .map((d) => `<div class="time-day-header ${isSameDay(d, today) ? 'is-today' : ''}"><span class="dow">${WEEKDAY_LABELS[d.getDay()]}</span><span>${d.getDate()}</span></div>`)
    .join('');

  const hourLabels = Array.from({ length: hourCount }, (_, i) => `<div class="time-hour-label" style="height:${ROW_HEIGHT}px;">${pad(HOUR_START + i)}:00</div>`).join('');

  // 하루종일 일정은 시간 그리드 안에 채워 넣지 않고, 상단에 고정된 "종일" 행에 따로 쌓는다.
  // 기본은 전부 보이도록 행이 세로로 늘어나고(CSS max-height 60vh에서 스크롤), 시간이 정해진 일정만 아래 시간대 그리드에.
  const alldayRowCells = days
    .map((d) => {
      const key = toKey(d);
      const allDayEvents = sortAllDay((byDate.get(key) || []).filter((e) => e.all_day));
      const bars = allDayEvents
        .map((e) => {
          const isGoogle = e.source === 'google';
          return `
          <div class="allday-bar ${isGoogle ? 'is-google' : ''} ${deletable && !isGoogle ? 'allday-bar-drag' : ''}" ${deletable && !isGoogle ? 'draggable="true"' : ''} style="background:${isGoogle ? '#9AA5B1' : e.color_hex || 'var(--text-faint)'};color:${isGoogle ? '#fff' : e.text_color || '#000'}" data-id="${e.id}" data-source="${isGoogle ? 'google' : 'local'}">
            ${deletable && !isGoogle ? `<button class="event-del" data-action="delete" data-id="${e.id}">${CLOSE_ICON}</button>` : ''}
            <span>${isGoogle ? '📅 ' : ''}${escapeHtml(e.title)}</span>
          </div>`;
        })
        .join('');
      return `<div class="allday-cell ${isSameDay(d, today) ? 'is-today-col' : ''}">${bars}</div>`;
    })
    .join('');

  // 같은 날 시간대가 겹치는(또는 최소 높이 20px 강제 때문에 살짝 겹치는) 일정들을
  // 옆으로 나란히 배치하기 위한 컬럼 계산. 지금까지는 전부 full-width(left:3px;right:3px)로
  // 겹쳐 그려서, 겹치는 구간에서는 나중에 그려진(=화면에 더 위로 쌓이는) 블록만 클릭되고
  // 나머지는 그 밑에 깔려 클릭이 안 먹는 문제가 있었다 — 이를 고치기 위한 그리디 컬럼 배정.
  function assignOverlapColumns(events) {
    const sorted = [...events].sort((a, b) => a._startMin - b._startMin || a._endMin - b._endMin);
    const clusters = [];
    let current = [];
    let clusterEnd = -Infinity;
    for (const e of sorted) {
      if (current.length && e._startMin >= clusterEnd) {
        clusters.push(current);
        current = [];
        clusterEnd = -Infinity;
      }
      current.push(e);
      clusterEnd = Math.max(clusterEnd, e._endMin);
    }
    if (current.length) clusters.push(current);

    clusters.forEach((cluster) => {
      const columns = []; // 각 컬럼에 배정된 이벤트들의 마지막 종료시각만 추적
      cluster.forEach((e) => {
        let placed = false;
        for (let i = 0; i < columns.length; i++) {
          if (columns[i] <= e._startMin) {
            columns[i] = e._endMin;
            e._col = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          e._col = columns.length;
          columns.push(e._endMin);
        }
      });
      cluster.forEach((e) => {
        e._totalCols = columns.length;
      });
    });
    return events;
  }

  const dayColumns = days
    .map((d) => {
      const key = toKey(d);
      const dayEvents = (byDate.get(key) || []).filter((e) => !e.all_day); // 시간이 정해진 일정만
      const withMinutes = dayEvents.map((e) => ({
        ...e,
        _startMin: Math.max(minutesInDay(e.start_at), HOUR_START * 60),
        _endMin: Math.min(minutesInDay(e.end_at), HOUR_END * 60),
      }));
      assignOverlapColumns(withMinutes);
      const blocks = withMinutes
        .map((e) => {
          const pxPerMin = ROW_HEIGHT / 60;
          const top = (e._startMin - HOUR_START * 60) * pxPerMin;
          const height = Math.max(20, (e._endMin - e._startMin) * pxPerMin);
          const isGoogle = e.source === 'google';
          const colWidth = 100 / e._totalCols;
          const leftPct = e._col * colWidth;
          const horizontalStyle =
            e._totalCols > 1
              ? `left:calc(${leftPct}% + 2px);width:calc(${colWidth}% - 4px);`
              : `left:3px;right:3px;`;
          return `
          <div class="time-event-block ${isGoogle ? 'is-google' : ''}" style="top:${top}px;height:${height}px;${horizontalStyle}background:${isGoogle ? '#9AA5B1' : e.color_hex || 'var(--text-faint)'};color:${isGoogle ? '#fff' : e.text_color || '#000'}" data-id="${e.id}" data-source="${isGoogle ? 'google' : 'local'}">
            ${deletable && !isGoogle ? `<button class="event-del" data-action="delete" data-id="${e.id}">${CLOSE_ICON}</button>` : ''}
            <b>${isGoogle ? '📅 ' : ''}${escapeHtml(e.title)}</b>
            ${height > 30 ? `<span>${(e.start_at || '').slice(11, 16)}${e.location ? ' · ' + escapeHtml(e.location) : ''}</span>` : ''}
          </div>`;
        })
        .join('');
      return `<div class="time-day-container ${isSameDay(d, today) ? 'is-today-col' : ''}" style="height:${totalHeight}px;">${blocks}</div>`;
    })
    .join('');

  return `
    <div class="time-grid">
      <div class="time-header-row" style="grid-template-columns:48px repeat(${dayCount},1fr);">
        <div class="time-corner"></div>
        ${dayHeaders}
      </div>
      <div class="allday-row ${alldayCollapsed ? 'is-collapsed' : ''}" style="grid-template-columns:48px repeat(${dayCount},1fr);${!alldayCollapsed && alldayHeight ? `height:${alldayHeight}px;` : ''}">
        <div class="time-corner allday-corner" data-action="toggle-allday-collapse" title="종일 일정 접기/펼치기">종일 ${alldayCollapsed ? '▸' : '▾'}</div>
        ${alldayRowCells}
      </div>
      <div class="time-body-scroll">
        <div class="time-body-grid" style="grid-template-columns:48px repeat(${dayCount},1fr);">
          <div style="grid-column:1;">${hourLabels}</div>
          <div style="grid-column:2 / span ${dayCount};display:grid;grid-template-columns:repeat(${dayCount},1fr);">${dayColumns}</div>
        </div>
      </div>
    </div>`;
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-green">${CAL_ICON}</div>
        <div><h1>일정</h1><p>월/주/일 단위로 일정을 확인하고 관리하세요.</p></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${widgetLaunchButtonHtml('c-scheduleWidgetBtn', '오늘 일정 위젯 열기')}
        <button class="btn" id="c-openAdd">+ 새 일정</button>
      </div>
    </div>

    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="btn-icon" id="c-prev">${CHEVRON_LEFT}</button>
        <span class="cal-period-label" id="c-periodLabel"></span>
        <button class="btn-icon" id="c-next">${CHEVRON_RIGHT}</button>
        <button class="btn-secondary" id="c-today">오늘</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="cal-search" id="c-searchWrap">
          <input type="text" id="c-search" class="input" placeholder="일정 검색 (F)" autocomplete="off" />
          <div class="cal-search-results" id="c-searchResults" style="display:none;"></div>
        </div>
        <button class="btn-secondary" id="c-toggleGoogle" title="구글 캘린더 일정 표시 켜기/끄기">${CAL_ICON} 구글 캘린더</button>
        <div class="tabs">
          <button class="tab active" data-view="month">월</button>
          <button class="tab" data-view="week">주</button>
          <button class="tab" data-view="day">일</button>
        </div>
      </div>
    </div>

    <div id="c-gridArea"><div class="empty">불러오는 중…</div></div>
    <div class="cal-legend" id="c-legend"></div>

    <div class="modal-overlay" id="c-modalOverlay">
      <div class="modal-card">
        <h3 id="c-modalTitle">새 일정</h3>
        <input type="hidden" id="c-editId" />
        <div class="form-row cal-template-row" id="c-templateRow">
          <div class="cal-template-chips" id="c-templateChips"></div>
          <button type="button" class="btn-secondary" id="c-saveTemplate" title="지금 입력한 제목·카테고리·장소·종일을 즐겨찾는 템플릿으로 저장">★ 템플릿 저장</button>
        </div>
        <div class="form-row"><input type="text" id="c-title" class="input" style="flex:1;" placeholder="일정 제목" /></div>
        <div class="form-row">
          <select id="c-category" class="select" style="flex:1;"></select>
          <input type="text" id="c-location" class="input" placeholder="장소" style="flex:1;" />
        </div>
        <div class="form-row">
          <label class="checkbox-row"><input type="checkbox" id="c-allDay" /> 하루종일</label>
        </div>
        <div class="form-row">
          <input type="datetime-local" id="c-start" class="input" style="flex:1;" />
          <input type="datetime-local" id="c-end" class="input" style="flex:1;" placeholder="종료 시각 (선택)" />
        </div>
        <div class="form-row" id="c-recurrenceRow">
          <label style="font-size:12px;color:var(--text-faint);display:flex;align-items:center;gap:6px;">
            반복
            <select id="c-recurrence" class="select">
              <option value="">안 함</option>
              <option value="daily">매일</option>
              <option value="weekly">매주 같은 요일</option>
              <option value="monthly">매월 같은 날짜</option>
            </select>
          </label>
        </div>
        <div class="form-row">
          <textarea id="c-memo" class="input" rows="3" style="flex:1;resize:vertical;" placeholder="내용 (선택)"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="c-cancelAdd">취소</button>
          <button class="btn" id="c-submitAdd">추가</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="c-detailOverlay">
      <div class="modal-card">
        <div class="panel-head">
          <span class="panel-eyebrow">일정 상세</span>
          <button class="btn-icon" id="cd-close" title="닫기">${CLOSE_ICON}</button>
        </div>
        <h3 id="cd-title" style="display:flex;align-items:center;gap:8px;"></h3>
        <input type="hidden" id="cd-detailId" />
        <div class="cd-meta-row" id="cd-time"></div>
        <div class="cd-meta-row" id="cd-location"></div>
        <div class="cd-meta-row" id="cd-memo" style="white-space:pre-wrap;"></div>

        <label class="panel-section-label">🔗 연결된 항목</label>
        <div id="cd-links"></div>

        <div class="modal-actions">
          <button class="btn-secondary panel-delete-btn" id="cd-delete">${SMALL_TRASH_ICON} 삭제</button>
          <button class="btn-secondary" id="cd-openWidget" title="바탕화면에 작은 창으로 띄워요">${WIDGET_ICON} 위젯으로 보기</button>
          <button class="btn" id="cd-edit">수정</button>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let categories = [];
  let currentView = 'month';
  let anchor = new Date();
  anchor.setHours(0, 0, 0, 0);
  let busy = false;
  let unmounted = false; // 비동기 콜백이 화면 전환 뒤에 도착했을 때 DOM 조작으로 크래시 나는 것 방지
  let currentEvents = []; // 상세 모달을 열 때 id로 다시 조회하지 않고 이미 불러온 목록에서 찾기 위함
  let detailIsRecurring = false; // 지금 열려있는 상세가 반복 시리즈의 일부인지 — 삭제 시 범위 선택 팝업을 띄울지 결정
  let showGoogle = true; // 구글 캘린더 위젯을 없애는 대신, 이 화면 안에서 바로 켜고 끌 수 있게
  let alldayCollapsed = false; // 종일 행 접힘 여부(주/일 뷰) — 기본 펼침. app_settings: calendar_allday_collapsed
  let alldayHeight = 0; // 종일 행 사용자 조절 높이(px, 0=자동). app_settings: calendar_allday_height
  let alldayOrder = []; // 종일 일정 사용자 지정 순서(드래그) — app_settings: calendar_allday_order
  let eventTemplates = []; // 즐겨찾는 일정 템플릿 — app_settings: calendar_event_templates

  // ---------- 카테고리 (셀렉트 + 범례) ----------
  async function loadCategories() {
    try {
      categories = await window.itda.categories.list();
      $('c-category').innerHTML =
        `<option value="">카테고리 없음</option>` +
        categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      $('c-legend').innerHTML = categories
        .map((c) => `<div class="item"><span class="dot" style="background:${c.color_hex}"></span>${escapeHtml(c.name)}</div>`)
        .join('');
    } catch (e) {
      errorToast(e, '카테고리를 불러오지 못했어요');
    }
  }

  // ---------- 데이터 로드 + 렌더 ----------
  async function load() {
    if (unmounted || !$('c-periodLabel')) return;
    $('c-periodLabel').textContent = periodLabel(currentView, anchor);
    const gridArea = $('c-gridArea');
    let localEvents = [];
    let googleEvents = [];
    try {
      const { fromDate, toDate } = queryRange(currentView, anchor);
      // 구글 캘린더는 읽기전용 캐시 테이블 조회일 뿐이라 연결 안 되어 있어도 그냥 빈 배열이 옴(에러 아님).
      // showGoogle이 꺼져 있으면 아예 요청하지 않는다(불필요한 조회 생략).
      const [localResult, googleResult] = await Promise.allSettled([
        window.itda.events.range({ fromDate, toDate }),
        showGoogle ? window.itda.googleCalendar.range({ fromDate, toDate }) : Promise.resolve([]),
      ]);
      if (localResult.status === 'fulfilled') localEvents = localResult.value;
      else throw localResult.reason;
      if (googleResult.status === 'fulfilled') googleEvents = googleResult.value;
      // 구글 쪽만 실패하는 경우(예: IPC 자체가 없는 구버전)는 조용히 무시 — 로컬 일정은 정상 표시되어야 하므로
    } catch (e) {
      errorToast(e, '일정을 불러오지 못했어요');
      gridArea.innerHTML = emptyStateBlock({ title: '일정을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }

    currentEvents = localEvents;
    const merged = [
      ...localEvents.map((e) => ({ ...e, source: 'local' })),
      ...googleEvents.map((e) => ({ ...e, source: 'google' })),
    ];
    const byDate = groupByDateKey(merged);
    if (currentView === 'month') renderMonth(gridArea, byDate);
    else renderTimeGrid(gridArea, byDate, currentView === 'week' ? 7 : 1);
  }

  function renderMonth(container, byDate) {
    container.innerHTML = buildMonthGridHtml(anchor, byDate, { alldayOrder });

    const goToDay = (dateKey) => {
      anchor = parseKey(dateKey);
      currentView = 'day';
      root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'day'));
      load();
    };
    container.querySelectorAll('.month-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        // 구글 캘린더처럼 — 날짜 숫자/기존 일정/"+N 더보기"는 그 날 일(day) 뷰로,
        // 칸의 빈 공간을 누르면 그 날짜·하루종일이 기본값인 "새 일정" 창을 띄운다.
        if (e.target.closest('.date-num, .month-event-pill, .month-more')) {
          goToDay(cell.dataset.date);
        } else {
          openModal(null, cell.dataset.date);
        }
      });
    });
  }

  function persistAlldayOrder() {
    window.itda.settings.set({ key: 'calendar_allday_order', value: JSON.stringify(alldayOrder) }).catch(() => {});
  }
  function reorderAllday(draggedId, targetId, before) {
    if (draggedId === targetId || !draggedId) return;
    // 처음 드래그하는 종일 일정들은 지금 화면에 보이는 순서대로 배열에 먼저 시드한다.
    const seen = new Set(alldayOrder);
    currentEvents
      .filter((e) => e.all_day)
      .forEach((e) => {
        if (!seen.has(e.id)) {
          alldayOrder.push(e.id);
          seen.add(e.id);
        }
      });
    alldayOrder = alldayOrder.filter((id) => id !== draggedId);
    let ti = alldayOrder.indexOf(targetId);
    if (ti === -1) ti = alldayOrder.length - 1;
    alldayOrder.splice(before ? ti : ti + 1, 0, draggedId);
    persistAlldayOrder();
    load();
  }

  function renderTimeGrid(container, byDate, dayCount) {
    container.innerHTML = buildTimeGridHtml(anchor, byDate, dayCount, { deletable: true, alldayOrder, alldayCollapsed, alldayHeight });

    container.querySelectorAll('.allday-bar-drag').forEach((bar) => {
      bar.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', bar.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
        bar.classList.add('dragging');
      });
      bar.addEventListener('dragend', () => bar.classList.remove('dragging'));
      bar.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      bar.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = bar.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        reorderAllday(Number(e.dataTransfer.getData('text/plain')), Number(bar.dataset.id), before);
      });
    });

    // "종일 ▾" 라벨 클릭 → 종일 행 접기/펼치기
    container.querySelectorAll('[data-action="toggle-allday-collapse"]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        alldayCollapsed = !alldayCollapsed;
        window.itda.settings.set({ key: 'calendar_allday_collapsed', value: alldayCollapsed ? '1' : '0' }).catch(() => {});
        renderTimeGrid(container, byDate, dayCount);
      });
    });

    // 종일 행 아래 모서리 드래그(CSS resize)로 높이 조절 → 드래그를 놓는 순간(mouseup) 저장
    const alldayRow = container.querySelector('.allday-row');
    if (alldayRow && !alldayCollapsed) {
      alldayRow.addEventListener('mouseup', () => {
        const h = Math.round(alldayRow.getBoundingClientRect().height);
        if (!h || h === alldayHeight) return;
        alldayHeight = h;
        window.itda.settings.set({ key: 'calendar_allday_height', value: String(h) }).catch(() => {});
      });
    }

    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          await window.itda.events.delete(Number(btn.dataset.id));
          toast('휴지통으로 이동했어요');
          load();
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });
    });

    container.querySelectorAll('.time-event-block,.allday-bar').forEach((block) => {
      block.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-action="delete"]')) return;
        if (block.dataset.source === 'google') return; // 구글 일정은 읽기전용 — 로컬 상세모달(삭제/연결) 대상 아님
        const evt = currentEvents.find((e) => e.id === Number(block.dataset.id));
        if (evt) openDetail(evt);
      });
    });

    // 드래그로 바탕화면에 꺼내는 기능은 (그리드 안 손잡이가 너무 작고 잘 안 먹는다는 피드백으로)
    // 여기서는 제공하지 않는다 — 대신 상세 모달의 "위젯으로 보기" 버튼(openDetail 참고)으로 대체.

    // 우클릭 컨텍스트 메뉴 (연결/위젯으로 보기/삭제) — 구글 일정은 읽기전용이라 대상 아님
    container.querySelectorAll('.time-event-block,.allday-bar').forEach((block) => {
      if (block.dataset.source === 'google') return;
      attachContextMenu(
        block,
        () => ({ type: 'event', id: Number(block.dataset.id) }),
        {
          onDeleted: (item) => {
            if ($('c-detailOverlay').classList.contains('open') && Number($('cd-detailId').value) === item.id) closeDetail();
            load();
          },
        }
      );
    });
  }

  // ---------- 일정 상세 모달 (연결된 항목 포함) ----------
  function openDetail(evt) {
    const cat = categories.find((c) => c.id === evt.category_id);
    $('cd-title').innerHTML = `${cat ? `<span class="dot" style="width:9px;height:9px;border-radius:50%;background:${cat.color_hex};display:inline-block;"></span>` : ''}${escapeHtml(evt.title)}`;
    const start = (evt.start_at || '').replace(' ', ' ');
    const end = (evt.end_at || '').slice(11, 16);
    $('cd-time').textContent = evt.all_day ? `${start.slice(0, 10)} · 하루종일` : `${start.slice(0, 16)} ~ ${end}`;
    $('cd-location').textContent = evt.location ? `📍 ${evt.location}` : '';
    $('cd-memo').textContent = evt.memo ? evt.memo : '';
    $('cd-detailId').value = evt.id;
    detailIsRecurring = !!(evt.recurrence_rule || evt.recurrence_parent_id);
    $('cd-edit').style.display = evt.source === 'google' ? 'none' : ''; // 구글 일정은 읽기전용
    $('cd-openWidget').style.display = evt.source === 'google' ? 'none' : ''; // 구글 일정은 위젯으로 못 꺼냄(읽기전용 캐시라 별도 항목 위젯 대상 아님)
    $('c-detailOverlay').classList.add('open');
    mountLinksWidget($('cd-links'), { type: 'event', id: evt.id });
  }
  function closeDetail() {
    $('c-detailOverlay').classList.remove('open');
    $('cd-links').innerHTML = '';
  }
  $('cd-edit').addEventListener('click', () => {
    const id = Number($('cd-detailId').value);
    const evt = currentEvents.find((e) => e.id === id);
    if (!evt) return;
    closeDetail();
    openModal(evt);
  });
  $('cd-close').addEventListener('click', closeDetail);
  $('cd-openWidget').addEventListener('click', async () => {
    const id = Number($('cd-detailId').value);
    try {
      await window.itda.itemWidget.open({ type: 'event', id });
      toast('위젯으로 열었어요');
    } catch (e) {
      errorToast(e, '위젯을 열지 못했어요');
    }
  });
  $('c-detailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'c-detailOverlay') closeDetail();
  });
  $('cd-delete').addEventListener('click', async () => {
    const id = Number($('cd-detailId').value);
    let scope = 'this';
    if (detailIsRecurring) {
      const picked = await confirmSeriesScope($('cd-delete'));
      if (!picked) return; // 취소
      scope = picked;
    }
    try {
      if (scope === 'following') await window.itda.events.deleteSeries({ id, scope: 'following' });
      else await window.itda.events.delete(id);
      toast(scope === 'following' ? '이후 반복 일정을 모두 휴지통으로 옮겼어요' : '휴지통으로 이동했어요');
      closeDetail();
      await load();
    } catch (e) {
      errorToast(e, '삭제하지 못했어요');
    }
  });

  // ---------- 네비게이션 ----------
  function step(dir) {
    if (currentView === 'month') anchor = addMonths(anchor, dir);
    else if (currentView === 'week') anchor = addDays(anchor, dir * 7);
    else anchor = addDays(anchor, dir);
    load();
  }

  $('c-prev').addEventListener('click', () => step(-1));
  $('c-next').addEventListener('click', () => step(1));
  $('c-today').addEventListener('click', () => {
    anchor = new Date();
    anchor.setHours(0, 0, 0, 0);
    load();
  });

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentView = tab.dataset.view;
      load();
    });
  });

  // ---------- 일정 추가/수정 모달 (동일한 폼을 재사용) ----------
  // evt가 있으면 "수정" 모드(값 미리 채움 + events:update 호출), 없으면 "추가" 모드.
  // prefillDate: 'YYYY-MM-DD' — 월간 뷰에서 날짜 칸을 눌러 새로 만들 때 그 날짜를 기본값으로.
  function openModal(evt, prefillDate) {
    const isEdit = !!evt;
    $('c-modalTitle').textContent = isEdit ? '일정 수정' : '새 일정';
    $('c-submitAdd').textContent = isEdit ? '저장' : '추가';
    $('c-editId').value = isEdit ? evt.id : '';

    $('c-title').value = isEdit ? evt.title || '' : '';
    $('c-category').value = isEdit && evt.category_id ? String(evt.category_id) : '';
    $('c-location').value = isEdit ? evt.location || '' : '';
    $('c-memo').value = isEdit ? evt.memo || '' : '';

    // 새 일정은 "하루종일"이 기본값 — 대부분의 일정 등록이 종일이라는 피드백 반영.
    const isAllDay = isEdit ? !!evt.all_day : true;
    $('c-allDay').checked = isAllDay;
    $('c-start').type = isAllDay ? 'date' : 'datetime-local';
    $('c-start').value = isEdit
      ? isAllDay
        ? (evt.start_at || '').slice(0, 10)
        : (evt.start_at || '').slice(0, 16).replace(' ', 'T')
      : prefillDate && isAllDay
        ? prefillDate
        : '';
    $('c-end').style.display = isAllDay ? 'none' : '';
    $('c-end').value = isEdit && !isAllDay ? (evt.end_at || '').slice(0, 16).replace(' ', 'T') : '';

    // 반복은 "새로 만들 때"만 지정 가능 — 이미 있는 시리즈의 반복 패턴을 바꾸는 건 지원 안 함(간단한 반복 기능의 한계)
    $('c-recurrenceRow').style.display = isEdit ? 'none' : '';
    $('c-recurrence').value = '';

    // 즐겨찾는 템플릿 칩은 "새로 만들 때"만
    $('c-templateRow').style.display = isEdit ? 'none' : '';
    if (!isEdit) renderTemplateChips();

    $('c-modalOverlay').classList.add('open');
    $('c-title').focus();
  }

  // ---------- 즐겨찾는 일정 템플릿 ----------
  function applyTemplate(t) {
    $('c-title').value = t.title || '';
    $('c-category').value = t.categoryId ? String(t.categoryId) : '';
    $('c-location').value = t.location || '';
    const wasAllDay = $('c-allDay').checked;
    $('c-allDay').checked = !!t.allDay;
    if (wasAllDay !== !!t.allDay) $('c-allDay').dispatchEvent(new Event('change')); // 시작/종료 입력 형태 갱신
    $('c-title').focus();
  }
  function renderTemplateChips() {
    const wrap = $('c-templateChips');
    if (!eventTemplates.length) {
      wrap.innerHTML = `<span class="cal-template-empty">자주 쓰는 일정을 템플릿으로 저장해 두면 여기서 한 번에 채울 수 있어요</span>`;
      return;
    }
    wrap.innerHTML = eventTemplates
      .map(
        (t, i) => `<span class="cal-template-chip"><button type="button" data-tpl="${i}">${escapeHtml(t.name)}</button><button type="button" class="cal-template-del" data-tpl-del="${i}" title="템플릿 삭제">${CLOSE_ICON}</button></span>`
      )
      .join('');
    wrap.querySelectorAll('[data-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => applyTemplate(eventTemplates[Number(btn.dataset.tpl)]));
    });
    wrap.querySelectorAll('[data-tpl-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        eventTemplates.splice(Number(btn.dataset.tplDel), 1);
        await window.itda.settings.set({ key: 'calendar_event_templates', value: JSON.stringify(eventTemplates) }).catch(() => {});
        renderTemplateChips();
      });
    });
  }
  function closeModal() {
    $('c-modalOverlay').classList.remove('open');
    $('c-modalTitle').textContent = '새 일정';
    $('c-submitAdd').textContent = '추가';
    $('c-editId').value = '';
    $('c-title').value = '';
    $('c-location').value = '';
    $('c-memo').value = '';
    $('c-allDay').checked = false;
    $('c-start').type = 'datetime-local';
    $('c-start').value = '';
    $('c-end').value = '';
    $('c-end').style.display = '';
  }

  // 하루종일 체크 시: 시작 입력을 날짜만 받도록 바꾸고, 종료 시각 입력은 숨김
  // (하루종일 이벤트는 종료 시각 자체가 의미 없으므로 입력을 안 받는다)
  $('c-allDay').addEventListener('change', (e) => {
    const isAllDay = e.target.checked;
    $('c-start').type = isAllDay ? 'date' : 'datetime-local';
    $('c-start').value = '';
    $('c-end').style.display = isAllDay ? 'none' : '';
    $('c-end').value = '';
  });

  attachDateQuickChips($('c-start')); // 시작 일시 옆에 오늘/내일/이번 주/다음 주 퀵칩 — c-start는 열고 닫아도 DOM이 그대로라 한 번만 붙이면 됨

  $('c-openAdd').addEventListener('click', () => openModal());
  $('c-cancelAdd').addEventListener('click', closeModal);

  // "★ 템플릿 저장" — 지금 폼에 입력된 제목/카테고리/장소/종일 여부를 즐겨찾는 템플릿으로 저장
  $('c-saveTemplate').addEventListener('click', async () => {
    const title = $('c-title').value.trim();
    if (!title) {
      toast('먼저 일정 제목을 입력해주세요.');
      return;
    }
    const name = await promptText($('c-saveTemplate'), { title: '템플릿 이름', placeholder: `예: ${title}` });
    if (!name) return;
    eventTemplates.push({
      name: name.trim(),
      title,
      categoryId: $('c-category').value ? Number($('c-category').value) : null,
      location: $('c-location').value.trim() || null,
      allDay: $('c-allDay').checked,
    });
    try {
      await window.itda.settings.set({ key: 'calendar_event_templates', value: JSON.stringify(eventTemplates) });
      toast('템플릿으로 저장했어요');
      renderTemplateChips();
    } catch (e) {
      errorToast(e, '템플릿을 저장하지 못했어요');
    }
  });
  // 일정 등록 폼은 입력 중간에 배경을 실수로 클릭해서 내용이 날아가는 일이 없도록,
  // 바깥 클릭으로는 안 닫히고 Esc(registerEscClose)나 취소 버튼으로만 닫히게 한다.

  $('c-submitAdd').addEventListener('click', async () => {
    if (busy) return;
    const editId = $('c-editId').value ? Number($('c-editId').value) : null;
    const title = $('c-title').value.trim();
    const isAllDay = $('c-allDay').checked;
    const startRaw = $('c-start').value;
    const endRaw = $('c-end').value; // 비워둬도 됨 — 서버가 자동으로 채워준다(events.ipc.js)

    if (!title || !startRaw) {
      toast(isAllDay ? '제목과 날짜를 입력해주세요.' : '제목과 시작 시각을 입력해주세요.');
      return;
    }
    // 종료 시각을 직접 입력한 경우에만 시작보다 늦은지 검사 (비워두면 서버가 기본값을 계산하므로 검사 불필요)
    if (!isAllDay && endRaw && startRaw >= endRaw) {
      toast('종료 시각이 시작 시각보다 늦어야 해요.');
      return;
    }

    busy = true;
    $('c-submitAdd').disabled = true;
    try {
      const categoryId = $('c-category').value ? Number($('c-category').value) : null;
      const location = $('c-location').value.trim() || null;
      const memo = $('c-memo').value.trim() || null;
      // 하루종일이면 날짜(YYYY-MM-DD)만 있으므로 'T00:00'을 붙여 datetime 형태로 맞춘다
      const startAt = isAllDay ? `${startRaw} 00:00:00` : startRaw.replace('T', ' ');
      const endAt = !isAllDay && endRaw ? endRaw.replace('T', ' ') : null; // null이면 서버가 자동 계산
      if (editId) {
        await window.itda.events.update({
          id: editId,
          title,
          categoryId,
          location,
          startAt,
          endAt: endAt ?? (isAllDay ? `${startRaw} 23:59:59` : undefined),
          allDay: isAllDay,
          memo,
        });
        toast('일정을 수정했어요');
      } else {
        await window.itda.events.add({
          title,
          categoryId,
          location,
          startAt,
          endAt,
          allDay: isAllDay,
          memo,
          recurrenceRule: $('c-recurrence').value || null,
        });
      }
      closeModal();
      await load();
    } catch (e) {
      errorToast(e, editId ? '일정을 수정하지 못했어요' : '일정을 추가하지 못했어요');
    } finally {
      busy = false;
      $('c-submitAdd').disabled = false;
    }
  });

  bindWidgetLaunchButton(root, 'c-scheduleWidgetBtn', 'today-schedule');

  // 구글 캘린더 표시 켜기/끄기 — 이전엔 별도 위젯 창으로만 볼 수 있었는데, 이 화면 안에서
  // 바로 켜고 끌 수 있게 하고 위젯 버튼은 없앴다(중복 UI라 판단). 상태는 다음에 열 때도
  // 그대로 유지되도록 설정에 저장한다.
  const toggleGoogleBtn = $('c-toggleGoogle');
  function applyGoogleToggleUi() {
    toggleGoogleBtn.classList.toggle('active', showGoogle);
    toggleGoogleBtn.title = showGoogle ? '구글 캘린더 일정 숨기기' : '구글 캘린더 일정 표시하기';
  }
  try {
    showGoogle = (await window.itda.settings.get('calendar_show_google')) !== '0';
  } catch (e) {
    // 못 불러오면 기본값(켬) 유지
  }
  applyGoogleToggleUi();
  toggleGoogleBtn.addEventListener('click', async () => {
    showGoogle = !showGoogle;
    applyGoogleToggleUi();
    load();
    try {
      await window.itda.settings.set({ key: 'calendar_show_google', value: showGoogle ? '1' : '0' });
    } catch (e) {
      errorToast(e, '설정을 저장하지 못했어요');
    }
  });
  const unsubscribeEsc = registerEscClose(
    () => $('c-detailOverlay').classList.contains('open') || $('c-modalOverlay').classList.contains('open'),
    () => {
      if ($('c-detailOverlay').classList.contains('open')) closeDetail();
      else closeModal();
    }
  );
  // 상세 모달이 열려있을 때 Delete/Backspace로 바로 삭제 (입력창에 포커스가 있으면 텍스트 편집을 방해하지 않도록 제외)
  function handleDeleteKey(e) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!$('c-detailOverlay').classList.contains('open')) return;
    if (e.target.closest?.('input,textarea,[contenteditable="true"]')) return;
    e.preventDefault();
    $('cd-delete').click();
  }
  document.addEventListener('keydown', handleDeleteKey);

  // 일정 화면 단축키 — 입력 중이거나 모달이 열려있으면 가로채지 않는다.
  // Alt를 누르고 있으면 뜨는 오버레이(shell.js)에 아래 목록이 그대로 보인다.
  const CAL_SCREEN_SHORTCUTS = [
    { label: '새 일정', keys: '+' },
    { label: '월 / 주 / 일 뷰', keys: 'M / W / D' },
    { label: '뷰 순환', keys: 'Tab' },
    { label: '이전 / 다음 기간', keys: '← / →' },
    { label: '오늘로', keys: 'T' },
    { label: '일정 검색', keys: 'F' },
    { label: '구글 캘린더 표시', keys: 'G' },
  ];
  function handleQuickKeys(e) {
    if (isUserTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('c-modalOverlay').classList.contains('open') || $('c-detailOverlay').classList.contains('open')) return;
    const goView = (v) => root.querySelector(`.tab[data-view="${v}"]`)?.click();
    switch (e.key) {
      case '+':
        e.preventDefault();
        openModal();
        break;
      case 'Tab': {
        e.preventDefault();
        const order = ['month', 'week', 'day'];
        goView(order[(order.indexOf(currentView) + 1) % order.length]);
        break;
      }
      case 'm': case 'M': e.preventDefault(); goView('month'); break;
      case 'w': case 'W': e.preventDefault(); goView('week'); break;
      case 'd': case 'D': e.preventDefault(); goView('day'); break;
      case 't': case 'T': e.preventDefault(); $('c-today').click(); break;
      case 'ArrowLeft': e.preventDefault(); step(-1); break;
      case 'ArrowRight': e.preventDefault(); step(1); break;
      case 'f': case 'F': e.preventDefault(); $('c-search').focus(); break;
      case 'g': case 'G': e.preventDefault(); $('c-toggleGoogle').click(); break;
      default:
        break;
    }
  }
  document.addEventListener('keydown', handleQuickKeys);
  setScreenShortcuts('일정', CAL_SCREEN_SHORTCUTS);

  // ---------- 일정 검색 (제목/내용 FTS) ----------
  const searchResults = $('c-searchResults');
  function closeSearchResults() {
    searchResults.style.display = 'none';
    searchResults.innerHTML = '';
  }
  async function runEventSearch(term) {
    const q = term.trim();
    if (q.length < 1) return closeSearchResults();
    let hits = [];
    try {
      const rows = await window.itda.search.query(q);
      hits = rows.filter((r) => r.entity_type === 'event');
    } catch (err) {
      // FTS 문법에 안 맞는 입력이면 지금 불러온 목록에서 제목 부분일치로 대체
      hits = currentEvents
        .filter((e) => (e.title || '').toLowerCase().includes(q.toLowerCase()))
        .map((e) => ({ entity_id: e.id, title: e.title }));
    }
    if (!hits.length) {
      searchResults.innerHTML = `<div class="cal-search-empty">"${escapeHtml(q)}" 일정을 찾지 못했어요</div>`;
      searchResults.style.display = 'block';
      return;
    }
    searchResults.innerHTML = hits
      .slice(0, 12)
      .map((h) => `<button type="button" class="cal-search-item" data-id="${h.entity_id}">${escapeHtml(h.title || '(제목 없음)')}</button>`)
      .join('');
    searchResults.style.display = 'block';
    searchResults.querySelectorAll('.cal-search-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const evt = await window.itda.events.get(Number(btn.dataset.id));
          if (!evt) return;
          anchor = parseKey((evt.start_at || '').slice(0, 10));
          currentView = 'day';
          root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === 'day'));
          $('c-search').value = '';
          closeSearchResults();
          await load();
          openDetail({ ...evt, source: 'local' });
        } catch (err) {
          errorToast(err, '일정을 열지 못했어요');
        }
      });
    });
  }
  const debouncedSearch = debounce(runEventSearch, 200);
  $('c-search').addEventListener('input', (e) => debouncedSearch(e.target.value));
  $('c-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('c-search').value = '';
      closeSearchResults();
      $('c-search').blur();
    }
  });
  const handleDocClickForSearch = (e) => {
    if (!$('c-searchWrap').contains(e.target)) closeSearchResults();
  };
  document.addEventListener('click', handleDocClickForSearch);

  // 저장된 종일 순서 / 즐겨찾는 템플릿 / 종일 행 접힘·높이 — 한 번의 IPC로(순차 5회 → 1회)
  try {
    const cs = await window.itda.settings.getMany([
      'calendar_allday_order', 'calendar_event_templates', 'calendar_allday_collapsed', 'calendar_allday_height',
    ]);
    if (cs.calendar_allday_order) alldayOrder = JSON.parse(cs.calendar_allday_order) || [];
    if (cs.calendar_event_templates) eventTemplates = JSON.parse(cs.calendar_event_templates) || [];
    alldayCollapsed = cs.calendar_allday_collapsed === '1';
    alldayHeight = Number(cs.calendar_allday_height) || 0;
  } catch (e) {
    // 깨졌으면 빈 값으로 시작
  }

  await loadCategories();
  await load();

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'event') return;
    if (isUserTyping()) return;
    debouncedLoad();
  });

  return () => {
    unmounted = true;
    unsubscribeEsc();
    document.removeEventListener('keydown', handleDeleteKey);
    document.removeEventListener('keydown', handleQuickKeys);
    document.removeEventListener('click', handleDocClickForSearch);
    setScreenShortcuts(null, []);
    offDataChanged?.();
  };
}
