export function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ================= 날짜 유틸 (일정/대시보드 캘린더 위젯이 공유) =================
export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function dateKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

export function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

export function monthGridDates(anchor, { trim = false } = {}) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  let weeks = 6;
  if (trim) {
    // 이 달이 실제로 걸치는 주 수만큼만(구글 캘린더 방식) — 보통 5주, 가끔 4·6주.
    const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const spanDays = Math.round((lastOfMonth - gridStart) / 86400000) + 1;
    weeks = Math.ceil(spanDays / 7);
  }
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
}

// SQLite 'YYYY-MM-DD HH:MM:SS' 문자열에서 하루 중 분(minute) 오프셋 추출
export function minutesInDay(datetimeStr) {
  const hh = Number((datetimeStr || '').slice(11, 13));
  const mm = Number((datetimeStr || '').slice(14, 16));
  return hh * 60 + mm;
}
