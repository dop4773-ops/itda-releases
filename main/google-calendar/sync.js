// 동기화 범위: 지난달 1일 ~ 3개월 뒤 1일. 병원 업무 특성상 "최근~가까운 미래" 위주로만
// 가져오면 충분하고, 범위를 넓게 잡을수록 매 동기화가 느려지므로 적당히 제한한다.
function syncWindow(now = new Date()) {
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString();
  return { timeMin, timeMax };
}

async function fetchCalendarList(accessToken) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`캘린더 목록 조회 실패 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    backgroundColor: c.backgroundColor || null,
  }));
}

async function fetchGoogleEvents(accessToken, calendarId, { timeMin, timeMax }) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true', // 반복 일정을 개별 인스턴스로 풀어서 받음 (RRULE 직접 해석 안 해도 됨)
    orderBy: 'startTime',
    maxResults: '250',
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Calendar 조회 실패 (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.items || [];
}

// Google 이벤트 원본(raw) -> google_calendar_events 테이블 형식으로 변환.
// 하루종일 일정은 start.date만 있고 start.dateTime이 없다 (Google API 스펙).
//
// 주의: 하루종일 일정의 end.date는 Google 쪽에서 "배타적"(그 날짜는 포함 안 됨, 마지막 날의 다음날)로
// 내려온다. 예를 들어 8/10~8/12 3일짜리 휴가는 start.date=8/10, end.date=8/13으로 온다.
// 잇다의 로컬 일정은 반대로 "포함적"(마지막 날짜의 23:59:59)으로 저장하므로, 그대로 넣으면
// 하루가 밀리거나(달력에 마지막 날이 하루 더 표시) groupByDateKey에서 범위 계산이 어긋난다.
// 그래서 여기서 하루를 빼서 로컬 규칙에 맞춰준다.
function normalizeEvent(raw, calendarId) {
  const isAllDay = !!(raw.start && raw.start.date && !raw.start.dateTime);
  const startAt = isAllDay ? `${raw.start.date} 00:00:00` : (raw.start?.dateTime || '').replace('T', ' ').slice(0, 19);
  const endAt = isAllDay ? `${shiftDateString(raw.end.date, -1)} 23:59:59` : (raw.end?.dateTime || '').replace('T', ' ').slice(0, 19);
  return {
    googleEventId: raw.id,
    googleCalendarId: calendarId,
    title: raw.summary || '(제목 없음)',
    location: raw.location || null,
    startAt,
    endAt,
    allDay: isAllDay,
    rawJson: JSON.stringify(raw),
  };
}

// 'YYYY-MM-DD' 문자열에 일(day) 단위로 offset을 더해서 다시 'YYYY-MM-DD'로 돌려준다.
// 타임존 문제를 피하려고 로컬 자정 기준 Date 객체로 계산한다.
function shiftDateString(dateStr, offsetDays) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// getAccessToken: () => Promise<string> — 호출 시점에 유효한 토큰을 돌려주는 함수를 주입받는다
// (매번 token-manager를 거치게 해서 만료 시 자동 갱신이 항상 적용되도록)
// calendarId: 동기화할 캘린더(설정에서 고른 것). 아직 안 골랐으면 기본값 'primary'.
async function syncNow(repos, getAccessToken, calendarId = 'primary') {
  const accessToken = await getAccessToken();
  const rawEvents = await fetchGoogleEvents(accessToken, calendarId, syncWindow());
  const normalized = rawEvents.filter((e) => e.status !== 'cancelled').map((e) => normalizeEvent(e, calendarId));

  repos.googleCalendar.replaceAll(normalized);
  return { count: normalized.length, syncedAt: new Date().toISOString() };
}

module.exports = { syncNow, fetchGoogleEvents, fetchCalendarList, normalizeEvent, syncWindow };
