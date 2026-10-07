/**
 * 메신저 불러오기 주기 실행 — 1분마다 설정을 보고 "지금 돌릴 때인가"만 판단한다.
 *   manual 수동만 / start 잇다를 켠 직후 한 번 / interval N분마다 / daily 매일 지정 시각
 * 읽기가 막혀 있으면(메신저가 저장 중 등) 조용히 건너뛰고 다음 틱에 다시 시도한다.
 */
const TICK_MS = 60 * 1000;
const START_DELAY_MS = 20 * 1000; // 앱이 뜨는 중에 겹치지 않게 잠깐 뒤에

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 지금 돌려야 하는지 — 순수 함수(테스트용으로 분리)
function isDue(cfg, state, now) {
  if (!cfg.enabled || !cfg.dbPath) return false;
  const { mode, everyMin, dailyAt } = cfg.schedule;
  if (mode === 'start') return !state.ranOnStart;
  if (mode === 'interval') return !state.lastRunAt || now.getTime() - state.lastRunAt >= everyMin * 60 * 1000;
  if (mode === 'daily') {
    const [h, m] = dailyAt.split(':').map(Number);
    return state.lastDailyKey !== dayKey(now) && (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m));
  }
  return false;
}

function startMessengerScheduler({ getConfig, run, now = () => new Date() }) {
  const state = { ranOnStart: false, lastRunAt: 0, lastDailyKey: '' };
  const tick = () => {
    const cfg = getConfig();
    const t = now();
    if (!isDue(cfg, state, t)) return;
    if (cfg.schedule.mode === 'start') state.ranOnStart = true;
    if (cfg.schedule.mode === 'daily') state.lastDailyKey = dayKey(t);
    state.lastRunAt = t.getTime();
    Promise.resolve(run('auto')).catch(() => {});
  };
  const first = setTimeout(tick, START_DELAY_MS);
  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { startMessengerScheduler, isDue };
