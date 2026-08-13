/**
 * 메모/포스트잇에 "볼드체, 글씨크기, 체크박스" 정도의 제한적인 서식만 허용하기 위한 sanitizer.
 * 절대 원칙: 허용 목록(whitelist) 방식만 쓴다 — 위험한 태그를 나열해서 막는 게 아니라,
 * 허용된 몇 개 태그·속성 외에는 전부 벗겨내거나 삭제한다.
 *
 * 허용 태그: b, strong, i, em, u, span(font-size만 / item-mention 칩), div, p, br,
 *           input(type=checkbox만, 체크리스트 전용 — contenteditable=false로 고정해서 텍스트 편집과 분리)
 * 허용 속성: span의 style 중 font-size 하나만 (10~28px 범위로 클램프), input의 type/checked만,
 *           span.item-mention의 data-type/data-id(연결된 항목 칩 — @검색으로 삽입, contenteditable=false로 고정)
 * 그 외 모든 태그/속성/이벤트핸들러/href/src 등은 제거된다.
 * a(링크)는 저장 시 항상 벗겨진다 — 하이퍼링크는 저장 데이터가 아니라 "열 때마다" linkifyUrls()로
 * 화면에만 입히는 방식이라(아래 설명 참고), href를 그대로 신뢰해서 저장할 필요가 없다.
 */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'DIV', 'P', 'BR']);
// script/style/iframe 등은 "태그만 벗기기"가 아니라 내용까지 통째로 삭제한다
// (벗기면 스크립트 원문이 그냥 텍스트로 노출되어 지저분해짐)
const REMOVE_ENTIRELY_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'IMG']);
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 28;
const MENTION_LINK_TYPES = new Set(['todo', 'event', 'memo', 'postit']);

function sanitizeElement(el) {
  const children = Array.from(el.childNodes);
  for (const child of children) {
    if (child.nodeType === 3 /* TEXT_NODE */) continue;
    if (child.nodeType !== 1 /* ELEMENT_NODE */) {
      el.removeChild(child);
      continue;
    }
    if (REMOVE_ENTIRELY_TAGS.has(child.tagName)) {
      el.removeChild(child);
      continue;
    }

    // 체크박스(input[type=checkbox])는 텍스트 서식 태그가 아니라 별도 규칙으로 취급.
    // type/checked 두 속성만 허용하고, contenteditable=false를 강제로 다시 걸어서
    // (사용자가 개발자도구 등으로 지웠더라도) 항상 "클릭하면 토글, 텍스트 편집 대상 아님" 상태를 보장한다.
    if (child.tagName === 'INPUT') {
      const isCheckbox = child.getAttribute('type') === 'checkbox';
      if (!isCheckbox) {
        el.removeChild(child);
        continue;
      }
      const checked = child.hasAttribute('checked');
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      child.setAttribute('type', 'checkbox');
      child.setAttribute('contenteditable', 'false');
      if (checked) child.setAttribute('checked', '');
      continue; // input은 자식 노드가 없으므로 재귀 불필요
    }

    if (!ALLOWED_TAGS.has(child.tagName)) {
      // 허용 안 된 태그(a, table, font 등)는 태그만 벗기고 내용(텍스트/허용된 자식)은 살린다
      while (child.firstChild) el.insertBefore(child.firstChild, child);
      el.removeChild(child);
      continue;
    }

    // "@검색" 연결 칩(span.item-mention) — data-type/data-id가 유효할 때만 속성을 보존하고,
    // 체크박스와 마찬가지로 "원자적" 요소라 자식(텍스트)까지 재귀검사하지 않고 그대로 둔다.
    // data-type이 유효하지 않으면(오염된 데이터) 칩 취급을 포기하고 태그만 벗겨 텍스트만 남긴다.
    if (child.tagName === 'SPAN' && child.classList.contains('item-mention')) {
      const mentionType = child.getAttribute('data-type');
      const mentionId = child.getAttribute('data-id');
      const valid = MENTION_LINK_TYPES.has(mentionType) && /^\d+$/.test(mentionId || '');
      if (!valid) {
        while (child.firstChild) el.insertBefore(child.firstChild, child);
        el.removeChild(child);
        continue;
      }
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      child.classList.add('item-mention');
      child.setAttribute('contenteditable', 'false');
      child.setAttribute('data-type', mentionType);
      child.setAttribute('data-id', mentionId);
      continue;
    }

    // 여기 도달했으면 허용된 태그 — 속성은 전부 지우고, span의 font-size /
    // 체크리스트 줄(div.mc-item) · 체크리스트 텍스트칸(span.mc-text)의 클래스만 검증 후 재부여
    const fontSize = child.tagName === 'SPAN' ? child.style.fontSize : '';
    const isChecklistLine = child.tagName === 'DIV' && child.classList.contains('mc-item');
    const isChecklistText = child.tagName === 'SPAN' && child.classList.contains('mc-text');
    Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
    if (child.tagName === 'SPAN' && fontSize) {
      const px = Math.round(parseFloat(fontSize));
      if (!Number.isNaN(px)) {
        const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, px));
        child.style.fontSize = `${clamped}px`;
      }
    }
    if (isChecklistLine) child.classList.add('mc-item');
    // 체크리스트 줄의 텍스트칸은 flexbox에서 flex:1로 늘어나야 체크박스 옆에서 자연스럽게
    // 줄바꿈되므로(순수 텍스트 노드는 CSS로 flex:1을 줄 수 없어 이 span이 꼭 필요함) 클래스를 보존한다
    if (isChecklistText) child.classList.add('mc-text');

    sanitizeElement(child); // 재귀적으로 자식도 동일하게 검사
  }
}

/** 저장하기 전에 항상 이걸 거친다. 신뢰할 수 없는 HTML(붙여넣기 등)이 들어와도 안전한 결과만 남는다. */
export function sanitizeRichHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html || '';
  sanitizeElement(container);
  return container.innerHTML;
}

/** 목록 미리보기/제목 유도용 — HTML을 순수 텍스트로. 블록 경계(div/p/br)는 줄바꿈으로 보존한다. */
export function stripHtmlToPlainText(html) {
  const container = document.createElement('div');
  container.innerHTML = html || '';
  // script/style 등은 실행되진 않지만(textContent라 안전), 미리보기에 원본 코드가 그대로
  // 노출되면 지저분하니 sanitizeRichHtml과 동일하게 먼저 걷어낸다
  REMOVE_ENTIRELY_TAGS.forEach((tag) => {
    container.querySelectorAll(tag.toLowerCase()).forEach((el) => el.remove());
  });
  // 체크박스는 textContent에 아무것도 안 남기므로, 미리보기에서 체크 상태가 사라지지 않도록
  // ☑/☐ 표시를 텍스트로 먼저 심어준다.
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.insertAdjacentText('afterend', cb.hasAttribute('checked') ? '☑ ' : '☐ ');
  });
  container.querySelectorAll('div, p, br').forEach((el) => {
    el.insertAdjacentText('beforebegin', '\n');
  });
  return (container.textContent || '').replace(/\n{2,}/g, '\n').trim();
}

/**
 * contenteditable 요소에 볼드/글씨크기를 적용하는 헬퍼.
 * document.execCommand는 deprecated 표시가 붙어있지만 Electron(Chromium)에서 여전히
 * 안정적으로 동작하고, 이 정도의 제한적 서식에는 직접 Range를 다루는 것보다 훨씬 안전하다
 * (선택 영역이 여러 엘리먼트에 걸쳐 있어도 깨지지 않음).
 */
export function toggleBold(editableEl) {
  if (typeof document.execCommand !== 'function') return; // jsdom 등 execCommand 미지원 환경 방어
  editableEl.focus();
  document.execCommand('bold');
}

export function applyFontSize(editableEl, px) {
  if (typeof document.execCommand !== 'function') return;
  editableEl.focus();
  // execCommand의 fontSize는 1~7 스케일만 받지만, 일단 표시(size="7")로 걸어놓은 뒤
  // 그 결과로 생긴 <font size="7"> 태그들을 원하는 px의 <span>으로 바로 바꿔치기한다.
  document.execCommand('fontSize', false, '7');
  editableEl.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
}

/**
 * 커서 위치에 체크리스트 한 줄을 삽입한다. 체크박스는 contenteditable=false라서
 * 클릭하면 텍스트 편집 없이 바로 체크만 토글된다.
 *
 * execCommand('insertHTML', ...)로 통째로 문자열을 넣던 예전 방식은 삽입 직후 캐럿이
 * 어디에 놓이는지가 브라우저마다/삽입 위치마다 불안정해서, "체크박스를 만들고 바로 타이핑하면
 * 글자가 체크박스보다 앞에 써지고 체크박스가 뒤로 밀리는" 문제가 있었다. 그래서 DOM 노드를
 * 직접 만들고 Range/Selection API로 캐럿 위치를 명시적으로 지정하는 방식으로 바꿨다.
 * 텍스트가 들어갈 자리를 별도 <span class="mc-text">로 감싸는 이유는, flexbox에서
 * flex:1을 줄 수 있는 대상이 element뿐이라서다(순수 텍스트 노드는 flex:1을 못 받아서
 * 체크박스 옆에서 자연스럽게 줄바꿈되지 않고 좁은 칸에 눌린 것처럼 보이는 문제가 있었음).
 */
export function insertChecklistItem(editableEl) {
  editableEl.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const line = document.createElement('div');
  line.className = 'mc-item';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('contenteditable', 'false');
  const textSpan = document.createElement('span');
  textSpan.className = 'mc-text';
  const caretAnchor = document.createTextNode('\u200B'); // 캐럿이 실제로 앉을 자리(폭 0 문자, 화면엔 안 보임)
  textSpan.appendChild(caretAnchor);
  line.appendChild(checkbox);
  line.appendChild(textSpan);

  range.insertNode(line);

  const newRange = document.createRange();
  newRange.setStart(caretAnchor, 1); // 폭 0 문자 바로 뒤 — 여기서부터 타이핑하면 span 안에 이어서 써짐
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/**
 * 체크박스 클릭으로 토글됐을 때 줄 전체에 완료 스타일(취소선 등)을 입히기 위한 클래스 동기화.
 * 이벤트 위임으로 한 번만 등록해두면, 나중에 삽입되는 체크박스에도 그대로 적용된다(change는 버블링됨).
 * @param {HTMLElement} editableEl
 * @param {() => void} [onToggle] - 토글 후 저장 등 후속 처리가 필요하면 전달
 */
export function bindChecklistToggle(editableEl, onToggle) {
  editableEl.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || !editableEl.contains(cb)) return;
    const line = cb.closest('.mc-item');
    line?.classList.toggle('mc-item-done', cb.checked);
    onToggle?.();
  });
}

/**
 * 체크리스트 줄 안에서 Enter를 눌렀을 때, 브라우저 기본 동작에 맡기지 않고 직접 처리한다.
 * 이유: .mc-item은 안에 contenteditable=false인 input(체크박스)이 들어있는 "원자적" 요소라서,
 * 브라우저가 Enter를 처리할 때(블록을 둘로 쪼개는 기본 동작) 이 비편집 섬 때문에 줄바꿈 자체가
 * 아예 안 먹거나 체크박스가 이상한 자리로 옮겨가는 문제가 있었다. 그래서 Enter를 가로채서
 * 직접 다음 줄(내용이 있으면 새 체크리스트 줄, 비어있으면 목록에서 빠져나와 일반 줄)을 만든다.
 *
 * @param {HTMLElement} editableEl
 */
export function bindChecklistEnterKey(editableEl) {
  editableEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchorEl = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
    const line = anchorEl?.closest?.('.mc-item');
    if (!line || !editableEl.contains(line)) return; // 체크리스트 줄이 아니면 브라우저 기본 동작 그대로

    e.preventDefault();
    const textSpan = line.querySelector('.mc-text');
    const isEmpty = !textSpan || textSpan.textContent.replace(/\u200B/g, '').trim() === '';

    if (isEmpty) {
      // 빈 체크리스트 줄에서 Enter → 목록에서 빠져나와 평범한 빈 줄로 바꾼다(대부분의 노트 앱과 동일한 동작)
      const p = document.createElement('div');
      p.appendChild(document.createElement('br'));
      line.replaceWith(p);
      const r = document.createRange();
      r.setStart(p, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }

    // 내용이 있으면 바로 아래에 새 체크리스트 줄을 이어서 만든다
    const newLine = document.createElement('div');
    newLine.className = 'mc-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('contenteditable', 'false');
    const newTextSpan = document.createElement('span');
    newTextSpan.className = 'mc-text';
    const caretAnchor = document.createTextNode('\u200B');
    newTextSpan.appendChild(caretAnchor);
    newLine.appendChild(checkbox);
    newLine.appendChild(newTextSpan);
    line.after(newLine);

    const r = document.createRange();
    r.setStart(caretAnchor, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

// http(s):// 또는 www.으로 시작하는 URL, 그리고 윈도우 파일 경로(드라이브 문자 C:\... 또는
// 네트워크 공유 \\서버\공유\...)를 찾는 패턴. 병원 PC가 전부 윈도우라 이 두 형태만 잡으면 충분하다.
// 문장 끝 구두점(.,)이나 닫는 괄호가 URL/경로에 딸려 들어가 링크가 깨지는 걸 막기 위해
// 끝에서 흔한 구두점은 링크에서 제외한다.
const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Za-z]:\\[^\s<]+|\\\\[^\s<]+)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;

/**
 * 저장된 텍스트 안의 URL을 클릭 가능한 링크로 "화면에만" 바꿔준다 — 저장 데이터 자체는 항상
 * 순수 텍스트로 유지되고(sanitizeRichHtml이 <a>를 허용하지 않음), 메모를 열 때마다 이 함수가
 * 다시 스캔해서 그때그때 링크를 입힌다. 그래서 href를 영구 저장/신뢰할 필요가 없어 안전하다.
 * 편집 중(입력할 때마다)이 아니라 "불러왔을 때 한 번"만 호출해야 한다 — 매 입력마다 돌리면
 * contenteditable 커서 위치가 계속 깨진다.
 */
export function linkifyUrls(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  textNodes.forEach((node) => {
    const text = node.nodeValue;
    if (!URL_PATTERN.test(text)) return;
    URL_PATTERN.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = URL_PATTERN.exec(text))) {
      const raw = match[0];
      const trailingMatch = raw.match(TRAILING_PUNCTUATION);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const url = trailing ? raw.slice(0, -trailing.length) : raw;
      if (!url) continue;

      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const a = document.createElement('a');
      a.href = url.startsWith('www.') ? `https://${url}` : url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('contenteditable', 'false');
      frag.appendChild(a);
      if (trailing) frag.appendChild(document.createTextNode(trailing));

      lastIndex = match.index + raw.length;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.parentNode.replaceChild(frag, node);
  });
}
