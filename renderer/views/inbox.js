import { escapeHtml, toast, errorToast, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { openCreateEventModal } from '../shared/create-event-modal.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { dateKey } from '../shared/date-utils.js';

const INBOX_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>`;
const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const EXTERNAL_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>`;
const STAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`;
const STAR_O = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`;

const STATUS_EMOJI = { unprocessed: '📨', todo: '✅', event: '📅', memo: '📝', postit: '📌' };
const STATUS_LABEL = { unprocessed: '미분류', todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇' };
const PROCESSED_LABEL = { todo: 'Todo로 전환됨', event: '일정으로 전환됨', memo: '메모로 전환됨', postit: '포스트잇으로 전환됨' };
const PROCESSED_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit' };
const TAB_ORDER = ['all', 'unprocessed', 'todo', 'event', 'memo', 'postit'];
const TAB_LABEL = { all: '전체', unprocessed: '미분류', todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇' };

const statusOf = (i) => (i.is_processed ? i.processed_type || 'todo' : 'unprocessed');

function timeLabel(raw) {
  if (!raw) return '';
  const d = new Date(String(raw).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const key = dateKey(d);
  const today = dateKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (key === today || key === dateKey(y)) return hm;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function bucketOf(raw) {
  const d = new Date(String(raw || '').replace(' ', 'T'));
  if (isNaN(d.getTime())) return 'old';
  const key = dateKey(d);
  const today = dateKey(new Date());
  if (key === today) return 'today';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === dateKey(y)) return 'yesterday';
  return 'old';
}
function bucketLabel(b, sample) {
  const d = new Date(String(sample || '').replace(' ', 'T'));
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  const md = isNaN(d.getTime()) ? '' : ` · ${d.getMonth() + 1}월 ${d.getDate()}일 (${wd[d.getDay()]})`;
  if (b === 'today') return `오늘${md}`;
  if (b === 'yesterday') return `어제${md}`;
  return '그 이전';
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-blue">${INBOX_ICON}</div>
        <div>
          <h1>Inbox <span class="i-count" id="i-count"></span></h1>
          <p>생각나는 대로 적어두세요. 자동 분류는 하지 않아요 — 정리는 나중에 직접.</p>
        </div>
      </div>
      ${widgetLaunchButtonHtml('i-widgetBtn', 'Inbox 위젯 열기')}
    </div>

    <div class="form-row i-add-row">
      <textarea id="i-input" class="input i-add-input" rows="1"
        placeholder="여기에 내용을 입력하세요…  (여러 줄을 붙여넣으면 줄 단위로 항목이 나뉘어요)"></textarea>
      <button class="btn" id="i-addBtn">추가</button>
    </div>

    <div class="search-type-tabs" id="i-tabs"></div>
    <div class="i-toolbar">
      <label class="i-selectall"><input type="checkbox" id="i-selectAll" /> 전체 선택</label>
      <select id="i-sort" class="select">
        <option value="old">오래된 순</option>
        <option value="new">최신 순</option>
      </select>
    </div>

    <div class="s-layout" id="i-layout">
      <div class="s-results-col"><div id="i-list"><div class="empty">불러오는 중…</div></div></div>
      <aside class="s-drawer" id="i-drawer"></aside>
    </div>

    <div class="search-bulk-bar" id="i-bulkBar" hidden>
      <span class="search-selected-count" id="i-selCount"></span>
      <button class="btn-secondary" id="i-bulkTodo">Todo로 전환</button>
      <button class="btn-secondary" id="i-bulkClear">선택 해제</button>
      <button class="btn-secondary search-bulk-delete-btn" id="i-bulkDelete">${TRASH_ICON} 삭제</button>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let allItems = [];
  let tab = 'unprocessed';
  let sort = 'old';
  let busy = false;
  let selected = new Set();
  let drawerId = null;
  let kbdIdx = -1;

  // ---------- 데이터 ----------
  async function load() {
    try {
      allItems = await window.itda.inbox.list({ onlyUnprocessed: false });
    } catch (e) {
      errorToast(e, 'Inbox를 불러오지 못했어요');
      $('i-list').innerHTML = emptyStateBlock({ title: '목록을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    render();
  }

  function filtered() {
    let list = allItems;
    if (tab === 'unprocessed') list = list.filter((i) => !i.is_processed);
    else if (tab !== 'all') list = list.filter((i) => i.is_processed && (i.processed_type || 'todo') === tab);
    return [...list].sort((a, b) => {
      if (!!b.is_favorite !== !!a.is_favorite) return b.is_favorite - a.is_favorite; // 별표 먼저
      const cmp = String(a.created_at).localeCompare(String(b.created_at));
      return sort === 'old' ? cmp : -cmp;
    });
  }

  // ---------- 렌더 ----------
  function render() {
    $('i-count').textContent = allItems.filter((i) => !i.is_processed).length || '';
    renderTabs();
    // 삭제/전환/필터 전환으로 selected가 바뀌었을 수 있으니 매 렌더마다 벌크바를 최신 상태로.
    // (이게 없어서 "N개 선택됨" 팝업이 삭제 후에도 안 사라졌음)
    for (const id of [...selected]) if (!allItems.some((i) => i.id === id)) selected.delete(id);
    updateBulk();
    const list = filtered();
    const listEl = $('i-list');
    if (!list.length) {
      listEl.innerHTML = emptyStateBlock(
        tab === 'unprocessed'
          ? { title: 'Inbox가 비어있어요', subtitle: '생각나는 걸 바로 적어두세요 (Enter로 저장, / 로 입력창 포커스)' }
          : { title: '해당하는 항목이 없어요', subtitle: '다른 탭을 확인해보세요' }
      );
      $('i-bulkBar').hidden = true;
      updateSelectAll(list);
      return;
    }
    const buckets = [];
    const idx = {};
    list.forEach((i) => {
      const b = bucketOf(i.created_at);
      if (idx[b] === undefined) { idx[b] = buckets.length; buckets.push({ b, items: [] }); }
      buckets[idx[b]].items.push(i);
    });
    const order = { today: 0, yesterday: 1, old: 2 };
    buckets.sort((a, b) => order[a.b] - order[b.b]);
    listEl.innerHTML = buckets
      .map(
        (g) => `
      <div class="i-group">
        <div class="i-group-head">${escapeHtml(bucketLabel(g.b, g.items[0]?.created_at))}</div>
        ${g.items.map(row).join('')}
      </div>`
      )
      .join('');
    wireRows(listEl);
    updateSelectAll(list);
    paintKbd();
  }

  function row(i) {
    const st = statusOf(i);
    return `
      <div class="i-row ${selected.has(i.id) ? 'selected' : ''} ${drawerId === i.id ? 'active' : ''} ${i.is_processed ? 'processed' : ''}" data-id="${i.id}">
        <input type="checkbox" class="i-row-check" ${selected.has(i.id) ? 'checked' : ''} />
        <span class="i-row-icon">${STATUS_EMOJI[st] || '📨'}</span>
        <span class="i-row-text">${escapeHtml(i.content)}</span>
        <span class="i-row-badge i-badge-${st}">${STATUS_LABEL[st]}</span>
        <span class="i-row-time">${timeLabel(i.created_at)}</span>
        <button class="i-row-star ${i.is_favorite ? 'on' : ''}" data-star="${i.id}" title="별표">${i.is_favorite ? STAR : STAR_O}</button>
      </div>`;
  }

  function renderTabs() {
    const counts = { all: allItems.length, unprocessed: 0, todo: 0, event: 0, memo: 0, postit: 0 };
    allItems.forEach((i) => {
      if (!i.is_processed) counts.unprocessed++;
      else counts[i.processed_type || 'todo'] = (counts[i.processed_type || 'todo'] || 0) + 1;
    });
    $('i-tabs').innerHTML = TAB_ORDER.map(
      (t) => `<button class="search-type-tab ${tab === t ? 'active' : ''}" data-tab="${t}">${TAB_LABEL[t]} ${counts[t] || 0}</button>`
    ).join('');
    $('i-tabs').querySelectorAll('.search-type-tab').forEach((b) => {
      b.addEventListener('click', () => {
        tab = b.dataset.tab;
        selected.clear();
        kbdIdx = -1;
        render();
      });
    });
  }

  function wireRows(container) {
    container.querySelectorAll('.i-row').forEach((el) => {
      const id = Number(el.dataset.id);
      el.addEventListener('click', (e) => {
        if (e.target.closest('input,button')) return;
        openDrawer(id);
      });
      el.querySelector('.i-row-check').addEventListener('change', (e) => {
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
        el.classList.toggle('selected', e.target.checked);
        updateBulk();
        updateSelectAll(filtered());
      });
      el.querySelector('[data-star]').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await window.itda.inbox.setFavorite(id);
          await load();
        } catch (err) {
          errorToast(err, '별표를 바꾸지 못했어요');
        }
      });
      attachContextMenu(el, () => ({ type: 'inbox', id }), {
        linkOnly: true,
        onDelete: async () => {
          await window.itda.inbox.delete(id);
          toast('삭제했어요');
          if (drawerId === id) closeDrawer();
          selected.delete(id);
          await load();
        },
      });
    });
  }

  function rowEls() {
    return [...$('i-list').querySelectorAll('.i-row')];
  }
  function paintKbd() {
    const els = rowEls();
    els.forEach((el, i) => el.classList.toggle('kbd', i === kbdIdx));
    if (kbdIdx >= 0 && els[kbdIdx]) els[kbdIdx].scrollIntoView({ block: 'nearest' });
  }
  function kbdItem() {
    const el = rowEls()[kbdIdx];
    return el ? allItems.find((x) => x.id === Number(el.dataset.id)) : null;
  }

  // ---------- 선택/일괄 ----------
  function updateBulk() {
    const bar = $('i-bulkBar');
    bar.hidden = selected.size === 0;
    $('i-selCount').textContent = `${selected.size}개 선택됨`;
  }
  function updateSelectAll(list) {
    const cb = $('i-selectAll');
    const ids = list.map((i) => i.id);
    cb.checked = ids.length > 0 && ids.every((id) => selected.has(id));
    cb.indeterminate = selected.size > 0 && !cb.checked;
  }
  $('i-selectAll').addEventListener('change', (e) => {
    const ids = filtered().map((i) => i.id);
    if (e.target.checked) ids.forEach((id) => selected.add(id));
    else ids.forEach((id) => selected.delete(id));
    render();
    updateBulk();
  });
  $('i-bulkClear').addEventListener('click', () => {
    selected.clear();
    render();
    updateBulk();
  });
  $('i-bulkDelete').addEventListener('click', async () => {
    if (!selected.size) return;
    $('i-bulkDelete').disabled = true;
    try {
      await Promise.all([...selected].map((id) => window.itda.inbox.delete(id)));
      toast(`${selected.size}개 삭제했어요`);
      if (drawerId && selected.has(drawerId)) closeDrawer();
      selected.clear();
      await load();
    } catch (e) {
      errorToast(e, '일부 항목을 삭제하지 못했어요');
      await load();
    } finally {
      $('i-bulkDelete').disabled = false;
    }
  });
  $('i-bulkTodo').addEventListener('click', async () => {
    if (!selected.size) return;
    const ids = [...selected].filter((id) => !allItems.find((x) => x.id === id)?.is_processed);
    if (!ids.length) return toast('전환할 미분류 항목이 없어요');
    $('i-bulkTodo').disabled = true;
    try {
      for (const id of ids) {
        const it = allItems.find((x) => x.id === id);
        await window.itda.todos.add({ title: it.content, fromInbox: id });
      }
      toast(`${ids.length}개를 Todo로 전환했어요`);
      selected.clear();
      await load();
    } catch (e) {
      errorToast(e, '일부를 전환하지 못했어요');
      await load();
    } finally {
      $('i-bulkTodo').disabled = false;
    }
  });

  // ---------- 전환 ----------
  async function convert(id, type) {
    const it = allItems.find((x) => x.id === id);
    if (!it || it.is_processed) return;
    try {
      if (type === 'todo') {
        await window.itda.todos.add({ title: it.content, fromInbox: id });
        toast('Todo로 전환했어요');
      } else if (type === 'event') {
        const ev = await openCreateEventModal({ title: it.content, fromInbox: id });
        if (!ev) return;
      } else if (type === 'memo') {
        await window.itda.memos.add({ content: it.content, fromInbox: id });
        toast('메모로 전환했어요');
      }
      if (drawerId === id) closeDrawer();
      await load();
    } catch (e) {
      errorToast(e, '전환하지 못했어요');
    }
  }

  // ---------- 드로어 ----------
  async function openDrawer(id) {
    drawerId = id;
    $('i-layout').classList.add('drawer-open');
    rowEls().forEach((r) => r.classList.toggle('active', Number(r.dataset.id) === id));
    const it = allItems.find((x) => x.id === id);
    if (!it) return closeDrawer();
    const st = statusOf(it);
    let related = [];
    try {
      related = (await window.itda.links.listFor({ type: 'inbox', id })) || [];
    } catch (e) {
      related = [];
    }
    if (drawerId !== id) return;
    const d = new Date(String(it.created_at).replace(' ', 'T'));
    const wd = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = isNaN(d.getTime())
      ? it.created_at
      : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${wd[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    $('i-drawer').innerHTML = `
      <div class="s-drawer-head">
        <span class="s-drawer-eyebrow">${STATUS_EMOJI[st]} ${it.is_processed ? PROCESSED_LABEL[it.processed_type] || '처리됨' : '미분류'}</span>
        <div style="display:flex;gap:4px;">
          <button class="i-row-star ${it.is_favorite ? 'on' : ''}" id="i-dStar" title="별표">${it.is_favorite ? STAR : STAR_O}</button>
          <button class="btn-icon" id="i-dClose" title="닫기">${CLOSE_ICON}</button>
        </div>
      </div>
      <div class="s-drawer-body">
        <h3 class="s-drawer-title">${escapeHtml(it.content)}</h3>
        <div class="s-drawer-meta">📅 ${escapeHtml(dateStr)} <span class="i-row-badge i-badge-${st}">${STATUS_LABEL[st]}</span></div>

        ${related.length ? `
          <div class="s-drawer-section">
            <div class="s-drawer-section-head">연관 항목 (${related.length})</div>
            ${related.slice(0, 8).map((r) => `
              <a class="s-drawer-rel" href="${r.type === 'inbox' ? '#/inbox' : `${PROCESSED_ROUTE[r.type] || '#/dashboard'}/${r.id}`}">
                <span>${STATUS_EMOJI[r.type] || '•'}</span>
                <span class="s-drawer-rel-title">${escapeHtml(String(r.title || r.label || '').replace(/<[^>]+>/g, ' ').slice(0, 60) || '(제목 없음)')}</span>
              </a>`).join('')}
          </div>` : ''}
      </div>
      <div class="s-drawer-foot">
        ${it.is_processed
          ? `<a class="btn" href="${PROCESSED_ROUTE[it.processed_type] || '#/dashboard'}/${it.processed_ref_id}">원본으로 이동 ${EXTERNAL_ICON}</a>`
          : `<div class="i-convert-row">
               <button class="btn" data-conv="todo">Todo로 전환</button>
               <button class="btn-secondary" data-conv="event">일정으로</button>
               <button class="btn-secondary" data-conv="memo">메모로</button>
             </div>`}
        <button class="btn-secondary" id="i-dDelete">${TRASH_ICON} 삭제</button>
      </div>`;

    $('i-dClose').addEventListener('click', closeDrawer);
    $('i-dStar').addEventListener('click', async () => {
      await window.itda.inbox.setFavorite(id).catch(() => {});
      await load();
      if (drawerId === id) openDrawer(id);
    });
    $('i-dDelete').addEventListener('click', async () => {
      try {
        await window.itda.inbox.delete(id);
        toast('삭제했어요');
        closeDrawer();
        await load();
      } catch (e) {
        errorToast(e, '삭제하지 못했어요');
      }
    });
    $('i-drawer').querySelectorAll('[data-conv]').forEach((b) => {
      b.addEventListener('click', () => convert(id, b.dataset.conv));
    });
  }
  function closeDrawer() {
    drawerId = null;
    $('i-layout')?.classList.remove('drawer-open');
    rowEls().forEach((r) => r.classList.remove('active'));
    const dr = $('i-drawer');
    if (dr) dr.innerHTML = '';
  }

  // ---------- 입력 ----------
  function autoGrow() {
    const el = $('i-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }
  async function handleAdd() {
    if (busy) return;
    const input = $('i-input');
    const content = input.value;
    if (!content.trim()) {
      input.focus();
      return;
    }
    busy = true;
    $('i-addBtn').disabled = true;
    try {
      const res = await window.itda.inbox.add(content); // 문자열(여러 줄이면 서버가 분리)
      input.value = '';
      autoGrow();
      input.focus(); // 연속 입력
      await load();
      if (res.count > 1) toast(`${res.count}개 추가했어요`);
    } catch (e) {
      errorToast(e, '저장하지 못했어요');
    } finally {
      busy = false;
      $('i-addBtn').disabled = false;
    }
  }
  $('i-addBtn').addEventListener('click', handleAdd);
  $('i-input').addEventListener('input', autoGrow);
  $('i-input').addEventListener('keydown', (e) => {
    // Enter = 저장, Shift+Enter = 줄바꿈(여러 줄 직접 입력)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  });

  $('i-sort').addEventListener('change', (e) => {
    sort = e.target.value;
    render();
  });

  // ---------- 단축키 ----------
  function onKey(e) {
    if (e.defaultPrevented) return;
    const typing = isUserTyping();
    if (e.key === 'Escape') {
      if (drawerId) { e.preventDefault(); closeDrawer(); }
      else if (selected.size) { e.preventDefault(); selected.clear(); render(); }
      return;
    }
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      $('i-input').focus();
      return;
    }
    // Tab / Shift+Tab = 유형 탭 순회 (입력창·드롭다운에 포커스가 있을 땐 기본 동작 유지)
    if (e.key === 'Tab' && !typing && document.activeElement?.tagName !== 'SELECT') {
      e.preventDefault();
      const cur = TAB_ORDER.indexOf(tab);
      tab = TAB_ORDER[(cur + (e.shiftKey ? -1 : 1) + TAB_ORDER.length) % TAB_ORDER.length];
      selected.clear();
      kbdIdx = -1;
      render();
      $('i-tabs').querySelector('.search-type-tab.active')?.focus({ preventScroll: true });
      return;
    }
    if (typing) return;
    const n = rowEls().length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); kbdIdx = kbdIdx < 0 ? 0 : (kbdIdx + 1) % n; paintKbd(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); kbdIdx = kbdIdx < 0 ? n - 1 : (kbdIdx - 1 + n) % n; paintKbd(); }
    else if (e.key === 'Enter' && kbdIdx >= 0) { e.preventDefault(); openDrawer(kbdItem()?.id); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && kbdIdx >= 0) {
      e.preventDefault();
      const it = kbdItem();
      if (it) window.itda.inbox.delete(it.id).then(load).catch((err) => errorToast(err, '삭제하지 못했어요'));
    } else if (kbdIdx >= 0 && ['t', 'e', 'm'].includes(e.key.toLowerCase())) {
      const it = kbdItem();
      if (it && !it.is_processed) {
        e.preventDefault();
        convert(it.id, { t: 'todo', e: 'event', m: 'memo' }[e.key.toLowerCase()]);
      }
    }
  }
  document.addEventListener('keydown', onKey);
  setScreenShortcuts('Inbox', [
    { label: '입력창', keys: '/' },
    { label: '탭 이동', keys: 'Tab' },
    { label: '행 이동', keys: '↑↓' },
    { label: 'Todo/일정/메모 전환', keys: 'T E M' },
    { label: '삭제', keys: 'Del' },
    { label: '닫기·선택해제', keys: 'Esc' },
  ]);

  bindWidgetLaunchButton(root, 'i-widgetBtn', 'inbox');
  autoGrow();
  await load();

  const debouncedLoad = debounce(load, 200);
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'inbox') return;
    if (isUserTyping()) return;
    debouncedLoad();
  });

  return () => {
    offDataChanged?.();
    debouncedLoad.cancel();
    document.removeEventListener('keydown', onKey);
    setScreenShortcuts(null, []);
  };
}
