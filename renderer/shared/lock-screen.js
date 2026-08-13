/**
 * 앱 실행 시 비밀번호 잠금 화면.
 * 설정에서 비밀번호를 등록해두지 않았으면 이 화면은 아예 뜨지 않고 그대로 통과한다.
 * router.js의 DOMContentLoaded 초기화에서 initShell()/navigate() 전에 반드시 먼저 호출해야
 * 잠금이 풀리기 전에 사이드바/대시보드 내용이 미리 그려지는 일이 없다.
 */
export async function ensureUnlocked() {
  let status;
  try {
    status = await window.itda.auth.getStatus();
  } catch (e) {
    console.error('[lock-screen] 잠금 상태 확인 실패', e);
    return; // 상태 확인 자체가 안 되면 잠금을 강제하지 않고 그냥 통과시킨다(먹통 방지)
  }
  if (!status.enabled) return;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'lock-screen';
    overlay.innerHTML = `
      <div class="lock-card">
        <div class="lock-logo">잇</div>
        <h2>잠겨 있어요</h2>
        <p>비밀번호를 입력하면 잇다를 열 수 있어요.</p>
        <input type="password" id="lock-passwordInput" class="input" placeholder="비밀번호" autocomplete="current-password" />
        <div class="lock-error" id="lock-error" style="display:none;"></div>
        <button class="btn" id="lock-submitBtn" style="width:100%;margin-top:10px;">잠금 해제</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#lock-passwordInput');
    const errorEl = overlay.querySelector('#lock-error');
    const submitBtn = overlay.querySelector('#lock-submitBtn');

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
      input.value = '';
      input.focus();
    }

    async function tryUnlock() {
      const pw = input.value;
      if (!pw) return;
      submitBtn.disabled = true;
      try {
        const ok = await window.itda.auth.verify(pw);
        if (ok) {
          overlay.remove();
          resolve();
        } else {
          showError('비밀번호가 일치하지 않아요.');
        }
      } catch (e) {
        showError('확인하는 중 오류가 발생했어요.');
      } finally {
        submitBtn.disabled = false;
      }
    }

    submitBtn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryUnlock();
    });
    setTimeout(() => input.focus(), 50);
  });
}
