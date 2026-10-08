// 대시보드 블록 줄이기(block-fit)가 저장값을 건드리지 않고, 대상 종류만 다룬다는 약속
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'block-fit.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('block-fit은 설정을 읽거나 쓰지 않는다(화면 표시용 transform만)', () => {
  assert.ok(!/settings\.|itda\./.test(code));
  assert.ok(/style\.transform/.test(code));
});

test('줄이기 대상은 실제로 넘침이 확인된 시계·진행 링뿐이다', () => {
  assert.match(code, /new Set\(\['clock', 'progressRing'\]\)/);
});

test('배경이 .clk에 있는 시계(LED·다크)를 위해 .clk 자체가 아니라 자식만 줄인다', () => {
  assert.ok(/clk\.children/.test(code));
  assert.ok(!/clk\.style\.transform/.test(code));
});
