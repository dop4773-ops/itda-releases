const test = require('node:test');
const assert = require('node:assert');
const { fitBoundsToScreens } = require('../main/shared/window-bounds');

const main = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1920, height: 1040 };

test('화면 안에 있으면 그대로', () => {
  const b = { x: 100, y: 100, width: 300, height: 360 };
  assert.deepStrictEqual(fitBoundsToScreens(b, [main], main), b);
});

test('위치가 없으면(OS가 정함) 건드리지 않는다', () => {
  const b = { width: 300, height: 360 };
  assert.deepStrictEqual(fitBoundsToScreens(b, [main], main), b);
});

test('모니터를 뺀 뒤 두 번째 화면에 있던 위젯은 기본 화면 가운데로', () => {
  const r = fitBoundsToScreens({ x: 2500, y: 200, width: 300, height: 360 }, [main], main);
  assert.deepStrictEqual(r, { x: 810, y: 340, width: 300, height: 360 });
  // 두 번째 화면이 있으면 그대로 둔다
  const keep = { x: 2500, y: 200, width: 300, height: 360 };
  assert.deepStrictEqual(fitBoundsToScreens(keep, [main, second], main), keep);
});

test('가장자리에 일부만 걸쳐 있어도 보이면 그대로, 완전히 벗어나면 옮긴다', () => {
  const edge = { x: 1850, y: 100, width: 300, height: 360 }; // 70px만 보임 → 80 미만이라 옮김
  assert.notDeepStrictEqual(fitBoundsToScreens(edge, [main], main), edge);
  const ok = { x: 1800, y: 100, width: 300, height: 360 }; // 120px 보임
  assert.deepStrictEqual(fitBoundsToScreens(ok, [main], main), ok);
  const below = { x: 100, y: 1100, width: 300, height: 360 };
  assert.notDeepStrictEqual(fitBoundsToScreens(below, [main], main), below);
});

test('화면보다 큰 창은 화면 크기로 줄여서 옮긴다', () => {
  const r = fitBoundsToScreens({ x: 5000, y: 0, width: 3000, height: 2000 }, [main], main);
  assert.deepStrictEqual([r.width, r.height], [1920, 1040]);
});
