// 비밀번호 무차별 대입 방어 — 연속 5번 틀리면 30초, 6번째 60초, 7번째부터 5분씩 비밀번호 확인 자체를 막는다.
// 앱을 껐다 켜도 이어지도록 app_settings에 저장하고(security_fail_state), 1시간 넘게 틀린 적이 없으면 횟수를 0부터 다시 센다.
const KEY = 'security_fail_state';
const FREE_TRIES = 5;
const RESET_AFTER_MS = 60 * 60 * 1000;
const delaySec = (fails) => (fails <= FREE_TRIES ? 30 : fails === FREE_TRIES + 1 ? 60 : 300);

function createThrottle(settings, now = () => Date.now()) {
  const read = () => {
    try {
      const s = JSON.parse(settings.get(KEY) || '{}');
      return { fails: Number(s.fails) || 0, at: Number(s.at) || 0, until: Number(s.until) || 0 };
    } catch (e) {
      return { fails: 0, at: 0, until: 0 };
    }
  };
  const save = (s) => settings.set(KEY, s.fails ? JSON.stringify(s) : '');
  return {
    // 막혀 있으면 남은 초, 아니면 0
    remainingSec() {
      return Math.max(0, Math.ceil((read().until - now()) / 1000));
    },
    recordFail() {
      let s = read();
      if (s.at && now() - s.at > RESET_AFTER_MS) s = { fails: 0, at: 0, until: 0 };
      const fails = s.fails + 1;
      save({ fails, at: now(), until: fails >= FREE_TRIES ? now() + delaySec(fails) * 1000 : 0 });
    },
    recordSuccess() {
      save({ fails: 0, at: 0, until: 0 });
    },
  };
}

module.exports = { createThrottle, FREE_TRIES };
