// 오늘 요약 화면(views/today.js)의 계산 부분 — DOM 없이 테스트할 수 있게 분리
export const OVERDUE_DAYS = 7; // 지난 미완료로 보여줄 기간
const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// 오늘의 일정(종일 → 시각순)과 마감 할 일(시각 있는 것은 그 시각에, 없는 것은 맨 뒤 '마감')을 한 줄로 섞는다
export function buildTimeline(events, todos) {
  const rows = [];
  events.forEach((e) => {
    const allDay = !!e.all_day;
    rows.push({ type: 'event', sort: allDay ? '00:00' : (e.start_at || '').slice(11, 16) || '00:00', order: 0, time: allDay ? '종일' : (e.start_at || '').slice(11, 16), data: e });
  });
  todos.forEach((t) => {
    const time = t.due_time ? String(t.due_time).slice(0, 5) : '';
    rows.push({ type: 'todo', sort: time || '99:99', order: 1, time: time || '마감', data: t });
  });
  return rows.sort((a, b) => a.sort.localeCompare(b.sort) || a.order - b.order || String(a.data.title).localeCompare(String(b.data.title), 'ko'));
}
export function pickOverdue(openTodos, today, days = OVERDUE_DAYS) {
  const from = toKey(addDays(new Date(`${today}T00:00:00`), -days));
  const all = openTodos.filter((t) => t.due_date && t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { recent: all.filter((t) => t.due_date >= from), older: all.filter((t) => t.due_date < from).length };
}


const hm = (s) => (s || '').slice(11, 16);
const toMin = (t) => (t && t.length >= 5 ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

// 일정이 지금 어느 상태인지(오늘을 볼 때만 의미 있음): 'past' 끝남 · 'now' 진행 중 · 'next' 아직 · '' 종일 등 구분 없음
export function eventState(e, nowMin) {
  if (e.all_day) return '';
  const s = toMin(hm(e.start_at));
  if (s === null) return '';
  const en = toMin(hm(e.end_at));
  const end = en !== null && (e.end_at || '').slice(0, 10) === (e.start_at || '').slice(0, 10) && en > s ? en : s;
  if (nowMin >= end && !(end === s && nowMin === s)) return 'past';
  if (nowMin >= s) return 'now';
  return 'next';
}

// 지금 진행 중인 일정과, 아직 안 시작한 가장 가까운 일정(몇 분 뒤인지 포함)
export function nextUp(events, nowMin) {
  let now = null;
  let next = null;
  [...events]
    .filter((e) => !e.all_day)
    .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''))
    .forEach((e) => {
      const st = eventState(e, nowMin);
      if (st === 'now' && !now) now = e;
      if (st === 'next' && !next) next = { event: e, inMin: toMin(hm(e.start_at)) - nowMin };
    });
  return { now, next };
}

export function minutesText(min) {
  if (min < 1) return '곧';
  if (min < 60) return `${min}분 뒤`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분 뒤` : `${h}시간 뒤`;
}

export function greeting(hour) {
  if (hour < 5) return '늦은 시간이에요';
  if (hour < 11) return '좋은 아침이에요';
  if (hour < 14) return '점심 맛있게 드세요';
  if (hour < 18) return '오후도 힘내요';
  return '오늘 하루 수고했어요';
}

// 일요일부터 7일 키 — 달력 화면의 주와 같은 기준
export function weekKeys(dayKey) {
  const d = new Date(`${dayKey}T00:00:00`);
  const start = addDays(d, -d.getDay());
  return Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i)));
}

// 날짜별 개수: 여러 날 이어지는 종일 일정은 걸친 모든 날에 센다
export function countByDay(keys, events, todos) {
  const out = Object.fromEntries(keys.map((k) => [k, { events: 0, todos: 0 }]));
  events.forEach((e) => {
    const s = (e.start_at || '').slice(0, 10);
    const en = e.all_day ? (e.end_at || '').slice(0, 10) || s : s;
    keys.forEach((k) => {
      if (k >= s && k <= en) out[k].events += 1;
    });
  });
  todos.forEach((t) => {
    if (t.status !== 'done' && out[t.due_date]) out[t.due_date].todos += 1;
  });
  return out;
}
