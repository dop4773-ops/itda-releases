const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'fit-zoom.js'), 'utf8')).toString('base64'));
const win = (outerW, outerH, frameW = 16, frameH = 39) => ({ outerW, outerH, innerW: outerW - frameW, innerH: outerH - frameH });

test('예전 최소 크기(1024x700) 이상이면 축소하지 않는다', async () => {
  const { fitFactor } = await load();
  assert.strictEqual(fitFactor(win(1024, 700)), 1);
  assert.strictEqual(fitFactor(win(1440, 900)), 1);
  assert.strictEqual(fitFactor(win(1920, 1040)), 1);
});

test('창을 줄이면 폭(또는 높이) 비율만큼 균일하게 줄고, 효과적인 안쪽 크기는 예전 최소 크기와 같다', async () => {
  const { fitFactor, REF } = await load();
  const w = win(512, 350);
  const f = fitFactor(w);
  assert.ok(f >= 0.45 && f <= 0.5, String(f));
  const half = win(768, 525);
  const f2 = fitFactor(half);
  // 줄어든 뒤 "화면에 들어가는 CSS 크기"(안쪽 / f)는 어느 쪽도 예전 최소 크기의 안쪽(1024-창틀 x 700-창틀)보다 작아지지 않고, 더 빡빡한 쪽은 정확히 같다
  const effW = half.innerW / f2;
  const effH = half.innerH / f2;
  assert.ok(effW >= REF.w - 16 - 1 && effH >= REF.h - 39 - 1);
  assert.ok(Math.abs(effW - (REF.w - 16)) < 2 || Math.abs(effH - (REF.h - 39)) < 2);
});

test('가로로만 좁거나 세로로만 낮아도 더 심한 쪽에 맞춘다', async () => {
  const { fitFactor } = await load();
  assert.ok(fitFactor(win(600, 900)) < 0.6);
  assert.ok(fitFactor(win(1440, 400)) < 0.6);
});

test('하한(0.45) 아래로는 안 줄고, 이상한 값은 1', async () => {
  const { fitFactor } = await load();
  assert.strictEqual(fitFactor(win(200, 150)), 0.45);
  assert.strictEqual(fitFactor({ innerW: 0, innerH: 0, outerW: 0, outerH: 0 }), 1);
});
