// 카테고리 색 도우미 — 글자색 추천·비슷한 색 판별·빈 색 추천 (DOM 없이 계산만)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let loaded;
const load = () => (loaded ||= import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../renderer/shared/color-suggest.js')).toString('base64')));

test('글자색: 밝은 배경은 검정, 진한 배경은 흰색, 애매한 파랑은 흰색', async () => {
  const { bestTextColor } = await load();
  assert.equal(bestTextColor('#f4c430'), '#000000'); // 노랑
  assert.equal(bestTextColor('#8ddad3'), '#000000'); // 연민트
  assert.equal(bestTextColor('#ff3d71'), '#000000'); // 선명한 분홍빨강
  assert.equal(bestTextColor('#2B3A67'), '#ffffff'); // 진한 남색
  assert.equal(bestTextColor('#2F6BFF'), '#ffffff'); // 로열 블루 — 두 명암비가 비슷하면 흰색
  assert.equal(bestTextColor('#000000'), '#ffffff');
  assert.equal(bestTextColor('#ffffff'), '#000000');
});

test('읽기 힘든 조합 감지 — 노랑 배경에 흰 글자', async () => {
  const { isPoorContrast, contrastRatio } = await load();
  assert.equal(isPoorContrast('#f4c430', '#ffffff'), true);
  assert.equal(isPoorContrast('#f4c430', '#000000'), false);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

test('색 거리: 같은 색 0, 비슷한 청록끼리 작고 전혀 다른 색은 큼', async () => {
  const { deltaE, findSimilar, findSimilarPairs } = await load();
  assert.equal(deltaE('#6c5ce7', '#6C5CE7'), 0);
  assert.ok(deltaE('#00c2a8', '#00a896') < 22); // 낙상 ↔ 입사
  assert.ok(deltaE('#ff3d71', '#00c2a8') > 60);
  const cats = [
    { id: 1, name: '낙상', color_hex: '#00c2a8' },
    { id: 2, name: '입사', color_hex: '#00a896' },
    { id: 3, name: '교육', color_hex: '#ff6b35' },
  ];
  const sim = findSimilar('#00b8a0', cats);
  assert.ok(sim && ['낙상', '입사'].includes(sim.name));
  assert.equal(findSimilar('#ff3d71', [cats[0], cats[1]]), null);
  const pairs = findSimilarPairs(cats);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.name, pairs[0].b.name], ['낙상', '입사']);
});

test('빈 색 추천: 기존 색과 충분히 떨어진 색만, 서로도 겹치지 않게', async () => {
  const { suggestColors, deltaE, SIMILAR_BELOW } = await load();
  const existing = ['#ff3d71', '#00c2a8', '#ff6b35', '#6c5ce7', '#8ddad3', '#c44569', '#f8bbd0', '#f4c430', '#00a896', '#c8a98a'];
  const out = suggestColors(existing, 6);
  assert.ok(out.length >= 4);
  for (const c of out) for (const e of existing) assert.ok(deltaE(c, e) >= SIMILAR_BELOW, `${c} vs ${e}`);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(deltaE(out[i], out[j]) >= SIMILAR_BELOW);
  assert.equal(new Set(out).size, out.length);
});

test('빈 색 추천: 색이 하나도 없으면 n개, 후보가 다 겹치면 빈 배열', async () => {
  const { suggestColors } = await load();
  assert.equal(suggestColors([], 6).length, 6);
  assert.deepEqual(suggestColors(['#000000'], 6, 1000), []); // 기준을 아주 크게 → 후보 없음
});

test('hex 검증·변환', async () => {
  const { isHex, hexToRgb, rgbToHex } = await load();
  assert.equal(isHex('#2F6BFF'), true);
  assert.equal(isHex('2F6BFF'), true);
  assert.equal(isHex('#2F6BF'), false);
  assert.deepEqual(hexToRgb('#2F6BFF'), [47, 107, 255]);
  assert.equal(rgbToHex([47, 107, 255]), '#2f6bff');
});
