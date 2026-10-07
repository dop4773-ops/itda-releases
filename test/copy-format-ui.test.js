const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../main/messenger/format');

const load = () => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'copy-format-ui.js'), 'utf8')).toString('base64'));

const items = [
  { source: 'a', ext_id: '1', patient: '김영자', rm: 'RM8', ward: '5병동', room: '504', time_text: '오후1시', note: '뇌출혈 / 재입원' },
  { source: 'a', ext_id: '2', patient: '박철수', rm: 'RM4', ward: '8병동', room: '802', time_text: '오후3시', note: '' },
];
const sups = { 'a:1': { gender: '여', age: 75, diagnosis: '요추 골절', transport: '휠체어' } };
const text = (format) => F.buildCopyText('admission', '2026-10-07', items, { nameMode: 'full', supplements: sups, format });

test('기본 모양은 main의 기본 형식과 같다', async () => {
  const U = await load();
  assert.deepStrictEqual(U.stateToFormat(U.DEFAULT_STATE), F.DEFAULT_COPY_FORMAT);
  assert.strictEqual(U.matchPreset(U.DEFAULT_STATE), 'basic');
});

test('한 줄씩: 환자마다 한 줄에 " · "로 이어지고 빈 항목은 사라진다', async () => {
  const U = await load();
  assert.strictEqual(text(U.stateToFormat(U.PRESETS.oneline.state)), [
    '입원 2명',
    '10/7일(수)',
    'RM8 504호 김영자님 · 오후 1시 · 여/75세 · 진단 요추 골절 · 이동수단 휠체어 · 뇌출혈 / 재입원',
    'RM4 802호 박철수님 · 오후 3시',
  ].join('\n'));
});

test('간단히: 호실·이름만, 날짜 줄 없음', async () => {
  const U = await load();
  assert.strictEqual(text(U.stateToFormat(U.PRESETS.simple.state)), '입원 2명\n504호 김영자님\n802호 박철수님');
});

test('항목을 하나씩 껐다 켜면 모양 강조가 풀리고, 이상한 저장값은 기본으로 정리된다', async () => {
  const U = await load();
  const s = { ...U.DEFAULT_STATE, fields: { ...U.DEFAULT_STATE.fields, ward: true } };
  assert.strictEqual(U.matchPreset(s), null);
  assert.match(text(U.stateToFormat(s)), /RM8 5병동 504호 김영자님/);
  assert.deepStrictEqual(U.normalizeState('garbage'), U.normalizeState(U.DEFAULT_STATE));
  assert.strictEqual(U.normalizeState({ layout: 'x', gap: 'y' }).layout, 'multi');
});

test('전부 끄면 빈 문구(미리보기가 안내를 보여줌)', async () => {
  const U = await load();
  const off = { title: false, date: false, fields: { name: false, rm: false, ward: false, room: false, time: false, sup: false, note: false }, layout: 'multi', gap: 'blank' };
  assert.strictEqual(text(U.stateToFormat(off)), '');
});
