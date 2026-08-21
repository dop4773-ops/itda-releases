/**
 * renderer/shared/update-overlay.js
 *
 * 수동 업데이트 모드에서 "지금 확인" 이후의 흐름(다운로드 진행 → 재시작 확인)을 화면과
 * 무관하게 전역으로 보여준다. 앱 셸(shell.js)에서 한 번만 초기화되고 계속 살아있다.
 * 자동 모드는 이 오버레이가 개입하지 않고 기존처럼 조용히 진행된다 — main/updater/index.js가
 * 다운로드가 끝나는 즉시(창을 닫거나 뭘 누르는 것과 무관하게) 조용히 설치+재시작한다.
 */

let overlayEl = null;
let modalEl = null;

function ensureElements() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'update-progress-overlay';
  overlayEl.innerHTML = `
    <div class="update-progress-icon">🔄</div>
    <div class="update-progress-title">업데이트 중</div>
    <div class="update-progress-sub" id="update-progress-sub">새 버전을 받는 중…</div>
    <div class="update-progress-bar"><div class="update-progress-bar-fill" id="update-progress-fill"></div></div>
  `;
  document.body.appendChild(overlayEl);

  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.id = 'update-restart-modal';
  modalEl.innerHTML = `
    <div class="modal-card" style="width:380px;">
      <div class="update-restart-icon">🔄</div>
      <h3 style="text-align:center;">프로그램 업데이트</h3>
      <p class="settings-row-desc" style="text-align:center;">지금 업데이트를 적용하고 프로그램을 재시작하시겠습니까?</p>
      <div class="update-restart-note">할 일·일정·메모 등 데이터는 그대로 유지됩니다.</div>
      <div class="modal-actions" style="justify-content:center;">
        <button class="btn-secondary" id="update-restart-later">나중에</button>
        <button class="btn" id="update-restart-now">재시작</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  function closeModal() {
    modalEl.classList.remove('open');
  }
  modalEl.querySelector('#update-restart-later').addEventListener('click', closeModal);
  modalEl.querySelector('#update-restart-now').addEventListener('click', () => {
    window.itda.updater.quitAndInstall();
  });
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.classList.contains('open')) closeModal();
  });
}

async function isManualMode() {
  const mode = await window.itda.settings.get('update_mode');
  return mode !== 'auto';
}

export function initUpdateOverlay() {
  ensureElements();

  window.itda.updater.onStatus(async (data) => {
    if (data.status === 'downloading') {
      if (!(await isManualMode())) return; // 자동 모드는 조용히 진행 — 오버레이 없음
      overlayEl.classList.add('open');
      document.getElementById('update-progress-sub').textContent = `새 버전을 받는 중… ${data.percent ?? 0}%`;
      document.getElementById('update-progress-fill').style.width = `${data.percent ?? 0}%`;
      return;
    }

    overlayEl.classList.remove('open'); // downloading이 아닌 다른 상태로 넘어가면 진행 화면은 항상 닫는다

    if (data.status === 'downloaded') {
      if (!(await isManualMode())) return; // 자동 모드는 창 닫을 때 조용히 설치(main 쪽 close 핸들러)
      modalEl.classList.add('open');
    }
  });
}
