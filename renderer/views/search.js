import { escapeHtml, toast, errorToast, emptyStateBlock } from '../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';
import { TYPE_EMOJI } from '../shared/links-ui.js';
import { todayStr, dateKey, startOfWeek } from '../shared/date-utils.js';
import { attachContextMenu } from '../shared/context-menu.js';

const RECENT_KEY = 'search_recent'; // 최근 검색어 (JSON 배열, 최대 8개)
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
const LIST_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const BOARD_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="6" height="9" rx="1"/><rect x="19" y="4" width="2" height="5" rx="1"/></svg>`;

const TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇', inbox: 'Inbox' };
// 검색 결과가 왜 나왔는지 (search.repository의 matchedIn)
const MATCH_LABEL = { title: '제목 일치', chosung: '초성 일치', content: '본문 일치' };
const TYPE_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit', inbox: '#/inbox' };
// 클릭 시 그 항목까지 바로 열리도록 딥링크(#/type/id). inbox는 낱개 상세가 없어 목록으로.
const itemHref = (type, id) => (type === 'inbox' ? '#/inbox' : `${TYPE_ROUTE[type] || '#/dashboard'}/${id}`);
// 타입별로 실제 삭제 API가 다르다 (todo/event/memo/postit는 소프트 삭제=휴지통행, inbox는 하드 삭제)
const DELETE_API = {
  todo: (id) => window.itda.todos.delete(id),
  event: (id) => window.itda.events.delete(id),
  memo: (id) => window.itda.memos.delete(id),
  postit: (id) => window.itda.postits.delete(id),
  inbox: (id) => window.itda.inbox.delete(id),
};

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-blue">${SEARCH_ICON}</div>
        <div><h1>검색</h1><p>Todo, 일정, 메모, 포스트잇, Inbox 전체를 한 번에 검색합니다.</p></div>
      </div>
    </div>
    <div class="search-toolbar">
      <input type="text" id="s-input" class="input" style="width:100%;max-width:420px;" placeholder="검색어를 입력하세요…" autofocus />
      <div class="search-filter-wrap">
        <button class="btn-secondary" id="s-filterBtn">필터</button>
        <div class="search-filter-pop" id="s-filterPop" hidden>
          <div class="sfp-section">
            <div class="sfp-label">기간</div>
            <div class="sfp-chips" id="s-periodChips">
              <button class="sfp-chip active" data-period="all">전체</button>
              <button class="sfp-chip" data-period="today">오늘</button>
              <button class="sfp-chip" data-period="week">이번 주</button>
              <button class="sfp-chip" data-period="custom">직접 지정</button>
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
          <button class="btn-link sfp-reset" id="s-filterReset">필터 초기화</button>
        </div>
      </div>
      <div class="view-toggle" id="s-viewToggle">
        <button class="view-toggle-btn" data-view="list" title="목록">${LIST_VIEW_ICON}</button>
        <button class="view-toggle-btn active" data-view="board" title="보드">${BOARD_VIEW_ICON}</button>
      </div>
    </div>

    <div class="search-type-tabs" id="s-typeTabs" hidden></div>

    <div class="search-bulk-bar" id="s-bulkBar" style="display:none;">
      <label class="checkbox-row"><input type="checkbox" id="s-selectAll" /> 전체선택</label>
      <span class="search-selected-count" id="s-selectedCount"></span>
      <button class="btn-secondary search-bulk-delete-btn" id="s-bulkDelete" disabled>${TRASH_ICON} 선택삭제</button>
    </div>

    <div id="s-results" style="margin-top:14px;"></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let debounceTimer = null;
  let recordTimer = null; // 최근 검색어 기록 지연
  let lastKeyword = '';
  let lastResults = { direct: [], related: [] }; // 뷰 전환(목록↔보드) 시 재검색 없이 다시 그림
  let currentView = 'board'; // 결과가 많으면 목록은 스크롤이 너무 길어져서 보드를 기본값으로 (요청에 따름)
  let selected = new Set(); // "type:id" 키 집합
  let currentAllKeys = []; // 마지막 검색 결과의 전체 키 목록 (전체선택 체크박스가 참조)
  // type은 클라에서 필터(재검색 X), dateFrom/dateTo/status는 서버 필터(재검색 O)
  const filters = { type: null, period: 'all', dateFrom: null, dateTo: null, status: 'all' };

  // 검색어가 없을 때 뜨는 시작 화면 — 최근 검색어 + 최근 항목
  async function renderPrompt() {
    $('s-bulkBar').style.display = 'none';
    $('s-typeTabs').hidden = true;
    const resultsEl = $('s-results');
    const [recentQ, recentItems] = await Promise.all([
      getRecentQueries(),
      window.itda.search.recentItems().catch(() => []),
    ]);
    if (!recentQ.length && !recentItems.length) {
      resultsEl.innerHTML = emptyStateBlock({
        icon: SEARCH_ICON.replace('18', '32'),
        title: '검색어를 입력해보세요',
        subtitle: 'Todo·일정·메모·포스트잇·Inbox를 한 번에 찾아드려요',
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
          <div>${recentItems.map(renderStartItemRow).join('')}</div>
        </div>` : ''}
    `;
    resultsEl.querySelectorAll('.search-recent-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('s-input').value = btn.dataset.q;
        runSearch(btn.dataset.q);
      });
    });
    const clearBtn = $('s-clearRecent');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      try { await window.itda.settings.set({ key: RECENT_KEY, value: '[]' }); } catch (e) { /* noop */ }
      renderPrompt();
    });
    wireResultRows(resultsEl);
  }

  function renderStartItemRow(r) {
    const key = `${r.entity_type}:${r.entity_id}`;
    return `
      <div class="list-row search-related-row" data-key="${key}">
        <span class="search-related-icon" data-type="${r.entity_type}">${TYPE_EMOJI[r.entity_type] || '•'}</span>
        <a class="main" href="${itemHref(r.entity_type, r.entity_id)}">
          <b>${escapeHtml(stripHtmlToPlainText(r.title || '').slice(0, 60) || '(제목 없음)')}</b>
        </a>
      </div>`;
  }
  renderPrompt();

  // 결과/시작화면의 각 행(.list-row / .search-card)에 우클릭 메뉴(열기·연결·전환·삭제)를 붙인다.
  function wireResultRows(container) {
    container.querySelectorAll('[data-key]').forEach((el) => {
      const [type, idStr] = el.dataset.key.split(':');
      const id = Number(idStr);
      attachContextMenu(el, () => ({ type, id }), {
        linkOnly: type === 'inbox', // inbox는 소프트삭제/위젯이 없어 연결·전환만
        onDeleted: () => (lastKeyword ? runSearch(lastKeyword) : renderPrompt()),
      });
    });
  }

  function updateBulkBar(allKeys) {
    const bar = $('s-bulkBar');
    if (allKeys.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const selectAllCb = $('s-selectAll');
    selectAllCb.checked = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
    selectAllCb.indeterminate = selected.size > 0 && !selectAllCb.checked;
    $('s-selectedCount').textContent = selected.size > 0 ? `${selected.size}개 선택됨` : '';
    $('s-bulkDelete').disabled = selected.size === 0;
  }

  function renderResultCard(type, i) {
    const key = `${type}:${i.entity_id}`;
    const badge = MATCH_LABEL[i.matchedIn] ? `<span class="search-match-badge" data-match="${i.matchedIn}">${MATCH_LABEL[i.matchedIn]}</span>` : '';
    if (currentView === 'board') {
      return `
        <div class="search-card" data-key="${key}">
          <input type="checkbox" data-action="select" data-key="${key}" />
          <a class="search-card-body" href="${itemHref(type, i.entity_id)}">
            <b>${escapeHtml(i.title || '(제목 없음)')}${badge}</b>
            <p>${escapeHtml(stripHtmlToPlainText(i.content || '').slice(0, 80))}</p>
          </a>
        </div>`;
    }
    return `
      <div class="list-row search-result-row" data-key="${key}">
        <input type="checkbox" data-action="select" data-key="${key}" />
        <a class="main" href="${itemHref(type, i.entity_id)}">
          <b>${escapeHtml(i.title || '(제목 없음)')}${badge}</b>
          <div class="meta">${escapeHtml(stripHtmlToPlainText(i.content || '').slice(0, 60))}</div>
        </a>
      </div>`;
  }

  function renderRelatedRow(r) {
    const key = `${r.entity_type}:${r.entity_id}`;
    const reason = r.relatedReason === 'tag' ? `같은 태그${r.tagName ? ` · ${r.tagName}` : ''}` : '연결된 항목';
    return `
      <div class="list-row search-related-row" data-key="${key}">
        <span class="search-related-icon" data-type="${r.entity_type}">${TYPE_EMOJI[r.entity_type] || '•'}</span>
        <a class="main" href="${itemHref(r.entity_type, r.entity_id)}">
          <b>${escapeHtml(stripHtmlToPlainText(r.title || '').slice(0, 60) || '(제목 없음)')}<span class="search-match-badge" data-match="related">${reason}</span></b>
        </a>
      </div>`;
  }

  // 종류 탭: 전체 + 결과에 실제로 있는 타입만. filters.type로 좁혀 보여준다(재검색 없음).
  function renderTypeTabs(directAll) {
    const tabsEl = $('s-typeTabs');
    if (!directAll.length) {
      tabsEl.hidden = true;
      return;
    }
    const counts = {};
    directAll.forEach((r) => { counts[r.entity_type] = (counts[r.entity_type] || 0) + 1; });
    const order = ['todo', 'event', 'memo', 'postit', 'inbox'].filter((t) => counts[t]);
    tabsEl.hidden = false;
    tabsEl.innerHTML =
      `<button class="search-type-tab ${!filters.type ? 'active' : ''}" data-type="">전체 ${directAll.length}</button>` +
      order.map((t) => `<button class="search-type-tab ${filters.type === t ? 'active' : ''}" data-type="${t}">${TYPE_LABEL[t]} ${counts[t]}</button>`).join('');
    tabsEl.querySelectorAll('.search-type-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.type = btn.dataset.type || null;
        renderResults(lastResults);
      });
    });
  }

  function renderResults(payload) {
    // payload: { direct, related }  (구버전 배열도 방어적으로 허용)
    const directAll = Array.isArray(payload) ? payload : payload.direct || [];
    const related = Array.isArray(payload) ? [] : payload.related || [];
    const resultsEl = $('s-results');
    renderTypeTabs(directAll);
    const direct = filters.type ? directAll.filter((r) => r.entity_type === filters.type) : directAll;
    if (directAll.length === 0) {
      resultsEl.innerHTML = emptyStateBlock({
        icon: SEARCH_ICON.replace('18', '32'),
        title: `"${escapeHtml(lastKeyword)}"에 대한 결과가 없어요`,
        subtitle: hasActiveFilter() ? '필터를 바꾸거나 초기화해 보세요' : '다른 검색어로 시도해보세요',
      });
      $('s-bulkBar').style.display = 'none';
      return;
    }

    const grouped = {};
    direct.forEach((r) => {
      grouped[r.entity_type] = grouped[r.entity_type] || [];
      grouped[r.entity_type].push(r);
    });

    const allKeys = direct.map((r) => `${r.entity_type}:${r.entity_id}`);
    currentAllKeys = allKeys;

    const listClass = currentView === 'board' ? 'search-board-grid' : '';
    const directHtml = Object.entries(grouped)
      .map(
        ([type, items]) => `
        <div class="search-group">
          <h4>${TYPE_LABEL[type] || type} (${items.length})</h4>
          <div class="${listClass}">
            ${items.map((i) => renderResultCard(type, i)).join('')}
          </div>
        </div>`
      )
      .join('');
    const relatedHtml = related.length
      ? `<div class="search-group search-related-group">
           <h4>🔗 관련 항목 (${related.length})</h4>
           <div>${related.map(renderRelatedRow).join('')}</div>
         </div>`
      : '';
    resultsEl.innerHTML = directHtml + relatedHtml;

    updateBulkBar(allKeys);

    resultsEl.querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.key);
        else selected.delete(cb.dataset.key);
        updateBulkBar(allKeys);
      });
    });
    wireResultRows(resultsEl); // 각 행 우클릭 메뉴(열기·연결·전환·삭제)
  }

  function hasActiveFilter() {
    return !!filters.type || filters.period !== 'all' || filters.status !== 'all';
  }
  function syncFilterBtn() {
    $('s-filterBtn').classList.toggle('has-filter', filters.period !== 'all' || filters.status !== 'all');
  }
  // 기간 칩 → dateFrom/dateTo 계산 (서버 필터)
  function resolvePeriod() {
    if (filters.period === 'today') {
      filters.dateFrom = filters.dateTo = todayStr();
    } else if (filters.period === 'week') {
      filters.dateFrom = dateKey(startOfWeek(new Date()));
      filters.dateTo = todayStr();
    } else if (filters.period === 'custom') {
      filters.dateFrom = $('s-dateFrom').value || null;
      filters.dateTo = $('s-dateTo').value || null;
    } else {
      filters.dateFrom = filters.dateTo = null;
    }
  }

  async function runSearch(keyword) {
    lastKeyword = keyword;
    const resultsEl = $('s-results');
    if (!keyword.trim()) {
      selected.clear();
      lastResults = { direct: [], related: [] };
      $('s-typeTabs').hidden = true;
      renderPrompt();
      return;
    }
    resolvePeriod();
    syncFilterBtn();
    let results;
    try {
      results = await window.itda.search.query({
        query: keyword,
        related: true,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        status: filters.status === 'all' ? null : filters.status,
      });
    } catch (e) {
      errorToast(e, '검색하지 못했어요');
      resultsEl.innerHTML = emptyStateBlock({ title: '검색 중 오류가 발생했어요', subtitle: '잠시 후 다시 시도해주세요' });
      $('s-bulkBar').style.display = 'none';
      return;
    }
    // 검색어가 바뀔 때마다 선택은 초기화 (이전 검색 결과의 선택 상태를 새 결과에 들고 오면 혼란스러움)
    selected.clear();
    lastResults = results;
    renderResults(results);
    // 결과가 있으면 최근 검색어로 기록 — 타이핑 중간값("김","김부")이 안 쌓이게 잠깐 뒤에
    if ((results.direct || []).length) {
      clearTimeout(recordTimer);
      recordTimer = setTimeout(() => {
        if ($('s-input').value.trim() === keyword.trim()) recordRecentQuery(keyword);
      }, 1400);
    }
  }

  root.querySelectorAll('#s-viewToggle .view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === currentView) return;
      root.querySelectorAll('#s-viewToggle .view-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      if (lastResults.direct?.length) renderResults(lastResults); // 재검색 없이 같은 결과를 다른 모양으로만 다시 그림
    });
  });

  // ---------- 필터 popover (기간 / 상태 — 둘 다 서버 필터라 바뀌면 재검색) ----------
  const filterPop = $('s-filterPop');
  const closeFilterPop = () => { filterPop.hidden = true; document.removeEventListener('mousedown', onFilterOutside); };
  function onFilterOutside(e) {
    if (!filterPop.contains(e.target) && e.target !== $('s-filterBtn')) closeFilterPop();
  }
  $('s-filterBtn').addEventListener('click', () => {
    if (filterPop.hidden) {
      filterPop.hidden = false;
      setTimeout(() => document.addEventListener('mousedown', onFilterOutside), 0);
    } else closeFilterPop();
  });
  $('s-periodChips').querySelectorAll('.sfp-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('s-periodChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      filters.period = chip.dataset.period;
      $('s-customDates').hidden = filters.period !== 'custom';
      if (filters.period !== 'custom' && lastKeyword) runSearch(lastKeyword);
    });
  });
  const onCustomDate = () => { if (filters.period === 'custom' && lastKeyword) runSearch(lastKeyword); };
  $('s-dateFrom').addEventListener('change', onCustomDate);
  $('s-dateTo').addEventListener('change', onCustomDate);
  $('s-statusChips').querySelectorAll('.sfp-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('s-statusChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      filters.status = chip.dataset.status;
      if (lastKeyword) runSearch(lastKeyword);
    });
  });
  $('s-filterReset').addEventListener('click', () => {
    filters.type = null;
    filters.period = 'all';
    filters.status = 'all';
    filters.dateFrom = filters.dateTo = null;
    $('s-periodChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.toggle('active', c.dataset.period === 'all'));
    $('s-statusChips').querySelectorAll('.sfp-chip').forEach((c) => c.classList.toggle('active', c.dataset.status === 'all'));
    $('s-customDates').hidden = true;
    closeFilterPop();
    if (lastKeyword) runSearch(lastKeyword);
  });

  // 전체선택 체크박스는 s-results 바깥(고정 DOM)에 있어서 runSearch가 재실행돼도 같은 엘리먼트를 계속 쓴다.
  // runSearch 안에서 매번 addEventListener 하면 호출될 때마다 리스너가 쌓이므로, 여기서 딱 한 번만 바인딩하고
  // 최신 목록은 currentAllKeys를 통해 참조한다.
  $('s-selectAll').addEventListener('change', (e) => {
    if (e.target.checked) currentAllKeys.forEach((k) => selected.add(k));
    else selected.clear();
    $('s-results').querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.checked = selected.has(cb.dataset.key);
    });
    updateBulkBar(currentAllKeys);
  });

  $('s-bulkDelete').addEventListener('click', async () => {
    if (selected.size === 0) return;
    const targets = [...selected].map((key) => {
      const [type, idStr] = key.split(':');
      return { type, id: Number(idStr) };
    });
    $('s-bulkDelete').disabled = true;
    try {
      // 타입이 섞여있어도(Todo+메모 동시선택 등) 각자 맞는 삭제 API로 병렬 처리
      await Promise.all(targets.map((t) => DELETE_API[t.type]?.(t.id)));
      toast(`${targets.length}개 삭제했어요`);
      selected.clear();
      await runSearch(lastKeyword);
    } catch (e) {
      errorToast(e, '일부 항목을 삭제하지 못했어요');
      await runSearch(lastKeyword); // 실패했더라도 최신 상태로 다시 맞춤
    }
  });

  $('s-input').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const value = e.target.value;
    debounceTimer = setTimeout(() => runSearch(value), 250);
  });

  return () => {
    clearTimeout(debounceTimer);
    clearTimeout(recordTimer);
    document.removeEventListener('mousedown', onFilterOutside);
  };
}
