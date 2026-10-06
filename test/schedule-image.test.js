// 근무표 사진 일괄 등록 — 칸 위치 → 날짜 계산(detectScheduleCells), 글 붙여넣기 파싱
// renderer ESM 모듈이라 require 대신 동적 import. 순수 함수(DOM 없음)라 합성 RGBA 이미지로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');

// npm test는 Electron(Node 모드)에서 돌아 .js를 ESM으로 자동 인식하지 못한다 — 소스를 data: URL로 넘겨
// 강제로 ESM 취급한다(이 모듈은 다른 import가 없는 순수 함수 파일이라 가능).
const fs = require('node:fs');
const path = require('node:path');
let loaded;
const load = () =>
  (loaded ||= import(
    'data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../renderer/shared/schedule-image.js')).toString('base64')
  ));

// 700x800 흰 바탕에 날짜 띠(연한 주황) 5줄 + 칸 폭 100px 7열. 색칠 도우미: fill(img, x0,y0,x1,y1, [r,g,b])
function makeGrid() {
  const W = 700;
  const H = 800;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const img = { data, width: W, height: H };
  const fill = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([r, g, b, 255], (y * W + x) * 4);
  };
  for (let k = 0; k < 5; k++) fill(0, 50 + k * 150, W, 80 + k * 150, [252, 229, 214]);
  return { img, fill };
}

test('하늘색 칸 → 날짜: 달력은 일요일 시작, 첫 주엔 앞달 날짜 / 토요일·진한 파랑은 제외', async () => {
  const { detectScheduleCells } = await load();
  const { img, fill } = makeGrid();
  fill(120, 100, 180, 112, [0, 176, 240]); // 0주차 월요일(2026-10 달력의 첫 줄 = 9/27~10/3) → 9/28
  fill(320, 260, 380, 272, [0, 176, 240]); // 1주차 수요일 → 10/7
  fill(620, 410, 680, 422, [0, 176, 240]); // 토요일 칸 → 평일만이라 제외
  fill(220, 560, 280, 572, [0, 112, 192]); // 진한 파랑(토요일 근무 표시 등) → 제외
  const r = detectScheduleCells(img, { year: 2026, month: 10 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.cells.map((c) => c.date), ['2026-09-28', '2026-10-07']);
});

test('달력 모양을 못 찾으면 ok:false (빈 이미지)', async () => {
  const { detectScheduleCells } = await load();
  const img = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 };
  assert.equal(detectScheduleCells(img, { year: 2026, month: 10 }).ok, false);
});

test('cellDate / parseLabel / formatLabel', async () => {
  const { cellDate, parseLabel, formatLabel } = await load();
  assert.equal(cellDate(2026, 10, 1, 3), '2026-10-07');
  assert.equal(cellDate(2026, 10, 0, 0), '2026-09-27');
  assert.deepEqual(parseLabel('RM7(8,9층)'), { rm: 7, floors: '8,9' });
  assert.equal(parseLabel('RM 6 ( 5, 7 층 )').floors, '5,7');
  assert.equal(parseLabel('회의'), null);
  assert.equal(formatLabel(4, '8,9'), 'RM4(8,9층)');
});

test('글 붙여넣기: 월/일 + 제목, 요일 괄호·구분자 허용, 못 읽는 줄은 skipped', async () => {
  const { parseScheduleText } = await load();
  const { rows, skipped } = parseScheduleText('10/7 RM7(8,9층)\n10월 8일(목) RM6(5,7층)\n\n10.13\tRM4(8,9층)\n아무말', 2026);
  assert.deepEqual(rows, [
    { date: '2026-10-07', title: 'RM7(8,9층)' },
    { date: '2026-10-08', title: 'RM6(5,7층)' },
    { date: '2026-10-13', title: 'RM4(8,9층)' },
  ]);
  assert.deepEqual(skipped, ['아무말']);
});

test('RM·층 추측: 기준과 같은 모양/잡음/1픽셀 어긋남도 같은 라벨, 전혀 다른 모양은 확신도가 낮다', async () => {
  const { buildModel, classify, VEC_W, VEC_H, vecToB64, b64ToVec } = await load();
  // 숫자 자리(오른쪽 영역)만 다른 가짜 글씨 3종 — 나머지(R,M,층 자리)는 모두 같다
  const mk = (seed) => {
    const v = new Float32Array(VEC_W * VEC_H);
    for (let y = 3; y < 11; y++) for (let x = 5; x < 70; x++) v[y * VEC_W + x] = 0.5; // 공통 글씨 띠
    for (let y = 3; y < 11; y++) for (let x = 20 + seed * 12; x < 26 + seed * 12; x++) v[y * VEC_W + x] = 1; // 라벨마다 다른 숫자 자리
    return v;
  };
  const model = buildModel([0, 1, 2].map((i) => ({ label: `RM${4 + i}(8,9층)`, v: mk(i) })));
  const noisy = (v, amp) => Float32Array.from(v, (x, k) => Math.max(0, Math.min(1, x + (((k * 2654435761) % 1000) / 1000 - 0.5) * amp)));
  const shiftRight = (v) => Float32Array.from(v, (_, k) => (k % VEC_W ? v[k - 1] : 0));
  for (let i = 0; i < 3; i++) {
    const want = `RM${4 + i}(8,9층)`;
    assert.equal(classify(mk(i), model).label, want);
    assert.equal(classify(noisy(mk(i), 0.3), model).label, want);
    assert.equal(classify(shiftRight(mk(i)), model).label, want);
  }
  assert.ok(classify(mk(0), model).ratio < 0.2, '정확히 같은 모양은 확실');
  assert.equal(classify(mk(0), buildModel([{ label: 'RM4(8,9층)', v: mk(0) }])), null, '라벨이 하나뿐이면 비교할 수 없어 null');
  assert.deepEqual(Array.from(b64ToVec(vecToB64(mk(1)))).map((x) => Math.round(x * 255)), Array.from(mk(1)).map((x) => Math.round(x * 255)));
});

test('학습 저장: 라벨당 최근 4개만 남긴다', async () => {
  const { addLearned } = await load();
  let l = [];
  for (let i = 0; i < 6; i++) l = addLearned(l, [{ label: 'RM7(8,9층)', v: `a${i}` }]);
  l = addLearned(l, [{ label: 'RM4(5,7층)', v: 'b' }]);
  assert.deepEqual(l.filter((x) => x.label === 'RM7(8,9층)').map((x) => x.v), ['a2', 'a3', 'a4', 'a5']);
  assert.equal(l.length, 5);
});

test('내장 기준(seeds): 10개 라벨, 모두 RM·층 형식이고 칸 크기에 맞는 길이', async () => {
  const seedsSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../renderer/shared/schedule-seeds.js'), 'utf8');
  const { SEED_TEMPLATES } = await import('data:text/javascript;base64,' + Buffer.from(seedsSrc).toString('base64'));
  const { parseLabel, b64ToVec, VEC_W, VEC_H } = await load();
  assert.equal(SEED_TEMPLATES.length, 10);
  for (const t of SEED_TEMPLATES) {
    assert.ok(parseLabel(t.label), t.label);
    assert.equal(b64ToVec(t.v).length, VEC_W * VEC_H);
  }
});
