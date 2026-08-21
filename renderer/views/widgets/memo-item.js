/**
 * 메모 낱개 위젯 — 바탕화면에 카드 형태로 띄워서 그 자리에서 바로 편집할 수 있다.
 * renderer/views/postit-widget.js(포스트잇 낱개 위젯)와 동일한 패턴: 프레임 없는 투명 창에
 * widget-card를 그리고, contenteditable 본문을 직접 편집 + 자동저장한다.
 */
import { toast, errorToast, escapeHtml } from '../../shared/ui-utils.js';
import {
  sanitizeRichHtml,
  toggleBold,
  toggleUnderline,
  applyAlign,
  insertChecklistItem,
  bindChecklistToggle,
  bindChecklistEnterKey,
  bindChecklistBackspaceKey,
  linkifyUrls,
} from '../../shared/rich-text.js';
import { STICKY_COLORS } from '../../shared/theme.js';
import { wrapAutosave } from '../../shared/pending-saves.js';

const BOLD_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><path d="M6 4h6a3.5 3.5 0 010 7H6zM6 11h7a3.5 3.5 0 010 7H6z"/></svg>`;
const UNDERLINE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 4v7a6 6 0 0012 0V4"/><path d="M4 20h16"/></svg>`;
const CHECKLIST_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="3" width="7" height="7" rx="1.5"/><path d="M4.5 6.5l1.3 1.3L8.5 5"/><path d="M13 5h8M13 12h8M13 19h8"/><rect x="3" y="13" width="7" height="7" rx="1.5"/></svg>`;
const LOCK_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`;
const LOCK_OPEN_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 017.8-1.3"/></svg>`;
const MINIMIZE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg>`;
const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const FILE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>`;
const PLUS_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg>`;

// 포스트잇과 같은 개인화 팔레트(STICKY_COLORS) 앞에 "기본 디자인"(색을 안 입힌 원래 느낌의
// 중립 배경) 옵션을 하나 더 둔다 — 색을 꼭 골라야 하는 게 아니라 안 고르는 것도 선택지가 되도록.
const DEFAULT_WIDGET_COLOR = '#F5F6F8';
const WIDGET_COLORS = [DEFAULT_WIDGET_COLOR, ...STICKY_COLORS];

const isMac = navigator.platform?.toUpperCase().includes('MAC');
const MOD_LABEL = isMac ? '⌘' : 'Ctrl+';
const MOD_SHIFT_LABEL = isMac ? '⇧⌘' : 'Ctrl+Shift+';

function getIdFromQuery() {
  return Number(new URLSearchParams(location.search).get('id'));
}

function bindWindowControls() {
  document.getElementById('w-minimize')?.addEventListener('click', () => window.itda.widgetControls.minimize());
  document.getElementById('w-close')?.addEventListener('click', () => window.close()); // 창만 닫힘 — 데이터는 그대로
}

// 내용 길이에 맞춰 창을 자동으로 맞춘다(열었을 때/동기화로 다시 그려졌을 때). 사용자가 그
// 뒤에 직접 창 가장자리를 끌어서 수동으로 키우고 줄이는 건 window-manager.js의
// resizable:true가 그대로 살아있어서 항상 가능하다 — 여기서 setBounds를 한 번 호출한다고
// 그 기능이 꺼지는 게 아니다.
function fitToContent(root) {
  requestAnimationFrame(() => {
    const card = root.querySelector('.widget-card');
    const contentEl = root.querySelector('#w-content');
    if (!card || !contentEl) return;
    const cardStyle = getComputedStyle(card);
    const paddingV = parseFloat(cardStyle.paddingTop) + parseFloat(cardStyle.paddingBottom);
    const sumOffsetHeight = (el) => {
      if (!el) return 0;
      const s = getComputedStyle(el);
      return el.offsetHeight + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
    };
    const titlebarH = sumOffsetHeight(card.querySelector('.widget-titlebar'));
    const colorRowH = sumOffsetHeight(card.querySelector('.mi-color-row'));
    const attachH = sumOffsetHeight(card.querySelector('.mi-attach-strip'));
    const textH = contentEl.scrollHeight; // overflow-y:auto라도 scrollHeight는 잘린 부분까지 포함한 전체 높이
    const total = Math.round(paddingV + titlebarH + colorRowH + attachH + textH + 6);
    window.itda.widgetWindow?.fitToContent?.({ height: total }).catch(() => {});
  });
}

async function mount() {
  const root = document.getElementById('widget-root');
  const id = getIdFromQuery();

  if (!id) {
    root.innerHTML = `<div class="widget-error">잘못된 항목이에요</div>`;
    return;
  }

  let memo;
  try {
    memo = await window.itda.memos.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!memo) {
    root.innerHTML = `<div class="widget-error">삭제된 메모예요</div>`;
    return;
  }

  // 잠긴 메모는 위젯에서 비밀번호를 입력받는 UI가 없으므로(메인 화면에만 있음) 편집 화면 대신
  // 안내만 보여주고, 잠금을 풀려면 메인 화면으로 가라고 안내한다.
  if (memo.is_locked) {
    root.innerHTML = `
      <div class="widget-card" style="background:#E8E8EC;">
        <div class="mi-titlebar">
          <span class="mi-titlebar-label">메모</span>
          <div class="mi-titlebar-buttons widget-controls-hover">
            <button class="widget-btn" id="w-minimize" title="최소화">${MINIMIZE_ICON}</button>
            <button class="widget-btn" id="w-close" title="닫기">${CLOSE_ICON}</button>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;font-size:12px;color:rgba(0,0,0,.6);">
          <div>🔒 잠긴 메모예요</div>
          <div id="w-openMain" style="text-decoration:underline;cursor:pointer;-webkit-app-region:no-drag;">메모 화면에서 열기</div>
        </div>
      </div>`;
    bindWindowControls();
    document.getElementById('w-openMain')?.addEventListener('click', () => window.itda.widgets.openMainApp('#/memo'));
    return;
  }

  // 첨부파일 — 사진은 썸네일로, 그 외 파일은 아이콘+파일명 칩으로. 위젯에서 새로 추가/삭제하는
  // 기능은 없다(메인 메모 화면 전용) — 여기는 "보이게"만.
  let attachments = [];
  try {
    attachments = await window.itda.memoAttachments.list(id);
  } catch (e) {
    attachments = [];
  }

  root.innerHTML = `
    <div class="widget-card" style="background:${memo.color_hex || DEFAULT_WIDGET_COLOR}">
      <div class="mi-titlebar">
        <span class="mi-titlebar-label">메모</span>
        <div class="mi-titlebar-buttons widget-controls-hover">
          <button class="widget-btn" id="w-bold" title="굵게 (${MOD_LABEL}B)">${BOLD_ICON}</button>
          <button class="widget-btn" id="w-underline" title="밑줄 (${MOD_LABEL}U)">${UNDERLINE_ICON}</button>
          <button class="widget-btn" id="w-checklist" title="체크박스 추가">${CHECKLIST_ICON}</button>
          <button class="widget-btn" id="w-lock" title="잠금">${LOCK_OPEN_ICON}</button>
          <button class="widget-btn" id="w-newMemo" title="새 메모">${PLUS_ICON}</button>
          <button class="widget-btn" id="w-minimize" title="최소화">${MINIMIZE_ICON}</button>
          <button class="widget-btn" id="w-close" title="닫기">${CLOSE_ICON}</button>
        </div>
      </div>
      <div class="mi-color-row">
        ${WIDGET_COLORS.map(
          (c, i) =>
            `<span class="mi-color-swatch ${i === 0 ? 'mi-color-default' : ''} ${(memo.color_hex || DEFAULT_WIDGET_COLOR) === c ? 'selected' : ''}" data-color="${c}" style="background:${c};" title="${i === 0 ? '기본 디자인' : ''}"></span>`
        ).join('')}
      </div>
      ${
        attachments.length
          ? `<div class="mi-attach-strip" id="mi-attachStrip">
              ${attachments
                .map((a) =>
                  a.mime_type?.startsWith('image/')
                    ? `<div class="mi-attach-chip" data-id="${a.id}" title="${escapeHtml(a.file_name)}"><div class="mi-attach-thumb" id="mi-thumb-${a.id}"></div></div>`
                    : `<div class="mi-attach-chip" data-id="${a.id}" title="${escapeHtml(a.file_name)}"><div class="mi-attach-thumb mi-attach-file">${FILE_ICON}</div></div>`
                )
                .join('')}
            </div>`
          : ''
      }
      <div id="w-content" class="widget-textarea" contenteditable="true" data-placeholder="메모를 입력하세요…">${sanitizeRichHtml(memo.content || '')}</div>
    </div>
    <div class="toast" id="toast"></div>
  `;

  const shell = root.querySelector('.widget-card');
  const contentEl = document.getElementById('w-content');
  linkifyUrls(contentEl); // 불러올 때 한 번만 — 입력 중엔 호출 금지(커서 깨짐)
  fitToContent(root); // 일단 지금 있는 내용 기준으로 한 번 맞추고, 사진 로드되면 아래서 다시 한 번 더

  attachments
    .filter((a) => a.mime_type?.startsWith('image/'))
    .forEach(async (a) => {
      try {
        const dataUrl = await window.itda.memoAttachments.getImageData(a.id);
        const thumbEl = document.getElementById(`mi-thumb-${a.id}`);
        if (dataUrl && thumbEl) thumbEl.innerHTML = `<img src="${dataUrl}" alt="" />`;
        fitToContent(root);
      } catch (e) {
        /* 썸네일 하나 실패해도 나머지 위젯 표시에는 영향 없게 조용히 무시 */
      }
    });

  root.querySelectorAll('.mi-attach-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      try {
        await window.itda.memoAttachments.open(Number(chip.dataset.id));
      } catch (err) {
        errorToast(err, '파일을 열지 못했어요');
      }
    });
  });

  const scheduleSave = wrapAutosave(async () => {
    try {
      const cleanContent = sanitizeRichHtml(contentEl.innerHTML);
      await window.itda.memos.update({ id, content: cleanContent });
    } catch (err) {
      errorToast(err, '저장하지 못했어요');
    }
  });
  contentEl.addEventListener('input', scheduleSave);
  bindChecklistToggle(contentEl, scheduleSave);
  bindChecklistEnterKey(contentEl);
  bindChecklistBackspaceKey(contentEl, scheduleSave);

  // 엑셀/워드처럼 서식 단축키 — 메인 메모 화면(renderer/views/memo.js)과 동일한 조합.
  contentEl.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (!e.shiftKey && key === 'b') {
      e.preventDefault();
      toggleBold(contentEl);
      scheduleSave();
    } else if (!e.shiftKey && key === 'u') {
      e.preventDefault();
      toggleUnderline(contentEl);
      scheduleSave();
    } else if (e.shiftKey && key === 'l') {
      e.preventDefault();
      applyAlign(contentEl, 'left');
      scheduleSave();
    } else if (e.shiftKey && key === 'e') {
      e.preventDefault();
      applyAlign(contentEl, 'center');
      scheduleSave();
    } else if (e.shiftKey && key === 'r') {
      e.preventDefault();
      applyAlign(contentEl, 'right');
      scheduleSave();
    }
  });

  document.getElementById('w-bold').addEventListener('click', () => {
    toggleBold(contentEl);
    scheduleSave();
  });
  document.getElementById('w-underline').addEventListener('click', () => {
    toggleUnderline(contentEl);
    scheduleSave();
  });
  document.getElementById('w-checklist').addEventListener('click', () => {
    insertChecklistItem(contentEl);
    scheduleSave();
  });

  document.getElementById('w-lock').addEventListener('click', async () => {
    try {
      const status = await window.itda.auth.getStatus();
      if (!status.enabled) {
        toast('먼저 설정 > 보안에서 비밀번호를 설정해주세요');
        return;
      }
      await window.itda.memos.toggleLock(id);
      mount(); // 잠금 화면으로 다시 그림 — 위젯에는 잠금 해제용 비밀번호 입력 UI가 없음(메인 화면 전용)
    } catch (err) {
      errorToast(err, '잠금 상태를 변경하지 못했어요');
    }
  });

  // 포스트잇의 "+"(새 포스트잇 만들고 바로 낱개 위젯으로 열기)와 동일한 패턴 — 빠른 메모
  // 위젯(목록 미리보기 + 메인 화면으로 점프하던 방식)을 없앤 대신, 메모 위젯 자체에서
  // 바로 새 메모를 만들어 또 다른 편집 가능한 위젯으로 열 수 있게 한다.
  document.getElementById('w-newMemo').addEventListener('click', async () => {
    try {
      const { id: newId } = await window.itda.memos.add({ content: '' });
      await window.itda.itemWidget.open({ type: 'memo', id: newId });
    } catch (err) {
      errorToast(err, '새 메모를 만들지 못했어요');
    }
  });

  root.querySelectorAll('.mi-color-swatch').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const colorHex = sw.dataset.color;
      try {
        await window.itda.memos.update({ id, colorHex });
        shell.style.background = colorHex;
        root.querySelectorAll('.mi-color-swatch').forEach((s) => s.classList.toggle('selected', s === sw));
      } catch (err) {
        errorToast(err, '색상을 바꾸지 못했어요');
      }
    });
  });

  bindWindowControls();
}

mount();

// 위젯 창은 항상 "지금 열려있는 창 자체"가 곧 닫을 대상이라 조건 없이 Esc=닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

// 메인 창(또는 다른 위젯)에서 이 메모가 바뀌면 위젯도 반영한다. 지금 이 위젯 안에서 타이핑
// 중이면(방금 자기 자신이 저장해서 온 브로드캐스트일 수도 있음) 건드리지 않는다 — 안 그러면
// 커서가 끊기거나 입력 중인 글자가 덮어써질 수 있다.
window.itda.onDataChanged(({ entity, id: changedId }) => {
  if (entity !== 'memo' || changedId !== getIdFromQuery()) return;
  if (document.activeElement?.id === 'w-content') return;
  mount();
});
