/**
 * 메모/포스트잇에 "볼드체, 글씨크기, 체크박스" 정도의 제한적인 서식만 허용하기 위한 sanitizer.
 * 절대 원칙: 허용 목록(whitelist) 방식만 쓴다 — 위험한 태그를 나열해서 막는 게 아니라,
 * 허용된 몇 개 태그·속성 외에는 전부 벗겨내거나 삭제한다.
 *
 * 허용 태그: a(href가 http(s):로 시작할 때만, 링크 삽입 버튼으로 명시적으로 넣은 것만 — 아래 설명 참고),
 *           b, strong, i, em, u, span(font-size/color만 / item-mention 칩), div/p(text-align만), br,
 *           input(type=checkbox만, 체크리스트 전용 — contenteditable=false로 고정해서 텍스트 편집과 분리),
 *           img(data-attachment-id가 유효한 숫자일 때만 — 첨부파일을 참조하는 인라인 사진, 아래 설명 참고)
 * 허용 속성: a의 href(http/https만) + target/rel/contenteditable은 항상 강제로 다시 부여,
 *           span의 style 중 font-size(10~28px 범위로 클램프)와 color(#RRGGBB 형식만) 둘만,
 *           div/p의 style 중 text-align(left/center/right/justify만),
 *           input의 type/checked만,
 *           img의 data-attachment-id(숫자만)와 style 중 width(60~600px로 클램프)만 — src는 항상 제거,
 *           span.item-mention의 data-type/data-id(연결된 항목 칩 — @검색으로 삽입, contenteditable=false로 고정)
 * 그 외 모든 태그/속성/이벤트핸들러/src 등은 제거된다.
 * a(링크)는 두 가지 경로로만 생긴다: (1) 링크 삽입 버튼(insertLink)으로 직접 넣은 것 — href를
 * 검증한 뒤 그대로 저장한다. (2) 본문에 타이핑/붙여넣기된 URL 문자열 — 이건 저장 시 순수
 * 텍스트로만 남고, 열 때마다 linkifyUrls()가 화면에만 클릭 가능한 링크를 입힌다(href를 저장/신뢰할
 * 필요 없음). 붙여넣기 등으로 들어온 <a>는 href가 안전한 http(s) 형식일 때만 살아남고, 아니면
 * 태그만 벗겨져 텍스트만 남는다(javascript: 등 위험한 href 방지).
 */

const ALLOWED_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'DIV', 'P', 'BR']);
// script/style/iframe 등은 "태그만 벗기기"가 아니라 내용까지 통째로 삭제한다
// (벗기면 스크립트 원문이 그냥 텍스트로 노출되어 지저분해짐)
const REMOVE_ENTIRELY_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG']);
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 28;
const MIN_IMG_WIDTH = 60;
const MAX_IMG_WIDTH = 600;
const SAFE_HEX_COLOR = /^#[0-9a-f]{6}$/i; // style에 CSS 인젝션(expression/url 등) 못 들어오게 이 형식만 허용
const SAFE_HREF = /^https?:\/\//i; // javascript:/data: 등 위험한 스킴 차단
const SAFE_TEXT_ALIGN = new Set(['left', 'center', 'right', 'justify']);
const MENTION_LINK_TYPES = new Set(['todo', 'event', 'memo', 'postit']);

// 브라우저는 style.color에 뭘 넣든(hex, named color 등) "rgb(r, g, b)"로 정규화해서 돌려준다 —
// 그래서 SAFE_HEX_COLOR로 바로 검증할 수 있게 다시 hex로 바꿔준다. rgb(...) 형식이 아니면(이미
// 깨진 값이거나 rgba 등) null을 돌려줘서 통째로 버려지게 한다.
function rgbStringToHex(rgbStr) {
  const m = rgbStr.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return null;
  const toHex = (n) => Math.min(255, Math.max(0, Number(n))).toString(16).padStart(2, '0');
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

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

    // 인라인 사진(img) — 첨부파일을 그대로 참조하는 "원자적" 요소. ALLOWED_TAGS 기반 일반 검사보다
    // 먼저 처리해야 한다(IMG는 ALLOWED_TAGS에 없어서, 순서가 바뀌면 아래 "허용 안 된 태그" 분기에
    // 걸려 태그만 벗겨지고 통째로 사라진다 — 처음 이 순서로 잘못 둬서 저장 후 사진이 사라지는
    // 버그가 있었다). src는 절대 저장하지 않는다(붙여넣기/드래그로 들어온 원본 data: URL을 그대로
    // 저장하면 DB가 급격히 불어나고, 파일이 이미 memo_attachments에 실물로 있으니 중복 저장일
    // 뿐이다) — data-attachment-id로만 참조해두면 불러올 때 렌더러가 memoAttachments:getImageData로
    // 다시 채워 넣는다(첨부 썸네일과 동일한 방식). style은 리사이즈 결과인 width(60~600px)만 허용.
    if (child.tagName === 'IMG') {
      const attachmentId = child.getAttribute('data-attachment-id');
      if (!/^\d+$/.test(attachmentId || '')) {
        el.removeChild(child); // 유효하지 않으면(오염된 데이터, 외부 img 붙여넣기 등) 통째로 버림 — 대체할 텍스트가 없음
        continue;
      }
      const width = child.style.width;
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      child.className = 'memo-inline-img';
      child.setAttribute('data-attachment-id', attachmentId);
      child.setAttribute('contenteditable', 'false');
      // img는 contenteditable 안에서 기본적으로 draggable="true"라, 리사이즈하려고 모서리를
      // 누르는 손짓이 브라우저의 네이티브 "이미지 드래그"로 오인돼서 이미지가 원래 자리에서
      // 붕 뜬 채 사라지는 문제가 있었다 — 꺼서 우리 커스텀 리사이즈 로직만 반응하게 한다.
      child.setAttribute('draggable', 'false');
      const pxMatch = width && width.match(/^(\d+(?:\.\d+)?)px$/);
      const px = pxMatch ? Math.round(parseFloat(pxMatch[1])) : 260;
      child.style.width = `${Math.min(MAX_IMG_WIDTH, Math.max(MIN_IMG_WIDTH, px))}px`;
      continue; // img는 자식이 없는 원자적 요소라 재귀 불필요
    }

    if (!ALLOWED_TAGS.has(child.tagName)) {
      // 허용 안 된 태그(a, table, font 등)는 태그만 벗기고 내용(텍스트/허용된 자식)은 살린다
      while (child.firstChild) el.insertBefore(child.firstChild, child);
      el.removeChild(child);
      continue;
    }

    // 링크(a) — href가 안전한 http(s) 형식일 때만 살아남는다(체크박스/멘션 칩과 마찬가지로
    // 원자적 요소라 자식까지 재귀검사하지 않는다). target/rel/contenteditable은 항상 강제로
    // 다시 부여해서, 개발자도구 등으로 지웠거나 붙여넣기로 이상한 값이 들어와도 클릭 시
    // 항상 새 창(외부 브라우저)으로 열리고 텍스트 편집 대상이 아니게 보장한다.
    if (child.tagName === 'A') {
      const href = child.getAttribute('href') || '';
      if (!SAFE_HREF.test(href)) {
        while (child.firstChild) el.insertBefore(child.firstChild, child);
        el.removeChild(child);
        continue;
      }
      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      child.setAttribute('href', href);
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
      child.setAttribute('contenteditable', 'false');
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

    // 여기 도달했으면 허용된 태그 — 속성은 전부 지우고, span의 font-size/color /
    // 체크리스트 줄(div.mc-item) · 체크리스트 텍스트칸(span.mc-text)의 클래스만 검증 후 재부여
    const fontSize = child.tagName === 'SPAN' ? child.style.fontSize : '';
    const color = child.tagName === 'SPAN' ? child.style.color : '';
    const textAlign = child.tagName === 'DIV' || child.tagName === 'P' ? child.style.textAlign : '';
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
    if (child.tagName === 'SPAN' && color) {
      // 브라우저가 style.color를 항상 rgb(r, g, b)로 정규화해서 돌려주므로 hex로 바꿔서 검증한다
      const hex = rgbStringToHex(color);
      if (hex && SAFE_HEX_COLOR.test(hex)) child.style.color = hex;
    }
    if (textAlign && SAFE_TEXT_ALIGN.has(textAlign)) child.style.textAlign = textAlign;
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
  // 인라인 사진도 체크박스와 같은 이유로 미리보기에 흔적을 남긴다(사진만 있는 메모가 빈 줄로 보이지 않게)
  container.querySelectorAll('img').forEach((img) => {
    img.insertAdjacentText('afterend', '📷 ');
  });
  container.querySelectorAll('div, p, br').forEach((el) => {
    el.insertAdjacentText('beforebegin', '\n');
  });
  return (container.textContent || '').replace(/\n{2,}/g, '\n').trim();
}

/** stripHtmlToPlainText의 반대 방향 — 순수 텍스트를 메모/포스트잇 content(HTML)로 저장할 때 줄바꿈을 <br>로 보존한다. */
export function plainTextToHtml(text) {
  const div = document.createElement('div');
  (text || '').split('\n').forEach((line, i) => {
    if (i > 0) div.appendChild(document.createElement('br'));
    div.appendChild(document.createTextNode(line));
  });
  return div.innerHTML;
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

export function toggleUnderline(editableEl) {
  if (typeof document.execCommand !== 'function') return;
  editableEl.focus();
  document.execCommand('underline');
}

const ALIGN_COMMANDS = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
export function applyAlign(editableEl, align) {
  if (typeof document.execCommand !== 'function') return;
  const cmd = ALIGN_COMMANDS[align];
  if (!cmd) return;
  editableEl.focus();
  document.execCommand(cmd);
}

/**
 * 커서/선택 영역에 링크를 삽입한다. 텍스트를 선택한 채로 호출하면 그 텍스트가 링크의
 * 표시 문구가 되고, 선택 없이 호출하면 URL 자체를 문구로 쓴다. 링크는 체크박스/멘션 칩과
 * 같은 "원자적" 요소(contenteditable=false)라 삽입 뒤 폭 0 문자를 하나 더 심어서
 * 캐럿이 링크 바로 뒤에서 이어 타이핑할 자리를 만들어준다.
 */
export function insertLink(editableEl, url) {
  editableEl.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const displayText = range.toString() || url;
  range.deleteContents();

  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute('contenteditable', 'false');
  a.textContent = displayText;
  range.insertNode(a);

  const caretAnchor = document.createTextNode('\u200B');
  a.after(caretAnchor);
  const newRange = document.createRange();
  newRange.setStart(caretAnchor, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
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
 * contenteditable 요소에 글자색을 적용하는 헬퍼. applyFontSize와 완전히 동일한 트릭—
 * execCommand('foreColor')가 만드는 <font color> 태그를 원하는 색의 <span>으로 바꿔치기한다
 * (sanitizeRichHtml이 font 태그 자체는 허용하지 않으므로, 저장 전에 span으로 미리 바꿔야 한다).
 */
export function applyTextColor(editableEl, hex) {
  if (typeof document.execCommand !== 'function') return;
  editableEl.focus();
  document.execCommand('foreColor', false, hex);
  editableEl.querySelectorAll('font[color]').forEach((f) => {
    const span = document.createElement('span');
    span.style.color = hex;
    span.innerHTML = f.innerHTML;
    f.replaceWith(span);
  });
}

/**
 * 커서/선택이 속한 "줄"(블록) 전체를 체크리스트 줄로 바꾼다. 체크박스는 contenteditable=false라서
 * 클릭하면 텍스트 편집 없이 바로 체크만 토글된다.
 *
 * 예전엔 range.deleteContents()로 커서/선택 위치의 내용을 지우고 그 자리에 빈 체크박스를
 * 끼워넣었는데, 그러면 (1) 텍스트를 드래그해서 선택한 채로 누르면 그 텍스트가 통째로
 * 사라지고, (2) 문장 중간에 커서만 두고 눌러도 그 지점에서 문장이 반으로 쪼개지는 문제가
 * 있었다(애플 메모장은 항상 줄 전체 앞에 체크박스가 붙지 커서 위치에서 쪼개지지 않음).
 * 그래서 커서/선택이 어디에 있든 "그 줄 전체"를 찾아서(div/p 블록, 아직 줄바꿈이 없는
 * 첫 줄이면 지금까지 입력된 내용 전체) 원래 서식(굵게/색 등)까지 그대로 유지한 채
 * mc-text로 옮기고 체크박스만 맨 앞에 붙인다 — 텍스트는 절대 지워지지 않는다.
 */
export function insertChecklistItem(editableEl) {
  editableEl.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchorNode = sel.anchorNode;
  const startEl = anchorNode && anchorNode.nodeType === 1 ? anchorNode : anchorNode && anchorNode.parentElement;
  if (!startEl || !editableEl.contains(startEl)) return;

  let lineEl = startEl.closest('div, p');
  if (!lineEl || lineEl === editableEl) {
    // 아직 줄바꿈으로 나뉜 블록이 없는 첫 줄 — 지금까지 입력된 내용 전체를 한 줄로 감싼다.
    lineEl = document.createElement('div');
    while (editableEl.firstChild) lineEl.appendChild(editableEl.firstChild);
    editableEl.appendChild(lineEl);
  }
  if (lineEl.classList.contains('mc-item')) return; // 이미 체크리스트 줄이면 중복 적용 안 함

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.setAttribute('contenteditable', 'false');
  const textSpan = document.createElement('span');
  textSpan.className = 'mc-text';
  while (lineEl.firstChild) textSpan.appendChild(lineEl.firstChild); // 서식(굵게/색 등) 그대로 유지한 채 옮김

  if (textSpan.textContent.replace(/\u200B/g, '').trim() === '') {
    // 원래 빈 줄이었으면(<br>만 있었거나 완전히 빈 줄) 캐럿이 앉을 자리만 남긴다
    textSpan.innerHTML = '';
    textSpan.appendChild(document.createTextNode('\u200B'));
  }

  lineEl.classList.add('mc-item');
  lineEl.appendChild(checkbox);
  lineEl.appendChild(textSpan);

  const newRange = document.createRange();
  newRange.selectNodeContents(textSpan);
  newRange.collapse(false); // 캐럿은 옮겨진 텍스트 맨 끝에 — 바로 이어서 타이핑 가능
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

// 커서가 체크리스트 텍스트칸(mc-text)의 맨 앞(실제 글자가 하나도 없는 위치)에 있는지 검사한다.
// 폭 0 문자(\u200B)는 화면에 안 보이는 캐럿 자리표시일 뿐이라 "글자"로 치지 않는다.
function isCaretAtTextSpanStart(range, textSpan) {
  const preRange = document.createRange();
  preRange.selectNodeContents(textSpan);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().replace(/\u200B/g, '').length === 0;
}

/**
 * 체크리스트 줄의 맨 앞에서 Backspace를 누르면(애플 메모장처럼) 한 번에 체크박스만 떼고
 * 텍스트는 그대로 살아있는 일반 줄로 되돌린다. 원래는 체크박스가 contenteditable=false
 * "원자적" 섬이라 브라우저 기본 삭제 동작이 애매하게 걸려서 두 번 눌러야 했다.
 * @param {HTMLElement} editableEl
 * @param {() => void} [onChange] - DOM을 직접 조작하는 처리라 브라우저의 기본 input 이벤트가
 *   안 뜬다 — 저장이 필요하면 호출부에서 scheduleSave 등을 넘겨야 한다.
 */
export function bindChecklistBackspaceKey(editableEl, onChange) {
  editableEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const textSpan = startEl?.closest?.('.mc-text');
    if (!textSpan || !editableEl.contains(textSpan)) return;
    if (!isCaretAtTextSpanStart(range, textSpan)) return;

    e.preventDefault();
    const line = textSpan.closest('.mc-item');
    if (!line) return;

    line.querySelector('input[type="checkbox"]')?.remove();
    line.classList.remove('mc-item', 'mc-item-done');
    while (textSpan.firstChild) line.insertBefore(textSpan.firstChild, textSpan);
    textSpan.remove();

    const r = document.createRange();
    r.selectNodeContents(line);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    onChange?.();
  });
}

// http(s):// 또는 www.으로 시작하는 URL, 그리고 윈도우 파일 경로(드라이브 문자 C:\... · C:/... ,
// 네트워크 공유 \\서버\공유\...)를 찾는 패턴. 병원 PC가 전부 윈도우라 이 형태만 잡으면 충분하다.
//
// 경로 안의 공백: "C:\Users\User\OneDrive\바탕 화면\..." 처럼 윈도우 경로엔 공백이 흔하다.
// 그래서 경로 부분은 " (?=\S)" — "뒤에 공백 아닌 글자가 오는 공백" 하나까지는 경로에 포함한다.
// (연속 공백·줄바꿈·문장 끝 공백에서는 자연스럽게 끊긴다.)
//
// 파일 경로는 "확장자까지 있으면(\.txt 등) 확장자 뒤 \b에서 바로 멈추는" 패턴을 먼저 시도한다.
// 한국어는 "파일.txt를 확인해주세요"처럼 조사가 공백 없이 바로 붙는 경우가 흔한데, 확장자
// 알파벳/숫자와 그 뒤 한글 사이엔 자동으로 단어 경계(\b)가 생겨서(\w에 한글이 안 들어감)
// "파일.txt"까지만 잡히고 "를"은 안 딸려온다.
//
// 확장자가 없는 폴더 경로는 공백 규칙대로 통째로 잡는 것으로 폴백.
// ponytail: 확장자 없는 폴더 경로 뒤에 같은 줄로 문장이 이어지면(구두점 없이) 문장 일부가
// 링크에 딸려올 수 있음 — 실제로는 경로를 줄 끝/줄 단독으로 두는 게 보통이라 감안한 한계.
// 줄바꿈을 넣으면 정확히 끊긴다.
//
// 문장 끝 구두점(.,)이나 닫는 괄호가 URL/경로에 딸려 들어가 링크가 깨지는 걸 막기 위해
// 끝에서 흔한 구두점은 링크에서 제외한다(단, (x86)·(OT)처럼 경로에 균형 잡힌 괄호는 linkifyUrls에서 되살림).
const PATH_BODY = '(?:[^\\s<]| (?=\\S))'; // 경로 한 글자: 공백 아닌 글자, 또는 "뒤에 글자가 오는 공백"
const URL_PATTERN = new RegExp(
  [
    'https?:\\/\\/[^\\s<]+',
    'www\\.[^\\s<]+',
    'file:\\/\\/[^\\s<]+',
    `[A-Za-z]:[\\\\/]${PATH_BODY}*?\\.[A-Za-z0-9]{1,6}\\b`, // C:\...\파일.확장자 (조사 앞에서 멈춤)
    `[A-Za-z]:[\\\\/]${PATH_BODY}*`, // C:\...\폴더
    `\\\\\\\\${PATH_BODY}*?\\.[A-Za-z0-9]{1,6}\\b`, // \\서버\공유\파일.확장자
    `\\\\\\\\${PATH_BODY}*`, // \\서버\공유폴더
  ].map((p) => `(?:${p})`).join('|'),
  'gi'
);
const TRAILING_PUNCTUATION = /[.,!?;:)\]]+$/;
// 로컬 경로(윈도우 드라이브 C:\ · C:/, 네트워크 공유 \\서버\..., file:// URL)인지.
// 이런 건 브라우저가 a.href에 넣으면 스킴 소문자화·퍼센트인코딩(한글 폴더명!)·punycode로 망가뜨려서
// shell.openPath가 실패한다 — href 대신 data-local-path에 원문 그대로 담고 클릭 시 IPC로 연다.
const LOCAL_PATH_PATTERN = /^([A-Za-z]:[\\/]|\\\\|file:\/\/)/i;

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
      let trailing = trailingMatch ? trailingMatch[0] : '';
      let url = trailing ? raw.slice(0, -trailing.length) : raw;
      // 경로에 흔한 균형 잡힌 닫는 괄호(...(x86) , ...(OT))는 링크 안으로 되돌린다.
      const countOf = (s, ch) => s.split(ch).length - 1;
      while (trailing.startsWith(')') && countOf(url, '(') > countOf(url, ')')) {
        url += ')';
        trailing = trailing.slice(1);
      }
      if (!url) continue;

      if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const a = document.createElement('a');
      a.textContent = url;
      a.setAttribute('contenteditable', 'false');
      if (LOCAL_PATH_PATTERN.test(url)) {
        // href를 안 넣어야 브라우저가 경로를 안 건드린다. 원문은 data-local-path에.
        a.className = 'local-path-link';
        a.setAttribute('role', 'link');
        a.setAttribute('data-local-path', url);
      } else {
        a.href = url.startsWith('www.') ? `https://${url}` : url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      frag.appendChild(a);
      if (trailing) frag.appendChild(document.createTextNode(trailing));

      lastIndex = match.index + raw.length;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.parentNode.replaceChild(frag, node);
  });

  // 로컬 경로 링크 클릭 → OS 탐색기/기본 앱으로 열기(IPC). 컨테이너당 한 번만 바인딩.
  if (!container.__localPathBound) {
    container.__localPathBound = true;
    container.addEventListener('click', (e) => {
      const link = e.target.closest?.('a.local-path-link[data-local-path]');
      if (!link || !container.contains(link)) return;
      e.preventDefault();
      e.stopPropagation();
      window.itda?.app?.openPath?.(link.getAttribute('data-local-path'));
    });
  }
}
