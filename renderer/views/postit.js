import { toast, errorToast, formatRelative, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { STICKY_COLORS, stickyRotation } from '../shared/theme.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { bindMentionAutocomplete } from '../shared/mention.js';
import { bindHashtagAutoTag } from '../shared/hashtag.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';
import { sanitizeRichHtml, toggleBold, applyFontSize, applyTextColor, insertChecklistItem, bindChecklistToggle, bindChecklistEnterKey, linkifyUrls } from '../shared/rich-text.js';
import { openColorPicker } from '../shared/color-picker.js';
import { attachDragOut, DRAG_HANDLE_ICON } from '../shared/drag-out.js';
import { attachContextMenu } from '../shared/context-menu.js';

const POSTIT_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6l3-2 3 2V3"/></svg>`;
const PIN_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const LINK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07l1.5-1.5"/></svg>`;
const WIDGET_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>`;
const BOLD_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M6 4h6a3.5 3.5 0 010 7H6zM6 11h7a3.5 3.5 0 010 7H6z"/></svg>`;
const CHECKLIST_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="3" width="7" height="7" rx="1.5"/><path d="M4.5 6.5l1.3 1.3L8.5 5"/><path d="M13 5h8M13 12h8M13 19h8"/><rect x="3" y="13" width="7" height="7" rx="1.5"/></svg>`;

// "새 포스트잇" 단축키 — 화면 전용 고정 단축키(설정 > 단축키 목록에 넣을 정도로 자주 바꿀 일은 없음).
const isMac = navigator.platform?.toUpperCase().includes('MAC');
const NEW_POSTIT_SHORTCUT_LABEL = isMac ? '⌘N' : 'Ctrl+N';

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-pink">${POSTIT_ICON}</div>
        <div><h1>포스트잇</h1><p>중요한 내용을 자유로운 색상으로 붙여두세요.</p></div>
      </div>
      ${widgetLaunchButtonHtml('p-widgetBtn', '포스트잇 위젯 열기')}
    </div>
    <div class="notes-bulk-bar" id="p-bulkBar" style="display:none;border-radius:var(--radius-md);margin-bottom:10px;">
      <label class="checkbox-row"><input type="checkbox" id="p-selectAll" /> 전체선택</label>
      <span class="search-selected-count" id="p-selectedCount"></span>
      <button class="btn-secondary search-bulk-delete-btn" id="p-bulkDelete" disabled>${TRASH_ICON} 삭제</button>
    </div>
    <div class="sticky-grid" id="p-grid"><div class="empty">불러오는 중…</div></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let creating = false;
  let items = [];
  let selected = new Set(); // 선택삭제용 — 포스트잇 id 집합

  function updateBulkBar() {
    const bar = $('p-bulkBar');
    if (!items.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const ids = items.map((i) => i.id);
    const selectAllCb = $('p-selectAll');
    selectAllCb.checked = ids.length > 0 && ids.every((id) => selected.has(id));
    selectAllCb.indeterminate = selected.size > 0 && !selectAllCb.checked;
    $('p-selectedCount').textContent = selected.size > 0 ? `${selected.size}개` : '';
    $('p-bulkDelete').disabled = selected.size === 0;
  }

  async function createNewPostit() {
    if (creating) return;
    creating = true;
    try {
      await window.itda.postits.add({ content: '새 포스트잇', colorHex: STICKY_COLORS[0] });
      await load();
    } catch (e) {
      errorToast(e, '포스트잇을 추가하지 못했어요');
    } finally {
      creating = false;
    }
  }

  function bindNewCard() {
    const newCard = $('p-newCard');
    if (!newCard) return;
    newCard.title = `새 포스트잇 (${NEW_POSTIT_SHORTCUT_LABEL})`;
    newCard.addEventListener('click', createNewPostit);
  }

  async function load() {
    const grid = $('p-grid');
    try {
      items = await window.itda.postits.list();
    } catch (e) {
      errorToast(e, '포스트잇을 불러오지 못했어요');
      grid.classList.add('empty');
      grid.innerHTML = emptyStateBlock({ title: '포스트잇을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }

    if (items.length === 0) {
      grid.classList.add('empty');
      grid.innerHTML =
        emptyStateBlock({ icon: POSTIT_ICON, title: '포스트잇이 없어요', subtitle: '중요한 내용을 자유로운 색으로 붙여보세요' }) +
        `<div class="new-sticky-card" id="p-newCard">+ 새 포스트잇</div>`;
      bindNewCard();
      updateBulkBar();
      return;
    }
    grid.classList.remove('empty');

    const sorted = [...items].sort((a, b) => b.is_pinned - a.is_pinned);
    grid.innerHTML =
      sorted
        .map(
          (item) => `
        <div class="sticky-card" style="background:${item.color_hex};transform:rotate(${stickyRotation(item.id)}deg);" data-id="${item.id}">
          <div class="card-top">
            <input type="checkbox" class="notes-list-item-check sticky-select-check" data-action="select" data-id="${item.id}" title="선택" />
            <span class="drag-handle" data-drag-id="${item.id}" title="드래그해서 바탕화면에 놓으면 작은 위젯으로 열려요">${DRAG_HANDLE_ICON}</span>
            <div class="rich-toolbar rich-toolbar-mini">
              <button class="rich-btn" data-action="bold" title="굵게">${BOLD_ICON}</button>
              <button class="rich-btn" data-action="checklist" title="체크박스 추가">${CHECKLIST_ICON}</button>
              <button class="rich-btn rich-size-btn" data-size="11" title="작게">가</button>
              <button class="rich-btn rich-size-btn active" data-size="13" title="보통">가</button>
              <button class="rich-btn rich-size-btn" data-size="16" title="크게">가</button>
              <button class="rich-btn rich-color-trigger rich-color-trigger-mini" data-action="textColor" title="글자색">
                <span>가</span><span class="rich-color-bar" style="background:#2B2E3A;"></span>
              </button>
            </div>
            <span class="card-meta" title="${formatRelative(item.updated_at)}">${formatRelative(item.updated_at)}</span>
            <button class="pin-btn ${item.is_pinned ? 'pinned' : ''}" data-action="pin" title="${item.is_pinned ? '고정 해제' : '고정'}">${PIN_ICON}</button>
          </div>
          <div class="card-content" contenteditable="true" data-action="content" data-placeholder="내용을 입력하세요…">${sanitizeRichHtml(item.content)}</div>
          <div class="card-bottom-row">
            <div class="color-swatch-row">
              ${STICKY_COLORS.map(
                (c) => `<span class="color-swatch ${c === item.color_hex ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`
              ).join('')}
            </div>
            <div class="card-bottom-actions">
              <button class="btn-icon" data-action="toggle-links" title="연결된 항목">${LINK_ICON}</button>
              <button class="btn-icon" data-action="open-widget" title="위젯으로 열기 (독립된 작은 창)">${WIDGET_ICON}</button>
              <button class="btn-icon" data-action="delete" title="삭제">${TRASH_ICON}</button>
            </div>
          </div>
          <div class="card-links-section" data-links-section></div>
        </div>`
        )
        .join('') + `<div class="new-sticky-card" id="p-newCard">+ 새 포스트잇</div>`;

    grid.querySelectorAll('.sticky-card').forEach((card) => {
      const id = Number(card.dataset.id);
      const contentArea = card.querySelector('[data-action="content"]');
      linkifyUrls(contentArea); // 불러올 때 한 번만 — 입력 중엔 호출 금지(커서 깨짐)
      let saveTimer = null;
      const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          try {
            const cleanContent = sanitizeRichHtml(contentArea.innerHTML); // 저장 직전 한 번 더 정화(붙여넣기 등 대비, a 태그는 여기서 자동으로 벗겨짐)
            await window.itda.postits.update({ id, content: cleanContent });
          } catch (e) {
            errorToast(e, '저장하지 못했어요');
          }
        }, 500);
      };
      contentArea.addEventListener('input', scheduleSave);
      bindChecklistToggle(contentArea, scheduleSave);
      bindChecklistEnterKey(contentArea);
      bindMentionAutocomplete(contentArea, { type: 'postit', id }); // "@검색"으로 빠르게 다른 항목과 연결
      bindHashtagAutoTag(contentArea, async (categoryId) => {
        try {
          await window.itda.postits.update({ id, categoryId });
        } catch (e) {
          errorToast(e, '태그를 저장하지 못했어요');
        }
      });

      card.querySelector('[data-action="bold"]').addEventListener('click', () => {
        toggleBold(contentArea);
        scheduleSave();
      });
      card.querySelector('[data-action="checklist"]').addEventListener('click', () => {
        insertChecklistItem(contentArea);
        scheduleSave();
      });
      card.querySelectorAll('.rich-size-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyFontSize(contentArea, Number(btn.dataset.size));
          card.querySelectorAll('.rich-size-btn').forEach((b) => b.classList.toggle('active', b === btn));
          scheduleSave();
        });
      });
      card.querySelector('[data-action="textColor"]').addEventListener('click', (e) => {
        openColorPicker(e.currentTarget, (hex) => {
          applyTextColor(contentArea, hex);
          e.currentTarget.querySelector('.rich-color-bar').style.background = hex;
          scheduleSave();
        });
      });

      card.querySelector('[data-action="pin"]').addEventListener('click', async () => {
        try {
          await window.itda.postits.togglePin(id);
          load();
        } catch (e) {
          errorToast(e, '고정 상태를 변경하지 못했어요');
        }
      });

      card.querySelectorAll('.color-swatch').forEach((sw) => {
        sw.addEventListener('click', async () => {
          try {
            await window.itda.postits.update({ id, colorHex: sw.dataset.color });
            load();
          } catch (e) {
            errorToast(e, '색상을 변경하지 못했어요');
          }
        });
      });

      card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        try {
          await window.itda.postits.delete(id);
          toast('휴지통으로 이동했어요');
          load();
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });

      card.querySelector('[data-action="open-widget"]').addEventListener('click', async () => {
        try {
          await window.itda.postitWidget.open(id);
        } catch (e) {
          errorToast(e, '위젯 창을 열지 못했어요');
        }
      });

      const dragHandle = card.querySelector('.drag-handle[data-drag-id]');
      if (dragHandle) {
        attachDragOut(dragHandle, () => ({ type: 'postit', id: Number(dragHandle.dataset.dragId) }));
      }

      attachContextMenu(card, () => ({ type: 'postit', id }), { onDeleted: () => load() });

      let linksMounted = false;
      card.querySelector('[data-action="toggle-links"]').addEventListener('click', () => {
        const section = card.querySelector('[data-links-section]');
        section.classList.toggle('open');
        if (section.classList.contains('open') && !linksMounted) {
          linksMounted = true;
          mountLinksWidget(section, { type: 'postit', id });
        }
      });

      const selectCb = card.querySelector('[data-action="select"]');
      selectCb.checked = selected.has(id);
      selectCb.addEventListener('click', (e) => e.stopPropagation());
      selectCb.addEventListener('change', () => {
        if (selectCb.checked) selected.add(id);
        else selected.delete(id);
        updateBulkBar();
      });
    });

    bindNewCard();
    updateBulkBar();
  }

  bindWidgetLaunchButton(root, 'p-widgetBtn', 'postit-board');

  $('p-selectAll').addEventListener('change', (e) => {
    const ids = items.map((i) => i.id);
    if (e.target.checked) ids.forEach((id) => selected.add(id));
    else selected.clear();
    $('p-grid').querySelectorAll('[data-action="select"]').forEach((cb) => {
      cb.checked = selected.has(Number(cb.dataset.id));
    });
    updateBulkBar();
  });

  $('p-bulkDelete').addEventListener('click', async () => {
    if (selected.size === 0) return;
    const targets = [...selected];
    $('p-bulkDelete').disabled = true;
    try {
      await Promise.all(targets.map((id) => window.itda.postits.delete(id)));
      toast(`${targets.length}개 휴지통으로 이동했어요`);
      selected.clear();
      await load();
    } catch (e) {
      errorToast(e, '일부 포스트잇을 삭제하지 못했어요');
      await load();
    }
  });

  // 화면 전용 고정 단축키(⌘/Ctrl+N) — 이 화면이 떠 있는 동안만 반응, 언마운트 시 해제.
  const handleNewPostitShortcut = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNewPostit();
    }
  };
  document.addEventListener('keydown', handleNewPostitShortcut);

  await load();

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'postit') return;
    if (isUserTyping()) return; // 지금 어떤 포스트잇 본문을 타이핑 중이면 커서가 끊기지 않게 미룸
    debouncedLoad();
  });

  return () => {
    document.removeEventListener('keydown', handleNewPostitShortcut);
    offDataChanged?.();
  };
}
