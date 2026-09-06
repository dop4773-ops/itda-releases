/**
 * main/perf.js — 개발/진단용 성능 계측.
 *
 * 일반 사용자에겐 완전히 안 보인다: 콘솔에만 찍고, 기본은 꺼짐.
 * 켜는 법:
 *   - 개발 모드(패키징 안 된 실행)에서는 자동으로 켜짐
 *   - 패키지 빌드에서 재보려면 환경변수 ITDA_PERF=1 로 실행
 *     (Windows: 명령프롬프트에서  set ITDA_PERF=1 && "잇다.exe" )
 *
 * 목적은 "어디가 느린지 수치부터 확보"하는 것. 실제 최적화는 이 데이터를 본 뒤 별도로.
 * renderer 쪽 계측은 renderer/shared/perf.js 참고(같은 게이트를 app:perfEnabled IPC로 받아온다).
 */
let enabled = false;

function initPerf(app) {
  enabled = process.env.ITDA_PERF === '1' || !app.isPackaged;
  if (enabled) console.log('[itda:perf] 성능 계측 ON');
  return enabled;
}

const now = () => performance.now();

// perf('라벨', 시작시각) — 시작시각은 now()로 찍어둔 값
function perf(label, startMs) {
  if (enabled) console.log(`[itda:perf] ${label}: ${(performance.now() - startMs).toFixed(1)}ms`);
}

module.exports = { initPerf, perf, now, isPerfEnabled: () => enabled };
