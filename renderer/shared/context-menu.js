import { toast, errorToast } from './ui-utils.js';
import { mountLinksWidget } from './links-ui.js';

// 항목 타입별 삭제(소프트삭제) API. links-ui.js의 LINK_TYPE_LABEL과 동일한 타입 키를 쓴다.
const DELETE_API = {
  todo: (id) => window.itda.todos.delete(id),
  event: (id) => window.itda.events.delete(id),
  memo: (id) => window.itda.memos.delete(id),
  postit: (id) => window.itda.postits.delete(id),
};

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

function openMenu(x, y, item, opts) {
  ensureOutsideHandlers();
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button class="ctx-menu-item" data-action="link">🔗 연결</button>
    <button class="ctx-menu-item" data-action="widget">🗗 위젯으로 보기</button>
    <button class="ctx-menu-item ctx-menu-danger" data-action="delete">🗑 삭제</button>
  `;
  activeEl = menu;
  const pos = placeAt(menu, x, y);

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
 * @param {{onDeleted?: (item: {type:string,id:number}) => void}} [opts] - 삭제 성공 후 호출(목록 갱신 등)
 * @returns {() => void} 리스너 해제 함수
 */
export function attachContextMenu(el, getItem, opts = {}) {
  function handler(e) {
    if (e.target.closest('input,textarea,[contenteditable="true"]')) return; // 텍스트 편집 중엔 OS 기본 메뉴 유지
    const item = getItem();
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(e.clientX, e.clientY, item, opts);
  }
  el.addEventListener('contextmenu', handler);
  return () => el.removeEventListener('contextmenu', handler);
}
