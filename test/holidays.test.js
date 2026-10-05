// 공휴일 — 인터넷 응답 파싱(holidays-kr JSON / Google ICS) + holidays repository
const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRepositories = require('../main/repositories');
const { parseHolidaysKr, parseGoogleIcs } = require('../main/holidays/fetch');
const { freshDb } = require('../scripts/test-helpers');

test('holidays-kr JSON: 해당 연도만, 같은 날 여러 이름은 ", "로 합침', () => {
  const list = parseHolidaysKr({ '2026-05-05': ['어린이날'], '2026-05-24': ['부처님 오신 날', '일요일 겹침'], '2027-01-01': ['신정'] }, 2026);
  assert.deepEqual(list, [
    { date: '2026-05-05', name: '어린이날' },
    { date: '2026-05-24', name: '부처님 오신 날, 일요일 겹침' },
  ]);
});

test('Google ICS: DESCRIPTION이 공휴일인 것만(기념일 제외), 접힌 줄 복원', () => {
  const ics = [
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261009', 'SUMMARY:한글날', 'DESCRIPTION:공휴일', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261001', 'SUMMARY:국군의 날', 'DESCRIPTION:기념일\\n숨기려면', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20270101', 'SUMMARY:신정', 'DESCRIPTION:공휴일', 'END:VEVENT',
  ].join('\r\n');
  assert.deepEqual(parseGoogleIcs(ics, 2026), [{ date: '2026-10-09', name: '한글날' }]);
});

test('repository: addMissing은 없는 날짜만 추가하고 고친 이름은 유지', () => {
  const { holidays } = createRepositories(freshDb());
  assert.equal(holidays.addMissing([{ date: '2026-05-05', name: '어린이날' }], 'auto'), 1);
  holidays.rename('2026-05-05', '내가 고친 이름');
  assert.equal(holidays.addMissing([{ date: '2026-05-05', name: '어린이날' }, { date: '2026-06-06', name: '현충일' }], 'auto'), 1);
  assert.equal(holidays.listYear(2026).find((h) => h.date === '2026-05-05').name, '내가 고친 이름');
});

test('repository: 같은 날짜 직접 추가는 거부, 잘못된 입력 거부, range/삭제', () => {
  const { holidays } = createRepositories(freshDb());
  holidays.add('2026-12-25', '성탄절');
  assert.throws(() => holidays.add('2026-12-25', '또'), /이미 등록/);
  assert.throws(() => holidays.add('2026/12/26', 'x'), /날짜 형식/);
  assert.throws(() => holidays.add('2026-12-26', '  '), /이름/);
  assert.equal(holidays.range('2026-12-01', '2026-12-31').length, 1);
  holidays.remove('2026-12-25');
  assert.equal(holidays.range('2026-12-01', '2026-12-31').length, 0);
});
