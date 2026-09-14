/**
 * renderer/shared/text-prompt.js
 *
 * 텍스트 한 줄을 입력받는 작은 팝오버 — window.prompt() 대신 앱 전체가 쓰는 커스텀 팝오버
 * 스타일(color-picker.js/series-scope.js와 같은 여닫기 패턴)을 맞추기 위해 만들었다.
 */
let activeEl = null;

function closePopover() {
  activeEl?.remove();
  activeEl = null;
}

/**
 * @param {HTMLElement} anchorEl - 팝오버를 붙일 기준 엘리먼트
 * @param {{title?: string, placeholder?: string, value?: string, password?: boolean}} [opts] - value를 주면 이름 바꾸기처럼
 *   기존 값을 미리 채우고 전체 선택해서 바로 덮어쓸 수 있게 한다. password를 주면 입력이 가려진다(비밀번호 확인 등).
 * @returns {Promise<string|null>} null이면 취소(바깥 클릭/Esc/빈 값)
 */
export function promptText(anchorEl, opts = {}) {
  closePopover();
  return new Promise((resolve) => {
    const pop = document.createElement('div');
    pop.className = 'text-prompt-pop';
    pop.innerHTML = `
      ${opts.title ? `<div class="text-prompt-title">${opts.title}</div>` : ''}
      <input type="${opts.password ? 'password' : 'text'}" class="input" placeholder="${opts.placeholder || ''}" value="${(opts.value || '').replace(/"/g, '&quot;')}" />
      <div class="text-prompt-actions">
        <button type="button" class="btn-secondary" data-action="cancel">취소</button>
        <button type="button" class="btn" data-action="confirm">확인</button>
      </div>
    `;
    document.body.appendChild(pop);
    activeEl = pop;

    const popRect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // anchorEl 없이 부를 때도 있다(예: 빠른찾기로 잠긴 메모를 바로 열면 버튼 클릭이 아니라
    // 딥링크라 기준 엘리먼트가 없음) — 그때 anchorEl.getBoundingClientRect()가 그대로 터지면
    // 예외가 위(openMemoMaybeLocked → 호출부에서 await 안 함)까지 조용히 묻혀서 팝오버가
    // 아예 안 뜨고 "눌러도 아무 반응 없음"으로 보인다. 없으면 화면 중앙 쯤에 띄운다.
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : { left: (vw - popRect.width) / 2, bottom: (vh - popRect.height) / 2 };
    pop.style.left = `${Math.max(8, Math.min(rect.left, vw - popRect.width - 8))}px`;
    pop.style.top = `${Math.min(rect.bottom + 4, vh - popRect.height - 8)}px`;

    const input = pop.querySelector('input');
    input.focus();
    input.select();

    function finish(value) {
      closePopover();
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    }
    function onOutside(e) {
      if (!pop.contains(e.target)) finish(null);
    }
    function onKey(e) {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter') finish(input.value.trim() || null);
    }
    pop.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
    pop.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(input.value.trim() || null));
    // mousedown 직후 등록해야 이 팝오버를 띄운 그 클릭 자체가 바로 "바깥 클릭"으로 오인되지 않는다
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside);
      document.addEventListener('keydown', onKey);
    }, 0);
  });
}
