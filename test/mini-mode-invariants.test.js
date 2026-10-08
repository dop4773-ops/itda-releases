// "대시보드 같은 기본 세팅은 절대 달라지면 안 된다" — 미니 모드·축소 보기 코드가 그런 저장값에 손대지 못하게 하는 안전장치.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const FILES = ['main/mini-mode/index.js', 'renderer/shared/mini-mode.js', 'renderer/shared/fit-zoom.js'];
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 주석 제외

test('미니 모드/축소 보기 코드는 대시보드 저장값(dashboard_*)·배율 재계산을 참조하지 않는다', () => {
  for (const f of FILES) {
    const c = code(read(f));
    assert.ok(!/dashboard_|dashboardLayout|DashboardLayout/.test(c), `${f}가 대시보드 저장값을 참조해요`);
    assert.ok(!/rescaleDashboardLayout|display_scale|setDisplayScale/.test(c), `${f}가 배율 저장 경로를 건드려요`);
  }
});

test('미니 모드가 저장하는 설정은 mini_bounds / mini_pin 둘뿐', () => {
  const keys = [...read('main/mini-mode/index.js').matchAll(/settings\.(?:set|get)\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(keys)].sort(), ['mini_bounds', 'mini_pin']);
  assert.ok(!/settings\.(set)\(/.test(code(read('renderer/shared/mini-mode.js')) + code(read('renderer/shared/fit-zoom.js'))), '렌더러 쪽은 설정을 직접 쓰지 않아요');
});

test('축소 보기는 shell.js의 applyZoom에서 화면 배율에 곱하기만 하고, 배율 변경(setDisplayScale)의 좌표 재계산과 분리돼 있다', () => {
  const shell = read('renderer/shared/shell.js');
  const apply = shell.slice(shell.indexOf('function applyZoom()'), shell.indexOf('let fitRaf'));
  assert.ok(/baseScale \* f/.test(apply));
  assert.ok(!/settings\./.test(apply));
});
