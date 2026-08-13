import { todayStr } from './date-utils.js';

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// 다른 창(위젯 등)에서 데이터가 바뀌었다는 브로드캐스트(itda:data-changed)를 받았을 때,
// 지금 이 창에서 사용자가 텍스트를 입력 중이면 그 순간 화면을 통째로 새로고침해서 커서/포커스를
// 끊어버리면 안 된다. input/textarea/contenteditable에 포커스가 가 있는 동안은 새로고침을 미룬다.
export function isUserTyping() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
  return !!el.isContentEditable;
}

// 여러 번 연달아 불릴 수 있는 함수(특히 itda:data-changed 브로드캐스트 핸들러)를 짧은 시간 안에
// 몰아서 한 번만 실행되게 묶어준다. 왜 필요하냐면 — 어떤 액션(예: 연결하기 버튼)은 그 핸들러
// 자신이 이미 한 번 새로고침을 하는데, 그 액션이 만든 브로드캐스트가 같은 화면에 다시 돌아와서
// "또" 새로고침을 트리거하는 경우가 많다(자기 자신에게 온 메아리). 매번 이중으로 IPC 왕복하는
// 대신, 짧은 시간(기본 250ms) 안에 들어온 호출은 마지막 한 번으로 합친다.
export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

let toastTimer = null;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// IPC 호출이 실패했을 때 공통으로 쓰는 에러 표시. 항상 이걸로 감싸서
// "콘솔에만 찍히고 화면은 아무 반응 없음" 상태를 만들지 않는다.
export function errorToast(e, fallback = '오류가 발생했어요') {
  console.error(e);
  toast(e?.message || fallback);
}

// SQLite 'YYYY-MM-DD HH:MM:SS' 문자열을 상대 시간으로 표시 (방금 전 / N분 전 / N시간 전 / N일 전)
export function formatRelative(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr.replace(' ', 'T'));
  const diffMin = Math.floor((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return dateStr.slice(0, 10);
}

function defaultEmptyIcon() {
  return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>`;
}

// 리스트형 화면 공통 빈 상태 블록 (아이콘 + 제목 + 설명)
export function emptyStateBlock({ icon, title, subtitle }) {
  return `
    <div class="empty-state-block">
      ${icon || defaultEmptyIcon()}
      <b>${title}</b>
      <span>${subtitle}</span>
    </div>`;
}

// SQLite 'YYYY-MM-DD' 마감일을 오늘/내일/지남 배지로 변환
export function formatDueBadge(dueDate, isDone) {
  if (!dueDate) return { label: '마감일 없음', tone: 'neutral' };
  const today = todayStr();
  if (dueDate === today) return { label: '오늘', tone: isDone ? 'neutral' : 'brand' };
  if (dueDate < today && !isDone) return { label: `${dueDate} 지남`, tone: 'danger' };

  const t = new Date();
  t.setDate(t.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const tomorrow = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  if (dueDate === tomorrow) return { label: '내일', tone: 'neutral' };
  return { label: dueDate, tone: 'neutral' };
}

export function priorityBadge(priority) {
  if (priority === 1) return { label: '높음', tone: 'danger' };
  if (priority === 3) return { label: '낮음', tone: 'neutral' };
  return null; // 보통(2)은 배지 없이 기본값으로 취급 — 화면이 배지로 뒤덮이지 않도록
}

// 일정 목록을 날짜별로 묶을 때 쓰는 그룹 헤더 라벨 ("8월 7일 (금) · 오늘")
export function dateGroupLabel(dateStr) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const d = new Date(dateStr + 'T00:00:00');
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
  const today = todayStr();
  if (dateStr === today) return `${base} · 오늘`;

  const t = new Date();
  t.setDate(t.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const tomorrow = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  if (dateStr === tomorrow) return `${base} · 내일`;
  return base;
}
