const test = require('node:test');
const assert = require('node:assert');
const store = require('../main/google-calendar/token-store');

const memRepo = () => {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => (v == null ? m.delete(k) : m.set(k, v)), _m: m };
};
// 계정 A에서만 풀리는 가짜 암호화(뒤집기) — 다른 계정이면 복호화 예외
const fakeCipher = (account) => ({
  encryptString: (s) => Buffer.from(account + ':' + s),
  decryptString: (b) => {
    const [a, ...rest] = b.toString().split(':');
    if (a !== account) throw new Error('다른 계정');
    return rest.join(':');
  },
});

test('토큰은 암호화되어 저장되고 읽으면 원래 값이 나온다', () => {
  store.__setCipherForTest(fakeCipher('A'));
  const repo = memRepo();
  store.saveTokens(repo, { refreshToken: 'r-secret', accessToken: 'a-secret', expiresIn: 3600 });
  assert.ok(repo._m.get('google_refresh_token').startsWith('enc1:'));
  assert.ok(!repo._m.get('google_refresh_token').includes('r-secret'));
  const t = store.getTokens(repo);
  assert.strictEqual(t.refreshToken, 'r-secret');
  assert.strictEqual(t.accessToken, 'a-secret');
  assert.ok(store.isConnected(repo));
});

test('예전 평문 토큰은 읽을 때 암호화본으로 바뀐다', () => {
  store.__setCipherForTest(fakeCipher('A'));
  const repo = memRepo();
  repo.set('google_refresh_token', 'plain-refresh');
  assert.strictEqual(store.getTokens(repo).refreshToken, 'plain-refresh');
  assert.ok(repo._m.get('google_refresh_token').startsWith('enc1:'));
});

test('다른 계정/PC에서 복사된 DB의 토큰은 연결 안 됨으로 취급', () => {
  store.__setCipherForTest(fakeCipher('A'));
  const repo = memRepo();
  store.saveTokens(repo, { refreshToken: 'r-secret' });
  store.__setCipherForTest(fakeCipher('B'));
  assert.strictEqual(store.getTokens(repo).refreshToken, null);
  assert.strictEqual(store.isConnected(repo), false);
});

test('암호화를 못 쓰는 환경이면 평문 그대로 저장(기존 동작 유지)', () => {
  store.__setCipherForTest(null);
  const repo = memRepo();
  store.saveTokens(repo, { refreshToken: 'r-plain' });
  assert.strictEqual(repo._m.get('google_refresh_token'), 'r-plain');
  assert.strictEqual(store.getTokens(repo).refreshToken, 'r-plain');
});
