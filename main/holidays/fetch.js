/**
 * 인터넷에서 한국 공휴일(대체공휴일·선거일 포함) 불러오기. (연차관리 앱과 같은 방식)
 * 1순위: holidays-kr (한국천문연구원 특일정보를 정리한 JSON, https://github.com/hyunbinseo/holidays-kr)
 * 2순위: Google 대한민국 휴일 캘린더(ICS) 중 '공휴일'만 (어버이날 같은 기념일은 제외)
 * 반환: [{ date: 'YYYY-MM-DD', name }] 날짜순. 같은 날 여러 개면 이름을 ', '로 합친다.
 */
const KR_JSON_URL = (year) => `https://holidays.hyunbin.page/${year}.json`;
const GOOGLE_ICS_URL =
  'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';

async function httpGetText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseHolidaysKr(json, year) {
  return Object.keys(json)
    .filter((d) => d.startsWith(`${year}-`))
    .map((date) => ({ date, name: [].concat(json[date]).join(', ') }));
}

function parseGoogleIcs(ics, year) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, ''); // 줄바꿈 접힘 풀기
  const byDate = {};
  unfolded.split('BEGIN:VEVENT').slice(1).forEach((ev) => {
    const date = (ev.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/) || []).slice(1).join('-');
    const name = ((ev.match(/\nSUMMARY:(.*)/) || [])[1] || '').trim();
    const isHoliday = /\nDESCRIPTION:공휴일/.test(ev); // '기념일'은 쉬는 날이 아니라 제외
    if (!date.startsWith(`${year}-`) || !name || !isHoliday) return;
    (byDate[date] = byDate[date] || []).push(name);
  });
  return Object.keys(byDate).map((date) => ({ date, name: byDate[date].join(', ') }));
}

async function fetchKoreanHolidays(year) {
  let list;
  try {
    list = parseHolidaysKr(JSON.parse(await httpGetText(KR_JSON_URL(year))), year);
  } catch (err) {
    console.error('[holidays] holidays-kr 실패, Google 캘린더로 재시도:', err.message);
    list = parseGoogleIcs(await httpGetText(GOOGLE_ICS_URL), year);
  }
  if (!list.length) throw new Error(`${year}년 공휴일 정보가 아직 없어요.`);
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { fetchKoreanHolidays, parseHolidaysKr, parseGoogleIcs };
