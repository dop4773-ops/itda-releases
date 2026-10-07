/**
 * 메신저에서 불러온 항목 → 잇다 일정 제목/메모/시간으로 만드는 순수 함수들(DB·화면 의존 없음).
 * 환자 이름은 "이름 표시" 설정(full 전체 / mask 가운데 가림 / hide 숨김)대로만 쓴다.
 */
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- 이름 / 방 ----------
// 이미 가린 값에 다시 적용해도 같은 결과(멱등)라서, 저장된 값을 더 엄격한 설정으로 바로 바꿀 수 있다.
function maskName(name, mode) {
  const n = String(name || '').trim();
  if (mode === 'hide' || !n) return '';
  if (mode === 'full') return n;
  const chars = [...n];
  if (chars.length <= 1) return n;
  if (chars.length === 2) return `${chars[0]}○`;
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

const roomLabel = (room) => {
  const r = String(room || '').trim();
  return /^\d+$/.test(r) ? `${r}호` : r;
};

// ---------- 날짜 / 시간 ----------
function dateLabel(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return `${m}/${d}일(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

const okTime = (h, m) => (h >= 0 && h <= 23 && m >= 0 && m <= 59 ? { h, m } : null);

// 메신저의 시간 입력은 자유 텍스트(최대 40자) — "13:00", "1300", "오후 1시 30분"은 시각으로 읽고, 나머지("오전(시간미정)" 등)는 null.
function parseTime(text) {
  const t = String(text || '').trim();
  let m = t.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (m) return okTime(Number(m[1]), Number(m[2]));
  m = t.match(/^(\d{2})(\d{2})$/);
  if (m) return okTime(Number(m[1]), Number(m[2]));
  m = t.match(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (m) return okTime((Number(m[2]) % 12) + (m[1] === '오후' ? 12 : 0), Number(m[3] || 0));
  return null;
}

function timeLabel(text) {
  const t = parseTime(text);
  if (t) {
    const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
    return `${t.h < 12 ? '오전' : '오후'} ${h12}시${t.m ? ` ${t.m}분` : ''}`;
  }
  return String(text || '').trim().slice(0, 40);
}

// 같은 날 정렬용 — 시각을 읽을 수 있으면 분 단위, 못 읽으면 뒤로
const timeKey = (text) => {
  const t = parseTime(text);
  return t ? t.h * 60 + t.m : 24 * 60;
};

// ---------- 메모: 자동 영역 + 내 메모 영역 ----------
const AUTO_HEAD = '[메신저에서 가져온 내용 · 자동으로 갱신돼요]';
const USER_HEAD = '[내 메모]';

function composeMemo(auto, user = '') {
  return `${AUTO_HEAD}\n${auto}\n\n${USER_HEAD}\n${user}`;
}

// 구분선이 사라졌으면(사용자가 지움) null — 그땐 메모를 건드리지 않는다.
function splitMemo(memo) {
  const s = String(memo || '');
  const u = s.indexOf(`\n${USER_HEAD}`);
  if (!s.startsWith(AUTO_HEAD) || u < 0) return null;
  return {
    auto: s.slice(AUTO_HEAD.length + 1, u).replace(/\s+$/, ''),
    user: s.slice(u + 1 + USER_HEAD.length).replace(/^\n/, ''),
  };
}

// ---------- 일정 만들기 ----------
const personLine = (item, nameMode) => {
  const name = maskName(item.patient, nameMode);
  return [item.rm, roomLabel(item.room), name ? `${name}님` : ''].filter(Boolean).join(' ');
};

// 보충 입력 한 줄: "여/75세 · 진단 요추 골절 · 이동수단 휠체어" — 비어 있으면 ''
function supplementLine(sup) {
  if (!sup) return '';
  const who = [sup.gender, sup.age != null && sup.age !== '' ? `${sup.age}세` : ''].filter(Boolean).join('/');
  return [who, sup.diagnosis && `진단 ${sup.diagnosis}`, sup.transport && `이동수단 ${sup.transport}`].filter(Boolean).join(' · ');
}

const sortItems = (a, b) =>
  timeKey(a.time_text) - timeKey(b.time_text) || String(a.ward).localeCompare(String(b.ward)) || String(a.room).localeCompare(String(b.room)) || String(a.ext_id).localeCompare(String(b.ext_id));

// 하루의 입원(또는 퇴원) 전체를 일정 하나로: 제목 "입원 3명", 메모 = 날짜 줄 + 환자별(사람 줄 / 비고 / 시간)
// supplements({'source:ext_id': 보충 입력})를 주면 사람 줄 아래에 한 줄 덧붙인다 — 일정 메모(구글 캘린더로도 나감)에는 주지 않고 전달용 문구에만 쓴다
function buildDaySummary(kind, date, items, { nameMode, supplements = null }) {
  const out = [dateLabel(date)];
  [...items].sort(sortItems).forEach((it, i, arr) => {
    out.push(personLine(it, nameMode));
    const sup = supplementLine(supplements && supplements[`${it.source}:${it.ext_id}`]);
    if (sup) out.push(sup);
    String(it.note || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((l) => out.push(l));
    const t = timeLabel(it.time_text);
    if (t) out.push(t);
    if (i < arr.length - 1) out.push('');
  });
  return { title: `${kind === 'admission' ? '입원' : '퇴원'} ${items.length}명`, auto: out.join('\n'), allDay: true, startAt: `${date} 00:00:00`, endAt: `${date} 23:59:59` };
}

const hhmm = (t) => `${pad2(t.h)}:${pad2(t.m)}:00`;
const plusHour = (t) => (t.h >= 23 ? { h: 23, m: 59 } : { h: t.h + 1, m: t.m });

// 외출·외박·병동이동은 항목마다 일정 하나. 시각을 읽을 수 있고 하루짜리면 시간 일정, 아니면 종일.
function buildItemEvent(item, { nameMode }) {
  const name = maskName(item.patient, nameMode);
  const nameTail = name ? ` ${name}님` : '';
  const lines = [];
  let title;
  let start = null;
  let end = null;

  if (item.kind === 'transfer') {
    const from = [item.ward, roomLabel(item.room)].filter(Boolean).join(' ');
    const to = [item.to_ward, roomLabel(item.to_room)].filter(Boolean).join(' ');
    title = `병동이동 · ${from}→${to}${nameTail}`;
    if (name) lines.push(`${name}님`);
    lines.push(`${from} → ${to}`);
    String(item.note || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => lines.push(l));
    const t = parseTime(item.time_text);
    if (t) {
      start = t;
      end = plusHour(t);
    }
    const tl = timeLabel(item.time_text);
    if (tl) lines.push(tl);
  } else {
    const label = item.kind === 'overnight' ? '외박' : '외출';
    const where = [item.ward, roomLabel(item.room)].filter(Boolean).join(' ');
    title = `${label}${where ? ` · ${where}` : ''}${nameTail}`;
    lines.push(personLine(item, nameMode));
    if (item.reason) lines.push(`사유: ${item.reason}`);
    const dep = timeLabel(item.time_text);
    const ret = timeLabel(item.time_text2);
    if (dep || ret) lines.push([dep && `출발 ${dep}`, ret && `복귀 ${ret}`].filter(Boolean).join(' · '));
    const d = parseTime(item.time_text);
    if (item.kind === 'outing' && d) {
      const r = parseTime(item.time_text2);
      start = d;
      end = r && r.h * 60 + r.m > d.h * 60 + d.m ? r : plusHour(d);
    }
  }

  const lastDate = item.end_date || item.date;
  const timed = !!start && lastDate === item.date;
  return {
    title,
    auto: lines.join('\n'),
    allDay: !timed,
    startAt: timed ? `${item.date} ${hhmm(start)}` : `${item.date} 00:00:00`,
    endAt: timed ? `${item.date} ${hhmm(end)}` : `${lastDate} 23:59:59`,
  };
}


// ---------- 위젯 표시용 ----------
// 시간대 칸: 시각을 읽을 수 있으면 "오후 1시", 못 읽으면 "오전/오후 시간미정" 또는 "시간 미정"
function timeBucket(text) {
  const t = parseTime(text);
  if (t) return `${t.h < 12 ? '오전' : '오후'} ${t.h % 12 === 0 ? 12 : t.h % 12}시`;
  const raw = String(text || '');
  if (/오전/.test(raw)) return '오전 시간미정';
  if (/오후/.test(raw)) return '오후 시간미정';
  return '시간 미정';
}

const STRICT = { full: 0, mask: 1, hide: 2 };
// 위젯이 요청한 표시(눈 아이콘)와 저장된 설정 중 더 엄격한 쪽 — 저장된 값보다 더 보이게는 못 한다
const stricterMode = (a, b) => (STRICT[a] >= STRICT[b] ? a : b);

// 위젯 한 줄에 필요한 값을 미리 계산(이름은 표시 모드대로 가림) — 화면은 계산 없이 그리기만 한다
function widgetRow(it, mode, sup = null) {
  const name = maskName(it.patient, mode);
  return {
    id: `${it.source}:${it.ext_id}`,
    kind: it.kind,
    date: it.date,
    endDate: it.end_date || null,
    ward: it.ward,
    room: roomLabel(it.room),
    toWard: it.to_ward,
    toRoom: roomLabel(it.to_room),
    rm: it.rm,
    name,
    person: personLine(it, mode),
    time: timeLabel(it.time_text),
    returnTime: timeLabel(it.time_text2),
    timeKey: timeKey(it.time_text),
    bucket: timeBucket(it.time_text),
    note: String(it.note || '').trim(),
    reason: String(it.reason || '').trim(),
    sup: sup ? { gender: sup.gender, age: sup.age, diagnosis: sup.diagnosis, transport: sup.transport } : null,
    supText: supplementLine(sup),
  };
}

const linkKeyDay = (kind, date) => `day:${kind}:${date}`;
const linkKeyItem = (source, extId) => `item:${source}:${extId}`;

module.exports = {
  maskName,
  roomLabel,
  dateLabel,
  parseTime,
  timeLabel,
  timeKey,
  composeMemo,
  splitMemo,
  buildDaySummary,
  buildItemEvent,
  supplementLine,
  timeBucket,
  stricterMode,
  widgetRow,
  linkKeyDay,
  linkKeyItem,
  AUTO_HEAD,
  USER_HEAD,
};
