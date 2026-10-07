const { hashPassword, verifyPassword } = require('../shared/password');
const lockState = require('../shared/lock-state');
const { createThrottle } = require('../shared/auth-throttle');

// 앱 실행 시 비밀번호 잠금 설정. 새 테이블 없이 기존 app_settings를 재사용한다
// (google-calendar 토큰, theme 등과 같은 패턴).
const SETTINGS_KEY = 'security_password_hash';

module.exports = function registerAuthIpc(ipcMain, repos) {
  const { settings } = repos;
  lockState.init(settings);
  const throttle = createThrottle(settings);
  // 비밀번호를 확인하는 모든 경로가 거치는 곳 — 연속 실패로 막혀 있으면 맞는 번호여도 확인하지 않고 막는다
  function check(password, stored) {
    const wait = throttle.remainingSec();
    if (wait > 0) throw new Error(`비밀번호를 여러 번 틀려서 잠시 막혔어요. ${wait >= 60 ? `${Math.ceil(wait / 60)}분` : `${wait}초`} 뒤에 다시 시도해주세요.`);
    const ok = verifyPassword(password, stored);
    if (ok) throttle.recordSuccess();
    else throttle.recordFail();
    return ok;
  }

  ipcMain.handle('auth:getStatus', () => {
    return { enabled: !!settings.get(SETTINGS_KEY) };
  });

  // 잠금이 꺼져 있으면(비밀번호 미설정) 항상 통과시킨다 — 잠금화면 자체를 안 띄우므로
  // 이 경로는 실제로는 거의 호출되지 않지만 방어적으로 안전하게 처리
  ipcMain.handle('auth:verify', (event, password) => {
    const stored = settings.get(SETTINGS_KEY);
    if (!stored) return true;
    const ok = check(password, stored);
    if (ok) lockState.unlock();
    return ok;
  });

  // 렌더러의 잠금 화면이 뜰 때(앱 시작·"지금 잠그기"·새로고침) 알려준다 — 비밀번호가 없으면 무시
  ipcMain.handle('auth:lock', () => {
    if (settings.get(SETTINGS_KEY)) lockState.lock();
    return { locked: lockState.isLocked() };
  });

  // newPassword: 새로 설정할 비밀번호, currentPassword: 이미 잠금이 켜져 있을 때만 필요(변경 시 본인 확인)
  ipcMain.handle('auth:setPassword', (event, { newPassword, currentPassword } = {}) => {
    if (!newPassword || newPassword.length < 4) {
      throw new Error('비밀번호는 4자 이상이어야 해요.');
    }
    const stored = settings.get(SETTINGS_KEY);
    if (stored && !check(currentPassword, stored)) {
      throw new Error('현재 비밀번호가 일치하지 않아요.');
    }
    settings.set(SETTINGS_KEY, hashPassword(newPassword));
    return { enabled: true };
  });

  ipcMain.handle('auth:disable', (event, { currentPassword } = {}) => {
    const stored = settings.get(SETTINGS_KEY);
    if (!stored) return { enabled: false };
    if (!check(currentPassword, stored)) {
      throw new Error('현재 비밀번호가 일치하지 않아요.');
    }
    settings.set(SETTINGS_KEY, '');
    lockState.unlock();
    return { enabled: false };
  });
};
