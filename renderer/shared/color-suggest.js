/**
 * 카테고리(태그) 색 도우미 — DOM 없이 계산만 한다(테스트 가능).
 *  - bestTextColor: 배경색 위에서 검정/흰 글자 중 더 잘 읽히는 쪽(WCAG 명암비)
 *  - deltaE / findSimilar / findSimilarPairs: 눈으로 구분하기 어려운 비슷한 색 찾기(CIE Lab 거리)
 *  - suggestColors: 이미 쓰는 색과 가장 안 겹치는 색 후보
 */
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
export const isHex = (v) => HEX_RE.test(String(v || '').trim());
const norm = (v) => (String(v).trim().startsWith('#') ? String(v).trim() : `#${String(v).trim()}`).toLowerCase();

export function hexToRgb(hex) {
  const h = norm(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG 명암비(1~21). 4.5 이상이면 본문 글자로 충분, 3 미만이면 읽기 힘들다. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 배경색 위에 올릴 글자색 — 검정(#000000)과 흰색(#ffffff) 중 더 잘 읽히는 쪽.
 * 두 명암비가 비슷하면(검정이 0.5 넘게 우세하지 않으면) 흰색 — 파랑·진한 색 위에선 흰 글자가 관례이고 눈에도 편하다.
 */
export function bestTextColor(bg) {
  return contrastRatio(bg, '#000000') > contrastRatio(bg, '#ffffff') + 0.5 ? '#000000' : '#ffffff';
}

/** 지금 고른 글자색이 읽기 힘든 정도인지(명암비 3 미만) */
export const isPoorContrast = (bg, text) => contrastRatio(bg, text || '#000000') < 3;

function toLab(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** 두 색의 지각 거리(CIE76 ΔE). 작을수록 비슷하다 — 2 안팎이면 거의 같은 색, 25 미만이면 일정 칸 위에서 헷갈릴 수 있다. */
export function deltaE(a, b) {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

// 달력 칸 위의 작은 막대로 구분할 때 "비슷하다"고 볼 기준(실제 카테고리 색들로 맞춘 값)
export const SIMILAR_BELOW = 22;

/** hex와 가장 비슷한(기준 미만인) 다른 카테고리 하나. 없으면 null. others: [{id, name, color_hex}] */
export function findSimilar(hex, others, below = SIMILAR_BELOW) {
  let best = null;
  for (const o of others) {
    if (!isHex(o.color_hex)) continue;
    const d = deltaE(hex, o.color_hex);
    if (d < below && (!best || d < best.distance)) best = { ...o, distance: d };
  }
  return best;
}

/** 서로 비슷한 카테고리 쌍 [{a, b, distance}] (가까운 순) */
export function findSimilarPairs(categories, below = SIMILAR_BELOW) {
  const pairs = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      if (!isHex(categories[i].color_hex) || !isHex(categories[j].color_hex)) continue;
      const d = deltaE(categories[i].color_hex, categories[j].color_hex);
      if (d < below) pairs.push({ a: categories[i], b: categories[j], distance: d });
    }
  }
  return pairs.sort((x, y) => x.distance - y.distance);
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
const median = (a) => {
  const v = [...a].sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

/**
 * "비슷하다"의 기준은 팔레트에 따라 달라진다 — 파스텔끼리는 원래 서로 가까워서(색 거리가 작아서) 고정 기준을 쓰면 전부 "비슷"하다고 나온다.
 * 지금 쓰는 색들 사이 거리의 중앙값에 비례해서 정한다(눈에 거의 같아 보이는 정도만 잡도록): 파스텔 ≈ 4~5, 선명한 색 ≈ 22.
 */
export function similarThreshold(hexes) {
  const list = hexes.filter(isHex);
  if (list.length < 4) return SIMILAR_BELOW;
  const d = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) d.push(deltaE(list[i], list[j]));
  return Math.max(3, Math.min(SIMILAR_BELOW, median(d) * 0.3));
}

/** 추천 색 테마 — match는 지금 쓰는 색들의 밝기·채도를 따라가고, 나머지는 고정 톤. 각 항목은 [채도, 밝기] 후보 */
export const SUGGEST_THEMES = {
  match: { label: '현재 색에 맞춤' },
  pastel: { label: '파스텔', tones: [[0.75, 0.9], [0.6, 0.86]] },
  vivid: { label: '선명', tones: [[0.78, 0.55], [0.65, 0.62]] },
  muted: { label: '차분', tones: [[0.35, 0.66], [0.3, 0.56]] },
  deep: { label: '진하게', tones: [[0.55, 0.38], [0.5, 0.45]] },
};

function toneCandidates(existing, theme) {
  let tones = SUGGEST_THEMES[theme]?.tones;
  if (!tones) {
    // 현재 색에 맞춤: 이미 쓰는 색들의 채도·밝기 중앙값을 그대로 따라간다(조금씩만 흔들어 후보를 늘림)
    const hsl = existing.filter(isHex).map(hexToHsl);
    const s = median(hsl.map((x) => x[1]));
    const l = median(hsl.map((x) => x[2]));
    tones = hsl.length ? [[s, l], [Math.max(0.2, s * 0.85), Math.min(0.97, l + 0.02)], [s, Math.max(0.2, l - 0.03)]] : SUGGEST_THEMES.pastel.tones;
  }
  const out = [];
  for (let h = 0; h < 360; h += 15) for (const [s, l] of tones) out.push(hslToHex(h, s, l));
  return out;
}

/**
 * 이미 쓰는 색들과 가장 안 겹치는 색 n개 — 후보마다 "가장 가까운 기존/선택된 색까지의 거리"를 보고(cap 넘으면 더 멀어도 이득 없음)
 * 높은 것부터 하나씩 뽑는다. 거의 같은 색(기준×1.5 미만)은 제외한다. theme 기본은 'match'(지금 색의 톤을 따라가서 튀지 않음).
 */
export function suggestColors(existing, n = 6, theme = 'match') {
  const taken = existing.filter(isHex).map(norm);
  const thr = similarThreshold(taken);
  // 'match'는 지금 색들과 확실히 구분되는 색만, 직접 고른 테마는 거의 같은 색만 피한다(그 톤을 원해서 고른 것이므로)
  // (쓰는 색이 거의 없으면 기준이 의미 없으므로 서로 확실히 다른 정도만 요구)
  const floor = taken.length < 4 ? 10 : theme === 'match' || !SUGGEST_THEMES[theme] ? Math.max(thr * 1.5, 4) : Math.max(thr * 0.5, 4);
  const cap = Math.max(15, thr * 1.6);
  // 추천끼리도 서로 구분되게(직접 고른 테마는 기존 색과의 기준이 느슨해서 비슷한 색만 여러 개 나오기 쉬움)
  const spread = Math.max(floor, theme === 'match' || !SUGGEST_THEMES[theme] ? 0 : 18);
  const picked = [];
  const candidates = toneCandidates(taken, theme);
  for (let k = 0; k < n; k++) {
    let best = null;
    for (const c of candidates) {
      if (picked.includes(c)) continue;
      const nearTaken = Math.min(...taken.map((t) => deltaE(c, t)), Infinity);
      const nearPicked = Math.min(...picked.map((t) => deltaE(c, t)), Infinity);
      if (nearTaken < floor || nearPicked < spread) continue;
      // 1순위: 기존 색과 충분히 먼 것(cap까지), 같으면 이미 고른 추천과도 먼 것 — 그래야 색상이 골고루 퍼진다
      const score = Math.min(nearTaken, cap) * 100 + Math.min(nearPicked, 80);
      if (!best || score > best.score) best = { color: c, score };
    }
    if (!best) break;
    picked.push(best.color);
  }
  return picked;
}
