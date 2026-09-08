import { escapeHtml, toast, errorToast, emptyStateBlock } from '../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';
import { TYPE_EMOJI } from '../shared/links-ui.js';
import { todayStr, dateKey, startOfWeek, addDays } from '../shared/date-utils.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { setScreenShortcuts } from '../shared/shell.js';

const RECENT_KEY = 'search_recent'; // 최근 검색어 (JSON 배열, 최대 8개) — app_settings(로컬 SQLite)에만 저장
async function getRecentQueries() {
  try {
    const raw = await window.itda.settings.get(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string').slice(0, 8) : [];
  } catch (e) {
    return [];
  }
}
async function recordRecentQuery(q) {
  const t = q.trim();
  if (!t) return;
  const cur = await getRecentQueries();
  const next = [t, ...cur.filter((s) => s.toLowerCase() !== t.toLowerCase())].slice(0, 8);
  try {
    await window.itda.settings.set({ key: RECENT_KEY, value: JSON.stringify(next) });
  } catch (e) {
    /* 저장 실패해도 검색엔 지장 없음 */
  }
}

const SEARCH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const EXTERNAL_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>`;
const FILTER_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18M6 12h12M10 19h4"/></svg>`;
const CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg>`;

const TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇', inbox: 'Inbox' };
const TYPE_ORDER = ['todo', 'event', 'memo', 'postit', 'inbox'];
const TYPE_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit', inbox: '#/inbox' };
const itemHref = (type, id) => (type === 'inbox' ? '#/inbox' : `${TYPE_ROUTE[type] || '#/dashboard'}/${id}`);
const DELETE_API = {
  todo: (id) => window.itda.todos.delete(id),
  event: (id) => window.itda.events.delete(id),
  memo: (id) => window.itda.memos.delete(id),
  postit: (id) => window.itda.postits.delete(id),
  inbox: (id) => window.itda.inbox.delete(id),
};
const PAGE = 40;

// 'YYYY-MM-DD HH:MM:SS' → { date:'09/05', time:'오전 10:00' }
function splitDT(raw) {
  if (!raw) return { date: '', time: '' };
  const s = String(raw).replace(' ', 'T');
  const d = new Date(s);
  if (isNaN(d.getTime())) return { date: String(raw).slice(5, 10).replace('-', '/'), time: '' };
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  let h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${mm}/${dd}`, time: `${ampm} ${String(h).padStart(2, '0')}:${min}` };
}

// escapeHtml 후 검색어 토큰을 <mark>로 감싼다(과한 형광색 X — CSS에서 brand 톤).
function highlight(text, tokens) {
  const safe = escapeHtml(text || '');
  const pats = (tokens || []).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!pats.length) return safe;
  return safe.replace(new RegExp(`(${pats.join('|')})`, 'gi'), '<mark class="s-hl">$1</mark>');
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-blue">${SEARCH_ICON}</div>
        <div><h1>검색</h1><p>Todo, 일정, 메모, 포스트잇, Inbox 전체를 한 번에 검색합니다.</p></div>
      </div>
    </div>

    <div class="search-toolbar">
      <div class="s-input-wrap">
        <span class="s-input-icon">${SEARCH_ICON}</span>
        <input type="text" id="s-input" class="input" placeholder="검색어를 입력하세요…" autocomplete="off" autofocus />
        <button class="s-input-clear" id="s-clear" hidden title="지우기">${CLOSE_ICON}</button>
      </div>
      <div class="search-filter-wrap">
        <button class="btn-secondary" id="s-filterBtn">${FILTER_ICON} 필터 <span class="s-filter-count" id="s-filterCount" hidden></span></button>
        <div class="search-filter-pop" id="s-filterPop" hidden>
          <div class="sfp-section">
            <div class="sfp-label">유형</div>
            <div class="sfp-checks" id="s-typeChecks">
              ${TYPE_ORDER.map((t) => `<label><input type="checkbox" data-type="${t}" /> ${TYPE_LABEL[t]}</label>`).join('')}
            </div>
          </div>
          <div class="sfp-section">
            <div class="sfp-label">기간</div>
            <div class="sfp-chips" id="s-periodChips">
              <button class="sfp-chip active" data-period="all">전체</button>
              <button class="sfp-chip" data-period="today">오늘</button>
              <button class="sfp-chip" data-period="7d">최근 7일</button>
              <button class="sfp-chip" data-period="30d">최근 30일</button>
              <button class="sfp-chip" data-period="custom">직접 선택</button>
            </div>
            <div class="sfp-dates" id="s-customDates" hidden>
              <input type="date" id="s-dateFrom" class="input" /> ~ <input type="date" id="s-dateTo" class="input" />
            </div>
          </div>
          <div class="sfp-section">
            <div class="sfp-label">상태 <span class="sfp-hint">(Todo)</span></div>
            <div class="sfp-chips" id="s-statusChips">
              <button class="sfp-chip active" data-status="all">전체</button>
              <button class="sfp-chip" data-status="open">미완료</button>
              <button class="sfp-chip" data-status="done">완료</button>
            </div>
          </div>
          <div class="sfp-section">
            <div class="sfp-label">정렬</div>
            <div class="sfp-chips" id="s-sortChips">
              <button class="sfp-chip active" data-sort="recent">최신순</button>
              <button class="sfp-chip" data-sort="relevance">관련도순</button>
              <button class="sfp-chip" data-sort="oldest">오래된순</button>
            </div>
          </div>
          <div class="sfp-actions">
            <button class="btn-link" id="s-filterReset">초기화</button>
            <button class="btn" id="s-filterApply">적용</button>
          </div>
        </div>
      </div>
    </div>

    <div class="search-type-tabs" id="s-typeTabs" hidden></div>

    <div class="s-layout" id="s-layout">
      <div class="s-results-col">
        <div id="s-results"></div>
        <button class="s-loadmore" id="s-loadMore" hidden>더 불러오기 ${CHEVRON}</button>
      </div>
      <aside class="s-drawer" id="s-drawer"></aside>
    </div>

    <div class="search-bulk-bar" id="s-bulkBar" hidden>
      <span class="search-selected-count" id="s-selectedCount"></span>
      <button class="btn-secondary" id="s-bulkClear">선택 해제</button>
      <button class="btn-secondary search-bulk-delete-btn" id="s-bulkDelete">${TRASH_ICON} 삭제</button>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let debounceTimer = null;
  let recordTimer = null;
  let lastKeyword = '';
  let tokens = [];
  let results = []; // 누적된 결과 items
  let total = 0;
  let typeCounts = {};
  let offset = 0;
  let loading = false;
  let selected = new Set(); // "type:id"
  let drawerKey = null;
  let kbdIdx = -1; // 키보드 커서(↑↓)로 짚은 결과 행 인덱스
  let categories = [];
  const filters = { types: [], period: 'all', dateFrom: null, dateTo: null, status: 'all', sort: 'recent' };

  try {
    categories = await window.itda.categories.list();
  } catch (e) {
    categories = [];
  }
  const catName = (id) => categories.find((c) => c.id === id)?.name || null;

  // ---------- 시작 화면(검색어 없음) ----------
  async function renderPrompt() {
    $('s-typeTabs').hidden = true;
    $('s-loadMore').hidden = true;
    $('s-bulkBar').hidden = true;
    closeDrawer();
    const resultsEl = $('s-results');
    const [recentQ, recentItems] = await Promise.all([
      getRecentQueries(),
      window.itda.search.recentItems().catch(() => []),
    ]);
    if (!recentQ.length && !recentItems.length) {
      resultsEl.innerHTML = emptyStateBlock({
        icon: SEARCH_ICON.replace('18', '32'),
        title: '검색어를 입력하세요',
        subtitle: 'Todo · 일정 · 메모 · 포스트잇 · Inbox에서 원하는 내용을 빠르게 찾을 수 있어요',
      });
      return;
    }
    resultsEl.innerHTML = `
      ${recentQ.length ? `
        <div class="search-start-block">
          <div class="search-start-head">최근 검색 <button class="btn-link" id="s-clearRecent">지우기</button></div>
          <div class="search-recent-chips">
            ${recentQ.map((q) => `<button class="search-recent-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}
          </div>
        </div>` : ''}
      ${recentItems.length ? `
        <div class="search-start-block">
          <div class="search-start-head">최근 항목</div>
          <div>${recentItems.map((r) => startRow(r)).join('')}</div>
        </div>` : ''}
    `;
    resultsEl.querySelectorAll('.search-recent-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('s-input').value = btn.dataset.q;
        $('s-clear').hidden = false;
        runSearch(btn.dataset.q);
      });
    });
    $('s-clearRecent')?.addEventListener('click', async () => {
      try { await window.itda.settings.set({ key: RECENT_KEY, value: '[]' }); } catch (e) { /* noop */ }
      renderPrompt();
    });
    resultsEl.querySelectorAll('.s-row').forEach(wireRowOpen);
  }

  function startRow(r) {
    return `
      <div class="s-row" data-key="${r.entity_type}:${r.entity_id}" data-type="${r.entity_type}" data-id="${r.entity_id}">
        <span class="s-row-icon">${TYPE_EMOJI[r.entity_type] || '•'}</span>
        <div class="s-row-main"><div class="s-row-title">${escapeHtml(stripHtmlToPlainText(r.title || '').slice(0, 80) || '(제목 없음)')}</div></div>
        <span class="s-row-badge s-row-badge-type">${TYPE_LABEL[r.entity_type] || ''}</span>
      </div>`;
  }

  // ---------- 결과 조회 ----------
  async function runSearch(keyword, { append = false } = {}) {
    if (loading) return;
    lastKeyword = keyword;
    if (!keyword.trim()) {
      selected.clear();
      results = [];
      renderPrompt();
      return;
    }
    if (!append) {
      offset = 0;
      results = [];
      selected.clear();
      kbdIdx = -1;
    }
    tokens = keyword.trim().split(/\s+/).filter(Boolean);
    loading = true;
    let res;
    try {
      res = await window.itda.search.query({
        query: keyword,
        paged: true,
        types: filters.types.length ? filters.types : undefined,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status === 'all' ? null : filters.status,
        sort: filters.sort,
        limit: PAGE,
        offset,
      });
    } catch (e) {
      loading = false;
      errorToast(e, '검색하지 못했어요');
      $('s-results').innerHTML = emptyStateBlock({ title: '검색 중 오류가 발생했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    loading = false;
    if (append) results.push(...(res.items || []));
    else {
      results = res.items || [];
      typeCounts = res.typeCounts || {};
    }
    total = res.total || 0;
    offset = results.length;
    render();
    if (!append && results.length) {
      clearTimeout(recordTimer);
      recordTimer = setTimeout(() => {
        if ($('s-input').value.trim() === keyword.trim()) recordRecentQuery(keyword);
      }, 1400);
    }
  }

  // ---------- 렌더 ----------
  function render() {
    renderTypeTabs();
    const resultsEl = $('s-results');
    if (!results.length) {
      resultsEl.innerHTML = emptyStateBlock({
        icon: SEARCH_ICON.replace('18', '32'),
        title: '검색 결과가 없습니다',
        subtitle: `"${escapeHtml(lastKeyword)}"에 대한 결과를 찾지 못했어요. 다른 검색어나 필터를 사용해보세요.`,
      });
      $('s-loadMore').hidden = true;
      $('s-bulkBar').hidden = true;
      return;
    }
    const grouped = {};
    results.forEach((r) => {
      (grouped[r.entity_type] = grouped[r.entity_type] || []).push(r);
    });
    resultsEl.innerHTML = TYPE_ORDER.filter((t) => grouped[t])
      .map((t) => {
        const fullCount = typeCounts[t] || grouped[t].length;
        return `
        <div class="s-group">
          <div class="s-group-head">
            <span>${TYPE_EMOJI[t]} ${TYPE_LABEL[t]} <span class="s-group-count">${fullCount}</span></span>
            ${!filters.types.length && fullCount > grouped[t].length ? `<button class="s-group-more" data-type="${t}">전체 보기 ${CHEVRON}</button>` : ''}
          </div>
          ${grouped[t].map((r) => resultRow(r)).join('')}
        </div>`;
      })
      .join('');

    $('s-loadMore').hidden = results.length >= total;
    resultsEl.querySelectorAll('.s-row').forEach((row) => {
      wireRowOpen(row);
      row.querySelector('.s-row-check')?.addEventListener('change', (e) => {
        e.stopPropagation();
        const key = row.dataset.key;
        if (e.target.checked) selected.add(key);
        else selected.delete(key);
        row.classList.toggle('selected', e.target.checked);
        updateBulkBar();
      });
    });
    resultsEl.querySelectorAll('.s-group-more').forEach((btn) => {
      btn.addEventListener('click', () => setTypeFilter(btn.dataset.type));
    });
    resultsEl.querySelectorAll('.s-row').forEach((row) => {
      const t = row.dataset.type;
      const id = Number(row.dataset.id);
      attachContextMenu(row, () => ({ type: t, id }), {
        linkOnly: t === 'inbox',
        onDeleted: () => runSearch(lastKeyword),
      });
    });
    updateBulkBar();
    // 드로어가 열려있던 항목이 새 결과에도 있으면 선택 표시 유지
    if (drawerKey) resultsEl.querySelector(`.s-row[data-key="${drawerKey}"]`)?.classList.add('active');
    if (kbdIdx >= rowEls().length) kbdIdx = -1;
    paintKbd();
  }

  function resultRow(r) {
    const key = `${r.entity_type}:${r.entity_id}`;
    const dt = splitDT(r.entity_type === 'event' ? r.eventStart : r.updated_at);
    const rawTitle = stripHtmlToPlainText(r.title || '').replace(/\s+/g, ' ').trim() || '(제목 없음)';
    const previewSrc = r.snippet || stripHtmlToPlainText(r.content || '').replace(/\s+/g, ' ').trim();
    const badge = r.categoryName
      ? `<span class="s-row-badge" style="background:${r.categoryColor || 'var(--text-soft)'};color:#fff;">${escapeHtml(r.categoryName)}</span>`
      : `<span class="s-row-badge s-row-badge-type">${TYPE_LABEL[r.entity_type] || ''}</span>`;
    return `
      <div class="s-row ${selected.has(key) ? 'selected' : ''} ${drawerKey === key ? 'active' : ''}" data-key="${key}" data-type="${r.entity_type}" data-id="${r.entity_id}">
        <input type="checkbox" class="s-row-check" ${selected.has(key) ? 'checked' : ''} />
        <span class="s-row-date">${dt.date}</span>
        <div class="s-row-main">
          <div class="s-row-title">${highlight(rawTitle.slice(0, 120), tokens)}</div>
          ${previewSrc ? `<div class="s-row-preview">${highlight(previewSrc.slice(0, 160), tokens)}</div>` : ''}
        </div>
        ${badge}
        <span class="s-row-time">${dt.time}</span>
      </div>`;
  }

  function wireRowOpen(row) {
    row.addEventListener('click', (e) => {
      if (e.target.closest('input,button,a')) return;
      openDrawer(row.dataset.type, Number(row.dataset.id));
    });
  }

  function renderTypeTabs() {
    const el = $('s-typeTabs');
    el.hidden = false;
    const present = TYPE_ORDER.filter((t) => (typeCounts[t] || 0) > 0);
    const grandTotal = Object.values(typeCounts).reduce((a, b) => a + b, 0);
    const isAll = filters.types.length === 0;
    el.innerHTML =
      `<button class="search-type-tab ${isAll ? 'active' : ''}" data-type="">전체 ${grandTotal}</button>` +
      present
        .map(
          (t) =>
            `<button class="search-type-tab ${filters.types.length === 1 && filters.types[0] === t ? 'active' : ''}" data-type="${t}">${TYPE_LABEL[t]} ${typeCounts[t]}</button>`
        )
        .join('');
    el.querySelectorAll('.search-type-tab').forEach((btn) => {
      btn.addEventListener('click', () => setTypeFilter(btn.dataset.type || null));
    });
  }

  function setTypeFilter(type) {
    filters.types = type ? [type] : [];
    syncTypeChecks();
    runSearch(lastKeyword);
  }

  // ---------- 상세 드로어 ----------
  async function openDrawer(type, id) {
    const key = `${type}:${id}`;
    drawerKey = key;
    $('s-layout').classList.add('drawer-open');
    $('s-results').querySelectorAll('.s-row').forEach((r) => r.classList.toggle('active', r.dataset.key === key));
    const drawer = $('s-drawer');
    drawer.innerHTML = `<div class="s-drawer-body"><div class="empty">불러오는 중…</div></div>`;
    try {
      const detail = await loadDetail(type, id);
      if (drawerKey !== key) return;
      if (!detail) {
        drawer.innerHTML = `<div class="s-drawer-body"><div class="empty">항목을 찾을 수 없어요(삭제되었을 수 있어요)</div></div>
          <div class="s-drawer-foot"><button class="btn-secondary" id="s-drawerClose">닫기</button></div>`;
      } else {
        renderDrawer(type, id, detail);
      }
    } catch (e) {
      drawer.innerHTML = `<div class="s-drawer-body"><div class="empty">상세를 불러오지 못했어요</div></div>
        <div class="s-drawer-foot"><button class="btn-secondary" id="s-drawerClose">닫기</button></div>`;
    }
    $('s-drawerClose')?.addEventListener('click', closeDrawer);
  }

  function closeDrawer() {
    drawerKey = null;
    $('s-layout')?.classList.remove('drawer-open');
    $('s-results')?.querySelectorAll('.s-row.active').forEach((r) => r.classList.remove('active'));
    const d = $('s-drawer');
    if (d) d.innerHTML = '';
  }

  async function loadDetail(type, id) {
    if (type === 'todo') return window.itda.todos.get(id);
    if (type === 'event') return window.itda.events.get(id);
    if (type === 'memo') return window.itda.memos.get(id);
    if (type === 'postit') return window.itda.postits.get(id);
    if (type === 'inbox') return results.find((r) => r.entity_type === 'inbox' && r.entity_id === id) || null;
    return null;
  }

  async function renderDrawer(type, id, d) {
    const drawer = $('s-drawer');
    const title = stripHtmlToPlainText(d.title || d.content || '').slice(0, 200) || '(제목 없음)';
    const catNm = d.category_name || catName(d.category_id);
    const catColor = d.color_hex || null;
    let dateLine = '';
    if (type === 'event' && d.start_at) {
      const s = splitDT(d.start_at);
      dateLine = `${d.start_at.slice(0, 10)} ${d.all_day ? '(종일)' : s.time}`;
    } else if (type === 'todo' && d.due_date) {
      dateLine = `마감 ${d.due_date}${d.due_time ? ` ${d.due_time}` : ''}`;
    } else if (d.updated_at) {
      dateLine = `수정 ${d.updated_at.slice(0, 16)}`;
    }
    const bodyText = stripHtmlToPlainText(d.memo || d.content || '').trim();

    let related = [];
    try {
      related = (await window.itda.links.listFor({ type, id })) || [];
    } catch (e) {
      related = [];
    }
    let attachments = [];
    if (type === 'memo') {
      try {
        attachments = (await window.itda.memoAttachments.list(id)) || [];
      } catch (e) {
        attachments = [];
      }
    }
    if (drawerKey !== `${type}:${id}`) return;

    drawer.innerHTML = `
      <div class="s-drawer-head">
        <span class="s-drawer-eyebrow">${TYPE_EMOJI[type] || ''} ${TYPE_LABEL[type] || ''}</span>
        <button class="btn-icon" id="s-drawerX" title="닫기">${CLOSE_ICON}</button>
      </div>
      <div class="s-drawer-body">
        <h3 class="s-drawer-title">${escapeHtml(title)}</h3>
        ${dateLine ? `<div class="s-drawer-meta">${escapeHtml(dateLine)}</div>` : ''}
        ${type === 'event' && d.location ? `<div class="s-drawer-meta">📍 ${escapeHtml(d.location)}</div>` : ''}
        ${catNm ? `<span class="s-row-badge" style="background:${catColor || 'var(--text-soft)'};color:#fff;">${escapeHtml(catNm)}</span>` : ''}
        ${bodyText ? `<div class="s-drawer-text">${escapeHtml(bodyText.slice(0, 600))}${bodyText.length > 600 ? '…' : ''}</div>` : ''}

        ${related.length ? `
          <div class="s-drawer-section">
            <div class="s-drawer-section-head">연관 항목 (${related.length})</div>
            ${related.slice(0, 8).map((r) => `
              <div class="s-drawer-rel" data-type="${r.type}" data-id="${r.id}">
                <span>${TYPE_EMOJI[r.type] || '•'}</span>
                <span class="s-drawer-rel-title">${escapeHtml(stripHtmlToPlainText(r.title || r.label || '').slice(0, 60) || '(제목 없음)')}</span>
                <span class="s-drawer-rel-go">${CHEVRON}</span>
              </div>`).join('')}
          </div>` : ''}

        ${attachments.length ? `
          <div class="s-drawer-section">
            <div class="s-drawer-section-head">첨부 파일 (${attachments.length})</div>
            ${attachments.slice(0, 6).map((a) => `
              <button class="s-drawer-attach" data-attach="${a.id}">
                📎 <span class="s-drawer-attach-name">${escapeHtml(a.file_name || a.filename || '첨부')}</span>
              </button>`).join('')}
          </div>` : ''}
      </div>
      <div class="s-drawer-foot">
        <a class="btn" href="${itemHref(type, id)}" id="s-drawerGo">원본으로 이동 ${EXTERNAL_ICON}</a>
        <button class="btn-secondary" id="s-drawerClose2">닫기</button>
      </div>`;

    $('s-drawerX').addEventListener('click', closeDrawer);
    $('s-drawerClose2').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('.s-drawer-rel').forEach((el) => {
      el.addEventListener('click', () => openDrawer(el.dataset.type, Number(el.dataset.id)));
    });
    drawer.querySelectorAll('.s-drawer-attach').forEach((el) => {
      el.addEventListener('click', () => window.itda.memoAttachments.open(Number(el.dataset.attach)).catch((e) => errorToast(e, '파일을 열지 못했어요')));
    });
  }

  // ---------- 벌크 선택/삭제 ----------
  function updateBulkBar() {
    const bar = $('s-bulkBar');
    if (selected.size === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    $('s-selectedCount').textContent = `${selected.size}개 선택됨`;
  }

  $('s-bulkClear').addEventListener('click', () => {
    selected.clear();
    $('s-results').querySelectorAll('.s-row-check').forEach((cb) => {
      cb.checked = false;
    });
    $('s-results').querySelectorAll('.s-row.selected').forEach((r) => r.classList.remove('selected'));
    updateBulkBar();
  });

  $('s-bulkDelete').addEventListener('click', async () => {
    if (selected.size === 0) return;
    const targets = [...selected].map((key) => {
      const [type, idStr] = key.split(':');
      return { type, id: Number(idStr) };
    });
    $('s-bulkDelete').disabled = true;
    try {
      await Promise.all(targets.map((t) => DELETE_API[t.type]?.(t.id)));
      toast(`${targets.length}개 삭제했어요`);
      selected.clear();
      if (drawerKey && targets.some((t) => `${t.type}:${t.id}` === drawerKey)) closeDrawer();
      await runSearch(lastKeyword);
    } catch (e) {
      errorToast(e, '일부 항목을 삭제하지 못했어요');
      await runSearch(lastKeyword);
    } finally {
      $('s-bulkDelete').disabled = false;
    }
  });

  // ---------- 필터 popover ----------
  const filterPop = $('s-filterPop');
  const closeFilterPop = () => {
    filterPop.hidden = true;
    document.removeEventListener('mousedown', onFilterOutside);
  };
  function onFilterOutside(e) {
    if (!filterPop.contains(e.target) && !$('s-filterBtn').contains(e.target)) closeFilterPop();
  }
  $('s-filterBtn').addEventListener('click', () => {
    if (filterPop.hidden) {
      syncFilterUI();
      filterPop.hidden = false;
      setTimeout(() => document.addEventListener('mousedown', onFilterOutside), 0);
    } else closeFilterPop();
  });

  function syncTypeChecks() {
    $('s-typeChecks').querySelectorAll('input[data-type]').forEach((cb) => {
      cb.checked = filters.types.includes(cb.dataset.type);
    });
  }
  function syncFilterUI() {
    syncTypeChecks();
    $('s-periodChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.toggle('active', c.dataset.period === filters.period));
    $('s-statusChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.toggle('active', c.dataset.status === filters.status));
    $('s-sortChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.toggle('active', c.dataset.sort === filters.sort));
    $('s-customDates').hidden = filters.period !== 'custom';
    $('s-dateFrom').value = filters.dateFrom || '';
    $('s-dateTo').value = filters.dateTo || '';
  }
  function chipGroup(elId, attr, onPick) {
    $(elId).querySelectorAll('.sfp-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $(elId).querySelectorAll('.sfp-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        onPick(chip.dataset[attr]);
      });
    });
  }
  $('s-typeChecks').querySelectorAll('input[data-type]').forEach((cb) => {
    cb.addEventListener('change', () => {
      filters.types = [...$('s-typeChecks').querySelectorAll('input[data-type]:checked')].map((x) => x.dataset.type);
    });
  });
  chipGroup('s-periodChips', 'period', (v) => {
    filters.period = v;
    $('s-customDates').hidden = v !== 'custom';
  });
  chipGroup('s-statusChips', 'status', (v) => (filters.status = v));
  chipGroup('s-sortChips', 'sort', (v) => (filters.sort = v));
  $('s-dateFrom').addEventListener('change', (e) => (filters.dateFrom = e.target.value || null));
  $('s-dateTo').addEventListener('change', (e) => (filters.dateTo = e.target.value || null));

  function resolvePeriod() {
    const t = todayStr();
    if (filters.period === 'today') filters.dateFrom = filters.dateTo = t;
    else if (filters.period === '7d') { filters.dateFrom = dateKey(addDays(new Date(), -7)); filters.dateTo = t; }
    else if (filters.period === '30d') { filters.dateFrom = dateKey(addDays(new Date(), -30)); filters.dateTo = t; }
    else if (filters.period === 'week') { filters.dateFrom = dateKey(startOfWeek(new Date())); filters.dateTo = t; }
    else if (filters.period === 'custom') { filters.dateFrom = $('s-dateFrom').value || null; filters.dateTo = $('s-dateTo').value || null; }
    else { filters.dateFrom = filters.dateTo = null; }
  }
  function activeFilterCount() {
    let n = 0;
    if (filters.types.length) n++;
    if (filters.period !== 'all') n++;
    if (filters.status !== 'all') n++;
    if (filters.sort !== 'recent') n++;
    return n;
  }
  function applyFilters() {
    resolvePeriod();
    const n = activeFilterCount();
    const badge = $('s-filterCount');
    badge.hidden = n === 0;
    badge.textContent = n;
    closeFilterPop();
    if (lastKeyword.trim()) runSearch(lastKeyword);
  }
  $('s-filterApply').addEventListener('click', applyFilters);
  $('s-filterReset').addEventListener('click', () => {
    filters.types = [];
    filters.period = 'all';
    filters.status = 'all';
    filters.sort = 'recent';
    filters.dateFrom = filters.dateTo = null;
    syncFilterUI();
    applyFilters();
  });

  // ---------- 입력 ----------
  $('s-input').addEventListener('input', (e) => {
    const value = e.target.value;
    $('s-clear').hidden = !value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(value), 250);
  });
  $('s-clear').addEventListener('click', () => {
    $('s-input').value = '';
    $('s-clear').hidden = true;
    $('s-input').focus();
    runSearch('');
  });
  $('s-loadMore').addEventListener('click', () => runSearch(lastKeyword, { append: true }));

  // ---------- 단축키 ----------
  function rowEls() {
    return [...$('s-results').querySelectorAll('.s-row')];
  }
  function paintKbd() {
    const els = rowEls();
    els.forEach((el, i) => el.classList.toggle('kbd', i === kbdIdx));
    if (kbdIdx >= 0 && els[kbdIdx]) els[kbdIdx].scrollIntoView({ block: 'nearest' });
  }
  function moveKbd(delta) {
    const n = rowEls().length;
    if (!n) return;
    kbdIdx = kbdIdx < 0 ? (delta > 0 ? 0 : n - 1) : (kbdIdx + delta + n) % n;
    paintKbd();
  }
  function onKey(e) {
    if (e.defaultPrevented) return;
    const typing = document.activeElement === $('s-input');
    if (e.key === 'Escape') {
      if (drawerKey) { e.preventDefault(); closeDrawer(); }
      else if (typing && $('s-input').value) { e.preventDefault(); $('s-input').value = ''; $('s-clear').hidden = true; runSearch(''); }
      return;
    }
    if ((e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) ||
        ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'k'))) {
      e.preventDefault();
      $('s-input').focus();
      $('s-input').select();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveKbd(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveKbd(-1); }
    else if (e.key === 'Enter' && kbdIdx >= 0) {
      const el = rowEls()[kbdIdx];
      if (el) { e.preventDefault(); openDrawer(el.dataset.type, Number(el.dataset.id)); }
    }
  }
  document.addEventListener('keydown', onKey);
  setScreenShortcuts('검색', [
    { label: '검색창', keys: '/' },
    { label: '결과 이동', keys: '↑↓' },
    { label: '열기', keys: 'Enter' },
    { label: '닫기', keys: 'Esc' },
  ]);

  renderPrompt();

  return () => {
    clearTimeout(debounceTimer);
    clearTimeout(recordTimer);
    document.removeEventListener('mousedown', onFilterOutside);
    document.removeEventListener('keydown', onKey);
    setScreenShortcuts(null, []);
  };
}
