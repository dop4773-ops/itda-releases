// 빠른 찾기 프리픽스 파서 — renderer/shared/quick-find-core.js 의 parseQuery.
// 그 파일은 window 의존은 없지만 ESM이라 통째로 require 못 함 — 규칙만 1:1로 옮겨 검증한다.
// ⚠ quick-find-core.js의 parseQuery / TYPE_PREFIX를 바꾸면 여기도 같이 바꿀 것.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const TYPE_PREFIX = {
  메모: 'memo', 노트: 'memo', memo: 'memo',
  투두: 'todo', 할일: 'todo', todo: 'todo',
  일정: 'event', 캘린더: 'event', calendar: 'event', event: 'event',
  포스트잇: 'postit', postit: 'postit',
  인박스: 'inbox', inbox: 'inbox',
};

function parseQuery(raw, tagNames = []) {
  let text = String(raw || '').replace(/^\s+/, '');
  let type = null;
  let tag = null;
  const tagM = text.match(/^([#@])(\S+)\s*([\s\S]*)$/);
  if (tagM) {
    const hit = tagNames.find((n) => n && n.toLowerCase() === tagM[2].toLowerCase());
    if (hit) {
      tag = hit;
      text = tagM[3];
    }
  }
  const sp = text.search(/\s/);
  if (sp > 0) {
    const head = text.slice(0, sp).toLowerCase();
    if (TYPE_PREFIX[head]) {
      type = TYPE_PREFIX[head];
      text = text.slice(sp + 1);
    }
  }
  return { type, tag, text: text.trim() };
}

test('타입 프리픽스: "메모 회의록" → memo + 회의록', () => {
  assert.deepEqual(parseQuery('메모 회의록'), { type: 'memo', tag: null, text: '회의록' });
  assert.deepEqual(parseQuery('할일 정리'), { type: 'todo', tag: null, text: '정리' });
  assert.deepEqual(parseQuery('todo foo'), { type: 'todo', tag: null, text: 'foo' });
});

test('프리픽스만: "메모 " → memo + 빈 텍스트(그 범위 최근 목록용)', () => {
  assert.deepEqual(parseQuery('메모 '), { type: 'memo', tag: null, text: '' });
});

test('공백 없이 "메모"만 = 프리픽스 아님(검색어)', () => {
  assert.deepEqual(parseQuery('메모'), { type: null, tag: null, text: '메모' });
  assert.deepEqual(parseQuery('할머니 생신'), { type: null, tag: null, text: '할머니 생신' });
});

test('태그 프리픽스: #재활 / @재활 둘 다, 존재하는 태그명일 때만', () => {
  const tags = ['재활', '프로젝트'];
  assert.deepEqual(parseQuery('#재활 회의록', tags), { type: null, tag: '재활', text: '회의록' });
  assert.deepEqual(parseQuery('@재활', tags), { type: null, tag: '재활', text: '' });
  assert.deepEqual(parseQuery('#없는거 회의록', tags), { type: null, tag: null, text: '#없는거 회의록' });
});

test('태그 + 타입 같이: "#재활 메모 회의록"', () => {
  assert.deepEqual(parseQuery('#재활 메모 회의록', ['재활']), { type: 'memo', tag: '재활', text: '회의록' });
});

test('태그명 대소문자 무관', () => {
  assert.deepEqual(parseQuery('#Rehab foo', ['rehab']), { type: null, tag: 'rehab', text: 'foo' });
});

// eventDateLabel — quick-find-core.js. ⚠ 그쪽 로직 바꾸면 여기도.
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function eventDateLabel(startAt, allDay) {
  if (!startAt) return '';
  const s = String(startAt).replace(' ', 'T');
  const hasTime = /T\d{2}:\d{2}/.test(s);
  const d = new Date(hasTime ? s : s.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const md = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${WD[d.getDay()]})`;
  if (allDay || !hasTime) return md;
  return `${md} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

test('eventDateLabel: 연월일 + 요일, 시간 있으면 HH:MM, 날짜만이면 날짜만', () => {
  const wd = (s) => WD[new Date(s).getDay()];
  assert.equal(eventDateLabel('2026-09-10 14:05', false), `2026. 9. 10 (${wd('2026-09-10T14:05')}) 14:05`);
  assert.equal(eventDateLabel('2026-09-10 00:00', true), `2026. 9. 10 (${wd('2026-09-10T00:00')})`);
  assert.equal(eventDateLabel('2026-09-10', false), `2026. 9. 10 (${wd('2026-09-10T00:00:00')})`, '날짜만 주면 시간 없이');
  assert.equal(eventDateLabel('2099-01-02 09:00', false), `2099. 1. 2 (${wd('2099-01-02T09:00')}) 09:00`);
  assert.equal(eventDateLabel('', false), '');
  assert.equal(eventDateLabel('nope', false), '');
});
