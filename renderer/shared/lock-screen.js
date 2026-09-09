/**
 * 앱 실행 시 비밀번호 잠금 화면.
 * 설정에서 비밀번호를 등록해두지 않았으면 이 화면은 아예 뜨지 않고 그대로 통과한다.
 * router.js의 DOMContentLoaded 초기화에서 initShell()/navigate() 전에 반드시 먼저 호출해야
 * 잠금이 풀리기 전에 사이드바/대시보드 내용이 미리 그려지는 일이 없다.
 */
const LOCK_AT_KEY = 'itda_lock_at';
const ICON = '../build/icons/app-icon.png';

const LOCK_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
const EYE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-10-7-10-7a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 10 7 10 7a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/><path d="M9.9 9.9a3 3 0 104.2 4.2"/></svg>`;
const KBD_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg>`;
const CLOCK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

function readLockAt() {
  try {
    return localStorage.getItem(LOCK_AT_KEY);
  } catch (e) {
    return null;
  }
}
function writeLockAt() {
  try {
    localStorage.setItem(LOCK_AT_KEY, new Date().toISOString());
  } catch (e) {
    /* localStorage 불가 환경이면 그냥 표시만 생략 */
  }
}
function fmtLockAt(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function ensureUnlocked() {
  let status;
  try {
    status = await window.itda.auth.getStatus();
  } catch (e) {
    console.error('[lock-screen] 잠금 상태 확인 실패', e);
    return; // 상태 확인 자체가 안 되면 잠금을 강제하지 않고 그냥 통과시킨다(먹통 방지)
  }
  if (!status.enabled) return;
  return showLockOverlay();
}

// 이미 잠금 해제된 상태에서 자리를 비울 때 "지금 잠그기"로 다시 잠그기 위한 함수.
// 설정 화면의 버튼과 전역 단축키(main/global-shortcut, Ctrl/Cmd+Alt+L) 둘 다 이걸 호출한다.
// 비밀번호가 아예 설정 안 돼 있으면 잠글 대상이 없으므로 안내만 하고 끝낸다.
let overlayOpen = false; // 단축키 연타/중복 호출로 잠금화면이 두 겹 뜨는 것 방지
export async function lockNow() {
  if (overlayOpen) return;
  let status;
  try {
    status = await window.itda.auth.getStatus();
  } catch (e) {
    return;
  }
  if (!status.enabled) {
    const { toast } = await import('./ui-utils.js');
    toast('잠금이 꺼져있어요. 설정 → 보안에서 비밀번호를 먼저 설정해주세요.');
    return;
  }
  writeLockAt(); // 사용자가 방금 잠갔으니 "마지막 잠금" 시각을 갱신
  await showLockOverlay();
}

function showLockOverlay() {
  overlayOpen = true;
  if (!readLockAt()) writeLockAt(); // 최초 실행 시 잠금이면 값이 없으므로 지금 시각으로
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'lock-screen';
    overlay.innerHTML = `
      <div class="lock-blob lock-blob-1"></div>
      <div class="lock-blob lock-blob-2"></div>
      <div class="lock-blob lock-blob-3"></div>

      <div class="lock-topbar">
        <div class="lock-brand">
          <img src="${ICON}" alt="" />
          <b>잇다</b>
          <span class="lock-brand-sep"></span>
          <span class="lock-brand-tag">더 나은 업무의 시작</span>
        </div>
        <span class="lock-brand-en">ITDA</span>
      </div>

      <div class="lock-card">
        <img class="lock-logo" src="${ICON}" alt="잇다" />
        <div class="lock-wordmark">잇다</div>
        <h2>${LOCK_SVG}<span>화면이 잠겨 있습니다</span></h2>
        <p>비밀번호를 입력하면 다시 사용할 수 있습니다.</p>

        <div class="lock-input-wrap">
          <span class="lock-input-icon">${LOCK_SVG}</span>
          <input type="password" id="lock-passwordInput" placeholder="비밀번호를 입력하세요" autocomplete="current-password" />
          <button type="button" class="lock-eye" id="lock-eye" title="비밀번호 표시">${EYE_SVG}</button>
        </div>
        <div class="lock-error" id="lock-error" hidden></div>

        <button class="btn lock-submit" id="lock-submitBtn">잠금 해제</button>
        <div class="lock-kbd-hint">${KBD_SVG}<span><b>Enter</b> 키로 잠금을 해제할 수 있습니다.</span></div>

        <div class="lock-foot">
          ${CLOCK_SVG}<span>마지막 잠금</span><span class="lock-foot-sep">|</span><span>${fmtLockAt(readLockAt())}</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#lock-passwordInput');
    const errorEl = overlay.querySelector('#lock-error');
    const submitBtn = overlay.querySelector('#lock-submitBtn');
    const eyeBtn = overlay.querySelector('#lock-eye');

    eyeBtn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eyeBtn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
      eyeBtn.classList.toggle('on', show);
      input.focus();
    });

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
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
          overlayOpen = false;
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
