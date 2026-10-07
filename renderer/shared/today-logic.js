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

