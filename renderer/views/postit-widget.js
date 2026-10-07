import { errorToast } from '../shared/ui-utils.js';
import { sanitizeRichHtml, insertChecklistItem, bindChecklistToggle, bindChecklistEnterKey, linkifyUrls } from '../shared/rich-text.js';
import { wrapAutosave } from '../shared/pending-saves.js';
import { attachContextMenu } from '../shared/context-menu.js';
import { STICKY_COLORS } from '../shared/theme.js';

const PIN_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const PIN_OUTLINE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
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
    <div class="note-wrap">
      <div class="note-paper" style="background:${postit.color_hex || '#FBE28A'}">
        <div class="note-bar">
          <div class="note-dots">${STICKY_COLORS.map((c) => `<button class="note-dot ${c === postit.color_hex ? 'on' : ''}" data-color="${c}" style="background:${c}" title="색 바꾸기"></button>`).join('')}</div>
          <div class="note-tools">
            <button class="widget-btn" id="w-checklist" title="체크박스 추가">${CHECKLIST_ICON}</button>
            <button class="widget-btn ${postit.is_always_on_top ? 'active' : ''}" id="w-pin" title="항상 위">${postit.is_always_on_top ? PIN_ICON : PIN_OUTLINE_ICON}</button>
            <button class="widget-btn" id="w-close" title="닫기">${CLOSE_ICON}</button>
          </div>
        </div>
        <div id="w-content" class="widget-textarea note-text" contenteditable="true" data-placeholder="내용을 입력하세요…">${sanitizeRichHtml(postit.content || '')}</div>
        <div class="note-foot" id="w-expiry" hidden></div>
        <div class="note-fold"></div>
        <div class="note-pop" id="w-expiryPop" hidden></div>
      </div>
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

  // 메인 앱과 동일한 우클릭 메뉴(연결·전환·삭제) — 본문 위에서도 열리게 openAnywhere.
  attachContextMenu(document.querySelector('.note-paper'), () => ({ type: 'postit', id }), { openAnywhere: true, onDeleted: () => window.close(), onExpiry: () => openExpiryPop() });

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

  document.getElementById('w-close').addEventListener('click', () => {
    window.close(); // 위젯 창만 닫힘 — 포스트잇 데이터는 그대로 남아있고 메인 화면에서 다시 열 수 있음
  });

  const paper = document.querySelector('.note-paper');
  const setPaperColor = (hex) => {
    paper.style.background = hex || '#FBE28A';
    document.querySelectorAll('.note-dot').forEach((d) => d.classList.toggle('on', d.dataset.color === hex));
  };
  document.querySelectorAll('.note-dot').forEach((d) =>
    d.addEventListener('click', async () => {
      try {
        await window.itda.postits.update({ id, colorHex: d.dataset.color });
        setPaperColor(d.dataset.color);
      } catch (err) {
        errorToast(err, '색을 바꾸지 못했어요');
      }
    })
  );

  // ---------- 만료 시간 ----------
  // 우클릭 "만료 시간"으로 정한 시각까지만 붙어 있다가 위젯 창이 닫힌다(포스트잇 자체는 목록에 남음). 정하지 않으면 계속.
  // 이미 지난 시각으로 열었을 땐(앱을 꺼 둔 사이 만료) 직접 연 것이니 닫지 않고 만료만 풀어 준다.
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
  const parse = (str) => new Date(String(str).replace(' ', 'T'));
  let expiresAt = postit.expires_at || null;
  const footEl = document.getElementById('w-expiry');
  const popEl = document.getElementById('w-expiryPop');

  function paintExpiry() {
    footEl.hidden = !expiresAt;
    if (expiresAt) {
      const d = parse(expiresAt);
      footEl.textContent = `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}까지`;
    }
  }
  async function saveExpiry(value) {
    try {
      await window.itda.postits.setExpiry({ id, expiresAt: value });
      expiresAt = value;
      paintExpiry();
    } catch (err) {
      errorToast(err, '만료 시간을 바꾸지 못했어요');
    }
  }
  if (expiresAt && parse(expiresAt).getTime() <= Date.now()) {
    saveExpiry(null);
  } else {
    paintExpiry();
  }
  setInterval(async () => {
    if (expiresAt && parse(expiresAt).getTime() <= Date.now()) {
      try {
        await window.itda.postits.setExpiry({ id, expiresAt: null }); // 다음에 다시 열 땐 그대로 보이게 해제
      } catch (err) {
        /* 닫기는 계속 */
      }
      window.close();
    }
  }, 15 * 1000);

  function openExpiryPop() {
    const soon = (min) => fmt(new Date(Date.now() + min * 60000));
    const at = (h, plusDays = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + plusDays);
      d.setHours(h, 0, 0, 0);
      return fmt(d);
    };
    const chips = [
      ['1시간 뒤', soon(60)],
      ['오늘 18시', at(18)],
      ['내일 9시', at(9, 1)],
      ['일주일 뒤', soon(7 * 24 * 60)],
    ];
    popEl.innerHTML = `
      <div class="note-pop-title">언제까지 붙여둘까요?</div>
      <div class="note-pop-chips">${chips.map(([l, v]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
      <input type="datetime-local" id="w-expiryInput" value="${expiresAt ? expiresAt.slice(0, 16).replace(' ', 'T') : ''}" />
      <div class="note-pop-actions">
        <button id="w-expiryClear">${expiresAt ? '계속 붙여두기' : '닫기'}</button>
        <button id="w-expiryOk" class="primary">정하기</button>
      </div>`;
    popEl.hidden = false;
    const close = () => (popEl.hidden = true);
    popEl.querySelectorAll('[data-v]').forEach((b) =>
      b.addEventListener('click', async () => {
        await saveExpiry(b.dataset.v);
        close();
      })
    );
    popEl.querySelector('#w-expiryOk').addEventListener('click', async () => {
      const v = popEl.querySelector('#w-expiryInput').value;
      if (!v) return;
      if (parse(v).getTime() <= Date.now()) {
        errorToast(new Error('지금보다 늦은 시각으로 정해주세요.'), '만료 시간');
        return;
      }
      await saveExpiry(v.replace('T', ' ') + ':00');
      close();
    });
    popEl.querySelector('#w-expiryClear').addEventListener('click', async () => {
      if (expiresAt) await saveExpiry(null);
      close();
    });
  }

  // 위젯 창은 항상 "지금 열려있는 창 자체"가 곧 닫을 대상이라 조건 없이 Esc=닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!popEl.hidden) popEl.hidden = true;
      else window.close();
    }
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
    setPaperColor(fresh.color_hex);
    expiresAt = fresh.expires_at || null;
    paintExpiry();
    const pinBtn = document.getElementById('w-pin');
    pinBtn.innerHTML = fresh.is_always_on_top ? PIN_ICON : PIN_OUTLINE_ICON;
    pinBtn.classList.toggle('active', !!fresh.is_always_on_top);
  });
}

mount();
