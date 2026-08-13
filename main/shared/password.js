const crypto = require('crypto');

// 앱 실행 잠금용 비밀번호 해싱. 병원 PC 로컬 앱이라 별도 인증서버 없이
// Node 내장 crypto(scrypt)만 사용 — 새 의존성 추가 없음.
// 저장 형식: "salt(hex):hash(hex)" 문자열 하나를 app_settings에 그대로 저장한다.

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password || '', salt, 64);
  const expected = Buffer.from(hash, 'hex');
  // 길이가 다르면 timingSafeEqual이 예외를 던지므로 먼저 걸러낸다(정보 유출 최소화 목적으로 길이 비교 자체는 어쩔 수 없음)
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

module.exports = { hashPassword, verifyPassword };
