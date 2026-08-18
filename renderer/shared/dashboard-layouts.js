// 대시보드 위젯의 기본 크기와 배치 프리셋 계산. dashboard.js(렌더링)와 settings.js(프리셋
// 선택 UI)가 같은 계산 로직을 공유해야 해서 별도 모듈로 뺐다.

const GAP = 14;

// 카드별 기본 크기 — '연결된 업무'만 가로로 넓은 카드라 따로 지정.
const CARD_SIZE = {
  todo: { w: 320, h: 260 },
  event: { w: 320, h: 220 },
  memo: { w: 320, h: 220 },
  postit: { w: 320, h: 220 },
  linked: { w: 660, h: 160 },
  activity: { w: 320, h: 220 },
  weekSummary: { w: 320, h: 200 },
  quickAdd: { w: 320, h: 150 },
};
const DEFAULT_SIZE = { w: 320, h: 220 };

function sizeFor(cardId) {
  return CARD_SIZE[cardId] || DEFAULT_SIZE;
}

// 기본형: 왼쪽 위부터 가로로 나열하다가 컨테이너 폭을 넘으면 다음 줄로 — 처음 이 기능을
// 만들었을 때 쓰던 flex-wrap 자동 배치와 같은 결과를 낸다.
function flowLayout(cardIds, containerWidth) {
  const positions = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  cardIds.forEach((id) => {
    const { w, h } = sizeFor(id);
    if (x > 0 && x + w > containerWidth) {
      x = 0;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    positions[id] = { x, y, w, h };
    x += w + GAP;
    rowHeight = Math.max(rowHeight, h);
  });
  return positions;
}

// 2열형: 넓은 카드는 한 줄을 다 차지하고, 나머지는 더 짧은 쪽 칼럼에 순서대로 쌓는다.
function twoColumnLayout(cardIds, containerWidth) {
  const colWidth = Math.max(260, Math.floor((containerWidth - GAP) / 2));
  const positions = {};
  let yLeft = 0;
  let yRight = 0;
  cardIds.forEach((id) => {
    const base = sizeFor(id);
    if (base.w > colWidth * 1.4) {
      const y = Math.max(yLeft, yRight);
      positions[id] = { x: 0, y, w: containerWidth, h: base.h };
      yLeft = y + base.h + GAP;
      yRight = yLeft;
      return;
    }
    if (yLeft <= yRight) {
      positions[id] = { x: 0, y: yLeft, w: colWidth, h: base.h };
      yLeft += base.h + GAP;
    } else {
      positions[id] = { x: colWidth + GAP, y: yRight, w: colWidth, h: base.h };
      yRight += base.h + GAP;
    }
  });
  return positions;
}

export const LAYOUT_PRESETS = [
  { id: 'flow', label: '기본형 — 가로로 나열', compute: flowLayout },
  { id: 'twocol', label: '2열형 — 좌우로 쌓기', compute: twoColumnLayout },
];

export function getPreset(id) {
  return LAYOUT_PRESETS.find((p) => p.id === id) || LAYOUT_PRESETS[0];
}
