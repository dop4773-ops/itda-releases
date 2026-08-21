import { errorToast } from '../shared/ui-utils.js';
import { sanitizeRichHtml, toggleBold, insertChecklistItem, bindChecklistToggle, bindChecklistEnterKey, linkifyUrls } from '../shared/rich-text.js';
import { wrapAutosave } from '../shared/pending-saves.js';

const PIN_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const PIN_OUTLINE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const MINIMIZE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg>`;
const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const BOLD_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M6 4h6a3.5 3.5 0 010 7H6zM6 11h7a3.5 3.5 0 010 7H6z"/></svg>`;
const CHECKLIST_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="3" width="7" height="7" rx="1.5"/><path d="M4.5 6.5l1.3 1.3L8.5 5"/><path d="M13 5h8M13 12h8M13 19h8"/><rect x="3" y="13" width="7" height="7" rx="1.5"/></svg>`;

function getPostitIdFromQuery() {
  return Number(new URLSearchParams(location.search).get('id'));
}

async function mount() {
  const id = getPostitIdFromQuery();
  const root = document.getElementById('widget-root');

  if (!id) {
    root.innerHTML = `<div class="widget-error">잘못된 포스트잇이에요</div>`;
    return;
  }

  let postit;
  try {
    postit = await window.itda.postits.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!postit) {
    root.innerHTML = `<div class="widget-error">삭제된 포스트잇이에요</div>`;
    return;
  }

  root.innerHTML = `
    <div class="widget-card" style="background:${postit.color_hex || '#FBE28A'}">
      <div class="widget-titlebar widget-controls-hover">
        <button class="widget-btn" id="w-bold" title="굵게">${BOLD_ICON}</button>
        <button class="widget-btn" id="w-checklist" title="체크박스 추가">${CHECKLIST_ICON}</button>
        <button class="widget-btn ${postit.is_always_on_top ? 'active' : ''}" id="w-pin" title="항상 위">${postit.is_always_on_top ? PIN_ICON : PIN_OUTLINE_ICON}</button>
        <button class="widget-btn" id="w-minimize" title="최소화">${MINIMIZE_ICON}</button>
        <button class="widget-btn" id="w-close" title="닫기">${CLOSE_ICON}</button>
      </div>
      <div id="w-content" class="widget-textarea" contenteditable="true" data-placeholder="내용을 입력하세요…">${sanitizeRichHtml(postit.content || '')}</div>
    </div>
    <div class="toast" id="toast"></div>
  `;

  const contentEl = document.getElementById('w-content');
  linkifyUrls(contentEl); // 불러올 때 한 번만 — 입력 중엔 호출 금지(커서 깨짐)
  const scheduleSave = wrapAutosave(async () => {
    try {
      const cleanContent = sanitizeRichHtml(contentEl.innerHTML);
      await window.itda.postits.update({ id, content: cleanContent });
    } catch (err) {
      errorToast(err, '저장하지 못했어요');
    }
  });
  contentEl.addEventListener('input', scheduleSave);
  bindChecklistToggle(contentEl, scheduleSave);
  bindChecklistEnterKey(contentEl);

  document.getElementById('w-bold').addEventListener('click', () => {
    toggleBold(contentEl);
    contentEl.dispatchEvent(new Event('input'));
  });

  document.getElementById('w-checklist').addEventListener('click', () => {
    insertChecklistItem(contentEl);
    contentEl.dispatchEvent(new Event('input'));
  });

  document.getElementById('w-pin').addEventListener('click', async () => {
    const btn = document.getElementById('w-pin');
    try {
      const result = await window.itda.postitWidget.toggleAlwaysOnTop(id);
      btn.innerHTML = result.is_always_on_top ? PIN_ICON : PIN_OUTLINE_ICON;
      btn.classList.toggle('active', !!result.is_always_on_top);
    } catch (err) {
      errorToast(err, '설정을 변경하지 못했어요');
    }
  });

  document.getElementById('w-minimize').addEventListener('click', () => {
    window.itda.widgetControls.minimize();
  });

  document.getElementById('w-close').addEventListener('click', () => {
    window.close(); // 위젯 창만 닫힘 — 포스트잇 데이터는 그대로 남아있고 메인 화면에서 다시 열 수 있음
  });

  // 위젯 창은 항상 "지금 열려있는 창 자체"가 곧 닫을 대상이라 조건 없이 Esc=닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });

  // 메인 창(또는 다른 위젯)에서 이 포스트잇이 바뀌면 반영한다. 지금 이 위젯 안에서 사용자가
  // 타이핑 중이면(방금 자기 자신이 저장해서 온 브로드캐스트일 수도 있음) 건드리지 않는다 —
  // 안 그러면 커서가 끊기거나 입력 중인 글자가 덮어써질 수 있다.
  window.itda.onDataChanged(async ({ entity, id: changedId }) => {
    if (entity !== 'postit' || changedId !== id) return;
    if (document.activeElement === contentEl) return;
    let fresh;
    try {
      fresh = await window.itda.postits.get(id);
    } catch (e) {
      return;
    }
    if (!fresh) {
      window.close(); // 다른 곳에서 삭제됨 — 위젯도 닫는다(휴지통행이라 데이터 자체는 안전)
      return;
    }
    contentEl.innerHTML = sanitizeRichHtml(fresh.content || '');
    linkifyUrls(contentEl);
    document.querySelector('.widget-card').style.background = fresh.color_hex || '#FBE28A';
    const pinBtn = document.getElementById('w-pin');
    pinBtn.innerHTML = fresh.is_always_on_top ? PIN_ICON : PIN_OUTLINE_ICON;
    pinBtn.classList.toggle('active', !!fresh.is_always_on_top);
  });
}

mount();
