import { toast, errorToast } from './ui-utils.js';
import { stripHtmlToPlainText } from './rich-text.js';
import { TYPE_ROUTE, TYPE_EMOJI, LINK_TYPE_LABEL } from './links-ui.js';

// 메모/포스트잇 본문(contenteditable)에 Obsidian [[검색]] 스타일의 "@검색형 빠른 연결"을 붙인다.
// "@회의"처럼 입력하면 아래에 후보 팝업이 뜨고, 선택하면:
//   1) "@회의" 텍스트를 지우고 그 자리에 연결 칩(span.item-mention)을 삽입
//   2) links:add IPC로 실제 item_links 행을 만들어 양방향 연결까지 완성
// 팝업 자체는 document.body에 붙여서 좁은 패널 안에서도 잘리지 않게 한다.

const DEBOUNCE_MS = 150;

/**
 * @param {HTMLElement} editableEl - contenteditable="true" 요소 (메모/포스트잇 본문)
 * @param {{type: 'memo'|'postit', id: number}} self - 지금 편집 중인 항목(자기 자신은 후보에서 제외)
 */
export function bindMentionAutocomplete(editableEl, self) {
  let popupEl = null;
  let candidates = [];
  let activeIndex = 0;
  let debounceTimer = null;
  let mentionCtx = null; // { node, at } — 트리거된 "@"의 텍스트 노드/위치

  function closePopup() {
    popupEl?.remove();
    popupEl = null;
    candidates = [];
    mentionCtx = null;
  }

  // 지금 캐럿 기준으로 "@질의" 패턴을 찾는다. 공백이 나오거나 캐럿이 텍스트 노드를 벗어나면 취소.
  function detectMention() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !editableEl.contains(node)) return null;
    const offset = sel.anchorOffset;
    const textBefore = node.textContent.slice(0, offset);
    const at = textBefore.lastIndexOf('@');
    if (at === -1) return null;
    const charBeforeAt = at > 0 ? textBefore[at - 1] : '';
    if (charBeforeAt && !/\s/.test(charBeforeAt)) return null; // "email@x" 같은 건 트리거 안 되게
    const query = textBefore.slice(at + 1);
    if (/\s/.test(query)) return null; // 공백 치면 멘션 포기(그 뒤론 그냥 일반 텍스트)
    return { node, at, offset, query };
  }

  function caretRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    // 빈 줄 등 rect가 안 잡히는 경우, 캐럿 위치에 폭 0 span을 잠깐 끼워서 위치만 잰다
    const span = document.createElement('span');
    span.textContent = '\u200B';
    range.insertNode(span);
    const r = span.getBoundingClientRect();
    span.remove();
    sel.removeAllRanges();
    sel.addRange(range);
    return r;
  }

  function renderPopup() {
    if (!popupEl) {
      popupEl = document.createElement('div');
      popupEl.className = 'mention-popup';
      document.body.appendChild(popupEl);
    }
    popupEl.innerHTML = candidates.length
      ? candidates
          .map(
            (c, i) => `
        <div class="mention-popup-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
          <span class="mention-popup-icon">${TYPE_EMOJI[c.type] || '🔗'}</span>
          <span class="mention-popup-label">${escapeShort(c.label)}</span>
          <span class="mention-popup-type">${LINK_TYPE_LABEL[c.type] || c.type}</span>
        </div>`
          )
          .join('')
      : `<div class="mention-popup-empty">검색 결과가 없어요</div>`;

    const rect = caretRect();
    if (rect) {
      const top = rect.bottom + window.scrollY + 4;
      const left = rect.left + window.scrollX;
      popupEl.style.top = `${top}px`;
      popupEl.style.left = `${left}px`;
      // 화면 아래로 넘치면 캐럿 위쪽에 띄운다
      requestAnimationFrame(() => {
        if (!popupEl) return;
        const popupRect = popupEl.getBoundingClientRect();
        if (popupRect.bottom > window.innerHeight) {
          popupEl.style.top = `${rect.top + window.scrollY - popupRect.height - 4}px`;
        }
      });
    }

    popupEl.querySelectorAll('.mention-popup-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // contenteditable 포커스/캐럿이 mousedown에 날아가는 걸 막음
        selectCandidate(Number(row.dataset.index));
      });
      row.addEventListener('mouseenter', () => {
        activeIndex = Number(row.dataset.index);
        popupEl.querySelectorAll('.mention-popup-item').forEach((r) => r.classList.toggle('active', r === row));
      });
    });
  }

  function escapeShort(text) {
    const div = document.createElement('div');
    div.textContent = stripHtmlToPlainText(text).slice(0, 40) || text.slice(0, 40);
    return div.innerHTML;
  }

  async function runSearch(query) {
    if (!query) {
      candidates = [];
      activeIndex = 0;
      renderPopup();
      return;
    }
    try {
      candidates = await window.itda.links.search({ keyword: query, excludeType: self.type, excludeId: self.id });
    } catch (e) {
      candidates = [];
    }
    activeIndex = 0;
    renderPopup();
  }

  async function selectCandidate(index) {
    const candidate = candidates[index];
    const ctx = mentionCtx; // detectMention()으로 새로 잡지 않고, 팝업 뜬 시점의 위치를 그대로 신뢰(마우스클릭 시 캐럿이 안 움직였을 수도 있어서)
    if (!candidate || !ctx) return;

    // 클릭 시점에 캐럿이 조금 움직였을 수 있으니, 같은 노드 안에서 지금 캐럿 offset을 다시 한번 확인
    const fresh = detectMention();
    const endOffset = fresh && fresh.node === ctx.node ? fresh.offset : ctx.offset;

    const range = document.createRange();
    range.setStart(ctx.node, ctx.at);
    range.setEnd(ctx.node, endOffset);
    range.deleteContents();

    const chip = document.createElement('span');
    chip.className = 'item-mention';
    chip.setAttribute('contenteditable', 'false');
    chip.setAttribute('data-type', candidate.type);
    chip.setAttribute('data-id', String(candidate.id));
    chip.textContent = `${TYPE_EMOJI[candidate.type] || '🔗'} ${stripHtmlToPlainText(candidate.label).slice(0, 40)}`;
    range.insertNode(chip);

    const spaceNode = document.createTextNode('\u00A0');
    chip.after(spaceNode);

    const newRange = document.createRange();
    newRange.setStart(spaceNode, 1);
    newRange.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);

    closePopup();
    editableEl.dispatchEvent(new Event('input', { bubbles: true })); // 기존 scheduleSave 리스너를 그대로 태워서 저장

    try {
      await window.itda.links.add({ aType: self.type, aId: self.id, bType: candidate.type, bId: candidate.id });
      toast('연결했어요');
    } catch (e) {
      errorToast(e, '연결하지 못했어요');
    }
  }

  editableEl.addEventListener('input', () => {
    const mention = detectMention();
    if (!mention) {
      closePopup();
      return;
    }
    mentionCtx = { node: mention.node, at: mention.at };
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(mention.query), DEBOUNCE_MS);
  });

  editableEl.addEventListener('keydown', (e) => {
    if (!popupEl) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (candidates.length) {
        activeIndex = (activeIndex + 1) % candidates.length;
        renderPopup();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (candidates.length) {
        activeIndex = (activeIndex - 1 + candidates.length) % candidates.length;
        renderPopup();
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (candidates.length) {
        e.preventDefault();
        selectCandidate(activeIndex);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopup();
    }
  });

  editableEl.addEventListener('blur', () => {
    // 팝업 안 클릭(mousedown)은 preventDefault로 blur 자체를 막았으므로, 순수하게 포커스가 밖으로 나갈 때만 닫힌다
    setTimeout(closePopup, 0);
  });

  // 저장된 연결 칩을 클릭하면 해당 화면으로 이동(편집 캐럿이 칩 안에 들어가지 않게 막고 라우팅만 수행)
  editableEl.addEventListener('click', (e) => {
    const chip = e.target.closest?.('.item-mention');
    if (!chip || !editableEl.contains(chip)) return;
    e.preventDefault();
    const route = TYPE_ROUTE[chip.getAttribute('data-type')];
    if (route) location.hash = route;
  });
}
