/**
 * 월간 근무표/그랜드라운딩표 캡처 이미지에서 "하늘색 글씨가 있는 칸"을 찾아 날짜를 계산한다.
 * 글자(OCR)는 읽지 않는다 — 가는 글씨는 무료 OCR로 거의 안 읽혀서, 대신 칸의 "위치"로 날짜를 정하고
 * 칸 이미지를 사용자에게 보여줘 RM 번호/층만 고르게 한다(bulk-schedule-dialog.js).
 *
 * 전제(이 표 양식): 일요일 시작 7열 달력, 각 주 맨 위에 연한 주황색 "날짜 숫자 띠", 그 아래 칸에
 * 하늘색(#00B0F0 계열) 글씨. 토요일 칸의 진한 파랑(#0070C0)은 밝기 차이로 걸러진다.
 * 순수 함수(DOM 없음)라 RGBA 배열만 있으면 어디서든(테스트 포함) 돌아간다.
 */

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const RM_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const FLOOR_OPTIONS = ['8,9', '5,7'];

// 달력 칸(week: 0부터, col: 0=일 … 6=토) → 날짜. 달력은 일요일 시작이고 첫 주엔 앞달 날짜가 섞여 있다.
export function cellDate(year, month, week, col) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  return toKey(new Date(year, month - 1, 1 - firstDow + week * 7 + col));
}

export const formatLabel = (rm, floors) => `RM${rm}(${floors}층)`;

// "RM7(8,9층)" 같은 글을 {rm, floors}로. 형식이 다르면 null.
export function parseLabel(text) {
  const m = String(text || '').match(/RM\s*(\d)\s*\(\s*(\d)\s*[,，]\s*(\d)\s*층?\s*\)/i);
  return m ? { rm: Number(m[1]), floors: `${m[2]},${m[3]}` } : null;
}

// 텍스트 붙여넣기용 — 한 줄에 "10/7 RM7(8,9층)" (월/일 + 제목). 읽지 못한 줄은 skipped로 돌려준다.
export function parseScheduleText(text, year) {
  const rows = [];
  const skipped = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim()) return;
      const m = line.match(/^\s*(\d{1,2})\s*[/.\-월]\s*(\d{1,2})\s*일?\s*(?:\([^)]*\)\s*)?[\s:,\t-]*(.+?)\s*$/);
      const month = m && Number(m[1]);
      const day = m && Number(m[2]);
      if (!m || month < 1 || month > 12 || day < 1 || day > 31) {
        skipped.push(line.trim());
        return;
      }
      rows.push({ date: `${year}-${pad(month)}-${pad(day)}`, title: m[3] });
    });
  return { rows, skipped };
}

// 하늘색 글씨의 "파란 기운": 흰 바탕에서 파랑(B)이 빨강(R)보다 훨씬 큰 픽셀. 압축으로 색이 탁해지거나 글자
// 가장자리가 옅어져도 잡히도록 느슨하게 보되, 진한 파랑(#0070C0, g≈112)은 g로 걸러낸다.
function isLightBlue(r, g, b) {
  return b - r >= 70 && g >= 120;
}

// 주마다 맨 위에 깔린 연한 주황색 "날짜 숫자 띠"(#FCE5D6 계열). 연두 요일줄/흰 칸/노랑 강조와는 구분된다.
function isDateBand(r, g, b) {
  return r >= 236 && g >= 205 && g <= 240 && b >= 185 && b <= 228 && r - g >= 5 && r - g <= 40 && g - b >= 3 && r - b >= 18 && r - b <= 60;
}

// 값이 연속으로 true인 구간들. gap 이하의 틈은 이어 붙이고, minLen보다 짧은 구간은 버린다.
function runs(flags, gap, minLen) {
  const out = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    if (start === -1) start = last = i;
    else if (i - last <= gap + 1) last = i;
    else {
      if (last - start + 1 >= minLen) out.push([start, last]);
      start = last = i;
    }
  }
  if (start !== -1 && last - start + 1 >= minLen) out.push([start, last]);
  return out;
}

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img RGBA 이미지(ImageData 모양)
 * @param {{year: number, month: number, weekdaysOnly?: boolean}} opts month는 1~12
 * @returns {{ok: boolean, reason?: string, cells: Array<{date: string, col: number, week: number, box: {x0,y0,x1,y1}}>}}
 */
export function detectScheduleCells(img, { year, month, weekdaysOnly = true }) {
  const { data, width, height } = img;

  // 1) 날짜 숫자 띠 → 주(週) 경계 + 달력의 좌우 폭
  const rowBand = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0, i = y * width * 4; x < width; x++, i += 4) if (isDateBand(data[i], data[i + 1], data[i + 2])) c++;
    rowBand[y] = c;
  }
  const maxRow = Math.max(...rowBand);
  if (maxRow < width * 0.3) return { ok: false, reason: '달력 모양(주황색 날짜 줄)을 찾지 못했어요.', cells: [] };
  const bands = runs(Array.from(rowBand, (c) => c > maxRow * 0.4), 2, 6);
  if (bands.length < 4 || bands.length > 6) return { ok: false, reason: '달력의 주(週) 개수를 알아보지 못했어요.', cells: [] };

  let xL = width;
  let xR = 0;
  for (const [y0, y1] of bands) {
    for (let y = y0; y <= y1; y++) {
      for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
        if (isDateBand(data[i], data[i + 1], data[i + 2])) {
          if (x < xL) xL = x;
          if (x > xR) xR = x;
        }
      }
    }
  }
  const unit = (xR - xL + 1) / 7; // 칸 하나의 폭
  if (unit < 40) return { ok: false, reason: '이미지가 너무 작아요. 더 크게 캡처해주세요.', cells: [] };

  // 2) 열(요일)별로 하늘색 글씨 덩어리를 찾는다 — 열 안에서만 찾으니 옆 칸 글씨와 붙을 일이 없다.
  const firstTop = bands[0][0];
  const found = new Map(); // week*7+col → box
  for (let col = 0; col < 7; col++) {
    if (weekdaysOnly && (col === 0 || col === 6)) continue;
    const cx0 = Math.round(xL + col * unit);
    const cx1 = Math.min(width - 1, Math.round(xL + (col + 1) * unit) - 1);
    const rowFlag = new Uint8Array(height);
    for (let y = firstTop; y < height; y++) {
      for (let x = cx0, i = (y * width + cx0) * 4; x <= cx1; x++, i += 4) {
        if (isLightBlue(data[i], data[i + 1], data[i + 2])) {
          rowFlag[y] = 1;
          break;
        }
      }
    }
    for (const [y0, y1] of runs(rowFlag, Math.max(2, Math.round(unit * 0.03)), Math.max(4, Math.round(unit * 0.04)))) {
      // 이 덩어리가 속한 주 = 그 위쪽에서 가장 가까운 날짜 띠
      let week = -1;
      for (let b = 0; b < bands.length; b++) if (bands[b][1] < y0) week = b;
      if (week < 0) continue;
      let bx0 = cx1;
      let bx1 = cx0;
      let n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = cx0, i = (y * width + cx0) * 4; x <= cx1; x++, i += 4) {
          if (isLightBlue(data[i], data[i + 1], data[i + 2])) {
            n++;
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
          }
        }
      }
      if (n < unit * 0.15 || bx1 - bx0 < unit * 0.15) continue; // 점 하나 같은 잡음
      const key = week * 7 + col;
      const prev = found.get(key);
      found.set(key, prev ? { x0: Math.min(prev.x0, bx0), y0: Math.min(prev.y0, y0), x1: Math.max(prev.x1, bx1), y1: Math.max(prev.y1, y1) } : { x0: bx0, y0, x1: bx1, y1 });
    }
  }

  // 3) 칸 위치 → 날짜
  const cells = [...found.entries()]
    .map(([key, box]) => {
      const week = Math.floor(key / 7);
      const col = key % 7;
      return { date: cellDate(year, month, week, col), col, week, box };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, cells };
}


// ---------- RM 번호/층 추측: 글자를 읽지 않고 "이미 아는 모양"과 비교 ----------
// 이 표의 글씨는 매달 같은 글꼴이라, 칸 안의 하늘색 글씨 모양을 고정 크기(VEC_W x VEC_H)로 줄여 비교한다.
// 처음엔 내장 기준(schedule-seeds.js), 이후엔 사용자가 확인해서 등록한 칸이 기준에 더해진다.
export const VEC_W = 80;
export const VEC_H = 14;

// 칸(box) 안의 하늘색 글씨 세기를 VEC_W x VEC_H 격자로 — 확대/축소·압축 정도가 달라도 비슷한 값이 나온다.
export function cellVector(img, box) {
  const { data, width } = img;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const hit = new Float32Array(VEC_W * VEC_H);
  const cnt = new Float32Array(VEC_W * VEC_H);
  for (let y = box.y0; y <= box.y1; y++) {
    const by = Math.min(VEC_H - 1, Math.floor(((y - box.y0) * VEC_H) / bh));
    for (let x = box.x0; x <= box.x1; x++) {
      const k = by * VEC_W + Math.min(VEC_W - 1, Math.floor(((x - box.x0) * VEC_W) / bw));
      const i = (y * width + x) * 4;
      cnt[k]++;
      // 하늘색 글씨는 흰 바탕에서 파랑(B)-빨강(R) 차이가 크다 — "맞다/아니다"로 자르지 않고 세기를 그대로 써야 압축/축소에 안 흔들린다.
      hit[k] += Math.max(0, Math.min(1, (data[i + 2] - data[i]) / 200));
    }
  }
  for (let k = 0; k < hit.length; k++) hit[k] = cnt[k] ? hit[k] / cnt[k] : 0;
  return hit;
}

// templates: [{label, v: Float32Array}]. 같은 라벨은 평균을 내고, 라벨끼리 "달라지는 픽셀"(RM 숫자·층 숫자 자리)에
// 가중치를 줘서 똑같은 부분(R, M, 층, 괄호)은 비교에서 사실상 빼는 모델을 만든다.
export function buildModel(templates) {
  const groups = new Map();
  for (const t of templates) (groups.get(t.label) || groups.set(t.label, []).get(t.label)).push(t.v);
  const means = [...groups].map(([label, vs]) => {
    const v = new Float32Array(VEC_W * VEC_H);
    for (const x of vs) for (let k = 0; k < v.length; k++) v[k] += x[k] / vs.length;
    return { label, v };
  });
  const w = new Float32Array(VEC_W * VEC_H);
  let sum = 0;
  for (let k = 0; k < w.length; k++) {
    const m = means.reduce((a, c) => a + c.v[k], 0) / means.length;
    w[k] = means.reduce((a, c) => a + (c.v[k] - m) ** 2, 0) / means.length;
    sum += w[k];
  }
  if (sum > 0) for (let k = 0; k < w.length; k++) w[k] /= sum;
  return { means, w };
}

// vec를 (dx,dy)칸 옮긴 복사본 — 칸 경계가 1~2픽셀 어긋나도 같은 글씨로 보게 한다.
function shifted(v, dx, dy) {
  const o = new Float32Array(v.length);
  for (let y = 0; y < VEC_H; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= VEC_H) continue;
    for (let x = 0; x < VEC_W; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < VEC_W) o[y * VEC_W + x] = v[sy * VEC_W + sx];
    }
  }
  return o;
}
const SHIFTS = [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [0, -1]];

// 가장 가까운 라벨과 그 확신도. ratio = (1등 거리)/(2등 거리) — 작을수록 확실.
export function classify(vec, model) {
  if (model.means.length < 2) return null;
  const vs = SHIFTS.map(([dx, dy]) => (dx || dy ? shifted(vec, dx, dy) : vec));
  const ds = model.means
    .map((m) => {
      let best = Infinity;
      for (const v of vs) {
        let d = 0;
        for (let k = 0; k < v.length; k++) d += model.w[k] * (v[k] - m.v[k]) ** 2;
        if (d < best) best = d;
      }
      return { label: m.label, d: best };
    })
    .sort((a, b) => a.d - b.d);
  return { label: ds[0].label, d: ds[0].d, ratio: ds[0].d / (ds[1].d || 1e-12) };
}

// 기준 저장용 — 0~1 값을 한 글자(0~255)씩으로 줄여 base64로 (칸 하나가 약 1.5KB).
export function vecToB64(v) {
  let s = '';
  for (let k = 0; k < v.length; k++) s += String.fromCharCode(Math.round(Math.max(0, Math.min(1, v[k])) * 255));
  return btoa(s);
}
export function b64ToVec(b64) {
  const s = atob(b64);
  const v = new Float32Array(s.length);
  for (let k = 0; k < s.length; k++) v[k] = s.charCodeAt(k) / 255;
  return v;
}

// 사용자가 확인한 칸을 기준에 더한다 — 라벨당 최근 MAX_PER_LABEL개만 남겨 저장 크기를 묶는다.
const MAX_PER_LABEL = 4;
export function addLearned(learned, additions) {
  const out = [...learned, ...additions];
  const seen = new Map();
  for (let i = out.length - 1; i >= 0; i--) {
    const n = (seen.get(out[i].label) || 0) + 1;
    seen.set(out[i].label, n);
    if (n > MAX_PER_LABEL) out.splice(i, 1);
  }
  return out;
}
