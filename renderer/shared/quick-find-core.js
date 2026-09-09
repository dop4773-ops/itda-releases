// 빠른 찾기 공용 코어 — Spotlight 창(renderer/spotlight.js)과 잇다 안 오버레이
// (renderer/shared/command-palette.js)가 같은 파싱/스코프 규칙을 쓰도록 한 곳에 모은다.
// (렌더링 DOM은 두 창이 서로 달라 각자 유지. 여기 있는 건 "무엇을 검색할지"의 두뇌.)

export const TYPE_EMOJI = { todo: '✅', event: '📅', memo: '📝', postit: '📌', inbox: '📥' };
export const TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇', inbox: 'Inbox' };
export const ITEM_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit', inbox: '#/inbox' };

// 맨 앞 토큰이 타입 이름이고 뒤에 공백이 오면 그 타입으로 좁힌다("메모 회의록").
// 그냥 "메모"만 치면 프리픽스가 아니라 검색어(제목이 "메모"인 항목 / 메모 화면 몫).
const TYPE_PREFIX = {
  메모: 'memo', 노트: 'memo', memo: 'memo',
  투두: 'todo', 할일: 'todo', todo: 'todo',
  일정: 'event', 캘린더: 'event', calendar: 'event', event: 'event',
  포스트잇: 'postit', postit: 'postit',
  인박스: 'inbox', inbox: 'inbox',
};

// "메모 회의록"        → { type:'memo',  tag:null,   text:'회의록' }
// "#재활 회의록"/"@재활" → { type:null,   tag:'재활',  text:'회의록' | '' }   (존재하는 태그명일 때만)
// "#재활 메모 회의록"   → { type:'memo',  tag:'재활',  text:'회의록' }
// "회의록"             → { type:null,   tag:null,   text:'회의록' }
export function parseQuery(raw, tagNames = []) {
  let text = String(raw || '').replace(/^\s+/, '');
  let type = null;
  let tag = null;

  const tagM = text.match(/^([#@])(\S+)\s*([\s\S]*)$/);
  if (tagM) {
    const hit = tagNames.find((n) => n && n.toLowerCase() === tagM[2].toLowerCase());
    if (hit) {
      tag = hit;
      text = tagM[3];
    }
  }

  const sp = text.search(/\s/);
  if (sp > 0) {
    const head = text.slice(0, sp).toLowerCase();
    if (TYPE_PREFIX[head]) {
      type = TYPE_PREFIX[head];
      text = text.slice(sp + 1);
    }
  }

  return { type, tag, text: text.trim() };
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

// 일정(event) 날짜 라벨 — 연월일 + 요일. "2026. 9. 10 (수)" / 시간이 있으면 "… 14:00".
// startAt은 'YYYY-MM-DD HH:MM' 또는 날짜만('YYYY-MM-DD') 둘 다 받는다.
export function eventDateLabel(startAt, allDay) {
  if (!startAt) return '';
  const s = String(startAt).replace(' ', 'T');
  const hasTime = /T\d{2}:\d{2}/.test(s);
  const d = new Date(hasTime ? s : s.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const md = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${WD[d.getDay()]})`;
  if (allDay || !hasTime) return md;
  return `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 활성 스코프를 한 줄로 — 섹션 헤더 접두("메모 · #재활 · 항목")에 쓴다.
export function describeScope({ type, tag }) {
  const bits = [];
  if (type) bits.push(TYPE_LABEL[type] || type);
  if (tag) bits.push(`#${tag}`);
  return bits.join(' · ');
}
