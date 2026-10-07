// 당일 알림 — 알림 대상 선별(main/day-alert collect) + 일정/할 일 저장·복제(remind_day)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { freshDb } = require('../scripts/test-helpers');
const { collect } = require('../main/day-alert');

const D = '2026-10-07';

test('collect: 알림 켠 것만 · 오늘 해당(여러 날 일정은 기간 중 매일) · 완료/삭제된 건 제외', () => {
  const db = freshDb();
  const { events, todos } = createRepositories(db);
  const ev = (title, start, end, o = {}) => events.insert({ title, startAt: `${start} 00:00:00`, endAt: `${end} 23:59:59`, allDay: true, ...o }).id;
  ev('오늘 종일(알림)', D, D, { remindDay: true });
  ev('알림 꺼짐', D, D);
  ev('어제만', '2026-10-06', '2026-10-06', { remindDay: true });
  ev('3일짜리(오늘 포함)', '2026-10-06', '2026-10-08', { remindDay: true });
  const gone = ev('삭제됨', D, D, { remindDay: true });
  events.softDelete(gone);
  const td = (title, due, o = {}) => todos.insert({ title, dueDate: due, ...o }).id;
  td('오늘 마감(알림)', D, { remindDay: true });
  td('알림 꺼짐', D);
  td('내일 마감', '2026-10-08', { remindDay: true });
  const done = td('완료함', D, { remindDay: true });
  todos.setDone(done, 1);

  const r = collect(db, D);
  assert.deepEqual(r.events.map((e) => e.title).sort(), ['3일짜리(오늘 포함)', '오늘 종일(알림)']);
  assert.deepEqual(r.todos.map((t) => t.title), ['오늘 마감(알림)']);
  assert.ok(r.events.every((e) => e.allDay && /^e:\d+$/.test(e.key)));
});

test('remind_day: 수정으로 켜고 끄기 · 반복 시리즈에 복제 · 컬럼 기본값 0', () => {
  const db = freshDb();
  const { events, todos } = createRepositories(db);
  const id = events.insert({ title: 'x', startAt: `${D} 00:00:00`, endAt: `${D} 23:59:59`, allDay: true }).id;
  assert.equal(events.getById(id).remind_day, 0);
  const ev = events.getById(id);
  events.update({ id, title: 'x', categoryId: null, location: null, startAt: ev.start_at, endAt: ev.end_at, allDay: 1, memo: null, remindDay: 1 });
  assert.equal(events.getById(id).remind_day, 1);

  const parent = todos.insert({ title: '반복', dueDate: D, recurrenceRule: 'daily', remindDay: true });
  todos.insertSeries(todos.getById(parent.id), ['2026-10-08', '2026-10-09']);
  const kids = db.prepare('SELECT remind_day FROM todos WHERE recurrence_parent_id = ?').all(parent.id);
  assert.equal(kids.length, 2);
  assert.ok(kids.every((k) => k.remind_day === 1));
});
