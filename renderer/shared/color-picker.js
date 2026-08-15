/**
 * renderer/shared/color-picker.js
 *
 * 메모/포스트잇 리치텍스트 글자색 선택용 — 엑셀/한글 같은 "표준 색 그리드 + 사용자 지정"
 * 드롭다운. 프리셋 14색은 한 번 클릭으로 바로 적용되고, "사용자 지정" 행의 네이티브
 * <input type=color>로 완전히 자유로운 색도 그대로 고를 수 있다(자유도는 안 줄어듦).
 *
 * 팝오버 여닫기/바깥 클릭 감지 패턴은 context-menu.js와 비슷하지만, 그건 "메뉴"이고
 * 이건 "색상 선택기"라 동시에 열릴 수 있는 다른 종류라 별도 모듈로 분리했다.
 */
const PRESET_COLORS = [
  '#000000', '#4A4A4A', '#808080', '#FFFFFF',
  '#E03131', '#F76707', '#F0B400', '#2F9E44',
  '#0CA678', '#1971C2', '#364FC7', '#9C36B5',
  '#D6336C', '#8B5A2B',
];

let activeEl = null;
let outsideHandlerBound = false;

function closePicker() {
  if (activeEl) {
    activeEl.remove();
    activeEl = null;
  }
}

function ensureOutsideHandler() {
  if (outsideHandlerBound) return;
  outsideHandlerBound = true;
  // mousedown이 click보다 먼저 발생 — 다른 색상버튼을 눌러 팝오버를 옮길 때도 자연스럽게 교체됨
  document.addEventListener('mousedown', (e) => {
    if (activeEl && !activeEl.contains(e.target)) closePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePicker();
  });
  window.addEventListener('blur', closePicker);
}

/**
 * @param {HTMLElement} anchorEl - 팝오버를 붙일 기준 엘리먼트(색상 버튼)
 * @param {(hex: string) => void} onPick - 프리셋을 클릭하거나 사용자 지정 색을 고르면 호출
 */
export function openColorPicker(anchorEl, onPick) {
  ensureOutsideHandler();
  closePicker();

  const pop = document.createElement('div');
  pop.className = 'color-picker-pop';
  pop.innerHTML = `
    <div class="color-picker-grid">
      ${PRESET_COLORS.map((c) => `<button type="button" class="color-picker-swatch" data-color="${c}" style="background:${c};" title="${c}"></button>`).join('')}
    </div>
    <label class="color-picker-custom">
      사용자 지정
      <input type="color" class="color-picker-customInput" value="#000000" />
    </label>
  `;
  document.body.appendChild(pop);
  activeEl = pop;

  const anchorRect = anchorEl.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(anchorRect.left, vw - popRect.width - 8));
  const top = Math.min(anchorRect.bottom + 4, vh - popRect.height - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  pop.querySelectorAll('.color-picker-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      onPick(btn.dataset.color);
      closePicker();
    });
  });
  // input 이벤트는 드래그하는 동안 계속 발생하므로 실시간 미리보기처럼 바로바로 적용된다.
  // 사용자 지정은 팝오버를 안 닫음 — OS 색상 다이얼로그를 여러 번 다시 열지 않고 계속 조정 가능.
  pop.querySelector('.color-picker-customInput').addEventListener('input', (e) => {
    onPick(e.target.value);
  });
}
