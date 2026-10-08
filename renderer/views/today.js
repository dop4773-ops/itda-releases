/**
 * 오늘 — 아침에 한 번 보는 요약 화면.
 * 오늘의 일정·마감 할 일을 시간순으로 섞어서 보여주고, 지난 미완료(최근 7일)·입퇴원(메신저 연동을 켠 경우)·내일 미리보기를 곁들인다.
 * 데이터는 기존 IPC(events/todos/messenger)만 쓰고, 화면은 데이터가 바뀌면 자동으로 다시 그린다.
 */
import { escapeHtml, errorToast, toast, goToHash, isUserTyping } from '../shared/ui-utils.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { mountEventDetailModal } from '../shared/event-detail-modal.js';
import { registerEscClose } from '../shared/esc-close.js';
import { buildTimeline, pickOverdue, OVERDUE_DAYS, toKey, addDays } from '../shared/today-logic.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const md = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
const SUN_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`;

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
    <div class="td-add"><input type="text" id="td-addInput" class="input" maxlength="200" placeholder="할 일 추가 — 입력하고 Enter (마감은 지금 보는 날)" /></div>
    <div class="td-undo" id="td-undo" style="display:none;"></div>
    <div class="td-stats" id="td-stats"></div>
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
  const state = { events: [], todayTodos: [], overdueAll: [], admItems: null };
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
      <span class="td-txt" data-todo-open="${t.id}">${escapeHtml(t.title)}</span>
      ${t.is_favorite ? '<span class="td-flag">★</span>' : t.priority === 1 ? '<span class="td-flag hi">중요</span>' : ''}
      ${showDate ? `<span class="td-when">${md(t.due_date)}</span>` : ''}
      ${showDate && isToday() ? `<button class="td-mini" data-resched="${t.id}" title="오늘로 옮기기">오늘로</button>` : ''}
    </div>`;

  function renderTimeline(events, todos) {
    const rows = buildTimeline(events, todos);
    if (!rows.length) {
      $('td-timeline').innerHTML = `<div class="td-empty">${isToday() ? '오늘은' : '이 날은'} 일정도 마감도 없어요. 여유로운 하루네요.</div>`;
      return;
    }
    $('td-timeline').innerHTML = rows
      .map((r) =>
        r.type === 'event'
          ? `<div class="td-line"><span class="td-time">${escapeHtml(r.time)}</span><div class="td-row" data-event="${r.data.id}"><span class="td-dot" style="background:${r.data.color_hex || 'var(--text-faint)'}"></span><span class="td-txt">${escapeHtml(r.data.title)}</span>${r.data.location ? `<span class="td-when">${escapeHtml(r.data.location)}</span>` : ''}</div></div>`
          : `<div class="td-line"><span class="td-time">${escapeHtml(r.time)}</span>${todoRow(r.data)}</div>`
      )
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
        ? buildTimeline(state.events, []).map((r) => `<div class="td-line"><span class="td-time">${escapeHtml(r.time)}</span><div class="td-row" data-event="${r.data.id}"><span class="td-dot" style="background:${r.data.color_hex || 'var(--text-faint)'}"></span><span class="td-txt">${escapeHtml(r.data.title)}</span>${r.data.location ? `<span class="td-when">${escapeHtml(r.data.location)}</span>` : ''}</div></div>`).join('')
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
      const [events, todayTodos, openTodos, tomEvents, tomTodos, adm] = await Promise.all([
        window.itda.events.range({ fromDate: today, toDate: today }),
        window.itda.todos.list({ fromDate: today, toDate: today }),
        window.itda.todos.list({ isDone: false }),
        window.itda.events.range({ fromDate: tomorrow, toDate: tomorrow }),
        window.itda.todos.list({ fromDate: tomorrow, toDate: tomorrow }),
        msgCfg.enabled ? window.itda.messenger.items({ fromDate: today, toDate: tomorrow }).catch(() => null) : null,
      ]);
      if (unmounted || my !== seq) return;

      const openToday = todayTodos.filter((t) => t.status !== 'done');
      // 지난 미완료는 "지금 기준"의 밀린 일이라 오늘을 볼 때만 보여준다
      const overdue = isToday() ? pickOverdue(openTodos, today) : { recent: [], older: 0 };
      const admItems = adm && adm.enabled ? adm.items : null;
      const count = (day, kind) => (admItems ? admItems.filter((i) => i.date === day && i.kind === kind).length : 0);

      const stats = [
        { label: isToday() ? '오늘 일정' : '일정', value: events.length, pop: 'events' },
        { label: isToday() ? '오늘 마감' : '마감', value: openToday.length, sub: todayTodos.length - openToday.length ? `${todayTodos.length - openToday.length}건 완료` : '', pop: 'todos' },
        ...(isToday() ? [{ label: '지난 미완료', value: overdue.recent.length + overdue.older, tone: overdue.recent.length + overdue.older ? 'warn' : '', pop: 'overdue' }] : []),
      ];
      if (admItems) stats.push({ label: '입원 · 퇴원', value: `${count(today, 'admission')} · ${count(today, 'discharge')}`, tone: 'info', pop: 'adm' });
      $('td-stats').innerHTML = stats
        .map((s) => `<button class="td-stat ${s.tone || ''}" data-pop="${s.pop}"><span>${s.label}</span><b>${s.value}</b>${s.sub ? `<small>${s.sub}</small>` : ''}</button>`)
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
      renderTimeline(events, todayTodos);
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
  function shiftDay(delta) {
    const d = delta === 0 ? new Date() : addDays(new Date(`${today}T00:00:00`), delta);
    realToday = toKey(new Date()); // 오늘로 돌아올 땐 "지금" 기준
    today = toKey(d);
    tomorrow = toKey(addDays(d, 1));
    closePopup();
    load();
  }

  const onClick = async (e) => {
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
  const checkNewDay = () => {
    const k = toKey(new Date());
    if (k === realToday || unmounted) return;
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
