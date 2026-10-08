// 축소 보기 — 창을 예전 최소 크기(1024x700)보다 작게 줄이면 화면 전체를 창에 맞춰 같은 비율로 줄인다.
// 그러면 "예전 최소 크기에서 보이던 모양" 그대로(카드 배치·크기 비율 동일) 글자·간격만 함께 작아진다.
// ⚠ 화면에 거는 일시적인 확대/축소 값일 뿐 어떤 설정도 저장·변경하지 않는다(대시보드 저장값 불변).
export const REF = { w: 1024, h: 700 };
export const MIN_FACTOR = 0.45; // 창 최소 크기(512x350)에서도 정확히 맞도록 약간 여유

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
