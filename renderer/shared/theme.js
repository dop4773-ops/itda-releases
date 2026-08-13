// 메모/포스트잇이 공유하는 "스티커노트" 개인화 팔레트 — categories(고정) 팔레트와 무관.
// 카테고리 색상(--cat-meeting 등)은 styles.css의 CSS 커스텀 프로퍼티로만 관리하고,
// 여기서는 사용자가 직접 고르는 개인화 색상만 다룬다.
export const STICKY_COLORS = ['#FBE28A', '#F6B8CE', '#A9D8F5', '#AEE6C4', '#D8CCF2', '#E4E6EA'];

// id 기반 고정 미세 회전값 (재렌더링해도 흔들리지 않도록 결정론적으로 계산)
export function stickyRotation(id) {
  const seq = [-1.4, 1, -0.6, 1.6, -1, 0.7, -1.8, 0.4];
  return seq[id % seq.length];
}
