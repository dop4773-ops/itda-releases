import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { mountLinksWidget } from '../shared/links-ui.js';
import { wrapAutosave } from '../shared/pending-saves.js';
import { bindMentionAutocomplete } from '../shared/mention.js';
import { bindHashtagAutoTag } from '../shared/hashtag.js';
import {
  sanitizeRichHtml,
  stripHtmlToPlainText,
  toggleBold,
  toggleUnderline,
  applyAlign,
  insertLink,
  applyFontSize,
  applyTextColor,
  insertChecklistItem,
  bindChecklistToggle,
  bindChecklistEnterKey,
  bindChecklistBackspaceKey,
  linkifyUrls,
} from '../shared/rich-text.js';
import { openColorPicker } from '../shared/color-picker.js';
import { registerEscClose } from '../shared/esc-close.js';
import { setScreenShortcuts } from '../shared/shell.js';
import { attachDragOut, DRAG_HANDLE_ICON } from '../shared/drag-out.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { promptText } from '../shared/text-prompt.js';

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
const FOLDER_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>`;
const UNDERLINE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 4v7a6 6 0 0012 0V4"/><path d="M4 20h16"/></svg>`;
const ALIGN_LEFT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M4 12h10M4 18h14"/></svg>`;
const ALIGN_CENTER_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M7 12h10M5 18h14"/></svg>`;
const ALIGN_RIGHT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M10 12h10M6 18h14"/></svg>`;
const URL_LINK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 00-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 007.07 7.07L12.5 19.5"/></svg>`;
const PHOTO_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>`;
const LOCK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;
const LOCK_OPEN_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 017.8-1.3"/></svg>`;
const CLIP_BADGE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.19 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;

// "새 메모" 단축키 — 화면 전체 커스터마이즈 대상인 설정 > 단축키(shortcuts.js)까지 갈 정도로
// 자주 바꿀 일은 없는 화면 전용 동작이라, 고정 단축키로 두고 이 화면이 떠 있을 때만 반응한다.
const isMac = navigator.platform?.toUpperCase().includes('MAC');
const NEW_MEMO_SHORTCUT_LABEL = isMac ? '⌘N' : 'Ctrl+N';
const MOD_LABEL = isMac ? '⌘' : 'Ctrl+';
const MOD_SHIFT_LABEL = isMac ? '⇧⌘' : 'Ctrl+Shift+';
// Alt를 누르고 있으면 뜨는 전역 단축키 오버레이(shell.js)에 이 화면 전용 단축키를 얹어서 보여준다.
const MEMO_SCREEN_SHORTCUTS = [
  { label: '새 메모', keys: `${NEW_MEMO_SHORTCUT_LABEL} / +` },
  { label: '폴더 접기/펼치기', keys: 'F' },
  { label: '전체 메모 ↔ 미분류', keys: 'A' },
  { label: '검색', keys: `${MOD_LABEL}F / /` },
  { label: '굵게', keys: `${MOD_LABEL}B` },
  { label: '밑줄', keys: `${MOD_LABEL}U` },
  { label: '왼쪽 정렬', keys: `${MOD_SHIFT_LABEL}L` },
  { label: '가운데 정렬', keys: `${MOD_SHIFT_LABEL}E` },
  { label: '오른쪽 정렬', keys: `${MOD_SHIFT_LABEL}R` },
];

// 저장된 content(HTML)의 첫 줄을 "제목 없는 메모"의 표시용 제목으로 쓴다 (애플 메모장과 동일한 관습).
function deriveTitle(memo) {
  if (memo.title && memo.title.trim()) return memo.title.trim();
  const firstLine = stripHtmlToPlainText(memo.content || '').split('\n')[0].trim();
  return firstLine || '새로운 메모';
}
// 애플 메모장처럼 목록을 오늘/지난 7일/이번 해의 월별/지난 해의 연도별로 자동 묶는다.
// (핀 고정된 메모는 이 그룹과 별도로 맨 위 "고정된 메모" 섹션에 모인다)
function dateGroupLabel(updatedAt) {
  const d = new Date((updatedAt || '').replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '이전';
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfToday - startOfDay) / dayMs);
  if (diffDays <= 0) return '오늘';
  if (diffDays <= 7) return '지난 7일';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월`;
  return `${d.getFullYear()}년`;
}

// 인라인 사진을 커서 위치(또는 없으면 끝)에 삽입한다. src는 여기서 바로 채워 넣지만(방금
// 붙여넣거나 방금 읽어온 dataUrl이라 이미 손에 있음) 저장될 땐 sanitizeRichHtml이 src를
// 걷어내고 data-attachment-id만 남긴다 — 다음에 불러올 때 다시 getImageData로 채워진다.
function insertInlineImage(bodyEl, attachmentId, dataUrl) {
  bodyEl.focus();
  const img = document.createElement('img');
  img.className = 'memo-inline-img';
  img.dataset.attachmentId = String(attachmentId);
  img.src = dataUrl;
  img.style.width = '260px';
  img.setAttribute('contenteditable', 'false');
  img.setAttribute('draggable', 'false'); // 브라우저 기본 이미지 드래그와 충돌해서 리사이즈 도중 사라지는 문제 방지
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && bodyEl.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    bodyEl.appendChild(img);
  }
}

// 저장된 content 안의 img[data-attachment-id]는 src 없이 저장돼 있으므로(rich-text.js 참고),
// 불러올 때마다 첨부 썸네일과 같은 방식으로 다시 채워 넣는다. 파일이 실제로 없으면(예: 다른
// 기기에서 옮겨온 DB 등) 빈 자리로 남기지 않고 "사진을 불러올 수 없어요" 표시로 대체해서,
// 사진이 그냥 조용히 사라진 것처럼 보이지 않게 한다.
function loadInlineImages(bodyEl) {
  bodyEl.querySelectorAll('img.memo-inline-img[data-attachment-id]').forEach(async (img) => {
    const id = Number(img.dataset.attachmentId);
    try {
      const dataUrl = await window.itda.memoAttachments.getImageData(id);
      if (dataUrl) {
        img.src = dataUrl;
      } else if (img.isConnected) {
        img.replaceWith(brokenImagePlaceholder());
      }
    } catch (e) {
      if (img.isConnected) img.replaceWith(brokenImagePlaceholder());
    }
  });
}
function brokenImagePlaceholder() {
  const span = document.createElement('span');
  span.className = 'memo-inline-img-broken';
  span.setAttribute('contenteditable', 'false');
  span.textContent = '🖼 사진을 불러올 수 없어요';
  return span;
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
        <details class="notes-folder-rail" id="m-folderRail"></details>
        <div class="notes-sidebar-head">
          <div class="notes-search-box">
            ${SEARCH_ICON}
            <input type="text" id="m-search" placeholder="검색" />
          </div>
          <button class="notes-new-btn" id="m-newBtn" title="새 메모 (${NEW_MEMO_SHORTCUT_LABEL})">${PLUS_ICON}</button>
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
  let folders = [];
  let selectedId = null;
  let keyword = '';
  let selected = new Set(); // 선택삭제용 — 메모 id 집합 (체크박스 또는 Cmd/Ctrl·Shift+클릭으로 채워짐)
  let lastClickedId = null; // Shift+클릭 범위선택의 기준점
  // undefined="전체 메모"(폴더 무관), null="미분류"(folder_id 없음), 숫자="그 폴더만"
  // 기본은 "미분류"로 시작(요청) — 전체 메모는 단축키 A 또는 폴더 레일에서.
  let currentFolderId = null;
  let lockListMode = 'hidden'; // 설정 > 보안의 "잠긴 메모 표시 방식" — 'hidden'(잠긴 메모로만 표시) | 'title'(제목만 표시)
  const unlockedIds = new Set(); // 이번 화면 세션 동안 비밀번호로 이미 연 잠긴 메모 id — 다시 클릭할 때마다 또 묻지 않으려고

  function filteredMemos() {
    let list = memos;
    if (currentFolderId !== undefined) {
      list = list.filter((m) => (currentFolderId === null ? !m.folder_id : m.folder_id === currentFolderId));
    }
    if (!keyword.trim()) return list;
    const k = keyword.trim().toLowerCase();
    return list.filter(
      (m) => deriveTitle(m).toLowerCase().includes(k) || stripHtmlToPlainText(m.content || '').toLowerCase().includes(k)
    );
  }

  // ---------- 폴더 (애플 메모장 스타일 분류) ----------
  async function loadFolders() {
    try {
      folders = await window.itda.memoFolders.list();
    } catch (e) {
      folders = [];
    }
    renderFolderRail();
  }

  function renderFolderRail() {
    const rail = $('m-folderRail');
    if (!rail) return; // 비동기 콜백이 화면 언마운트 뒤에 도착한 경우
    const totalCount = memos.length;
    const unfiledCount = memos.filter((m) => !m.folder_id).length;
    rail.innerHTML = `
      <summary class="notes-folder-summary">폴더<span class="notes-folder-toggle-icon">▾</span></summary>
      <div class="notes-folder-rows">
      <div class="notes-folder-row ${currentFolderId === undefined ? 'active' : ''}" data-folder="all">
        ${FOLDER_ICON}<span class="notes-folder-name">전체 메모</span><span class="notes-folder-count">${totalCount}</span>
      </div>
      <div class="notes-folder-row ${currentFolderId === null ? 'active' : ''}" data-folder="unfiled">
        ${FOLDER_ICON}<span class="notes-folder-name">미분류</span><span class="notes-folder-count">${unfiledCount}</span>
      </div>
      ${folders
        .map(
          (f) => `
        <div class="notes-folder-row ${currentFolderId === f.id ? 'active' : ''}" data-folder="${f.id}" data-fid="${f.id}" draggable="true" title="우클릭: 메뉴 · 드래그: 순서 변경">
          ${FOLDER_ICON}<span class="notes-folder-name">${escapeHtml(f.name)}</span><span class="notes-folder-count">${f.memo_count}</span>
          <button class="btn-icon notes-folder-del" data-rename-folder="${f.id}" title="이름 바꾸기">✎</button>
          <button class="btn-icon notes-folder-del" data-delete-folder="${f.id}" title="폴더 삭제(메모는 안 지워지고 미분류로 이동)">${SMALL_X_ICON}</button>
        </div>`
        )
        .join('')}
      <button class="notes-folder-add" id="m-addFolderBtn">${PLUS_ICON} 새 폴더</button>
      </div>
    `;

    rail.querySelectorAll('.notes-folder-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const key = row.dataset.folder;
        currentFolderId = key === 'all' ? undefined : key === 'unfiled' ? null : Number(key);
        renderFolderRail();
        renderList();
      });
    });
    rail.querySelectorAll('[data-rename-folder]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.renameFolder);
        const folder = folders.find((f) => f.id === id);
        const name = await promptText(btn, { title: '폴더 이름 바꾸기', placeholder: '폴더 이름', value: folder?.name });
        if (!name) return;
        try {
          await window.itda.memoFolders.rename({ id, name });
          await loadFolders();
        } catch (err) {
          errorToast(err, '폴더 이름을 바꾸지 못했어요');
        }
      });
    });
    rail.querySelectorAll('[data-delete-folder]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.deleteFolder);
        try {
          await window.itda.memoFolders.delete(id);
          if (currentFolderId === id) currentFolderId = undefined;
          await load(); // load()가 내부에서 loadFolders()도 같이 호출한다
        } catch (err) {
          errorToast(err, '폴더를 삭제하지 못했어요');
        }
      });
    });
    $('m-addFolderBtn').addEventListener('click', async () => {
      const name = await promptText($('m-addFolderBtn'), { title: '새 폴더', placeholder: '폴더 이름' });
      if (!name) return;
      try {
        await window.itda.memoFolders.add({ name });
        await loadFolders();
      } catch (err) {
        errorToast(err, '폴더를 추가하지 못했어요');
      }
    });

    // ---- 폴더 우클릭 메뉴 + 드래그로 순서 변경 (커스텀 폴더만) ----
    rail.querySelectorAll('.notes-folder-row[data-fid]').forEach((row) => {
      const fid = Number(row.dataset.fid);
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openFolderMenu(e.clientX, e.clientY, folders.find((f) => f.id === fid));
      });
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(fid));
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('folder-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('folder-dragging'));
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const draggedId = Number(e.dataTransfer.getData('text/plain'));
        if (!draggedId || draggedId === fid) return;
        const rect = row.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        reorderFolders(draggedId, fid, before);
      });
    });
  }

  async function reorderFolders(draggedId, targetId, before) {
    const ids = folders.map((f) => f.id).filter((id) => id !== draggedId);
    let ti = ids.indexOf(targetId);
    if (ti === -1) ti = ids.length - 1;
    ids.splice(before ? ti : ti + 1, 0, draggedId);
    try {
      await window.itda.memoFolders.reorder(ids);
      await loadFolders();
    } catch (err) {
      errorToast(err, '폴더 순서를 바꾸지 못했어요');
    }
  }

  let folderMenuEl = null;
  function closeFolderMenu() {
    folderMenuEl?.remove();
    folderMenuEl = null;
    document.removeEventListener('mousedown', onFolderMenuOutside, true);
    document.removeEventListener('keydown', onFolderMenuEsc, true);
  }
  function onFolderMenuOutside(e) {
    if (folderMenuEl && !folderMenuEl.contains(e.target)) closeFolderMenu();
  }
  function onFolderMenuEsc(e) {
    if (e.key === 'Escape') closeFolderMenu();
  }
  function openFolderMenu(x, y, folder) {
    if (!folder) return;
    closeFolderMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `
      <button class="ctx-menu-item" data-act="new">📝 이 폴더에 새 메모</button>
      <button class="ctx-menu-item" data-act="open">📂 이 폴더 열기</button>
      <div class="ctx-menu-divider"></div>
      <button class="ctx-menu-item" data-act="rename">✎ 이름 바꾸기</button>
      <button class="ctx-menu-item ctx-menu-danger" data-act="delete">🗑 폴더 삭제</button>
    `;
    document.body.appendChild(menu);
    // 화면 밖으로 안 나가게 위치 보정
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - mh - 8)}px`;
    folderMenuEl = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', onFolderMenuOutside, true);
      document.addEventListener('keydown', onFolderMenuEsc, true);
    }, 0);

    menu.querySelector('[data-act="new"]').addEventListener('click', async () => {
      closeFolderMenu();
      await createNewMemo(folder.id);
    });
    menu.querySelector('[data-act="open"]').addEventListener('click', () => {
      closeFolderMenu();
      currentFolderId = folder.id;
      renderFolderRail();
      renderList();
    });
    menu.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      closeFolderMenu();
      const anchor = $('m-folderRail')?.querySelector(`[data-fid="${folder.id}"]`) || document.body;
      const name = await promptText(anchor, { title: '폴더 이름 바꾸기', placeholder: '폴더 이름', value: folder.name });
      if (!name) return;
      try {
        await window.itda.memoFolders.rename({ id: folder.id, name });
        await loadFolders();
      } catch (err) {
        errorToast(err, '폴더 이름을 바꾸지 못했어요');
      }
    });
    menu.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      closeFolderMenu();
      try {
        await window.itda.memoFolders.delete(folder.id);
        if (currentFolderId === folder.id) currentFolderId = undefined;
        await load();
      } catch (err) {
        errorToast(err, '폴더를 삭제하지 못했어요');
      }
    });
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

  function renderItemRow(m) {
    const locked = m.is_locked && !unlockedIds.has(m.id);
    const showThumb = !locked && m.first_image_id;
    const title = locked && lockListMode === 'hidden' ? '🔒 잠긴 메모' : escapeHtml(deriveTitle(m));
    const snippet = locked ? '' : escapeHtml(deriveSnippet(m));
    return `
      <div class="notes-list-item ${m.id === selectedId ? 'active' : ''} ${selected.has(m.id) ? 'multi-selected' : ''}" data-id="${m.id}">
        ${showThumb ? `<div class="notes-list-item-thumb" id="thumb-${m.id}" data-image-id="${m.first_image_id}"></div>` : ''}
        <div class="notes-list-item-body">
          <div class="notes-list-item-title-row">
            <input type="checkbox" class="notes-list-item-check" data-action="select" data-id="${m.id}" />
            ${m.is_pinned ? `<span class="notes-pin-dot">${PIN_ICON}</span>` : ''}
            ${locked ? `<span class="notes-lock-dot">${LOCK_ICON}</span>` : ''}
            <span class="notes-list-item-title">${title}</span>
            ${!locked && m.attachment_count > 0 ? `<span class="notes-attach-badge" title="첨부 ${m.attachment_count}개">${CLIP_BADGE_ICON}</span>` : ''}
            <span class="drag-handle" data-drag-id="${m.id}" title="드래그해서 바탕화면에 놓으면 작은 위젯으로 열려요">${DRAG_HANDLE_ICON}</span>
          </div>
          <div class="notes-list-item-meta">
            <span>${formatRelative(m.updated_at)}</span>
            <span class="notes-list-item-snippet">${snippet}</span>
          </div>
        </div>
      </div>`;
  }

  // 목록의 첫 사진 썸네일은 base64라 무거워서, 실제로 그려진 행에 대해서만 지연 로드한다.
  function loadListThumbnails(listEl) {
    listEl.querySelectorAll('.notes-list-item-thumb[data-image-id]').forEach(async (el) => {
      const imageId = Number(el.dataset.imageId);
      try {
        const dataUrl = await window.itda.memoAttachments.getImageData(imageId);
        if (dataUrl) el.innerHTML = `<img src="${dataUrl}" alt="" />`;
      } catch (e) {
        /* 썸네일 하나 실패해도 나머지 목록에 영향 없게 조용히 무시 */
      }
    });
  }

  function renderList() {
    renderFolderRail(); // 메모 개수가 바뀌었을 수 있으니(추가/삭제/폴더 이동) 매번 같이 갱신
    const listEl = $('m-list');
    if (!listEl) return; // 언마운트 후 도착한 비동기 콜백 방어
    const byUpdatedDesc = (a, b) => (b.updated_at || '').localeCompare(a.updated_at || '');
    const all = filteredMemos();

    if (all.length === 0) {
      listEl.innerHTML = emptyStateBlock({
        icon: MEMO_ICON,
        title: keyword ? '검색 결과가 없어요' : '메모가 없어요',
        subtitle: keyword ? '다른 검색어로 시도해보세요' : '+ 버튼을 눌러 새 메모를 만들어보세요',
      });
      updateBulkBar([]);
      return;
    }

    const pinned = all.filter((m) => m.is_pinned).sort(byUpdatedDesc);
    const rest = all.filter((m) => !m.is_pinned).sort(byUpdatedDesc);

    let html = '';
    if (pinned.length) {
      html += `<div class="notes-list-group-label">📌 고정된 메모</div>` + pinned.map(renderItemRow).join('');
    }
    let lastGroup = null;
    rest.forEach((m) => {
      const group = dateGroupLabel(m.updated_at);
      if (group !== lastGroup) {
        html += `<div class="notes-list-group-label">${group}</div>`;
        lastGroup = group;
      }
      html += renderItemRow(m);
    });
    listEl.innerHTML = html;
    loadListThumbnails(listEl);
    const items = [...pinned, ...rest];

    listEl.querySelectorAll('.notes-list-item').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="select"]') || e.target.closest('.drag-handle')) return;
        const id = Number(row.dataset.id);

        // 파인더/애플 메모장처럼 Cmd·Ctrl+클릭(하나씩 토글) / Shift+클릭(범위선택)으로
        // 다중 선택 — 열지는 않고 배경색만 다르게 표시한다(체크박스와 같은 selected Set을 공유).
        if (e.metaKey || e.ctrlKey) {
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          lastClickedId = id;
          renderList();
          return;
        }
        if (e.shiftKey && lastClickedId != null) {
          const ids = items.map((m) => m.id);
          const a = ids.indexOf(lastClickedId);
          const b = ids.indexOf(id);
          if (a !== -1 && b !== -1) {
            const [start, end] = a < b ? [a, b] : [b, a];
            for (let i = start; i <= end; i++) selected.add(ids[i]);
            renderList();
            return;
          }
        }

        // 일반 클릭 — 다중 선택 중이었으면 비우고(파인더와 동일한 관례) 평소처럼 상세를 연다.
        if (selected.size > 0) selected.clear();
        lastClickedId = id;
        openMemoMaybeLocked(id, row);
      });
      row.addEventListener('contextmenu', (e) => {
        // 여러 개를 선택해둔 상태에서 그중 하나를 우클릭하면, 그 하나만을 위한 메뉴 대신
        // "선택한 N개 삭제"만 있는 축소 메뉴를 띄운다. attachContextMenu의 리스너보다 먼저
        // 등록돼 있어야 하므로(같은 엘리먼트에서는 등록 순서대로 실행됨) 반드시 그 위에 온다.
        const id = Number(row.dataset.id);
        if (selected.size <= 1 || !selected.has(id)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        showBulkDeleteMenu(e.clientX, e.clientY, [...selected]);
      });
      attachContextMenu(
        row,
        () => {
          const id = Number(row.dataset.id);
          const memo = memos.find((m) => m.id === id);
          return { type: 'memo', id, isPinned: !!memo?.is_pinned, isLocked: !!memo?.is_locked };
        },
        {
          onDeleted: (item) => {
            memos = memos.filter((m) => m.id !== item.id);
            selected.delete(item.id);
            if (selectedId === item.id) selectedId = null;
            loadFolders(); // 지워진 메모가 폴더에 있었으면 그 폴더 개수도 갱신
            renderList();
            renderDetail();
          },
          onMoved: (item, folderId) => {
            const memo = memos.find((m) => m.id === item.id);
            if (memo) memo.folder_id = folderId;
            // 폴더별 개수(f.memo_count)는 서버가 계산해서 loadFolders()로만 받아오는 값이라 —
            // renderList()가 매번 부르는 renderFolderRail()은 전체/미분류 카운트(memos 배열에서
            // 즉석 계산)만 맞고, 커스텀 폴더 칸은 다시 불러오기 전까진 그대로 낡아있었다(버그).
            loadFolders();
            renderList();
            if (selectedId === item.id) renderDetail();
          },
          onPinToggled: (item, isPinned) => {
            const memo = memos.find((m) => m.id === item.id);
            if (memo) memo.is_pinned = isPinned;
            renderList();
            if (selectedId === item.id) renderDetail();
          },
          onLockToggled: (item, isLocked) => {
            const memo = memos.find((m) => m.id === item.id);
            if (memo) memo.is_locked = isLocked;
            if (isLocked) unlockedIds.delete(item.id); // 방금 잠갔으면 이번 세션 기록도 지워서 목록에서 바로 숨겨지게
            else unlockedIds.add(item.id); // 방금 풀었으면 다시 클릭할 때 또 묻지 않게
            if (selectedId === item.id) selectedId = null; // 잠근 메모가 지금 열려 있었다면 상세 패널도 닫아서 내용이 계속 보이지 않게
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
    if (!detailEl) return; // 언마운트 후 도착한 비동기 콜백 방어
    const memo = memos.find((m) => m.id === selectedId);
    if (!memo) {
      detailEl.innerHTML = `
        <div class="notes-detail-empty" id="m-detailEmpty">
          <div class="page-head-icon tone-yellow" style="margin:0 auto 10px;">${MEMO_ICON}</div>
          메모를 선택하거나 새로 만들어보세요
        </div>`;
      return;
    }

    // 방어적 잠금 가드 — 지금은 openMemoMaybeLocked()를 거쳐야만 selectMemo()가 불리지만,
    // 혹시 다른 경로로 selectedId가 잠긴 메모로 바뀌어도 여기서 한 번 더 막는다.
    if (memo.is_locked && !unlockedIds.has(memo.id)) {
      detailEl.innerHTML = `
        <div class="notes-detail-empty" id="m-detailEmpty">
          <div class="page-head-icon tone-yellow" style="margin:0 auto 10px;">${LOCK_ICON}</div>
          🔒 잠긴 메모예요<br />목록에서 다시 눌러 비밀번호를 입력해주세요
        </div>`;
      return;
    }

    detailEl.innerHTML = `
      <div class="notes-detail-toolbar">
        <span class="notes-detail-date">${formatRelative(memo.updated_at)}</span>
        <div class="notes-detail-toolbar-actions">
          <select id="m-folderSelect" class="select" title="폴더">
            <option value="">미분류</option>
            ${folders.map((f) => `<option value="${f.id}" ${memo.folder_id === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
          <div class="links-popover-wrap" id="m-linksWrap">
            <button class="btn-icon" id="m-linksBtn" title="연결된 항목">${LINK_ICON}</button>
            <div class="links-popover" id="m-linksPopover">
              <div class="links-popover-head">🔗 연결된 항목</div>
              <div id="m-links"></div>
            </div>
          </div>
          <button class="btn-icon ${memo.is_pinned ? 'active-pin' : ''}" id="m-pinBtn" title="${memo.is_pinned ? '고정 해제' : '고정'}">${memo.is_pinned ? PIN_ICON : PIN_OUTLINE_ICON}</button>
          <button class="btn-icon ${memo.is_locked ? 'active-pin' : ''}" id="m-lockBtn" title="${memo.is_locked ? '잠금 해제' : '잠금'}">${memo.is_locked ? LOCK_ICON : LOCK_OPEN_ICON}</button>
          <button class="btn-icon" id="m-deleteBtn" title="삭제">${TRASH_ICON}</button>
        </div>
      </div>
      <div class="rich-toolbar">
        <button class="rich-btn" id="m-boldBtn" title="굵게 (${MOD_LABEL}B)">${BOLD_ICON}</button>
        <button class="rich-btn" id="m-underlineBtn" title="밑줄 (${MOD_LABEL}U)">${UNDERLINE_ICON}</button>
        <button class="rich-btn" id="m-alignLeftBtn" title="왼쪽 정렬 (${MOD_SHIFT_LABEL}L)">${ALIGN_LEFT_ICON}</button>
        <button class="rich-btn" id="m-alignCenterBtn" title="가운데 정렬 (${MOD_SHIFT_LABEL}E)">${ALIGN_CENTER_ICON}</button>
        <button class="rich-btn" id="m-alignRightBtn" title="오른쪽 정렬 (${MOD_SHIFT_LABEL}R)">${ALIGN_RIGHT_ICON}</button>
        <button class="rich-btn" id="m-checklistBtn" title="체크박스 추가">${CHECKLIST_ICON}</button>
        <button class="rich-btn" id="m-linkBtn" title="링크 삽입">${URL_LINK_ICON}</button>
        <button class="rich-btn" id="m-photoBtn" title="사진 삽입">${PHOTO_ICON}</button>
        <button class="rich-btn" id="m-attachBtn" title="파일 첨부">${PAPERCLIP_ICON}</button>
        <span class="rich-divider"></span>
        <button class="rich-btn rich-size-btn" data-size="12" title="작게">가</button>
        <button class="rich-btn rich-size-btn active" data-size="14" title="보통">가</button>
        <button class="rich-btn rich-size-btn" data-size="18" title="크게">가</button>
        <span class="rich-divider"></span>
        <button class="rich-btn rich-color-trigger" id="m-colorBtn" title="글자색">
          <span>가</span><span class="rich-color-bar" id="m-colorBar" style="background:#2B2E3A;"></span>
        </button>
      </div>
      <div class="memo-attach-strip" id="m-attachStrip"></div>
      <div id="m-bodyInput" class="notes-body-input" contenteditable="true" data-placeholder="메모를 입력하세요…">${sanitizeRichHtml(memo.content || '')}</div>
    `;

    const bodyEl = $('m-bodyInput');
    linkifyUrls(bodyEl); // 불러올 때 한 번만 URL을 링크로 표시(입력 중엔 절대 호출하지 않음 — 커서 깨짐 방지)
    loadInlineImages(bodyEl); // 저장된 인라인 사진들의 src를 첨부파일에서 다시 채워 넣음(마찬가지로 불러올 때 한 번만)
    const scheduleSave = wrapAutosave(async () => {
      try {
        const cleanContent = sanitizeRichHtml(bodyEl.innerHTML); // 저장 직전에도 한 번 더 정화(붙여넣기 등 대비, a 태그는 여기서 자동으로 벗겨짐)
        await window.itda.memos.update({ id: memo.id, content: cleanContent });
        // 목록의 제목/미리보기/정렬도 즉시 반영되도록 로컬 상태 갱신 후 리스트만 다시 그림(상세는 그대로 유지)
        memo.content = cleanContent;
        memo.updated_at = new Date().toISOString();
        renderList();
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
      }
    });
    bodyEl.addEventListener('input', scheduleSave);
    bindChecklistToggle(bodyEl, scheduleSave);
    bindChecklistEnterKey(bodyEl);
    bindChecklistBackspaceKey(bodyEl, scheduleSave);

    // 클립보드에 이미지가 있으면(스크린샷 도구로 캡처 후 바로 붙여넣기 등) 브라우저 기본
    // 붙여넣기(base64 <img>를 그대로 삽입 — sanitizeRichHtml이 나중에 지워버려서 저장 후
    // 다시 열면 사진이 사라진 것처럼 보이는 원인이었다)를 막고, 첨부파일로 저장한 뒤
    // data-attachment-id를 참조하는 인라인 사진으로 삽입한다.
    bodyEl.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const imageItem = items.find((it) => it.type.startsWith('image/'));
      if (!imageItem) return; // 이미지가 아니면(텍스트 등) 기본 붙여넣기 그대로 둔다
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const record = await window.itda.memoAttachments.addFromDataUrl({
            memoId: memo.id,
            dataUrl: reader.result,
            fileName: `pasted-${Date.now()}.png`,
          });
          insertInlineImage(bodyEl, record.id, reader.result);
          scheduleSave();
        } catch (err) {
          errorToast(err, '사진을 붙여넣지 못했어요');
        }
      };
      reader.readAsDataURL(file);
    });

    // 인라인 사진 크기 조절 — 이미지 우측 하단 모서리 근처를 눌러서 끌면 폭이 바뀐다
    // (높이는 auto라 비율 그대로 유지됨). 별도 리사이즈 손잡이 엘리먼트를 저장 데이터에
    // 남기지 않으려고, 핸들을 따로 그리지 않고 이미지 자체의 코너 히트 영역으로만 판정한다.
    bodyEl.addEventListener('mousedown', (e) => {
      const img = e.target.closest('img.memo-inline-img');
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const nearCorner = e.clientX > rect.right - 16 && e.clientY > rect.bottom - 16;
      if (!nearCorner) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = rect.width;
      const onMove = (ev) => {
        const nextW = Math.max(60, Math.min(bodyEl.clientWidth || 600, startW + (ev.clientX - startX)));
        img.style.width = `${Math.round(nextW)}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        scheduleSave();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 엑셀/워드처럼 서식을 단축키로 — Cmd/Ctrl+B/U는 크로미움이 contenteditable에 기본으로도
    // 걸어주지만, 여기서 직접 가로채 처리해야 정렬(Cmd/Ctrl+Shift+L/E/R, 브라우저 기본 단축키가
    // 없음)까지 한 자리에서 일관되게 다루고, B/U도 브라우저 기본 처리와 중복 토글되지 않는다.
    bodyEl.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (!e.shiftKey && key === 'b') {
        e.preventDefault();
        toggleBold(bodyEl);
        scheduleSave();
      } else if (!e.shiftKey && key === 'u') {
        e.preventDefault();
        toggleUnderline(bodyEl);
        scheduleSave();
      } else if (e.shiftKey && key === 'l') {
        e.preventDefault();
        applyAlign(bodyEl, 'left');
        scheduleSave();
      } else if (e.shiftKey && key === 'e') {
        e.preventDefault();
        applyAlign(bodyEl, 'center');
        scheduleSave();
      } else if (e.shiftKey && key === 'r') {
        e.preventDefault();
        applyAlign(bodyEl, 'right');
        scheduleSave();
      }
    });
    bindMentionAutocomplete(bodyEl, { type: 'memo', id: memo.id }); // "@검색"으로 빠르게 다른 항목과 연결
    bindHashtagAutoTag(bodyEl, async (categoryId) => {
      try {
        await window.itda.memos.update({ id: memo.id, categoryId });
        memo.category_id = categoryId;
      } catch (e) {
        errorToast(e, '태그를 저장하지 못했어요');
      }
    });

    $('m-boldBtn').addEventListener('click', () => {
      toggleBold(bodyEl);
      scheduleSave();
    });
    $('m-underlineBtn').addEventListener('click', () => {
      toggleUnderline(bodyEl);
      scheduleSave();
    });
    $('m-alignLeftBtn').addEventListener('click', () => {
      applyAlign(bodyEl, 'left');
      scheduleSave();
    });
    $('m-alignCenterBtn').addEventListener('click', () => {
      applyAlign(bodyEl, 'center');
      scheduleSave();
    });
    $('m-alignRightBtn').addEventListener('click', () => {
      applyAlign(bodyEl, 'right');
      scheduleSave();
    });
    $('m-checklistBtn').addEventListener('click', () => {
      insertChecklistItem(bodyEl);
      scheduleSave();
    });
    $('m-linkBtn').addEventListener('click', async () => {
      // promptText가 팝오버 입력창에 포커스를 주는 순간 body의 텍스트 선택이 사라지므로
      // (포커스가 옮겨가면 contenteditable의 Range가 날아감), 팝오버를 띄우기 전에 선택
      // 범위를 미리 복제해두고 확인을 누른 뒤 다시 복원한다.
      const sel = window.getSelection();
      const savedRange = sel && sel.rangeCount > 0 && bodyEl.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      const url = await promptText($('m-linkBtn'), { title: '링크 삽입', placeholder: 'https://...' });
      if (!url) return;
      if (savedRange) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      insertLink(bodyEl, /^https?:\/\//i.test(url) ? url : `https://${url}`);
      scheduleSave();
    });
    $('m-photoBtn').addEventListener('click', addInlinePhotos);
    root.querySelectorAll('.rich-size-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFontSize(bodyEl, Number(btn.dataset.size));
        root.querySelectorAll('.rich-size-btn').forEach((b) => b.classList.toggle('active', b === btn));
        scheduleSave();
      });
    });
    $('m-colorBtn').addEventListener('click', (e) => {
      openColorPicker(e.currentTarget, (hex) => {
        applyTextColor(bodyEl, hex);
        $('m-colorBar').style.background = hex;
        scheduleSave();
      });
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
      // 본문에 이미 인라인으로 삽입된 사진은 스트립에 또 보여주지 않는다(중복 표시 방지) —
      // 문서 파일이나, 아직 인라인으로 옮겨지지 않은 예전 사진 첨부만 스트립에 남는다.
      const inlineIds = new Set(
        [...bodyEl.querySelectorAll('img.memo-inline-img[data-attachment-id]')].map((img) => Number(img.dataset.attachmentId))
      );
      attachments = attachments.filter((a) => !inlineIds.has(a.id));

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

    // "사진 삽입" 버튼 — 파일 첨부와 같은 선택 다이얼로그를 재사용하되, 고른 게 사진이면
    // 스트립이 아니라 본문에 바로 인라인으로 넣는다(애플 메모장처럼 크기 조절 가능).
    async function addInlinePhotos() {
      try {
        const result = await window.itda.memoAttachments.add(memo.id);
        if (result?.cancelled) return;
        for (const record of result.added || []) {
          if (!record.mime_type?.startsWith('image/')) continue; // 문서를 골랐으면 스트립에만 남기고 인라인 삽입은 생략
          try {
            const dataUrl = await window.itda.memoAttachments.getImageData(record.id);
            if (dataUrl) insertInlineImage(bodyEl, record.id, dataUrl);
          } catch (e) {
            /* 하나 실패해도 나머지는 계속 */
          }
        }
        if (result?.skipped?.length) {
          toast(`${result.skipped.length}개 파일은 건너뛰었어요 (${result.skipped[0].reason})`);
        }
        scheduleSave();
        await renderAttachments();
      } catch (e) {
        errorToast(e, '사진을 추가하지 못했어요');
      }
    }

    $('m-folderSelect').addEventListener('change', async (e) => {
      const folderId = e.target.value ? Number(e.target.value) : null;
      try {
        await window.itda.memos.update({ id: memo.id, folderId });
        memo.folder_id = folderId;
        await loadFolders(); // 커스텀 폴더의 개수(f.memo_count)는 서버 계산값이라 다시 불러와야 갱신됨
        renderList();
      } catch (err) {
        errorToast(err, '폴더를 변경하지 못했어요');
      }
    });

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

    // 지금 열려 있는 메모를 잠글 때는 이미 앱 안에서 보고 있던 내용이라 비밀번호를 다시
    // 묻지 않는다(우회 경로가 아니라 진짜 소유자 액션) — 목록/우클릭 메뉴에서 잠긴 메모를 다시
    // 열 때만 비밀번호를 확인한다(openMemoMaybeLocked/context-menu.js의 잠금 해제 참고).
    $('m-lockBtn').addEventListener('click', async () => {
      try {
        if (!memo.is_locked) {
          const status = await window.itda.auth.getStatus();
          if (!status.enabled) {
            toast('먼저 설정 > 보안에서 비밀번호를 설정해주세요');
            return;
          }
        }
        const result = await window.itda.memos.toggleLock(memo.id);
        memo.is_locked = result.is_locked;
        if (result.is_locked) unlockedIds.delete(memo.id);
        else unlockedIds.add(memo.id);
        renderList();
        renderDetail();
      } catch (e) {
        errorToast(e, '잠금 상태를 변경하지 못했어요');
      }
    });

    $('m-deleteBtn').addEventListener('click', async () => {
      try {
        await window.itda.memos.delete(memo.id);
        toast('휴지통으로 이동했어요');
        memos = memos.filter((m) => m.id !== memo.id);
        selectedId = null;
        await loadFolders(); // 지워진 메모가 폴더에 있었으면 그 폴더 개수도 갱신
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

  // "+"로 막 만든 메모나 지금 보고 있는 메모를 Esc로 닫고(선택 해제) 빈 상태로 돌아간다 —
  // 제목/본문을 타이핑하는 중엔 반응하지 않는다(다른 팝오버 닫기 등과 겹치지 않게).
  function closeMemoDetail() {
    selectedId = null;
    renderList();
    renderDetail();
    root.querySelector('.notes-app')?.classList.remove('detail-open');
  }

  // 잠긴 메모는 앱 비밀번호(설정 > 보안)로 확인한 뒤에만 상세를 연다 — 비밀번호가 아예
  // 설정 안 돼 있으면(잠금 기능 자체를 안 쓰는 경우) 설정으로 가서 먼저 켜라고 안내한다.
  async function verifyLockPassword(anchorEl) {
    let status;
    try {
      status = await window.itda.auth.getStatus();
    } catch (e) {
      errorToast(e, '잠금 상태를 확인하지 못했어요');
      return false;
    }
    if (!status.enabled) {
      toast('먼저 설정 > 보안에서 비밀번호를 설정해주세요');
      return false;
    }
    const pw = await promptText(anchorEl, { title: '🔒 잠긴 메모예요', placeholder: '비밀번호', password: true });
    if (!pw) return false;
    try {
      const ok = await window.itda.auth.verify(pw);
      if (!ok) toast('비밀번호가 일치하지 않아요');
      return ok;
    } catch (e) {
      errorToast(e, '확인하지 못했어요');
      return false;
    }
  }

  async function openMemoMaybeLocked(id, anchorEl) {
    const memo = memos.find((m) => m.id === id);
    if (memo?.is_locked && !unlockedIds.has(id)) {
      const ok = await verifyLockPassword(anchorEl);
      if (!ok) return;
      unlockedIds.add(id);
      renderList(); // 잠금 배지/미리보기가 방금 풀렸으니 목록 표시도 같이 갱신
    }
    selectMemo(id);
  }

  async function bulkDeleteSelected() {
    if (selected.size === 0) return;
    const targets = [...selected];
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
  }

  // 다중 선택된 상태에서 그중 하나를 우클릭하면 뜨는 축소 메뉴 — "선택한 N개 삭제" 하나뿐.
  // context-menu.js(공용 컴포넌트, todo/event/postit과도 공유)를 건드리지 않고 이 화면에서만
  // 쓰는 가벼운 메뉴라 여기서 직접 만든다.
  function showBulkDeleteMenu(x, y, ids) {
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `<button class="ctx-menu-item ctx-menu-danger" data-action="bulk-delete">${TRASH_ICON} 선택한 ${ids.length}개 삭제</button>`;
    document.body.appendChild(menu);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, vw - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, vh - rect.height - 8))}px`;

    function close() {
      menu.remove();
      document.removeEventListener('mousedown', onOutside);
    }
    function onOutside(e) {
      if (!menu.contains(e.target)) close();
    }
    menu.querySelector('[data-action="bulk-delete"]').addEventListener('click', async () => {
      close();
      if (!confirm(`선택한 메모 ${ids.length}개를 삭제하시겠습니까?`)) return;
      await bulkDeleteSelected();
    });
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  }

  async function load() {
    try {
      memos = await window.itda.memos.list({});
    } catch (e) {
      errorToast(e, '메모를 불러오지 못했어요');
      $('m-list').innerHTML = emptyStateBlock({ title: '메모를 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
      return;
    }
    await loadFolders(); // 커스텀 폴더 개수(f.memo_count)는 서버 계산값이라 메모 목록과 같이 다시 불러온다
    renderList();
    renderDetail();
  }

  async function createNewMemo(folderIdArg) {
    try {
      // 인자로 폴더를 주면(폴더 우클릭 메뉴) 그 폴더로, 아니면 현재 선택된 폴더 기준
      // ("전체"/"미분류"에서 만들면 미분류, 특정 폴더 안에서 만들면 그 폴더로)
      const folderId = folderIdArg !== undefined ? folderIdArg : currentFolderId ?? null;
      const { id } = await window.itda.memos.add({ content: '', folderId });
      await load();
      selectMemo(id);
      $('m-bodyInput')?.focus();
    } catch (e) {
      errorToast(e, '메모를 추가하지 못했어요');
    }
  }
  $('m-newBtn').addEventListener('click', createNewMemo);
  // 화면 전용 고정 단축키(⌘/Ctrl+N) — 이 화면이 떠 있는 동안만 반응, 언마운트 시 해제.
  const handleNewMemoShortcut = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      createNewMemo();
      return;
    }
    // 일정 화면과 동일하게, 입력 중이 아닐 때 '+' 로도 새 메모 추가
    if (e.key === '+' && !e.metaKey && !e.ctrlKey && !e.altKey && !isUserTyping()) {
      e.preventDefault();
      createNewMemo();
    }
  };
  document.addEventListener('keydown', handleNewMemoShortcut);

  // F: 폴더 레일 접기/펼치기 (입력 중이 아닐 때만)
  const handleFolderToggle = (e) => {
    if (e.key.toLowerCase() !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (isUserTyping()) return;
    const rail = $('m-folderRail');
    if (!rail) return;
    e.preventDefault();
    rail.open = !rail.open;
  };
  document.addEventListener('keydown', handleFolderToggle);

  // ⌘F(Ctrl+F) 또는 입력 중이 아닐 때 '/' 로 검색창에 포커스
  const handleSearchFocus = (e) => {
    const isModF = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
    const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isUserTyping();
    if (!isModF && !isSlash) return;
    const input = $('m-search');
    if (!input) return;
    e.preventDefault();
    input.focus();
    input.select();
  };
  document.addEventListener('keydown', handleSearchFocus);

  // A: "전체 메모" ↔ "미분류" 전환 (입력 중이 아닐 때만)
  const handleAllMemosToggle = (e) => {
    if (e.key.toLowerCase() !== 'a' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (isUserTyping()) return;
    e.preventDefault();
    currentFolderId = currentFolderId === undefined ? null : undefined;
    renderFolderRail();
    renderList();
  };
  document.addEventListener('keydown', handleAllMemosToggle);

  // 목록에서 Cmd/Ctrl·Shift+클릭으로 여러 개 선택해뒀을 때 Delete/Backspace로 한 번에 지우기
  // (제목/본문 입력 중 글자를 지우는 backspace와 겹치지 않도록 isUserTyping()으로 가드).
  const handleDeleteKey = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isUserTyping()) return;
    if (selected.size === 0) return;
    e.preventDefault();
    if (!confirm(`선택한 메모 ${selected.size}개를 삭제하시겠습니까?`)) return;
    bulkDeleteSelected();
  };
  document.addEventListener('keydown', handleDeleteKey);

  const unsubscribeEsc = registerEscClose(() => selectedId !== null && !isUserTyping(), closeMemoDetail);

  // ---------- 첨부파일 드래그앤드롭 ----------
  // mount() 스코프에서 딱 한 번만 등록한다 — renderDetail() 안에 있으면 메모를 열 때마다(심지어
  // 같은 메모를 다시 클릭할 때마다) 리스너가 새로 쌓여서, 파일 하나를 드롭해도 여러 개가
  // 중복으로 첨부되는 버그가 있었다(detailEl은 재렌더링돼도 계속 같은 DOM 노드라 리스너가
  // 안 사라짐). memo.id는 매번 selectedId로 다시 찾아서 최신 값을 쓴다.
  // dataTransfer.files의 각 File은 Electron 렌더러에서 .path(실제 파일 시스템 경로)를 그대로
  // 들고 있다 — 그 경로만 메인 프로세스로 넘기면(addFromPaths) 파일선택 다이얼로그와 똑같은
  // 복사+기록 로직을 그대로 재사용할 수 있다.
  let dragDepth = 0; // dragenter/dragleave가 자식 요소를 넘나들며 여러 번 오가므로 카운터로 안정적으로 판정
  const detailEl = $('m-detail');
  detailEl.addEventListener('dragenter', (e) => {
    if (selectedId == null) return;
    e.preventDefault();
    dragDepth += 1;
    detailEl.classList.add('drag-over');
  });
  detailEl.addEventListener('dragover', (e) => {
    if (selectedId == null) return;
    e.preventDefault(); // 기본 동작(파일을 새 탭으로 여는 등)을 막아야 drop이 발생함
  });
  detailEl.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) detailEl.classList.remove('drag-over');
  });
  detailEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    detailEl.classList.remove('drag-over');
    const memo = memos.find((m) => m.id === selectedId);
    if (!memo) return;
    const filePaths = [...(e.dataTransfer?.files || [])].map((f) => f.path).filter(Boolean);
    if (!filePaths.length) return;
    try {
      const result = await window.itda.memoAttachments.addFromPaths({ memoId: memo.id, filePaths });
      if (result?.skipped?.length) {
        toast(`${result.skipped.length}개 파일은 건너뛰었어요 (${result.skipped[0].reason})`);
      }
      const imageRecords = (result.added || []).filter((r) => r.mime_type?.startsWith('image/'));
      if (imageRecords.length) {
        // 사진은 스트립이 아니라 본문에 바로 인라인으로 삽입 — renderDetail로 새 bodyEl을 얻는다.
        renderDetail();
        const bodyEl = $('m-bodyInput');
        for (const record of imageRecords) {
          try {
            const dataUrl = await window.itda.memoAttachments.getImageData(record.id);
            if (dataUrl) insertInlineImage(bodyEl, record.id, dataUrl);
          } catch (err) {
            /* 하나 실패해도 나머지는 계속 */
          }
        }
        const cleanContent = sanitizeRichHtml(bodyEl.innerHTML);
        await window.itda.memos.update({ id: memo.id, content: cleanContent });
        memo.content = cleanContent;
        memo.updated_at = new Date().toISOString();
        renderList();
      } else {
        renderDetail(); // 문서 파일만 있었으면 스트립 갱신을 위해 다시 그리기만 하면 충분
      }
    } catch (err) {
      errorToast(err, '파일을 첨부하지 못했어요');
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
    $('m-bulkDelete').disabled = true;
    await bulkDeleteSelected();
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

  // 연결된 항목 팝오버 바깥 클릭 시 닫기 — renderDetail()이 여러 번 재실행돼도
  // 리스너가 쌓이지 않도록 mount() 스코프에서 딱 한 번만 등록하고, 화면을 벗어날 때 해제한다.
  const closeOnOutsideClick = (e) => {
    if (!e.target.closest('.links-popover-wrap')) {
      root.querySelectorAll('.links-popover-wrap.open').forEach((w) => w.classList.remove('open'));
    }
  };
  document.addEventListener('click', closeOnOutsideClick);

  try {
    lockListMode = (await window.itda.settings.get('memo_lock_list_mode')) === 'title' ? 'title' : 'hidden';
  } catch (e) {
    lockListMode = 'hidden';
  }
  await load(); // load()가 내부에서 loadFolders()도 같이 호출한다
  setScreenShortcuts('메모', MEMO_SCREEN_SHORTCUTS);

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity === 'memoFolder') {
      loadFolders();
      return;
    }
    if (entity !== 'memo') return;
    if (isUserTyping()) return; // 지금 메모 본문/제목을 타이핑 중이면 커서가 끊기지 않게 미룸
    debouncedLoad();
  });

  return () => {
    document.removeEventListener('click', closeOnOutsideClick);
    document.removeEventListener('keydown', handleNewMemoShortcut);
    document.removeEventListener('keydown', handleFolderToggle);
    document.removeEventListener('keydown', handleSearchFocus);
    document.removeEventListener('keydown', handleAllMemosToggle);
    document.removeEventListener('keydown', handleDeleteKey);
    closeFolderMenu();
    unsubscribeEsc();
    offDataChanged?.();
    setScreenShortcuts(null, []); // 다른 화면으로 이동하면 이 화면 전용 단축키는 오버레이에서 빠져야 함
  };
}
