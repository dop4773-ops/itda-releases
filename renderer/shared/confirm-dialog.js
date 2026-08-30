/**
 * renderer/shared/confirm-dialog.js
 *
 * window.confirm() 대체 — Electron 렌더러에서 네이티브 confirm/alert/prompt는 쓰지 않는다는 원칙에 따라,
 * 앱 전체가 쓰는 .modal-overlay/.modal-card 스타일로 통일한 확인 다이얼로그.
 * 배경 클릭으로는 안 닫히고(실수 방지), Esc·"취소" 버튼으로만 취소된다.
 */
import { escapeHtml } from './ui-utils.js';

let overlayEl = null;

/**
 * @param {string} message - 본문(줄바꿈은 \n)
 * @param {{title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} [opts]
 * @returns {Promise<boolean>} 확인=true, 취소/Esc=false
 */
export function confirmDialog(message, opts = {}) {
  const { title = '확인', confirmLabel = '확인', cancelLabel = '취소', danger = false } = opts;

  // 이전에 열려있던 게 있으면 정리(중첩 호출 방어)
  overlayEl?.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:380px;">
        <h3>${escapeHtml(title)}</h3>
        <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:var(--text-soft);white-space:pre-wrap;">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" data-act="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn${danger ? ' btn-danger' : ''}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlayEl = overlay;

    function finish(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (overlayEl === overlay) overlayEl = null;
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    }
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('[data-act="ok"]').focus();
  });
}
