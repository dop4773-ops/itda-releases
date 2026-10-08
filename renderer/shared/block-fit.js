// 대시보드 시계 등 "글자 크기가 창 폭(vw)에 묶인" 블록이 칸보다 커져서 옆 위젯을 침범하는 것을 막는다.
// 글자 크기·디자인은 그대로 두고, 칸을 넘칠 때만 그 칸에 맞게 균일하게 줄인다(넘치지 않으면 아무것도 안 함 = 지금 모양 그대로).
// ⚠ 화면 표시용 transform일 뿐 저장값(dashboard_*)은 읽지도 쓰지도 않는다.
const FIT_TYPES = new Set(['clock', 'progressRing']); // 실제로 넘침이 확인된 종류
const MARGIN = 6; // 칸 가장자리와 내용 사이 최소 여유(px)

const tracked = new Set(); // 줄이기 대상인 블록 본문(.dash-block-body)
let raf = 0;
let ro = null;

// 내용(.clk 안의 모든 요소)이 칸(body)보다 얼마나 큰지 재서, 넘치면 .clk의 "자식들"을 같은 비율로 줄인다.
// - .clk 자체는 줄이지 않는다: LED·다크 시계처럼 배경이 .clk에 칠해진 경우 배경(칸 전체)은 그대로 두고 안의 글자만 줄어야 한다.
// - 자식마다 "칸 중심"이 기준점이 되게 transform-origin을 비율(%)로 준다 → 여러 조각(미니멀: 시간+날짜)도 서로의 배치가 그대로 줄어든다.
//   (CSS zoom은 줄인 뒤 좌표를 이상하게 돌려줘서 쓰지 않는다.)
function fit(body) {
  const clk = body.firstElementChild;
  if (!clk) return;
  const kids = [...clk.children];
  kids.forEach((k) => {
    k.style.transform = ''; // 원래 크기로 재야 정확하다
    k.style.transformOrigin = '';
  });
  const box = body.getBoundingClientRect();
  if (box.width < 20 || box.height < 20) return;
  let L = Infinity;
  let T = Infinity;
  let R = -Infinity;
  let B = -Infinity;
  clk.querySelectorAll('*').forEach((e) => {
    const q = e.getBoundingClientRect();
    if (q.width < 1 || q.height < 1) return;
    L = Math.min(L, q.left);
    T = Math.min(T, q.top);
    R = Math.max(R, q.right);
    B = Math.max(B, q.bottom);
  });
  if (!isFinite(L)) return;
  const s = Math.min(1, (box.width - MARGIN) / (R - L), (box.height - MARGIN) / (B - T));
  if (s >= 0.995) return;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  kids.forEach((k) => {
    const q = k.getBoundingClientRect();
    if (q.width < 1 || q.height < 1) return;
    k.style.transformOrigin = `${(((cx - q.left) / q.width) * 100).toFixed(2)}% ${(((cy - q.top) / q.height) * 100).toFixed(2)}%`;
    k.style.transform = `scale(${Math.max(0.3, s).toFixed(3)})`;
  });
}

function runAll() {
  raf = 0;
  tracked.forEach((body) => (body.isConnected ? fit(body) : tracked.delete(body)));
}
const schedule = () => {
  if (!raf) raf = requestAnimationFrame(runAll);
};

/** 블록이 그려질 때마다 호출 — 줄이기 대상 종류면 등록하고 한 번 맞춘다 */
export function trackBlockFit(el, block) {
  if (!FIT_TYPES.has(block.type)) return;
  const body = el.querySelector('.dash-block-body');
  if (!body) return;
  if (!tracked.size) {
    window.addEventListener('resize', schedule); // 창 크기가 바뀌면 vw 기반 글자도 바뀌므로
    ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  }
  tracked.add(body);
  ro?.observe(body);
  schedule();
}
