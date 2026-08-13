import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock } from '../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../shared/rich-text.js';

const TRASH_HEADER_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const RESTORE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`;
const DELETE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

const TYPE_META = {
  todo: { label: 'Todo', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>` },
  event: { label: '일정', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>` },
  memo: { label: '메모', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>` },
  postit: { label: '포스트잇', icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6l3-2 3 2V3"/></svg>` },
};

// memo/postit은 label이 HTML(볼드·글씨크기 서식)일 수 있어서 태그를 걷어내고 짧게 자른다.
function plainLabel(label) {
  const text = stripHtmlToPlainText(label || '').replace(/\s+/g, ' ').trim();
  return text || '(제목 없음)';
}

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon">${TRASH_HEADER_ICON}</div>
        <div><h1>휴지통</h1><p>삭제된 Todo·일정·메모·포스트잇을 복원하거나 완전히 삭제할 수 있어요.</p></div>
      </div>
    </div>

    <div class="trash-filter-row">
      <div class="notes-search-box" style="flex:1;max-width:260px;">
        ${SEARCH_ICON}
        <input type="text" id="tr-search" placeholder="휴지통에서 검색" />
      </div>
      <select id="tr-typeFilter" class="select">
        <option value="">전체 종류</option>
        <option value="todo">Todo</option>
        <option value="event">일정</option>
        <option value="memo">메모</option>
        <option value="postit">포스트잇</option>
      </select>
      <select id="tr-categoryFilter" class="select"><option value="">전체 카테고리</option></select>
    </div>

    <div class="trash-bulk-bar" id="tr-bulkBar" style="display:none;">
      <label class="checkbox-row"><input type="checkbox" id="tr-selectAll" /> 전체선택</label>
      <span class="search-selected-count" id="tr-selectedCount"></span>
      <div style="flex:1;"></div>
      <button class="btn-secondary" id="tr-bulkRestore">선택 복원</button>
      <button class="btn-secondary search-bulk-delete-btn" id="tr-bulkPurge">선택 완전삭제</button>
      <button class="btn-secondary search-bulk-delete-btn" id="tr-purgeAll">휴지통 비우기</button>
    </div>

    <div id="tr-list" class="compact-list"><div class="empty">불러오는 중…</div></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let allItems = [];
  let categories = [];
  let keyword = '';
  let typeFilter = '';
  let categoryFilter = '';
  let selected = new Set(); // "type:id"
  let currentKeys = [];

  function filteredItems() {
    let list = allItems;
    if (typeFilter) list = list.filter((i) => i.type === typeFilter);
    if (categoryFilter) list = list.filter((i) => String(i.category_id) === String(categoryFilter));
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase();
      list = list.filter((i) => plainLabel(i.label).toLowerCase().includes(k));
    }
    return list;
  }

  function updateBulkBar() {
    const bar = $('tr-bulkBar');
    if (currentKeys.length === 0) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const selectAllCb = $('tr-selectAll');
    selectAllCb.checked = currentKeys.length > 0 && currentKeys.every((k) => selected.has(k));
    selectAllCb.indeterminate = selected.size > 0 && !selectAllCb.checked;
    $('tr-selectedCount').textContent = selected.size > 0 ? `${selected.size}개 선택됨` : '';
    $('tr-bulkRestore').disabled = selected.size === 0;
    $('tr-bulkPurge').disabled = selected.size === 0;
  }

  function render() {
    const listEl = $('tr-list');
    const items = filteredItems();
    currentKeys = items.map((i) => `${i.type}:${i.id}`);

    if (allItems.length === 0) {
      listEl.innerHTML = emptyStateBlock({ icon: TRASH_HEADER_ICON.replace('18', '32'), title: '휴지통이 비어있어요', subtitle: '삭제한 항목이 여기에 모여요' });
      $('tr-bulkBar').style.display = 'none';
      return;
    }
    if (items.length === 0) {
      listEl.innerHTML = emptyStateBlock({ title: '조건에 맞는 항목이 없어요', subtitle: '필터나 검색어를 바꿔보세요' });
      updateBulkBar();
      return;
    }

    listEl.innerHTML = items
      .map((i) => {
        const key = `${i.type}:${i.id}`;
        return `
        <div class="list-row" data-key="${key}">
          <input type="checkbox" data-action="select" data-key="${key}" />
          <div class="row-icon">${TYPE_META[i.type]?.icon || ''}</div>
          <div class="main">
            <b>${escapeHtml(plainLabel(i.label))}</b>
            <div class="meta">${TYPE_META[i.type]?.label || i.type} · ${formatRelative(i.deleted_at)} 삭제됨</div>
          </div>
          <div class="actions">
            <button class="btn-icon" data-action="restore" data-type="${i.type}" data-id="${i.id}" title="복원">${RESTORE_ICON}</button>
            <button class="btn-icon" data-action="purge" data-type="${i.type}" data-id="${i.id}" title="완전 삭제" style="color:var(--danger);">${DELETE_ICON}</button>
          </div>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.key);
        else selected.delete(cb.dataset.key);
        updateBulkBar();
      });
    });
    listEl.querySelectorAll('[data-action="restore"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.trash.restore({ type: btn.dataset.type, id: Number(btn.dataset.id) });
          toast('복원했어요');
          await load();
        } catch (e) {
          errorToast(e, '복원하지 못했어요');
        }
      });
    });
    listEl.querySelectorAll('[data-action="purge"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.trash.permanentlyDelete({ type: btn.dataset.type, id: Number(btn.dataset.id) });
          toast('완전히 삭제했어요');
          await load();
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });
    });

    updateBulkBar();
  }

  async function load() {
    selected.clear();
    try {
      [allItems, categories] = await Promise.all([window.itda.trash.list(), window.itda.categories.list()]);
    } catch (e) {
      errorToast(e, '휴지통을 불러오지 못했어요');
      $('tr-list').innerHTML = emptyStateBlock({ title: '불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    $('tr-categoryFilter').innerHTML =
      `<option value="">전체 카테고리</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    render();
  }

  let searchTimer = null;
  $('tr-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => {
      keyword = value;
      render();
    }, 150);
  });
  $('tr-typeFilter').addEventListener('change', (e) => {
    typeFilter = e.target.value;
    render();
  });
  $('tr-categoryFilter').addEventListener('change', (e) => {
    categoryFilter = e.target.value;
    render();
  });

  $('tr-selectAll').addEventListener('change', (e) => {
    if (e.target.checked) currentKeys.forEach((k) => selected.add(k));
    else selected.clear();
    $('tr-list').querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.checked = selected.has(cb.dataset.key);
    });
    updateBulkBar();
  });

  function selectedTargets() {
    return [...selected].map((key) => {
      const [type, idStr] = key.split(':');
      return { type, id: Number(idStr) };
    });
  }

  $('tr-bulkRestore').addEventListener('click', async () => {
    const targets = selectedTargets();
    if (targets.length === 0) return;
    try {
      await Promise.all(targets.map((t) => window.itda.trash.restore(t)));
      toast(`${targets.length}개 복원했어요`);
      await load();
    } catch (e) {
      errorToast(e, '일부 항목을 복원하지 못했어요');
      await load();
    }
  });

  $('tr-bulkPurge').addEventListener('click', async () => {
    const targets = selectedTargets();
    if (targets.length === 0) return;
    try {
      await Promise.all(targets.map((t) => window.itda.trash.permanentlyDelete(t)));
      toast(`${targets.length}개 완전히 삭제했어요`);
      await load();
    } catch (e) {
      errorToast(e, '일부 항목을 삭제하지 못했어요');
      await load();
    }
  });

  $('tr-purgeAll').addEventListener('click', async () => {
    if (allItems.length === 0) return;
    try {
      await Promise.all(allItems.map((i) => window.itda.trash.permanentlyDelete({ type: i.type, id: i.id })));
      toast('휴지통을 비웠어요');
      await load();
    } catch (e) {
      errorToast(e, '휴지통을 비우지 못했어요');
      await load();
    }
  });

  await load();
}
