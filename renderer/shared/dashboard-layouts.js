// 대시보드 위젯 배치 — 노션처럼 "12칸 그리드"에 카드를 스냅해서 놓는다.
// 저장하는 좌표는 픽셀이 아니라 그리드 단위: {x: 시작 열(0~11), y: 시작 행, w: 열 span, h: 행 span}.
// dashboard.js(렌더링/드래그)와 settings.js(프리셋 선택 UI)가 같은 계산을 공유해서 별도 모듈로 뒀다.

export const GRID_COLS = 12;

// 카드별 기본 크기(그리드 칸 단위). '연결된 업무'만 가로로 넓다.
const CARD_SIZE = {
  todo: { w: 4, h: 2 },
  event: { w: 4, h: 2 },
  memo: { w: 4, h: 2 },
  postit: { w: 4, h: 2 },
  linked: { w: 8, h: 1 },
  activity: { w: 4, h: 2 },
  weekSummary: { w: 4, h: 2 },
  quickAdd: { w: 4, h: 1 },
};
const DEFAULT_SIZE = { w: 4, h: 2 };

// 자유 배치 그리드에 실제로 속하는 카드 id — DASHBOARD_CARDS엔 사이드 패널 카드도 섞여 있는데
// 걔들은 .dash-widget이 아니라 별도 오버레이라 여기 계산/미리보기 대상이 아니다.
export const WIDGET_CARD_IDS = Object.keys(CARD_SIZE);

function sizeFor(cardId, overrides) {
  return { ...(CARD_SIZE[cardId] || DEFAULT_SIZE), ...(overrides?.[cardId] || {}) };
}

// 주어진 순서대로 12칸 그리드에 왼쪽 위부터 채운다(한 줄을 넘으면 다음 줄로).
function pack(orderedIds, overrides) {
  const positions = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  orderedIds.forEach((id) => {
    const { w, h } = sizeFor(id, overrides);
    const cw = Math.min(w, GRID_COLS);
    if (x > 0 && x + cw > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    positions[id] = { x, y, w: cw, h };
    x += cw;
    rowH = Math.max(rowH, h);
  });
  return positions;
}

// preset.order에 명시된 카드 먼저, 나머지 보이는 카드는 뒤에 붙여서 배치.
function computeFrom(preset, visibleIds) {
  const inOrder = preset.order.filter((id) => visibleIds.includes(id));
  const rest = visibleIds.filter((id) => !inOrder.includes(id));
  return pack([...inOrder, ...rest], preset.sizes);
}

export const LAYOUT_PRESETS = [
  {
    id: 'default',
    label: '기본형 — 골고루',
    order: ['todo', 'event', 'memo', 'postit', 'linked', 'quickAdd', 'activity', 'weekSummary'],
    sizes: {},
  },
  {
    id: 'work',
    label: '업무형 — 할 일 중심',
    order: ['todo', 'quickAdd', 'memo', 'postit', 'event', 'linked', 'activity', 'weekSummary'],
    sizes: { todo: { w: 8, h: 3 }, quickAdd: { w: 4, h: 3 } },
  },
  {
    id: 'calendar',
    label: '일정형 — 일정 중심',
    order: ['event', 'linked', 'todo', 'memo', 'postit', 'quickAdd', 'activity', 'weekSummary'],
    sizes: { event: { w: 8, h: 3 }, linked: { w: 4, h: 3 } },
  },
];

export const DEFAULT_PRESET_ID = 'default';

export function getPreset(id) {
  return LAYOUT_PRESETS.find((p) => p.id === id) || LAYOUT_PRESETS[0];
}

// { compute(ids) } 형태를 유지 — settings.js가 getPreset(id).compute(ids, _) 로 호출한다(둘째 인자 무시).
LAYOUT_PRESETS.forEach((p) => {
  p.compute = (visibleIds) => computeFrom(p, visibleIds || WIDGET_CARD_IDS);
});

// 프리셋 미리보기용 — 그리드 좌표를 작은 박스(boxW x boxH) 안에 비율 그대로 축소한다.
export function scaleForPreview(positions, boxW, boxH) {
  const ids = Object.keys(positions);
  if (!ids.length) return {};
  let maxX = 0;
  let maxY = 0;
  ids.forEach((id) => {
    const p = positions[id];
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  });
  const sx = boxW / Math.max(maxX, GRID_COLS);
  const sy = boxH / Math.max(maxY, 1);
  const scaled = {};
  ids.forEach((id) => {
    const p = positions[id];
    scaled[id] = {
      x: Math.round(p.x * sx),
      y: Math.round(p.y * sy),
      w: Math.max(4, Math.round(p.w * sx) - 2),
      h: Math.max(4, Math.round(p.h * sy) - 2),
    };
  });
  return scaled;
}
