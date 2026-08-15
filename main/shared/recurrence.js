/**
 * main/shared/recurrence.js
 *
 * "간단한 반복"(매일/매주 같은 요일/매월 같은 날짜) 전용 — 표준 RRULE은 안 씀.
 * 렌더러의 date-utils.js와 같은 날짜 연산이 필요하지만, 렌더러(ESM)와 메인 프로세스(CJS)는
 * 서로 다른 모듈 시스템이라 파일을 그대로 공유할 수 없어서 필요한 만큼만 여기 따로 둔다.
 *
 * 생성 시점에 앞으로 180일치 발생일을 미리 만들어서 실제 행(row)으로 저장한다(가상 확장 아님).
 * 그래서 "이 항목만 삭제/이후 모두 삭제"가 그냥 평범한 행 삭제로 처리된다. 단점: 180일이 지나면
 * 반복이 자동으로 끊긴다 — 이후 자동 연장하려면 별도 백그라운드 작업이 필요(지금은 없음).
 */
const WINDOW_DAYS = 180;

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

// 매월 같은 날짜(N번째 다음달, 원래 시작일 기준) — setMonth를 반복 누적하면 1/31 → 3/3처럼
// 날짜가 밀리면서 그 오차가 다음 달에도 계속 누적되는 버그가 생긴다(2월엔 31일이 없어서 3월로
// 넘어가버림). 그래서 매번 "원래 시작일 + N개월"을 처음부터 다시 계산하고, 그 달에 그 날짜가
// 없으면(예: 1/31 → 2월) 그 달의 마지막 날로 자연스럽게 당긴다(2/28, 4/30 등).
function nthMonthlyOccurrence(start, n) {
  const originalDay = start.getDate();
  const targetIndex = start.getMonth() + n;
  const targetYear = start.getFullYear() + Math.floor(targetIndex / 12);
  const targetMonth0 = ((targetIndex % 12) + 12) % 12;
  const clampedDay = Math.min(originalDay, daysInMonth(targetYear, targetMonth0));
  return new Date(targetYear, targetMonth0, clampedDay);
}

// startDateStr: 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:MM:SS' — 시각 부분은 무시하고 날짜만 본다
function generateOccurrenceDates(startDateStr, rule) {
  const [y, m, d] = startDateStr.slice(0, 10).split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const limit = addDays(start, WINDOW_DAYS);
  const dates = [];

  if (rule === 'daily' || rule === 'weekly') {
    const stepDays = rule === 'daily' ? 1 : 7;
    let cur = addDays(start, stepDays);
    while (cur <= limit) {
      dates.push(dateKey(cur));
      cur = addDays(cur, stepDays);
    }
  } else if (rule === 'monthly') {
    let n = 1;
    let occ = nthMonthlyOccurrence(start, n);
    while (occ <= limit) {
      dates.push(dateKey(occ));
      n++;
      occ = nthMonthlyOccurrence(start, n);
    }
  }
  return dates;
}

module.exports = { generateOccurrenceDates, WINDOW_DAYS };
