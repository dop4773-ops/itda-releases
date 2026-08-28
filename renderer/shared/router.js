import * as dashboardView from '../views/dashboard.js';
import * as inboxView from '../views/inbox.js';
import * as todoView from '../views/todo.js';
import * as calendarView from '../views/calendar.js';
import * as memoView from '../views/memo.js';
import * as postitView from '../views/postit.js';
import * as searchView from '../views/search.js';
import * as trashView from '../views/trash.js';
import * as settingsView from '../views/settings.js';
import { initShell } from './shell.js';
import { ensureUnlocked, lockNow } from './lock-screen.js';

// 라우트 테이블: 새 화면 추가 시 여기 한 줄만 추가하면 사이드바/URL 해시로 바로 연결됨
const routes = {
  '#/dashboard': dashboardView,
  '#/inbox': inboxView,
  '#/todo': todoView,
  '#/calendar': calendarView,
  '#/memo': memoView,
  '#/postit': postitView,
  '#/search': searchView,
  // 태그 관리는 독립 화면이 아니라 설정(#/settings) 안의 "태그" 탭으로 이동함
  '#/trash': trashView,
  '#/settings': settingsView,
};

const root = document.getElementById('view-root');
let unmountCurrent = null;

function setActiveNav(hash) {
  document.querySelectorAll('.nav-item[data-route]').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === hash);
  });
}

async function navigate() {
  const requested = location.hash;
  const hash = routes[requested] ? requested : '#/dashboard';
  if (hash !== requested) {
    location.hash = hash; // 잘못된 해시면 대시보드로 정정 (hashchange가 다시 navigate 호출)
    return;
  }

  if (typeof unmountCurrent === 'function') {
    try { unmountCurrent(); } catch (e) { console.error('[router] unmount 오류', e); }
  }
  unmountCurrent = null;
  root.innerHTML = '';
  root.dataset.view = hash.replace('#/', ''); // 화면별 CSS 훅 (예: .main[data-view="memo"])
  setActiveNav(hash);

  try {
    const result = await routes[hash].mount(root);
    if (typeof result === 'function') unmountCurrent = result;
    window.dispatchEvent(new CustomEvent('itda:route-mounted', { detail: { hash } })); // 커맨드 팔레트가 "화면 이동 후 후속 동작"을 걸 수 있게(예: 새 투두 입력창 포커스)
  } catch (e) {
    console.error(`[router] ${hash} 화면 로드 실패`, e);
    root.innerHTML = `<div class="panel"><div class="empty">화면을 불러오는 중 오류가 발생했어요.<br>${e.message}</div></div>`;
  }
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', async () => {
  // 비밀번호 잠금이 켜져 있으면 여기서 대기 — 풀리기 전까지 사이드바/대시보드 등
  // 어떤 실제 데이터도 그려지지 않는다. 잠금이 꺼져 있으면 즉시 통과.
  await ensureUnlocked();
  initShell();
  navigate();
  // 위젯 창(별도 BrowserWindow)의 "전체 OO 보기" 클릭 시 메인 창이 여기로 이동
  window.itda.onNavigate((route) => {
    location.hash = route;
  });
  // OS 전역 단축키(Ctrl/Cmd+Alt+L)로 어디서든 바로 다시 잠그기
  window.itda.onLockNow(lockNow);
});
