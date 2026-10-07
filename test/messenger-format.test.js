// 메신저 항목 → 일정 제목/메모/시간 (main/messenger/format.js) — 순수 함수
const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../main/messenger/format');

test('이름 가리기: 전체/가림/숨김, 이미 가린 값에 다시 적용해도 같음(멱등)', () => {
  assert.equal(F.maskName('김가람', 'full'), '김가람');
  assert.equal(F.maskName('김가람', 'mask'), '김○람');
  assert.equal(F.maskName('남궁민수', 'mask'), '남○○수');
  assert.equal(F.maskName('이안', 'mask'), '이○');
  assert.equal(F.maskName('김가람', 'hide'), '');
  assert.equal(F.maskName('김○람', 'mask'), '김○람');
  assert.equal(F.maskName('김○람', 'hide'), '');
  assert.equal(F.maskName('', 'full'), '');
});

test('시각 읽기: 13:00 / 1300 / 오후 1시 30분은 시각, 오전(시간미정)·빈값은 null', () => {
  assert.deepEqual(F.parseTime('13:00'), { h: 13, m: 0 });
  assert.deepEqual(F.parseTime('8:30'), { h: 8, m: 30 });
  assert.deepEqual(F.parseTime('0830'), { h: 8, m: 30 });
  assert.deepEqual(F.parseTime('오후 1시 30분'), { h: 13, m: 30 });
  assert.deepEqual(F.parseTime('오전12시'), { h: 0, m: 0 });
  assert.equal(F.parseTime('오전(시간미정)'), null);
  assert.equal(F.parseTime(''), null);
  assert.equal(F.parseTime('25:99'), null);
});

test('시각 표기: 오후 1시 / 오전 9시 30분 / 못 읽는 글은 그대로', () => {
  assert.equal(F.timeLabel('13:00'), '오후 1시');
  assert.equal(F.timeLabel('09:30'), '오전 9시 30분');
  assert.equal(F.timeLabel('0000'), '오전 12시');
  assert.equal(F.timeLabel('오전(시간미정)'), '오전(시간미정)');
  assert.equal(F.timeLabel(''), '');
  assert.ok(F.timeKey('08:00') < F.timeKey('13:00') && F.timeKey('13:00') < F.timeKey('오전(시간미정)'));
});

test('날짜 줄: 10/7일(수)', () => {
  assert.equal(F.dateLabel('2026-10-07'), '10/7일(수)');
  assert.equal(F.dateLabel('2026-12-25'), '12/25일(금)');
});

test('메모: 자동 영역 + 내 메모 영역 — 합치고 나누고, 구분선이 없어지면 null', () => {
  const m = F.composeMemo('자동 내용\n둘째 줄', '내가 쓴 것');
  assert.deepEqual(F.splitMemo(m), { auto: '자동 내용\n둘째 줄', user: '내가 쓴 것' });
  assert.deepEqual(F.splitMemo(F.composeMemo('x', '')), { auto: 'x', user: '' });
  assert.equal(F.splitMemo('그냥 메모'), null);
  assert.equal(F.splitMemo(m.replace(F.USER_HEAD, '')), null);
});

const A = (o) => ({ source: 'admission', ext_id: 'a', kind: 'admission', date: '2026-10-07', patient: '김가람', rm: 'RM8', ward: '5병동', room: '504호', time_text: '13:00', note: '', ...o });

test('입원 하루 요약: 제목 "입원 N명", 사용자가 말한 형식(날짜 / 사람 줄 / 비고 / 시간)과 시간순 정렬', () => {
  const s = F.buildDaySummary(
    'admission',
    '2026-10-07',
    [A({ ext_id: 'b', patient: '이나래', rm: 'RM6', room: '411호', time_text: '오전(시간미정)' }), A({ ext_id: 'a', note: '뇌출혈 / 타병원 수술 후 재입원' })],
    { nameMode: 'full' }
  );
  assert.equal(s.title, '입원 2명');
  assert.equal(s.allDay, true);
  assert.equal(s.startAt, '2026-10-07 00:00:00');
  assert.equal(s.endAt, '2026-10-07 23:59:59');
  assert.equal(s.auto, ['10/7일(수)', 'RM8 504호 김가람님', '뇌출혈 / 타병원 수술 후 재입원', '오후 1시', '', 'RM6 411호 이나래님', '오전(시간미정)'].join('\n'));
});

test('이름 표시 설정이 사람 줄에 반영: 가림은 김○람님, 숨김은 이름 줄 생략, 방 번호만 숫자면 "호" 붙임', () => {
  const mk = (mode) => F.buildDaySummary('discharge', '2026-10-07', [A({ kind: 'discharge', room: '506' })], { nameMode: mode });
  assert.equal(mk('mask').auto.split('\n')[1], 'RM8 506호 김○람님');
  assert.equal(mk('hide').auto.split('\n')[1], 'RM8 506호');
  assert.equal(mk('hide').title, '퇴원 1명');
});

const O = (o) => ({ source: 'outing', ext_id: 'o', kind: 'outing', date: '2026-10-08', end_date: null, patient: '윤도윤', rm: 'RM6', ward: '4병동', room: '411호', time_text: '13:00', time_text2: '16:00', reason: '외진', note: '', ...o });

test('외출: 출발·복귀 시각을 읽을 수 있으면 시간 일정, 못 읽으면 종일', () => {
  const t = F.buildItemEvent(O(), { nameMode: 'mask' });
  assert.equal(t.title, '외출 · 4병동 411호 윤○윤님');
  assert.equal(t.allDay, false);
  assert.equal(t.startAt, '2026-10-08 13:00:00');
  assert.equal(t.endAt, '2026-10-08 16:00:00');
  assert.match(t.auto, /사유: 외진/);
  assert.match(t.auto, /출발 오후 1시 · 복귀 오후 4시/);
  const u = F.buildItemEvent(O({ time_text: '오전(시간미정)', time_text2: '' }), { nameMode: 'mask' });
  assert.equal(u.allDay, true);
  assert.equal(u.endAt, '2026-10-08 23:59:59');
  const r = F.buildItemEvent(O({ time_text2: '' }), { nameMode: 'hide' }); // 복귀 시각 없으면 1시간
  assert.equal(r.endAt, '2026-10-08 14:00:00');
  assert.equal(r.title, '외출 · 4병동 411호');
});

test('외박: 여러 날 종일 일정(시작일~종료일)', () => {
  const e = F.buildItemEvent(O({ kind: 'overnight', date: '2026-10-07', end_date: '2026-10-09', time_text: '10:00', time_text2: '17:00' }), { nameMode: 'hide' });
  assert.equal(e.title, '외박 · 4병동 411호');
  assert.equal(e.allDay, true);
  assert.equal(e.startAt, '2026-10-07 00:00:00');
  assert.equal(e.endAt, '2026-10-09 23:59:59');
});

test('병동이동: 이전→이후, 시각 있으면 1시간짜리 시간 일정', () => {
  const e = F.buildItemEvent({ source: 'transfer', ext_id: 't', kind: 'transfer', date: '2026-10-07', patient: '장하윤', ward: '4병동', room: '403호', to_ward: '5병동', to_room: '502호', time_text: '14:00', note: '병실 조정' }, { nameMode: 'mask' });
  assert.equal(e.title, '병동이동 · 4병동 403호→5병동 502호 장○윤님');
  assert.equal(e.allDay, false);
  assert.equal(e.startAt, '2026-10-07 14:00:00');
  assert.equal(e.endAt, '2026-10-07 15:00:00');
  assert.match(e.auto, /병실 조정/);
});
