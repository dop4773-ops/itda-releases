/**
 * renderer/shared/perf.js — 화면 시작/전환 성능 계측 (콘솔 전용, 기본 꺼짐).
 * 게이트는 main과 동일: 개발 모드거나 ITDA_PERF=1 (app:perfEnabled IPC로 받아옴).
 * 목적은 "어디가 느린지 수치 확보" — 실제 최적화는 별도.
 */
let enabled = false;

// DOMContentLoaded 초반에 한 번 호출. 이후 perf()가 이 값을 따른다.
export async function initPerf() {
  try {
    enabled = await window.itda.app.perfEnabled();
  } catch (e) {
    enabled = false;
  }
  if (enabled) console.log('[itda:perf] (renderer) 성능 계측 ON');
  return enabled;
}

export const now = () => performance.now();

// perf('라벨', 시작시각)
export function perf(label, startMs) {
  if (enabled) console.log(`[itda:perf] (renderer) ${label}: ${(performance.now() - startMs).toFixed(1)}ms`);
}

export const isPerfEnabled = () => enabled;
