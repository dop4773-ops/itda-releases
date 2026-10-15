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

const PASTEL = ['#FFF3C9', '#DDF3F0', '#FCE7E7', '#E4EBFF', '#DDF3F0', '#F8DCE5', '#FCE7EF', '#FCE9B5', '#DDF3F0', '#F7EBDD', '#E4EBFF'];
const VIVID = ['#ff3d71', '#00c2a8', '#ff6b35', '#6c5ce7', '#8ddad3', '#c44569', '#f8bbd0', '#f4c430', '#00a896', '#c8a98a'];
const lightness = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
};

test('비슷하다는 기준은 팔레트에 맞춰 달라진다 — 파스텔은 거의 같은 색만, 선명한 색은 넓게', async () => {
  const { similarThreshold, findSimilarPairs } = await load();
  const tp = similarThreshold(PASTEL);
  const tv = similarThreshold(VIVID);
  assert.ok(tp < 6 && tp >= 3, `파스텔 기준 ${tp}`);
  assert.ok(tv > 15, `선명 기준 ${tv}`);
  const cats = PASTEL.map((color_hex, id) => ({ id, name: `c${id}`, color_hex }));
  const pairs = findSimilarPairs(cats, tp);
  // 완전히 같은 색(낙상·입원·입사 / 외래·비회복기)과 거의 같은 분홍 정도만 — 모든 쌍이 걸리면 안 된다
  assert.ok(pairs.length >= 5 && pairs.length <= 8, `걸린 쌍 ${pairs.length}`);
  assert.ok(pairs.length < (cats.length * (cats.length - 1)) / 2 / 4);
  assert.equal(similarThreshold(['#ff0000']), 22); // 색이 너무 적으면 기본값
});

test('빈 색 추천(기본 "현재 색에 맞춤"): 파스텔이면 파스텔로, 기존 색과 겹치지 않게', async () => {
  const { suggestColors, deltaE, similarThreshold } = await load();
  const out = suggestColors(PASTEL, 6);
  assert.ok(out.length >= 4, `추천 ${out.length}개`);
  const thr = similarThreshold(PASTEL);
  for (const c of out) {
    assert.ok(lightness(c) > 0.8, `${c} 밝기 ${lightness(c).toFixed(2)} — 파스텔 톤을 벗어남`);
    for (const e of PASTEL) assert.ok(deltaE(c, e) >= thr * 1.5, `${c} vs ${e}`);
  }
  assert.equal(new Set(out).size, out.length);
});

test('빈 색 추천: 선명한 팔레트는 선명하게, 테마를 고르면 그 톤으로', async () => {
  const { suggestColors } = await load();
  const matchVivid = suggestColors(VIVID, 6);
  assert.ok(matchVivid.length >= 4);
  assert.ok(matchVivid.every((c) => lightness(c) < 0.75), '선명한 팔레트 추천이 파스텔로 나옴');
  // 파스텔 팔레트에서 "선명" 테마를 직접 고르면 선명한 색이 나온다
  const vividPick = suggestColors(PASTEL, 6, 'vivid');
  assert.ok(vividPick.length >= 4 && vividPick.every((c) => lightness(c) < 0.75));
  // 선명한 팔레트에서 "파스텔" 테마도 빈 배열이 아니다
  assert.ok(suggestColors(VIVID, 6, 'pastel').length >= 4);
  // 색이 하나도 없어도 6개
  assert.equal(suggestColors([], 6).length, 6);
});

test('추천 테마 목록: 기본은 match, 나머지는 톤이 있다', async () => {
  const { SUGGEST_THEMES } = await load();
  assert.ok(SUGGEST_THEMES.match.label);
  for (const k of ['pastel', 'vivid', 'muted', 'deep']) assert.ok(Array.isArray(SUGGEST_THEMES[k].tones) && SUGGEST_THEMES[k].tones.length);
});

test('hex 검증·변환', async () => {
  const { isHex, hexToRgb, rgbToHex } = await load();
  assert.equal(isHex('#2F6BFF'), true);
  assert.equal(isHex('2F6BFF'), true);
  assert.equal(isHex('#2F6BF'), false);
  assert.deepEqual(hexToRgb('#2F6BFF'), [47, 107, 255]);
  assert.equal(rgbToHex([47, 107, 255]), '#2f6bff');
});
