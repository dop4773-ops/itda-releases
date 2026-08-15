/**
 * renderer/shared/series-scope.js
 *
 * 반복 Todo/일정을 삭제할 때 "이 항목만" vs "이 항목부터 이후 전부"를 고르는 작은 팝오버.
 * color-picker.js와 같은 여닫기 패턴(바깥 클릭/Esc 닫기)이지만, 이건 "예/아니오형 확인"이라
 * 별도 모듈로 분리했다.
 */
let activeEl = null;

function closePopover() {
  activeEl?.remove();
  activeEl = null;
}

/**
 * @param {HTMLElement} anchorEl - 팝오버를 붙일 기준 엘리먼트(삭제 버튼)
 * @returns {Promise<'this'|'following'|null>} null이면 취소(바깥 클릭/Esc)
 */
export function confirmSeriesScope(anchorEl) {
  closePopover();
  return new Promise((resolve) => {
    const pop = document.createElement('div');
    pop.className = 'series-scope-pop';
    pop.innerHTML = `
      <div class="series-scope-title">반복되는 항목이에요</div>
      <button type="button" class="btn-secondary" data-scope="this">이 항목만</button>
      <button type="button" class="btn-danger" data-scope="following">이 항목부터 이후 전부</button>
    `;
    document.body.appendChild(pop);
    activeEl = pop;

    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    pop.style.left = `${Math.max(8, Math.min(rect.left, vw - popRect.width - 8))}px`;
    pop.style.top = `${Math.min(rect.bottom + 4, vh - popRect.height - 8)}px`;

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
    }
    pop.querySelectorAll('[data-scope]').forEach((btn) => {
      btn.addEventListener('click', () => finish(btn.dataset.scope));
    });
    // mousedown 직후 등록해야 이 팝오버를 띄운 그 클릭 자체가 바로 "바깥 클릭"으로 오인되지 않는다
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside);
      document.addEventListener('keydown', onKey);
    }, 0);
  });
}
