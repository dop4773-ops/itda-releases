// 축소 보기 — 창이 좁아지면 (1) 사이드바를 일시적으로 아이콘 폭으로 접고 (2) 그래도 모자라면 화면 전체를 창에 맞춰 같은 비율로 줄인다.
// 기준: 예전 최소 창(1024px, 사이드바 220px)에서 본문이 쓰던 폭 ≈ 804px. 사이드바를 68px로 접으면 창 872px에서 본문 폭이 똑같아지므로,
// 1024px 미만에선 사이드바를 접고 872px 미만에서만 축소한다 → 본문(대시보드 카드 배치·비율)은 예전 최소 창과 같은 모양이고 글자는 덜 작아진다.
// ⚠ 화면에 거는 일시적인 클래스·확대/축소 값일 뿐 어떤 설정도 저장·변경하지 않는다(대시보드 저장값·사이드바 접힘 설정 불변).
export const COMPACT_BELOW = 1024; // 이보다 좁으면 사이드바 자동 접힘(저장 안 함)
export const REF = { w: 872, h: 600 };
export const MIN_FACTOR = 0.5; // 창 최소 크기(512x350)에서도 정확히 맞도록 약간 여유

/**
 * @param {{innerW:number, innerH:number, outerW:number, outerH:number}} win 창의 안쪽/바깥 크기(DIP)
 * @returns {number} 0.45 ~ 1 — 1이면 줄이지 않음
 */
export function fitFactor({ innerW, innerH, outerW, outerH }) {
  if (!(innerW > 0) || !(innerH > 0)) return 1;
  // 예전 최소 크기는 "바깥" 기준이었으니 창틀(바깥-안쪽) 몫을 뺀 안쪽 기준 크기와 비교한다
  const refW = REF.w - Math.max(0, outerW - innerW);
  const refH = REF.h - Math.max(0, outerH - innerH);
  const f = Math.min(1, innerW / refW, innerH / refH);
  return Math.max(MIN_FACTOR, Math.round(f * 1000) / 1000);
}
