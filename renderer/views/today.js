/**
 * 오늘 — 아침에 한 번 보는 요약 화면.
 * 오늘의 일정·마감 할 일을 시간순으로 섞어서 보여주고, 지난 미완료(최근 7일)·입퇴원(메신저 연동을 켠 경우)·내일 미리보기를 곁들인다.
 * 데이터는 기존 IPC(events/todos/messenger)만 쓰고, 화면은 데이터가 바뀌면 자동으로 다시 그린다.
 */
import { escapeHtml, errorToast, toast, goToHash, isUserTyping } from '../shared/ui-utils.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { mountEventDetailModal } from '../shared/event-detail-modal.js';
import { registerEscClose } from '../shared/esc-close.js';
import { buildTimeline, pickOverdue, OVERDUE_DAYS, toKey, addDays, eventState, nextUp, minutesText, greeting, weekKeys, countByDay, nowMinutes } from '../shared/today-logic.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const md = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const SUN_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

// 가장 오래 밀린 할 일이 며칠 전인지(없으면 0)
function oldestOverdueDays(openTodos, today) {
  const dues = openTodos.filter((t) => t.due_date && t.due_date < today).map((t) => t.due_date).sort();
  return dues.length ? Math.round((new Date(`${today}T00:00:00`) - new Date(`${dues[0]}T00:00:00`)) / 86400000) : 0;
}

export async function mount(root) {
  let realToday = toKey(new Date());
  // 화면이 보여주는 날 — 처음엔 오늘이고 ‹ › 로 옮긴다. today/tomorrow는 "보는 날"과 그다음 날을 뜻한다
  let today = realToday;
  let tomorrow = toKey(addDays(new Date(), 1));
  const isToday = () => today === realToday;
  const dayLabel = (key) => {
    const d = new Date(`${key}T00:00:00`);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
  };
  let unmounted = false;
  let seq = 0;

  root.innerHTML = `<div class="td-page">
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-green">${SUN_ICON}</div>
        <div><h1 id="td-h1">${dayLabel(today)}</h1><p id="td-sub">불러오는 중…</p></div>
      </div>
      <div class="td-head-tools">
        <button class="btn-secondary td-navbtn" id="td-prevDay" title="전날 (←)">‹</button>
        <button class="btn-secondary" id="td-goToday" title="오늘로 (T)" style="display:none;">오늘</button>
        <button class="btn-secondary td-navbtn" id="td-nextDay" title="다음 날 (→)">›</button>
        <button class="btn-secondary" id="td-refresh">${REFRESH_ICON} 새로고침</button>
      </div>
    </div>
    <div class="td-hero" id="td-hero"></div>
    <div class="td-add"><input type="text" id="td-addInput" class="input" maxlength="200" placeholder="할 일 추가 — 입력하고 Enter (마감은 지금 보는 날)" /></div>
    <div class="td-undo" id="td-undo" style="display:none;"></div>
    <div class="td-stats" id="td-stats"></div>
    <div class="td-week" id="td-week"></div>
    <div class="td-grid">
      <div class="panel td-timeline"><div class="panel-head"><h3 id="td-tlTitle">오늘 하루</h3></div><div id="td-timeline"></div></div>
      <div class="td-side">
        <div class="panel" id="td-admPanel" style="display:none;"><div class="panel-head"><h3>입퇴원</h3><button class="btn-secondary" id="td-copy">전달 문구 복사</button></div><div id="td-adm"></div></div>
        <div class="panel" id="td-overPanel"><div class="panel-head"><h3>지난 미완료</h3><button class="btn-secondary" id="td-reschedAll" style="display:none;"></button></div><div id="td-over"></div></div>
        <div class="panel"><div class="panel-head"><h3 id="td-nextTitle">내일 미리보기</h3><span class="td-date" id="td-nextDate"></span></div><div id="td-next"></div></div>
      </div>
    </div></div>`;
  // 이벤트는 root가 아니라 이 화면 안쪽 요소에 건다 — root는 화면을 옮겨도 그대로라 리스너가 쌓여 중복 실행된다
  const page = root.querySelector('.td-page');
  const $ = (id) => page.querySelector(`#${id}`);

  // 상단 카드·할 일을 누르면 화면을 옮기지 않고 팝업으로 보여준다. 일정 상세 모달보다 먼저 만들어 DOM에서 앞에 두면
  // 목록 팝업 위에 일정 상세가 겹쳐 뜬다(닫으면 목록으로 돌아옴).
  const state = { events: [], todayTodos: [], overdueAll: [], admItems: null, week: null };
  let popup = null; // { kind: 'events'|'todos'|'overdue'|'adm'|'todo', id? }
  const popupEl = document.createElement('div');
  popupEl.className = 'modal-overlay td-popup';
  popupEl.innerHTML = `<div class="modal-card td-popup-card">
    <div class="td-popup-head"><h3 id="tdp-title"></h3><button class="btn-icon" id="tdp-close" title="닫기">✕</button></div>
    <div id="tdp-body" class="td-popup-body"></div>
    <div class="modal-actions" id="tdp-actions"></div>
  </div>`;
  root.appendChild(popupEl);
  const closePopup = () => {
    popup = null;
    popupEl.classList.remove('open');
  };
  // 일정 상세 같은 다른 모달이 위에 떠 있으면 그쪽 Esc가 먼저 닫히게, 이 팝업은 혼자 열려 있을 때만 닫는다
  const offEsc = registerEscClose(() => popupEl.classList.contains('open') && document.querySelectorAll('.modal-overlay.open').length === 1, closePopup);
  popupEl.addEventListener('click', (e) => {
    if (e.target === popupEl || e.target.closest('#tdp-close')) closePopup();
  });

  const eventDetailModal = mountEventDetailModal(root, { onChange: () => load() });

  const todoRow = (t, { showDate = false } = {}) => `
    <div class="td-row ${t.status === 'done' ? 'done' : ''}" data-todo="${t.id}">
      <input type="checkbox" data-check="${t.id}" ${t.status === 'done' ? 'checked' : ''} />
      <span class="td-dot" style="background:${t.color_hex || 'var(--text-faint)'}"></span>
      <span class="td-txt" data-todo-open="${t.id}"><b>${escapeHtml(t.title)}</b></span>
      ${t.category_name && !showDate ? `<span class="td-chip">${escapeHtml(t.category_name)}</span>` : ''}
      ${t.is_favorite ? '<span class="td-flag">★</span>' : t.priority === 1 ? '<span class="td-flag hi">중요</span>' : ''}
      ${showDate ? `<span class="td-when">${md(t.due_date)}</span>` : ''}
      ${showDate && isToday() ? `<button class="td-mini" data-resched="${t.id}" title="오늘로 옮기기">오늘로</button>` : ''}
    </div>`;

  // 타임라인 한 줄 — nowMin이 있으면(오늘을 볼 때) 끝난 일정은 흐리게, 진행 중인 일정은 강조
  function lineHtml(r, nowMin) {
    if (r.type === 'todo') return `<div class="td-line"><span class="td-time"><b>${escapeHtml(r.time)}</b></span>${todoRow(r.data)}</div>`;
    const e = r.data;
    const st = nowMin === null ? '' : eventState(e, nowMin);
    const end = !e.all_day && (e.end_at || '').slice(0, 10) === (e.start_at || '').slice(0, 10) ? (e.end_at || '').slice(11, 16) : '';
    const color = e.color_hex || 'var(--text-faint)';
    return `<div class="td-line ${st ? `st-${st}` : ''}"><span class="td-time"><b>${escapeHtml(r.time)}</b>${end && end !== r.time ? `<small>~${end}</small>` : ''}</span>
      <div class="td-row td-ev" data-event="${e.id}" style="--ev:${color}">
        <span class="td-bar"></span>
        <span class="td-ev-main"><span class="td-txt"><b>${escapeHtml(e.title)}</b></span>${e.memo ? `<span class="td-memo">${escapeHtml(String(e.memo).split('\n')[0])}</span>` : ''}</span>
        ${st === 'now' ? '<span class="td-live">진행 중</span>' : ''}
        ${e.category_name ? `<span class="td-chip" style="--chip:${color}">${escapeHtml(e.category_name)}</span>` : ''}
        ${e.location ? `<span class="td-when">📍 ${escapeHtml(e.location)}</span>` : ''}
      </div></div>`;
  }

  function renderTimeline(events, todos) {
    const rows = buildTimeline(events, todos);
    if (!rows.length) {
      $('td-timeline').innerHTML = `<div class="td-empty">${isToday() ? '오늘은' : '이 날은'} 일정도 마감도 없어요. 여유로운 하루네요.</div>`;
      return;
    }
    const nowMin = isToday() ? nowMinutes() : null;
    const nowKey = nowMin === null ? null : `${String(Math.floor(nowMin / 60)).padStart(2, '0')}:${String(nowMin % 60).padStart(2, '0')}`;
    let marked = nowKey === null;
    const out = [];
    rows.forEach((r) => {
      // "지금" 줄 — 아직 안 지난 첫 항목 바로 앞에 한 번만
      if (!marked && r.sort > nowKey) {
        out.push(`<div class="td-nowline"><span>지금 ${nowKey}</span></div>`);
        marked = true;
      }
      out.push(lineHtml(r, nowMin));
    });
    if (!marked) out.push(`<div class="td-nowline"><span>지금 ${nowKey}</span></div>`);
    $('td-timeline').innerHTML = out.join('');
  }

  // 맨 위 요약 — 인사 + 지금/다음 일정 + 오늘 할 일 진행도
  function renderHero() {
    const total = state.todayTodos.length;
    const done = state.todayTodos.filter((t) => t.status === 'done').length;
    const open = total - done;
    let head;
    let line;
    if (isToday()) {
      head = greeting(new Date().getHours());
      const { now, next } = nextUp(state.events, nowMinutes());
      const t = (ev) => (ev.start_at || '').slice(11, 16);
      if (now) line = `<em>지금</em> <b>${escapeHtml(now.title)}</b> <span>${t(now)}${now.end_at ? `~${(now.end_at || '').slice(11, 16)}` : ''}</span>`;
      else if (next) line = `다음 일정 <b>${t(next.event)}</b> <b>${escapeHtml(next.event.title)}</b> <span>${minutesText(next.inMin)}</span>`;
      else line = state.events.length ? '오늘 남은 시간 일정은 모두 끝났어요' : '오늘은 정해진 시간 일정이 없어요';
    } else {
      const diff = Math.round((new Date(`${today}T00:00:00`) - new Date(`${realToday}T00:00:00`)) / 86400000);
      head = diff > 0 ? `${diff}일 뒤` : `${-diff}일 전`;
      line = `일정 <b>${state.events.length}</b>건 · 마감 <b>${open}</b>건`;
    }
    const pct = total ? Math.round((done / total) * 100) : 0;
    const C = 2 * Math.PI * 20;
    $('td-hero').innerHTML = `
      <div class="td-hero-main"><span class="td-hero-hi">${escapeHtml(head)}</span><div class="td-hero-line">${line}</div></div>
      <div class="td-hero-prog" title="마감 할 일 ${done}/${total} 완료">
        <svg width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="20" class="td-ring-bg"/><circle cx="26" cy="26" r="20" class="td-ring" stroke-dasharray="${(C * pct) / 100} ${C}" transform="rotate(-90 26 26)"/></svg>
        <div><b>${total ? `${done}/${total}` : '–'}</b><small>${total ? (open ? `${open}건 남음` : '모두 완료!') : '마감 없음'}</small></div>
      </div>`;
  }

  // 이번 주 한눈에 — 날짜를 누르면 그날로 이동
  function renderWeek() {
    if (!state.week) {
      $('td-week').innerHTML = '';
      return;
    }
    const { keys, counts } = state.week;
    $('td-week').innerHTML = keys
      .map((k) => {
        const c = counts[k];
        const d = new Date(`${k}T00:00:00`);
        return `<button class="td-wd ${k === today ? 'sel' : ''} ${k === realToday ? 'real' : ''} ${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}" data-day="${k}">
          <span class="td-wd-dow">${WEEK[d.getDay()]}</span><b>${d.getDate()}</b>
          <span class="td-wd-cnt">${c.events || c.todos ? `${c.events ? `<i class="ev">${c.events}</i>` : ''}${c.todos ? `<i class="td">${c.todos}</i>` : ''}` : '<i class="none">·</i>'}</span>
        </button>`;
      })
      .join('');
  }

  function renderAdmission(items) {
    const list = items.filter((i) => i.date === today && (i.kind === 'admission' || i.kind === 'discharge'));
    $('td-adm').innerHTML = list.length
      ? list
          .sort((a, b) => a.timeKey - b.timeKey)
          .map((i) => `<div class="td-row"><span class="td-pill ${i.kind === 'admission' ? 'in' : 'out'}">${i.kind === 'admission' ? '입원' : '퇴원'}</span><span class="td-txt">${escapeHtml(i.time ? `${i.time} ` : '')}${escapeHtml(i.person)}${i.supText ? `<small>${escapeHtml(i.supText)}</small>` : ''}</span></div>`)
          .join('')
      : `<div class="td-empty">${isToday() ? '오늘' : '이 날'} 불러온 입원·퇴원이 없어요.</div>`;
  }

  function renderOverdue({ recent, older }) {
    $('td-over').innerHTML = recent.length || older
      ? recent.map((t) => todoRow(t, { showDate: true })).join('') + (older ? `<div class="td-more" data-pop="overdue">${OVERDUE_DAYS}일 이전 ${older}건 더 있어요 →</div>` : '')
      : '<div class="td-empty">밀린 할 일이 없어요.</div>';
  }

  const popTitle = (k) => ({ events: '일정', todos: '마감 할 일', overdue: '지난 미완료', adm: '입퇴원' }[k] ? `${k === 'overdue' || !isToday() ? '' : '오늘 '}${{ events: '일정', todos: '마감 할 일', overdue: '지난 미완료', adm: '입퇴원' }[k]}` : '');
  async function renderPopup() {
    const body = popupEl.querySelector('#tdp-body');
    const actions = popupEl.querySelector('#tdp-actions');
    const title = popupEl.querySelector('#tdp-title');
    actions.innerHTML = '<button class="btn-secondary" id="tdp-done">닫기</button>';
    actions.querySelector('#tdp-done').addEventListener('click', closePopup);
    if (popup.kind === 'events') {
      title.textContent = `${popTitle('events')} ${state.events.length}건`;
      body.innerHTML = state.events.length
        ? buildTimeline(state.events, []).map((r) => lineHtml(r, isToday() ? nowMinutes() : null)).join('')
        : `<div class="td-empty">${isToday() ? '오늘 ' : ''}일정이 없어요.</div>`;
    } else if (popup.kind === 'todos' || popup.kind === 'overdue') {
      const list = popup.kind === 'todos' ? state.todayTodos : state.overdueAll;
      title.textContent = `${popTitle(popup.kind)} ${list.length}건`;
      if (popup.kind === 'overdue' && list.length && isToday()) actions.insertAdjacentHTML('afterbegin', `<button class="btn-secondary" data-resched-all="1">전부 오늘로 옮기기 (${list.length}건)</button>`);
      body.innerHTML = list.length ? list.map((t) => todoRow(t, { showDate: popup.kind === 'overdue' })).join('') : '<div class="td-empty">없어요.</div>';
    } else if (popup.kind === 'adm') {
      const list = (state.admItems || []).filter((i) => i.date === today && (i.kind === 'admission' || i.kind === 'discharge')).sort((a, b) => a.timeKey - b.timeKey);
      title.textContent = `${popTitle('adm')} ${list.length}건`;
      body.innerHTML = list.length
        ? list.map((i) => `<div class="td-row"><span class="td-pill ${i.kind === 'admission' ? 'in' : 'out'}">${i.kind === 'admission' ? '입원' : '퇴원'}</span><span class="td-txt">${escapeHtml(i.time ? `${i.time} ` : '')}${escapeHtml(i.person)}${i.supText ? `<small>${escapeHtml(i.supText)}</small>` : ''}${i.note ? `<small class="note">${escapeHtml(i.note)}</small>` : ''}</span></div>`).join('')
        : `<div class="td-empty">${isToday() ? '오늘 ' : ''}불러온 입원·퇴원이 없어요.</div>`;
      actions.insertAdjacentHTML('afterbegin', '<button class="btn-secondary" id="tdp-copy">전달 문구 복사</button>');
      actions.querySelector('#tdp-copy').addEventListener('click', () => $('td-copy').click());
    } else if (popup.kind === 'todo') {
      let t = null;
      try {
        t = await window.itda.todos.get(popup.id);
      } catch (e) {
        /* 아래에서 처리 */
      }
      if (!popup || popup.kind !== 'todo') return;
      if (!t) {
        title.textContent = '할 일';
        body.innerHTML = '<div class="td-empty">삭제됐거나 찾을 수 없는 할 일이에요.</div>';
        return;
      }
      title.textContent = '할 일';
      const prio = { 1: '높음', 2: '보통', 3: '낮음' }[t.priority] || '';
      body.innerHTML = `
        <label class="td-todo-main"><input type="checkbox" data-check="${t.id}" ${t.status === 'done' ? 'checked' : ''} /><span class="${t.status === 'done' ? 'done' : ''}">${escapeHtml(t.title)}</span></label>
        <div class="td-todo-meta">${[t.due_date ? `마감 ${t.due_date}${t.due_time ? ` ${String(t.due_time).slice(0, 5)}` : ''}` : '마감 없음', prio && `우선순위 ${prio}`, t.is_favorite ? '★ 즐겨찾기' : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        ${t.memo ? `<div class="td-todo-memo">${escapeHtml(t.memo)}</div>` : ''}`;
      actions.insertAdjacentHTML('afterbegin', `${popup.back ? '<button class="btn-secondary" id="tdp-back">← 목록</button>' : ''}<button class="btn-secondary" id="tdp-open">Todo 화면에서 열기</button>`);
      actions.querySelector('#tdp-back')?.addEventListener('click', () => openPopup(popup.back));
      actions.querySelector('#tdp-open').addEventListener('click', () => {
        closePopup();
        goToHash(`#/todo/${t.id}`);
      });
    }
  }
  function openPopup(next) {
    popup = next;
    popupEl.classList.add('open');
    renderPopup();
  }

  async function load() {
    const my = ++seq;
    try {
      const msgCfg = await window.itda.messenger.getConfig().catch(() => ({ enabled: false }));
      const wk = weekKeys(today);
      const [events, todayTodos, openTodos, tomEvents, tomTodos, adm, wkEvents, wkTodos] = await Promise.all([
        window.itda.events.range({ fromDate: today, toDate: today }),
        window.itda.todos.list({ fromDate: today, toDate: today }),
        window.itda.todos.list({ isDone: false }),
        window.itda.events.range({ fromDate: tomorrow, toDate: tomorrow }),
        window.itda.todos.list({ fromDate: tomorrow, toDate: tomorrow }),
        msgCfg.enabled ? window.itda.messenger.items({ fromDate: today, toDate: tomorrow }).catch(() => null) : null,
        window.itda.events.range({ fromDate: wk[0], toDate: wk[6] }).catch(() => []),
        window.itda.todos.list({ fromDate: wk[0], toDate: wk[6] }).catch(() => []),
      ]);
      if (unmounted || my !== seq) return;

      const openToday = todayTodos.filter((t) => t.status !== 'done');
      // 지난 미완료는 "지금 기준"의 밀린 일이라 오늘을 볼 때만 보여준다
      const overdue = isToday() ? pickOverdue(openTodos, today) : { recent: [], older: 0 };
      const admItems = adm && adm.enabled ? adm.items : null;
      const count = (day, kind) => (admItems ? admItems.filter((i) => i.date === day && i.kind === kind).length : 0);

      const nowMin = nowMinutes();
      const upcoming = isToday() ? nextUp(events, nowMin).next : null;
      const overCount = overdue.recent.length + overdue.older;
      const oldest = oldestOverdueDays(openTodos, today);
      const stats = [
        { label: isToday() ? '오늘 일정' : '일정', value: events.length, sub: upcoming ? `다음 ${(upcoming.event.start_at || '').slice(11, 16)}` : events.length ? '' : '여유로워요', pop: 'events', hue: 'green' },
        { label: isToday() ? '오늘 마감' : '마감', value: openToday.length, sub: todayTodos.length - openToday.length ? `${todayTodos.length - openToday.length}건 완료` : openToday.length ? '' : '없어요', pop: 'todos', hue: 'purple' },
        ...(isToday() ? [{ label: '지난 미완료', value: overCount, sub: overCount && oldest ? `가장 오래된 ${oldest}일 전` : overCount ? '' : '깔끔해요', tone: overCount ? 'warn' : '', pop: 'overdue', hue: 'yellow' }] : []),
      ];
      if (admItems) stats.push({ label: '입원 · 퇴원', value: `${count(today, 'admission')} · ${count(today, 'discharge')}`, sub: `내일 ${count(tomorrow, 'admission')} · ${count(tomorrow, 'discharge')}`, tone: 'info', pop: 'adm', hue: 'blue' });
      $('td-stats').innerHTML = stats
        .map((s) => `<button class="td-stat ${s.tone || ''}" data-pop="${s.pop}" data-hue="${s.hue || ''}"><span>${s.label}</span><b>${s.value}</b>${s.sub ? `<small>${s.sub}</small>` : ''}</button>`)
        .join('');
      $('td-h1').textContent = dayLabel(today);
      $('td-goToday').style.display = isToday() ? 'none' : '';
      $('td-tlTitle').textContent = isToday() ? '오늘 하루' : `${md(today)} 하루`;
      $('td-nextTitle').textContent = isToday() ? '내일 미리보기' : '다음 날 미리보기';
      $('td-nextDate').textContent = `${md(tomorrow)} (${WEEK[new Date(`${tomorrow}T00:00:00`).getDay()]})`;
      $('td-sub').textContent = `${isToday() ? '오늘' : '이 날'} 챙길 것 ${events.length + openToday.length}건${admItems ? ` · 입원 ${count(today, 'admission')} · 퇴원 ${count(today, 'discharge')}` : ''}`;

      state.events = events;
      state.todayTodos = todayTodos;
      state.overdueAll = [...openTodos.filter((t) => t.due_date && t.due_date < today)].sort((a, b) => a.due_date.localeCompare(b.due_date));
      state.admItems = admItems;
      state.week = { keys: wk, counts: countByDay(wk, wkEvents, wkTodos) };
      renderTimeline(events, todayTodos);
      renderHero();
      renderWeek();
      $('td-admPanel').style.display = admItems ? '' : 'none';
      if (admItems) renderAdmission(admItems);
      $('td-overPanel').style.display = isToday() ? '' : 'none';
      const reschedBtn = $('td-reschedAll');
      reschedBtn.style.display = isToday() && state.overdueAll.length ? '' : 'none';
      reschedBtn.textContent = `전부 오늘로 (${state.overdueAll.length}건)`;
      renderOverdue(overdue);

      const nextParts = [
        `일정 ${tomEvents.length}`,
        `마감 ${tomTodos.filter((t) => t.status !== 'done').length}`,
        ...(admItems ? [`입원 ${count(tomorrow, 'admission')}`, `퇴원 ${count(tomorrow, 'discharge')}`] : []),
      ];
      const nextLines = [...tomEvents.slice(0, 3).map((e) => `${e.all_day ? '종일' : (e.start_at || '').slice(11, 16)} ${e.title}`), ...tomTodos.filter((t) => t.status !== 'done').slice(0, 3).map((t) => `마감 ${t.title}`)];
      if (popup) renderPopup(); // 팝업이 열려 있으면 바뀐 데이터로 다시 그림
      $('td-next').innerHTML = `<div class="td-next-sum">${nextParts.join(' · ')}</div>${nextLines.map((l) => `<div class="td-next-line">${escapeHtml(l)}</div>`).join('')}`;
    } catch (e) {
      if (!unmounted) errorToast(e, '오늘 요약을 불러오지 못했어요');
    }
  }

  // 마감일을 옮기고 "되돌리기" 안내를 잠깐 보여준다(옮기기 전 날짜를 기억해 두었다가 그대로 복구)
  let undoTimer = null;
  async function reschedule(list, label) {
    const items = list.filter((t) => t.due_date !== realToday).map((t) => ({ id: t.id, dueDate: realToday }));
    if (!items.length) return;
    const before = list.filter((t) => t.due_date !== realToday).map((t) => ({ id: t.id, dueDate: t.due_date }));
    try {
      await window.itda.todos.reschedule({ items });
    } catch (err) {
      return errorToast(err, '옮기지 못했어요');
    }
    const bar = $('td-undo');
    bar.innerHTML = `<span>${escapeHtml(label)} ${items.length}건을 오늘로 옮겼어요</span><button class="btn-secondary" id="td-undoBtn">되돌리기</button>`;
    bar.style.display = '';
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (bar.style.display = 'none'), 12000);
    $('td-undoBtn').addEventListener('click', async () => {
      clearTimeout(undoTimer);
      bar.style.display = 'none';
      try {
        await window.itda.todos.reschedule({ items: before });
        toast('원래 마감일로 되돌렸어요');
      } catch (err) {
        errorToast(err, '되돌리지 못했어요');
      }
    });
  }
  function goDate(key) {
    if (key === today) return;
    realToday = toKey(new Date());
    today = key;
    tomorrow = toKey(addDays(new Date(`${key}T00:00:00`), 1));
    closePopup();
    load();
  }
  function shiftDay(delta) {
    const d = delta === 0 ? new Date() : addDays(new Date(`${today}T00:00:00`), delta);
    realToday = toKey(new Date()); // 오늘로 돌아올 땐 "지금" 기준
    today = toKey(d);
    tomorrow = toKey(addDays(d, 1));
    closePopup();
    load();
  }

  const onClick = async (e) => {
    const wd = e.target.closest('[data-day]');
    if (wd) return goDate(wd.dataset.day);
    const one = e.target.closest('[data-resched]');
    if (one) return reschedule(state.overdueAll.filter((t) => t.id === Number(one.dataset.resched)), '지난 미완료');
    if (e.target.closest('#td-reschedAll') || e.target.closest('[data-resched-all]')) return reschedule(state.overdueAll, '지난 미완료');
    const pop = e.target.closest('[data-pop]');
    if (pop) return openPopup({ kind: pop.dataset.pop });
    const todoOpen = e.target.closest('[data-todo-open]');
    if (todoOpen) return openPopup({ kind: 'todo', id: Number(todoOpen.dataset.todoOpen), back: popup && popup.kind !== 'todo' ? popup : null });
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('input')) return goToHash(go.dataset.go);
    const ev = e.target.closest('[data-event]');
    if (ev) {
      const evts = await window.itda.events.range({ fromDate: today, toDate: today });
      const found = evts.find((x) => x.id === Number(ev.dataset.event));
      if (found) eventDetailModal.openDetail({ ...found, source: 'local' });
    }
  };
  const onChange = async (e) => {
    const id = e.target.dataset?.check;
    if (!id) return;
    try {
      await window.itda.todos.toggle(Number(id));
      load();
    } catch (err) {
      e.target.checked = !e.target.checked;
      errorToast(err, '상태를 변경하지 못했어요');
    }
  };
  page.addEventListener('click', onClick);
  popupEl.addEventListener('click', onClick);
  page.addEventListener('change', onChange);
  popupEl.addEventListener('change', onChange);
  $('td-refresh').addEventListener('click', load);
  $('td-prevDay').addEventListener('click', () => shiftDay(-1));
  $('td-nextDay').addEventListener('click', () => shiftDay(1));
  $('td-goToday').addEventListener('click', () => shiftDay(0));
  // 바로 추가 — 지금 보는 날이 마감일인 할 일로 들어간다
  $('td-addInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const title = e.target.value.trim();
    if (!title) return;
    e.target.disabled = true;
    try {
      await window.itda.todos.add({ title, dueDate: today });
      e.target.value = '';
      toast(`${md(today)} 할 일로 추가했어요`);
    } catch (err) {
      errorToast(err, '추가하지 못했어요');
    } finally {
      e.target.disabled = false;
      e.target.focus();
    }
  });
  $('td-copy').addEventListener('click', async () => {
    try {
      const texts = [];
      for (const kind of ['admission', 'discharge']) {
        const r = await window.itda.messenger.copyText({ date: today, kind });
        if (r.text) texts.push(r.text);
      }
      if (!texts.length) return toast('복사할 입퇴원이 없어요');
      await navigator.clipboard.writeText(texts.join('\n\n'));
      toast('전달 문구를 복사했어요');
    } catch (err) {
      errorToast(err, '복사하지 못했어요');
    }
  });

  // 화면 전용 단축키(Alt 길게 누르면 안내) — 입력 중이거나 모달이 떠 있을 땐 무시
  const copyBtn = () => $('td-copy');
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isUserTyping() || document.querySelector('.modal-overlay.open')) return;
    if (e.key === 'r' || e.key === 'R') load();
    else if (e.key === 'ArrowLeft') shiftDay(-1);
    else if (e.key === 'ArrowRight') shiftDay(1);
    else if (e.key === 't' || e.key === 'T') shiftDay(0);
    else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      $('td-addInput').focus();
    }
    else if ((e.key === 'c' || e.key === 'C') && $('td-admPanel').style.display !== 'none') copyBtn().click();
  };
  document.addEventListener('keydown', onKey);
  setScreenShortcuts('오늘', [
    { label: '할 일 추가', keys: 'N' },
    { label: '전날 / 다음 날', keys: '← →' },
    { label: '오늘로 돌아오기', keys: 'T' },
    { label: '새로고침', keys: 'R' },
    { label: '입퇴원 전달 문구 복사', keys: 'C' },
  ]);

  // 자정을 넘기면 자동으로 새 날짜로 — 오늘을 보고 있었으면 새 오늘로 넘어가고(다른 날을 보고 있었으면 그 날은 유지), 지난 미완료 등도 다시 계산한다.
  // 앱을 켜 둔 채 절전에서 깨어나거나 창으로 돌아올 때도 확인한다(그동안은 타이머가 멈춰 있을 수 있어서).
  // 1분마다: "지금" 줄·진행 중 표시·다음 일정까지 남은 시간을 새로 그린다(날짜가 안 바뀌었을 때)
  const repaintLive = () => {
    if (!isToday() || unmounted || !state.week) return;
    renderTimeline(state.events, state.todayTodos);
    renderHero();
  };
  const checkNewDay = () => {
    const k = toKey(new Date());
    if (k === realToday || unmounted) return repaintLive();
    const wasToday = today === realToday;
    realToday = k;
    if (wasToday) {
      today = k;
      tomorrow = toKey(addDays(new Date(), 1));
      closePopup();
    }
    load();
  };
  const dayTimer = setInterval(checkNewDay, 60 * 1000);
  window.addEventListener('focus', checkNewDay);
  document.addEventListener('visibilitychange', checkNewDay);

  let timer = null;
  const offDataChanged = window.itda.onDataChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  });
  load();

  return () => {
    unmounted = true;
    clearTimeout(timer);
    clearTimeout(undoTimer);
    clearInterval(dayTimer);
    window.removeEventListener('focus', checkNewDay);
    document.removeEventListener('visibilitychange', checkNewDay);
    document.removeEventListener('keydown', onKey);
    offEsc();
    setScreenShortcuts(null, []);
    if (typeof offDataChanged === 'function') offDataChanged();
  };
}
