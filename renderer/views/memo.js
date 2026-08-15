import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { bindMentionAutocomplete } from '../shared/mention.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { sanitizeRichHtml, stripHtmlToPlainText, toggleBold, applyFontSize, applyTextColor, insertChecklistItem, bindChecklistToggle, bindChecklistEnterKey, linkifyUrls } from '../shared/rich-text.js';
import { attachDragOut, DRAG_HANDLE_ICON } from '../shared/drag-out.js';
import { attachContextMenu } from '../shared/context-menu.js';

const MEMO_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>`;
const PIN_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const PIN_OUTLINE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const PLUS_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const BOLD_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 4h6a3.5 3.5 0 010 7H6zM6 11h7a3.5 3.5 0 010 7H6z"/></svg>`;
const CHECKLIST_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><path d="M4.5 6.5l1.3 1.3L8.5 5"/><path d="M13 5h8M13 12h8M13 19h8"/><rect x="3" y="13" width="7" height="7" rx="1.5"/></svg>`;
const PAPERCLIP_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.19 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;
const FILE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>`;
const SMALL_X_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const LINK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07L12.5 19.5"/></svg>`;

// 저장된 content(HTML)의 첫 줄을 "제목 없는 메모"의 표시용 제목으로 쓴다 (애플 메모장과 동일한 관습).
function deriveTitle(memo) {
  if (memo.title && memo.title.trim()) return memo.title.trim();
  const firstLine = stripHtmlToPlainText(memo.content || '').split('\n')[0].trim();
  return firstLine || '새로운 메모';
}
function deriveSnippet(memo) {
  const lines = stripHtmlToPlainText(memo.content || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // 제목으로 이미 쓴 첫 줄은 미리보기에서 제외 (제목 필드를 따로 안 쓰는 애플 메모장 스타일 관습)
  const rest = memo.title && memo.title.trim() ? lines : lines.slice(1);
  return rest.join(' ').slice(0, 60);
}

export async function mount(root) {
  root.innerHTML = `
    <div class="notes-app">
      <div class="notes-sidebar">
        <div class="notes-sidebar-head">
          <div class="notes-search-box">
            ${SEARCH_ICON}
            <input type="text" id="m-search" placeholder="검색" />
          </div>
          <button class="notes-new-btn" id="m-newBtn" title="새 메모">${PLUS_ICON}</button>
          ${widgetLaunchButtonHtml('m-widgetBtn', '빠른 메모 위젯 열기')}
        </div>
        <div class="notes-bulk-bar" id="m-bulkBar" style="display:none;">
          <label class="checkbox-row"><input type="checkbox" id="m-selectAll" /> 전체선택</label>
          <span class="search-selected-count" id="m-selectedCount"></span>
          <button class="btn-secondary search-bulk-delete-btn" id="m-bulkDelete" disabled>${TRASH_ICON} 삭제</button>
        </div>
        <div class="notes-list" id="m-list"><div class="empty">불러오는 중…</div></div>
      </div>

      <div class="notes-detail" id="m-detail">
        <div class="notes-detail-empty" id="m-detailEmpty">
          <div class="page-head-icon tone-yellow" style="margin:0 auto 10px;">${MEMO_ICON}</div>
          메모를 선택하거나 새로 만들어보세요
        </div>
      </div>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let memos = [];
  let selectedId = null;
  let keyword = '';
  let selected = new Set(); // 선택삭제용 — 메모 id 집합

  function filteredMemos() {
    if (!keyword.trim()) return memos;
    const k = keyword.trim().toLowerCase();
    return memos.filter(
      (m) => deriveTitle(m).toLowerCase().includes(k) || stripHtmlToPlainText(m.content || '').toLowerCase().includes(k)
    );
  }

  function updateBulkBar(allIds) {
    const bar = $('m-bulkBar');
    if (!allIds.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const selectAllCb = $('m-selectAll');
    selectAllCb.checked = allIds.length > 0 && allIds.every((id) => selected.has(id));
    selectAllCb.indeterminate = selected.size > 0 && !selectAllCb.checked;
    $('m-selectedCount').textContent = selected.size > 0 ? `${selected.size}개` : '';
    $('m-bulkDelete').disabled = selected.size === 0;
  }

  function renderList() {
    const listEl = $('m-list');
    const items = [...filteredMemos()].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });

    if (items.length === 0) {
      listEl.innerHTML = emptyStateBlock({
        icon: MEMO_ICON,
        title: keyword ? '검색 결과가 없어요' : '메모가 없어요',
        subtitle: keyword ? '다른 검색어로 시도해보세요' : '+ 버튼을 눌러 새 메모를 만들어보세요',
      });
      updateBulkBar([]);
      return;
    }

    listEl.innerHTML = items
      .map(
        (m) => `
      <div class="notes-list-item ${m.id === selectedId ? 'active' : ''}" data-id="${m.id}">
        <div class="notes-list-item-title-row">
          <input type="checkbox" class="notes-list-item-check" data-action="select" data-id="${m.id}" />
          ${m.is_pinned ? `<span class="notes-pin-dot">${PIN_ICON}</span>` : ''}
          <span class="notes-list-item-title">${escapeHtml(deriveTitle(m))}</span>
          <span class="drag-handle" data-drag-id="${m.id}" title="드래그해서 바탕화면에 놓으면 작은 위젯으로 열려요">${DRAG_HANDLE_ICON}</span>
        </div>
        <div class="notes-list-item-meta">
          <span>${formatRelative(m.updated_at)}</span>
          <span class="notes-list-item-snippet">${escapeHtml(deriveSnippet(m))}</span>
        </div>
      </div>`
      )
      .join('');

    listEl.querySelectorAll('.notes-list-item').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="select"]') || e.target.closest('.drag-handle')) return;
        selectMemo(Number(row.dataset.id));
      });
      attachContextMenu(
        row,
        () => ({ type: 'memo', id: Number(row.dataset.id) }),
        {
          onDeleted: (item) => {
            memos = memos.filter((m) => m.id !== item.id);
            selected.delete(item.id);
            if (selectedId === item.id) selectedId = null;
            renderList();
            renderDetail();
          },
        }
      );
    });
    listEl.querySelectorAll('.drag-handle[data-drag-id]').forEach((handle) => {
      attachDragOut(handle, () => ({ type: 'memo', id: Number(handle.dataset.dragId) }));
    });
    listEl.querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.checked = selected.has(Number(cb.dataset.id));
      cb.addEventListener('click', (e) => e.stopPropagation()); // 체크박스 클릭이 상세 열기로 안 이어지게
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selected.add(id);
        else selected.delete(id);
        updateBulkBar(items.map((m) => m.id));
      });
    });
    updateBulkBar(items.map((m) => m.id));
  }

  function renderDetail() {
    const detailEl = $('m-detail');
    const memo = memos.find((m) => m.id === selectedId);
    if (!memo) {
      detailEl.innerHTML = `
        <div class="notes-detail-empty" id="m-detailEmpty">
          <div class="page-head-icon tone-yellow" style="margin:0 auto 10px;">${MEMO_ICON}</div>
          메모를 선택하거나 새로 만들어보세요
        </div>`;
      return;
    }

    detailEl.innerHTML = `
      <div class="notes-detail-toolbar">
        <span class="notes-detail-date">${formatRelative(memo.updated_at)}</span>
        <div class="notes-detail-toolbar-actions">
          <div class="links-popover-wrap" id="m-linksWrap">
            <button class="btn-icon" id="m-linksBtn" title="연결된 항목">${LINK_ICON}</button>
            <div class="links-popover" id="m-linksPopover">
              <div class="links-popover-head">🔗 연결된 항목</div>
              <div id="m-links"></div>
            </div>
          </div>
          <button class="btn-icon ${memo.is_pinned ? 'active-pin' : ''}" id="m-pinBtn" title="${memo.is_pinned ? '고정 해제' : '고정'}">${memo.is_pinned ? PIN_ICON : PIN_OUTLINE_ICON}</button>
          <button class="btn-icon" id="m-deleteBtn" title="삭제">${TRASH_ICON}</button>
        </div>
      </div>
      <input type="text" id="m-titleInput" class="notes-title-input" placeholder="제목" value="${escapeHtml(memo.title || '')}" />

      <div class="rich-toolbar">
        <button class="rich-btn" id="m-boldBtn" title="굵게">${BOLD_ICON}</button>
        <button class="rich-btn" id="m-checklistBtn" title="체크박스 추가">${CHECKLIST_ICON}</button>
        <button class="rich-btn" id="m-attachBtn" title="파일/사진 첨부">${PAPERCLIP_ICON}</button>
        <span class="rich-divider"></span>
        <button class="rich-btn rich-size-btn" data-size="12" title="작게">가</button>
        <button class="rich-btn rich-size-btn active" data-size="14" title="보통">가</button>
        <button class="rich-btn rich-size-btn" data-size="18" title="크게">가</button>
        <span class="rich-divider"></span>
        <input type="color" class="rich-color-btn" id="m-colorBtn" title="글자색" value="#2B2E3A" />
      </div>
      <div class="memo-attach-strip" id="m-attachStrip"></div>
      <div id="m-bodyInput" class="notes-body-input" contenteditable="true" data-placeholder="메모를 입력하세요…">${sanitizeRichHtml(memo.content || '')}</div>
    `;

    const bodyEl = $('m-bodyInput');
    linkifyUrls(bodyEl); // 불러올 때 한 번만 URL을 링크로 표시(입력 중엔 절대 호출하지 않음 — 커서 깨짐 방지)
    let saveTimer = null;
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const cleanContent = sanitizeRichHtml(bodyEl.innerHTML); // 저장 직전에도 한 번 더 정화(붙여넣기 등 대비, a 태그는 여기서 자동으로 벗겨짐)
          await window.itda.memos.update({
            id: memo.id,
            title: $('m-titleInput').value.trim() || null,
            content: cleanContent,
          });
          // 목록의 제목/미리보기/정렬도 즉시 반영되도록 로컬 상태 갱신 후 리스트만 다시 그림(상세는 그대로 유지)
          memo.title = $('m-titleInput').value.trim() || null;
          memo.content = cleanContent;
          memo.updated_at = new Date().toISOString();
          renderList();
        } catch (e) {
          errorToast(e, '저장하지 못했어요');
        }
      }, 500);
    };
    $('m-titleInput').addEventListener('input', scheduleSave);
    bodyEl.addEventListener('input', scheduleSave);
    bindChecklistToggle(bodyEl, scheduleSave);
    bindChecklistEnterKey(bodyEl);
    bindMentionAutocomplete(bodyEl, { type: 'memo', id: memo.id }); // "@검색"으로 빠르게 다른 항목과 연결

    $('m-boldBtn').addEventListener('click', () => {
      toggleBold(bodyEl);
      scheduleSave();
    });
    $('m-checklistBtn').addEventListener('click', () => {
      insertChecklistItem(bodyEl);
      scheduleSave();
    });
    root.querySelectorAll('.rich-size-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFontSize(bodyEl, Number(btn.dataset.size));
        root.querySelectorAll('.rich-size-btn').forEach((b) => b.classList.toggle('active', b === btn));
        scheduleSave();
      });
    });
    $('m-colorBtn').addEventListener('input', (e) => {
      applyTextColor(bodyEl, e.target.value);
      scheduleSave();
    });

    // ---------- 첨부파일 ----------
    const formatFileSize = (bytes) => {
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    };

    async function renderAttachments() {
      const strip = $('m-attachStrip');
      let attachments = [];
      try {
        attachments = await window.itda.memoAttachments.list(memo.id);
      } catch (e) {
        errorToast(e, '첨부파일을 불러오지 못했어요');
      }

      strip.innerHTML =
        attachments
          .map(
            (a) => `
        <div class="attach-chip" data-id="${a.id}" data-image="${a.mime_type?.startsWith('image/') ? '1' : '0'}" title="${escapeHtml(a.file_name)}">
          <div class="attach-thumb" id="attach-thumb-${a.id}">${a.mime_type?.startsWith('image/') ? '' : FILE_ICON}</div>
          <div class="attach-meta">
            <span class="attach-name">${escapeHtml(a.file_name)}</span>
            <span class="attach-size">${formatFileSize(a.size)}</span>
          </div>
          <button class="attach-del" data-id="${a.id}" title="삭제">${SMALL_X_ICON}</button>
        </div>`
          )
          .join('') +
        `<button class="attach-add-tile" id="m-attachAddTile" title="파일/사진 첨부">${PAPERCLIP_ICON}</button>`;

      // 이미지는 썸네일을 비동기로 채워 넣는다(목록 렌더 자체를 base64 로딩 때문에 막지 않기 위해)
      attachments
        .filter((a) => a.mime_type?.startsWith('image/'))
        .forEach(async (a) => {
          try {
            const dataUrl = await window.itda.memoAttachments.getImageData(a.id);
            const thumbEl = $(`attach-thumb-${a.id}`);
            if (dataUrl && thumbEl) thumbEl.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(a.file_name)}" />`;
          } catch (e) {
            /* 썸네일 하나 실패해도 나머지에 영향 없게 조용히 무시 */
          }
        });

      strip.querySelectorAll('.attach-chip').forEach((chip) => {
        chip.addEventListener('click', async (e) => {
          if (e.target.closest('.attach-del')) return;
          try {
            await window.itda.memoAttachments.open(Number(chip.dataset.id));
          } catch (err) {
            errorToast(err, '파일을 열지 못했어요');
          }
        });
      });
      strip.querySelectorAll('.attach-del').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await window.itda.memoAttachments.delete(Number(btn.dataset.id));
            await renderAttachments();
          } catch (err) {
            errorToast(err, '첨부파일을 삭제하지 못했어요');
          }
        });
      });
      $('m-attachAddTile')?.addEventListener('click', addAttachments);
    }

    async function addAttachments() {
      try {
        const result = await window.itda.memoAttachments.add(memo.id);
        if (result?.skipped?.length) {
          toast(`${result.skipped.length}개 파일은 건너뛰었어요 (${result.skipped[0].reason})`);
        }
        await renderAttachments();
      } catch (e) {
        errorToast(e, '파일을 첨부하지 못했어요');
      }
    }
    $('m-attachBtn').addEventListener('click', addAttachments);
    renderAttachments();

    $('m-pinBtn').addEventListener('click', async () => {
      try {
        const result = await window.itda.memos.togglePin(memo.id);
        memo.is_pinned = result.is_pinned;
        renderList();
        renderDetail();
      } catch (e) {
        errorToast(e, '고정 상태를 변경하지 못했어요');
      }
    });

    $('m-deleteBtn').addEventListener('click', async () => {
      try {
        await window.itda.memos.delete(memo.id);
        toast('휴지통으로 이동했어요');
        memos = memos.filter((m) => m.id !== memo.id);
        selectedId = null;
        renderList();
        renderDetail();
      } catch (e) {
        errorToast(e, '삭제하지 못했어요');
      }
    });

    const linksWrap = $('m-linksWrap');
    let linksLoaded = false;
    $('m-linksBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !linksWrap.classList.contains('open');
      root.querySelectorAll('.links-popover-wrap.open').forEach((w) => w.classList.remove('open'));
      linksWrap.classList.toggle('open', opening);
      if (opening && !linksLoaded) {
        linksLoaded = true;
        mountLinksWidget($('m-links'), { type: 'memo', id: memo.id });
      }
    });
  }

  function selectMemo(id) {
    selectedId = id;
    renderList();
    renderDetail();
    if (window.matchMedia('(max-width: 900px)').matches) {
      root.querySelector('.notes-app')?.classList.add('detail-open');
    }
  }

  async function load() {
    try {
      memos = await window.itda.memos.list({});
    } catch (e) {
      errorToast(e, '메모를 불러오지 못했어요');
      $('m-list').innerHTML = emptyStateBlock({ title: '메모를 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    renderList();
    renderDetail();
  }

  $('m-newBtn').addEventListener('click', async () => {
    try {
      const { id } = await window.itda.memos.add({ content: '' });
      await load();
      selectMemo(id);
      $('m-titleInput')?.focus();
    } catch (e) {
      errorToast(e, '메모를 추가하지 못했어요');
    }
  });

  $('m-selectAll').addEventListener('change', (e) => {
    const ids = [...filteredMemos()].map((m) => m.id);
    if (e.target.checked) ids.forEach((id) => selected.add(id));
    else selected.clear();
    $('m-list').querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.checked = selected.has(Number(cb.dataset.id));
    });
    updateBulkBar(ids);
  });

  $('m-bulkDelete').addEventListener('click', async () => {
    if (selected.size === 0) return;
    const targets = [...selected];
    $('m-bulkDelete').disabled = true;
    try {
      await Promise.all(targets.map((id) => window.itda.memos.delete(id)));
      toast(`${targets.length}개 휴지통으로 이동했어요`);
      selected.clear();
      if (selectedId && targets.includes(selectedId)) selectedId = null;
      await load();
    } catch (e) {
      errorToast(e, '일부 메모를 삭제하지 못했어요');
      await load();
    }
  });

  let searchTimer = null;
  $('m-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => {
      keyword = value;
      renderList();
    }, 150);
  });

  bindWidgetLaunchButton(root, 'm-widgetBtn', 'quick-memo');

  // 연결된 항목 팝오버 바깥 클릭 시 닫기 — renderDetail()이 여러 번 재실행돼도
  // 리스너가 쌓이지 않도록 mount() 스코프에서 딱 한 번만 등록하고, 화면을 벗어날 때 해제한다.
  const closeOnOutsideClick = (e) => {
    if (!e.target.closest('.links-popover-wrap')) {
      root.querySelectorAll('.links-popover-wrap.open').forEach((w) => w.classList.remove('open'));
    }
  };
  document.addEventListener('click', closeOnOutsideClick);

  await load();

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'memo') return;
    if (isUserTyping()) return; // 지금 메모 본문/제목을 타이핑 중이면 커서가 끊기지 않게 미룸
    debouncedLoad();
  });

  return () => {
    document.removeEventListener('click', closeOnOutsideClick);
    offDataChanged?.();
  };
}
