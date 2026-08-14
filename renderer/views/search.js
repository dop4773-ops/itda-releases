import { escapeHtml, toast, errorToast, emptyStateBlock } from '../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';

const SEARCH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

const TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇', inbox: 'Inbox' };
const TYPE_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit', inbox: '#/inbox' };
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
    <input type="text" id="s-input" class="input" style="width:100%;max-width:420px;" placeholder="검색어를 입력하세요…" autofocus />

    <div class="search-bulk-bar" id="s-bulkBar" style="display:none;">
      <label class="checkbox-row"><input type="checkbox" id="s-selectAll" /> 전체선택</label>
      <span class="search-selected-count" id="s-selectedCount"></span>
      <button class="btn-secondary search-bulk-delete-btn" id="s-bulkDelete" disabled>${TRASH_ICON} 선택삭제</button>
    </div>

    <div id="s-results" style="margin-top:14px;"></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let debounceTimer = null;
  let lastKeyword = '';
  let selected = new Set(); // "type:id" 키 집합
  let currentAllKeys = []; // 마지막 검색 결과의 전체 키 목록 (전체선택 체크박스가 참조)

  function renderPrompt() {
    $('s-bulkBar').style.display = 'none';
    $('s-results').innerHTML = emptyStateBlock({
      icon: SEARCH_ICON.replace('18', '32'),
      title: '검색어를 입력해보세요',
      subtitle: 'Todo·일정·메모·포스트잇·Inbox를 한 번에 찾아드려요',
    });
  }
  renderPrompt();

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

  async function runSearch(keyword) {
    lastKeyword = keyword;
    const resultsEl = $('s-results');
    if (!keyword.trim()) {
      selected.clear();
      renderPrompt();
      return;
    }
    let results;
    try {
      results = await window.itda.search.query(keyword);
    } catch (e) {
      errorToast(e, '검색하지 못했어요');
      resultsEl.innerHTML = emptyStateBlock({ title: '검색 중 오류가 발생했어요', subtitle: '잠시 후 다시 시도해주세요' });
      $('s-bulkBar').style.display = 'none';
      return;
    }
    // 검색어가 바뀔 때마다 선택은 초기화 (이전 검색 결과의 선택 상태를 새 결과에 들고 오면 혼란스러움)
    selected.clear();

    if (results.length === 0) {
      resultsEl.innerHTML = emptyStateBlock({
        icon: SEARCH_ICON.replace('18', '32'),
        title: `"${escapeHtml(keyword)}"에 대한 결과가 없어요`,
        subtitle: '다른 검색어로 시도해보세요',
      });
      $('s-bulkBar').style.display = 'none';
      return;
    }

    const grouped = {};
    results.forEach((r) => {
      grouped[r.entity_type] = grouped[r.entity_type] || [];
      grouped[r.entity_type].push(r);
    });

    const allKeys = results.map((r) => `${r.entity_type}:${r.entity_id}`);
    currentAllKeys = allKeys;

    resultsEl.innerHTML = Object.entries(grouped)
      .map(
        ([type, items]) => `
        <div class="search-group">
          <h4>${TYPE_LABEL[type] || type} (${items.length})</h4>
          ${items
            .map((i) => {
              const key = `${type}:${i.entity_id}`;
              return `
            <div class="list-row search-result-row" data-key="${key}">
              <input type="checkbox" data-action="select" data-key="${key}" />
              <a class="main" href="${TYPE_ROUTE[type] || '#/dashboard'}">
                <b>${escapeHtml(i.title || '(제목 없음)')}</b>
                <div class="meta">${escapeHtml(stripHtmlToPlainText(i.content || '').slice(0, 60))}</div>
              </a>
            </div>`;
            })
            .join('')}
        </div>`
      )
      .join('');

    updateBulkBar(allKeys);

    resultsEl.querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.key);
        else selected.delete(cb.dataset.key);
        updateBulkBar(allKeys);
      });
    });
  }

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
}
