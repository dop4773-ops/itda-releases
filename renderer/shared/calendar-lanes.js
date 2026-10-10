// 달력의 여러 날 종일 일정(휴가 등) 배치 계산 — DOM 없이 테스트할 수 있게 분리
// 여러 날에 걸친 종일 일정(휴가·연휴 등) 판별 — 종일이고 종료일이 시작일보다 뒤.
export function isMultiDayAllDay(e) {
  const s = (e.start_at || '').slice(0, 10);
  const en = (e.end_at || '').slice(0, 10);
  return !!e.all_day && !!en && en > s;
}

// 여러 날 종일 일정(휴가 등)의 "줄 번호"를 한 주(또는 보이는 날짜들) 단위로 고정한다.
// 칸마다 따로 정렬하면 2일 휴가가 끝난 날 3일 휴가가 맨 위로 올라가 막대가 끊겨 보인다(구글 캘린더처럼
// 같은 일정은 모든 날에서 같은 줄). 반환: dateKey → [event|null,...] (null=빈 줄 자리표시, 뒤쪽 빈 줄은 생략).
export function layoutMultiDayLanes(keys, byDate) {
  const seen = new Set();
  const items = [];
  keys.forEach((k) => {
    (byDate.get(k) || []).forEach((e) => {
      if (!isMultiDayAllDay(e) || seen.has(e)) return;
      seen.add(e);
      const s = (e.start_at || '').slice(0, 10);
      const en = (e.end_at || '').slice(0, 10);
      items.push({ e, first: s < keys[0] ? keys[0] : s, last: en > keys[keys.length - 1] ? keys[keys.length - 1] : en });
    });
  });
  // 먼저 시작하는 것, 같으면 더 길게 이어지는 것, 같으면 id 순 — 결정적이라 새로고침해도 자리가 안 바뀐다
  items.sort((a, b) => a.first.localeCompare(b.first) || b.last.localeCompare(a.last) || (a.e.id > b.e.id ? 1 : -1));
  const laneEnds = [];
  items.forEach((it) => {
    let lane = laneEnds.findIndex((end) => end < it.first);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = it.last;
    it.lane = lane;
  });
  const out = new Map();
  keys.forEach((k) => {
    const arr = [];
    items.forEach((it) => {
      if (it.first <= k && k <= it.last) arr[it.lane] = it.e;
    });
    for (let i = 0; i < arr.length; i += 1) if (!arr[i]) arr[i] = null;
    out.set(k, arr);
  });
  return out;
}
