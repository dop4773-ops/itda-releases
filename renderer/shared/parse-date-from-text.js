/**
 * renderer/shared/parse-date-from-text.js
 *
 * Inbox/Todo 내용에 적힌 날짜·시각 표현을 훑어서 일정 등록 모달의 초기값으로 쓸
 * { date: 'YYYY-MM-DD'|null, time: 'HH:MM'|null } 을 뽑아낸다.
 *
 * ponytail: 흔한 한국어 표현(오늘/내일/모레, N일 후, M월D일, M/D, 요일, 시각)만 다루는
 * 휴리스틱 정규식 파서. "격주 화요일", "다다음주" 같은 복잡한 표현은 인식 못 하고 null을
 * 반환한다 — 그래도 모달에서 사용자가 직접 고르면 되므로 치명적이지 않음. 더 정교한 파싱이
 * 필요해지면 그때 chrono-node 같은 라이브러리 도입을 고려.
 */
import { dateKey, addDays } from './date-utils.js';

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function findDate(s, today) {
  if (/모레/.test(s)) return dateKey(addDays(today, 2));
  if (/내일/.test(s)) return dateKey(addDays(today, 1));
  if (/오늘/.test(s)) return dateKey(today);

  const daysLater = s.match(/(\d{1,2})\s*일\s*(?:뒤|후)/);
  if (daysLater) return dateKey(addDays(today, Number(daysLater[1])));

  const ymd = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ymd) return dateKey(new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));

  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || s.match(/(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/);
  if (md) {
    const y = today.getFullYear();
    let candidate = new Date(y, Number(md[1]) - 1, Number(md[2]));
    if (candidate < today) candidate = new Date(y + 1, Number(md[1]) - 1, Number(md[2])); // 이미 지난 날짜면 내년으로
    return dateKey(candidate);
  }

  const wd = s.match(/(다음\s*주|이번\s*주)?\s*([일월화수목금토])요일/);
  if (wd) {
    const targetIdx = WEEKDAY_NAMES.indexOf(wd[2]);
    let diff = (targetIdx - today.getDay() + 7) % 7;
    const scope = (wd[1] || '').replace(/\s/g, '');
    if (scope === '다음주') diff += 7;
    else if (diff === 0) diff = 7; // 범위 표현 없이 "화요일"만 있으면 오늘이 아니라 다음 주로 해석
    return dateKey(addDays(today, diff));
  }

  return null;
}

function findTime(s) {
  const ampm = s.match(/(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/);
  if (ampm) {
    let h = Number(ampm[2]);
    const min = ampm[3] ? Number(ampm[3]) : 0;
    const period = ampm[1];
    if ((period === '오후' || period === '저녁' || period === '밤') && h < 12) h += 12;
    if (period === '오전' && h === 12) h = 0;
    if (h <= 23 && min <= 59) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  const hm = s.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (hm) return `${hm[1].padStart(2, '0')}:${hm[2]}`;

  return null;
}

export function guessDateTimeFromText(text) {
  const s = (text || '').trim();
  if (!s) return { date: null, time: null };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return { date: findDate(s, today), time: findTime(s) };
}
