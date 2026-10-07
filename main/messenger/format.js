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

const sortItems = (a, b) =>
  timeKey(a.time_text) - timeKey(b.time_text) || String(a.ward).localeCompare(String(b.ward)) || String(a.room).localeCompare(String(b.room)) || String(a.ext_id).localeCompare(String(b.ext_id));

// 하루의 입원(또는 퇴원) 전체를 일정 하나로: 제목 "입원 3명", 메모 = 날짜 줄 + 환자별(사람 줄 / 비고 / 시간)
function buildDaySummary(kind, date, items, { nameMode }) {
  const out = [dateLabel(date)];
  [...items].sort(sortItems).forEach((it, i, arr) => {
    out.push(personLine(it, nameMode));
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
  linkKeyDay,
  linkKeyItem,
  AUTO_HEAD,
  USER_HEAD,
};
