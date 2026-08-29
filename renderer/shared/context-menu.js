import { toast, errorToast, escapeHtml } from './ui-utils.js';
import { promptText } from './text-prompt.js';
import { mountLinksWidget } from './links-ui.js';
import { todayStr, dateKey, addDays } from './date-utils.js';
import { stripHtmlToPlainText } from './rich-text.js';
import { openCreateEventModal } from './create-event-modal.js';
import { openCreateTodoModal } from './create-todo-modal.js';
import { openCreateMemoModal } from './create-memo-modal.js';
import { openCreatePostitModal } from './create-postit-modal.js';

// 항목 타입별 삭제(소프트삭제) API. links-ui.js의 LINK_TYPE_LABEL과 동일한 타입 키를 쓴다.
const DELETE_API = {
  todo: (id) => window.itda.todos.delete(id),
  event: (id) => window.itda.events.delete(id),
  memo: (id) => window.itda.memos.delete(id),
  postit: (id) => window.itda.postits.delete(id),
};

// "다른 타입으로 만들기" 우클릭 메뉴 항목. 타입별로 등록 팝업(openXModal)만 있으면
// 여기 한 줄 추가하는 것만으로 새 방향을 열 수 있다.
// todo/event/memo/postit는 서로 완전히 양방향(자기 자신 제외 전부)이고, inbox는 나머지 4개로만
// 갈 수 있다(반대 방향은 없음 — Inbox는 "정리 전 임시 수집함"이라 다른 항목을 다시 Inbox로
// 되돌리는 흐름은 제품 개념상 의미가 없어서 뺐다).
export const EVENT_TARGET = { type: 'event', label: '📅 일정 만들기', open: openCreateEventModal };
export const TODO_TARGET = { type: 'todo', label: '☑️ Todo로 만들기', open: openCreateTodoModal };
const MEMO_TARGET = { type: 'memo', label: '📝 메모로 만들기', open: openCreateMemoModal };
const POSTIT_TARGET = { type: 'postit', label: '📌 포스트잇으로 만들기', open: openCreatePostitModal };

const CONVERT_TARGETS = {
  todo: [EVENT_TARGET, MEMO_TARGET, POSTIT_TARGET],
  event: [TODO_TARGET, MEMO_TARGET, POSTIT_TARGET],
  memo: [TODO_TARGET, EVENT_TARGET, POSTIT_TARGET],
  postit: [TODO_TARGET, EVENT_TARGET, MEMO_TARGET],
  inbox: [EVENT_TARGET, TODO_TARGET, MEMO_TARGET, POSTIT_TARGET],
};

// 전환 시 팝업에 미리 채울 제목/메모/날짜를 항목 타입별로 가져온다.
async function fetchConvertSource(item) {
  if (item.type === 'todo') {
    const t = await window.itda.todos.get(item.id);
    return { title: t?.title || '', memo: t?.memo || '', dueDate: t?.due_date || null };
  }
  if (item.type === 'event') {
    const e = await window.itda.events.get(item.id);
    return { title: e?.title || '', memo: e?.memo || '', dueDate: e?.start_at ? e.start_at.slice(0, 10) : null };
  }
  if (item.type === 'memo') {
    const m = await window.itda.memos.get(item.id);
    return { title: m?.title || '', memo: stripHtmlToPlainText(m?.content || ''), dueDate: null };
  }
  if (item.type === 'postit') {
    const p = await window.itda.postits.get(item.id);
    return { title: p?.title || '', memo: stripHtmlToPlainText(p?.content || ''), dueDate: null };
  }
  if (item.type === 'inbox') {
    const items = await window.itda.inbox.list({ onlyUnprocessed: false });
    const found = items.find((i) => i.id === item.id);
    return { title: found?.content || '', memo: '', dueDate: null };
  }
  return { title: '', memo: '', dueDate: null };
}

// 우클릭 메뉴뿐 아니라 카드의 "Todo/일정으로 변환" 버튼(postit.js 등)에서도 직접 부른다.
export async function convertItem(item, target) {
  closeMenu();
  let source;
  try {
    source = await fetchConvertSource(item);
  } catch (e) {
    errorToast(e, '내용을 불러오지 못했어요');
    return;
  }
  const created = await target.open({ title: source.title, memo: source.memo, dueDate: source.dueDate });
  if (!created) return; // 취소
  try {
    // Inbox는 소프트 삭제 대상이 아니라 자체 "처리됨" 상태로 관리되므로 링크 대신 markProcessed를 쓴다.
    if (item.type === 'inbox') await window.itda.inbox.markProcessed({ id: item.id, type: target.type, refId: created.id });
    else await window.itda.links.add({ aType: item.type, aId: item.id, bType: target.type, bId: created.id });
  } catch (e) {
    errorToast(e, '전환한 항목과 연결하지 못했어요');
  }
  return created;
}

let activeEl = null;
let outsideHandlersBound = false;

function closeMenu() {
  if (activeEl) {
    activeEl.remove();
    activeEl = null;
  }
}

function ensureOutsideHandlers() {
  if (outsideHandlersBound) return;
  outsideHandlersBound = true;
  // 메뉴 바깥을 클릭/우클릭하거나 스크롤/창 포커스 변화가 생기면 닫는다.
  // (우클릭도 contextmenu 이전에 mousedown이 먼저 발생하므로 이걸로 다른 항목 재우클릭 시 자연스럽게 교체됨)
  document.addEventListener('mousedown', (e) => {
    if (activeEl && !activeEl.contains(e.target)) closeMenu();
  });
  // 팝오버 내부 목록이 길어서 자체적으로 스크롤될 때(마우스 휠 등)도 'scroll' 이벤트가 캡처 단계로
  // document까지 올라온다(scroll은 버블링은 안 하지만 캡처링은 함) — 그래서 팝오버 안에서 스크롤한
  // 것뿐인데 "바깥 스크롤"로 오인해서 팝오버 자신이 닫혀버리는 버그가 있었다. 스크롤이 팝오버 안에서
  // 일어난 거면(target이 activeEl 안에 있으면) 닫지 않는다.
  document.addEventListener(
    'scroll',
    (e) => {
      if (activeEl && activeEl.contains(e.target)) return;
      closeMenu();
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('blur', closeMenu);
}

function placeAt(el, x, y) {
  document.body.appendChild(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, vw - rect.width - 8));
  const top = Math.max(8, Math.min(y, vh - rect.height - 8));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  return { left, top };
}

function openLinkPopover(x, y, item) {
  closeMenu();
  const pop = document.createElement('div');
  pop.className = 'ctx-link-popover';
  pop.innerHTML = `<div class="links-popover-head">🔗 연결된 항목</div><div class="ctx-link-mount"></div>`;
  activeEl = pop;
  placeAt(pop, x, y);
  mountLinksWidget(pop.querySelector('.ctx-link-mount'), { type: item.type, id: item.id });
}

// 메모 우클릭 → "폴더로 이동" 서브메뉴 (애플 메모장처럼 목록에서 바로 폴더 옮기기)
async function openMoveFolderSubmenu(x, y, item, opts) {
  let folders = [];
  try {
    folders = await window.itda.memoFolders.list();
  } catch (e) {
    /* 폴더 목록 실패해도 "미분류"는 계속 고를 수 있게 조용히 무시 */
  }
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button class="ctx-menu-item" data-folder="">📄 미분류</button>
    ${folders.map((f) => `<button class="ctx-menu-item" data-folder="${f.id}">📁 ${escapeHtml(f.name)}</button>`).join('')}
  `;
  activeEl = menu;
  placeAt(menu, x, y);
  menu.querySelectorAll('[data-folder]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      closeMenu();
      const folderId = btn.dataset.folder ? Number(btn.dataset.folder) : null;
      try {
        await window.itda.memos.update({ id: item.id, folderId });
        opts.onMoved?.(item, folderId);
      } catch (e) {
        errorToast(e, '폴더를 변경하지 못했어요');
      }
    });
  });
}

function openMenu(x, y, item, opts) {
  ensureOutsideHandlers();
  closeMenu();

  const convertTargets = CONVERT_TARGETS[item.type] || [];
  const isMemo = item.type === 'memo';
  const memoItems = isMemo
    ? `<button class="ctx-menu-item" data-action="pin">${item.isPinned ? '📌 고정 해제' : '📌 상단 고정'}</button>
    <button class="ctx-menu-item" data-action="move-folder">🗂 폴더로 이동</button>
    <button class="ctx-menu-item" data-action="lock">${item.isLocked ? '🔓 잠금 해제' : '🔒 잠금'}</button>`
    : '';

  // linkOnly: 위젯/삭제를 지원하지 않는 항목(예: Inbox)용 — "연결"(+ 전환 가능하면 전환)만 있는 축소 메뉴
  if (opts.linkOnly) {
    if (convertTargets.length === 0) {
      openLinkPopover(x, y, item);
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = `
      ${convertTargets.map((c) => `<button class="ctx-menu-item" data-convert="${c.type}">${c.label}</button>`).join('')}
      <button class="ctx-menu-item" data-action="link">🔗 연결</button>
    `;
    activeEl = menu;
    const pos = placeAt(menu, x, y);
    convertTargets.forEach((c) => {
      menu.querySelector(`[data-convert="${c.type}"]`).addEventListener('click', () => convertItem(item, c));
    });
    menu.querySelector('[data-action="link"]').addEventListener('click', () => openLinkPopover(pos.left, pos.top, item));
    return;
  }

  // 기한 없는 Todo 전용 빠른 날짜 액션 — item.dueDate는 todo.js가 getItem()에서 채워서 넘겨준다.
  // 이미 기한이 있는 Todo는 상세 패널에서 직접 바꾸면 되니 여기서는 굳이 안 보여줌.
  const isTodo = item.type === 'todo';
  const isDatelessTodo = isTodo && !item.dueDate;
  const quickDateItems = isDatelessTodo
    ? `
    <button class="ctx-menu-item" data-action="due-today">📅 오늘 할 일로 표시</button>
    <button class="ctx-menu-item" data-action="due-tomorrow">➡️ 내일로 미루기</button>
    <button class="ctx-menu-item" data-action="due-pick">🗓 날짜 지정</button>`
    : '';
  // 완료는 기한 유무와 무관하게 모든 Todo에 항상 보여준다.
  const todoItems = isTodo
    ? `${quickDateItems}
    <button class="ctx-menu-item" data-action="complete">${item.isDone ? '↩️ 완료 취소' : '✅ 완료'}</button>
    <div class="ctx-menu-divider"></div>`
    : '';

  const convertItems = convertTargets.length
    ? convertTargets.map((c) => `<button class="ctx-menu-item" data-convert="${c.type}">${c.label}</button>`).join('') +
      `<div class="ctx-menu-divider"></div>`
    : '';

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    ${todoItems}
    ${memoItems}
    ${convertItems}
    <button class="ctx-menu-item" data-action="link">🔗 연결</button>
    <button class="ctx-menu-item" data-action="widget">🗗 위젯으로 보기</button>
    <button class="ctx-menu-item ctx-menu-danger" data-action="delete">🗑 삭제</button>
  `;
  activeEl = menu;
  const pos = placeAt(menu, x, y);

  convertTargets.forEach((c) => {
    menu.querySelector(`[data-convert="${c.type}"]`).addEventListener('click', () => convertItem(item, c));
  });

  if (isDatelessTodo) {
    menu.querySelector('[data-action="due-today"]').addEventListener('click', async () => {
      closeMenu();
      try {
        await window.itda.todos.update({ id: item.id, dueDate: todayStr() });
        toast('오늘 할 일로 표시했어요');
      } catch (e) {
        errorToast(e, '변경하지 못했어요');
      }
    });
    menu.querySelector('[data-action="due-tomorrow"]').addEventListener('click', async () => {
      closeMenu();
      try {
        await window.itda.todos.update({ id: item.id, dueDate: dateKey(addDays(new Date(), 1)) });
        toast('내일로 미뤘어요');
      } catch (e) {
        errorToast(e, '변경하지 못했어요');
      }
    });
    menu.querySelector('[data-action="due-pick"]').addEventListener('click', () => {
      closeMenu();
      opts.onPickDate?.(item); // 실제 날짜 입력 UI는 todo.js의 상세 패널을 그대로 재사용(중복 구현 안 함)
    });
  }

  if (isTodo) {
    menu.querySelector('[data-action="complete"]').addEventListener('click', async () => {
      closeMenu();
      try {
        await window.itda.todos.toggle(item.id);
        toast(item.isDone ? '완료를 취소했어요' : '완료 처리했어요');
      } catch (e) {
        errorToast(e, '완료 처리하지 못했어요');
      }
    });
  }

  if (isMemo) {
    menu.querySelector('[data-action="pin"]').addEventListener('click', async () => {
      closeMenu();
      try {
        const result = await window.itda.memos.togglePin(item.id);
        opts.onPinToggled?.(item, result.is_pinned);
      } catch (e) {
        errorToast(e, '고정 상태를 변경하지 못했어요');
      }
    });
    menu.querySelector('[data-action="move-folder"]').addEventListener('click', () => {
      openMoveFolderSubmenu(pos.left, pos.top, item, opts);
    });
    menu.querySelector('[data-action="lock"]').addEventListener('click', async () => {
      closeMenu();
      try {
        if (item.isLocked) {
          // 잠금을 푸는 쪽만 비밀번호를 확인한다 — 잠그는 건 이미 열려 있는 앱 안에서 하는
          // 동작이라 굳이 다시 물을 필요가 없고, 여기서 물어도 우회 경로만 늘어난다.
          const status = await window.itda.auth.getStatus();
          if (!status.enabled) {
            toast('먼저 설정 > 보안에서 비밀번호를 설정해주세요');
            return;
          }
          const anchor = { getBoundingClientRect: () => ({ left: pos.left, top: pos.top, bottom: pos.top, right: pos.left, width: 0, height: 0 }) };
          const pw = await promptText(anchor, { title: '🔒 잠긴 메모예요', placeholder: '비밀번호', password: true });
          if (!pw) return;
          const ok = await window.itda.auth.verify(pw);
          if (!ok) {
            toast('비밀번호가 일치하지 않아요');
            return;
          }
        } else {
          const status = await window.itda.auth.getStatus();
          if (!status.enabled) {
            toast('먼저 설정 > 보안에서 비밀번호를 설정해주세요');
            return;
          }
        }
        const result = await window.itda.memos.toggleLock(item.id);
        opts.onLockToggled?.(item, !!result.is_locked);
      } catch (e) {
        errorToast(e, '잠금 상태를 변경하지 못했어요');
      }
    });
  }

  menu.querySelector('[data-action="link"]').addEventListener('click', () => {
    openLinkPopover(pos.left, pos.top, item);
  });

  menu.querySelector('[data-action="widget"]').addEventListener('click', async () => {
    closeMenu();
    try {
      if (item.type === 'postit') await window.itda.postitWidget.open(item.id);
      else await window.itda.itemWidget.open({ type: item.type, id: item.id });
    } catch (e) {
      errorToast(e, '위젯을 열지 못했어요');
    }
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    closeMenu();
    try {
      const del = DELETE_API[item.type];
      if (!del) throw new Error('알 수 없는 항목입니다.');
      await del(item.id);
      toast('휴지통으로 이동했어요');
      opts.onDeleted?.(item);
    } catch (e) {
      errorToast(e, '삭제하지 못했어요');
    }
  });
}

/**
 * 항목 카드/행에 우클릭 컨텍스트 메뉴(연결/위젯으로 보기/삭제)를 붙인다.
 * 편집 가능한 텍스트 영역(입력창, contenteditable) 위에서는 OS 기본 메뉴(복사/붙여넣기 등)를
 * 그대로 쓸 수 있도록 커스텀 메뉴를 열지 않는다.
 *
 * @param {HTMLElement} el - 우클릭을 감지할 엘리먼트(카드/행 전체)
 * @param {() => ({type:'todo'|'event'|'memo'|'postit', id:number}|null)} getItem - 클릭 시점의 최신 항목 정보
 * @param {{onDeleted?: (item: {type:string,id:number}) => void, openAnywhere?: boolean}} [opts]
 *   openAnywhere: contenteditable(본문) 위에서도 커스텀 메뉴를 연다(포스트잇 — "어느 부분이든 우클릭").
 *   input/textarea(체크박스 등)는 openAnywhere여도 항상 예외로 둔다.
 * @returns {() => void} 리스너 해제 함수
 */
export function attachContextMenu(el, getItem, opts = {}) {
  function handler(e) {
    if (e.target.closest('input,textarea')) return; // 체크박스/텍스트필드는 항상 OS 기본
    if (!opts.openAnywhere && e.target.closest('[contenteditable="true"]')) return; // 기본: 편집 중엔 OS 메뉴 유지
    const item = getItem();
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, item, opts);
  }
  el.addEventListener('contextmenu', handler);
  return () => el.removeEventListener('contextmenu', handler);
}
