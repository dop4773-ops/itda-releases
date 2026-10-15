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

// 후보 팔레트: 색상 24단계 × (선명/연함/진함) — 달력 막대로 쓰기 좋은 중간 밝기·채도만.
// bonus: 형광처럼 튀는 색보다 차분한 쪽을 살짝 우대(같은 정도로 안 겹치면 보기 좋은 색을 먼저 추천)
const CANDIDATES = (() => {
  const out = [];
  for (let h = 0; h < 360; h += 15) for (const [s, l, bonus] of [[0.62, 0.58, 6], [0.55, 0.74, 3], [0.5, 0.42, 2]]) out.push({ hex: hslToHex(h, s, l), bonus });
  return out;
})();

/**
 * 이미 쓰는 색들과 가장 안 겹치는 색 n개 — 후보마다 "가장 가까운 기존/선택된 색까지의 거리"를 보고(35가 넘으면 더 멀어도 이득 없음)
 * 점수가 높은 것부터 하나씩 뽑는다. 기준(minDistance) 미만으로 가까운 후보는 제외해서, 이미 색이 빽빽하면 적게(또는 0개) 돌려준다.
 */
export function suggestColors(existing, n = 6, minDistance = SIMILAR_BELOW) {
  const taken = existing.filter(isHex).map(norm);
  const picked = [];
  for (let k = 0; k < n; k++) {
    let best = null;
    for (const c of CANDIDATES) {
      const nearest = Math.min(...[...taken, ...picked].map((t) => deltaE(c.hex, t)), Infinity);
      if (nearest < minDistance) continue;
      const score = Math.min(nearest, 35) + c.bonus;
      if (!best || score > best.score) best = { color: c.hex, score };
    }
    if (!best) break;
    picked.push(best.color);
  }
  return picked;
}
