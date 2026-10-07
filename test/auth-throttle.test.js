const test = require('node:test');
const assert = require('node:assert');
const { createThrottle } = require('../main/shared/auth-throttle');

const setup = () => {
  const m = new Map();
  const settings = { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) };
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  return { settings, clock, throttle: createThrottle(settings, clock.now) };
};

test('4번까지는 막히지 않고, 5번째 실패에 30초 → 6번째 60초 → 7번째부터 5분', () => {
  const { throttle, clock } = setup();
  for (let i = 0; i < 4; i++) {
    throttle.recordFail();
    assert.strictEqual(throttle.remainingSec(), 0);
  }
  throttle.recordFail();
  assert.strictEqual(throttle.remainingSec(), 30);
  clock.advance(30_000);
  assert.strictEqual(throttle.remainingSec(), 0);
  throttle.recordFail();
  assert.strictEqual(throttle.remainingSec(), 60);
  clock.advance(60_000);
  throttle.recordFail();
  assert.strictEqual(throttle.remainingSec(), 300);
  clock.advance(300_000);
  throttle.recordFail();
  assert.strictEqual(throttle.remainingSec(), 300);
});

test('성공하면 횟수가 0으로 돌아가고, 1시간 넘게 지나면 예전 실패는 잊는다', () => {
  const a = setup();
  for (let i = 0; i < 4; i++) a.throttle.recordFail();
  a.throttle.recordSuccess();
  a.throttle.recordFail();
  assert.strictEqual(a.throttle.remainingSec(), 0);

  const b = setup();
  for (let i = 0; i < 4; i++) b.throttle.recordFail();
  b.clock.advance(61 * 60 * 1000);
  b.throttle.recordFail(); // 새로 1번째
  assert.strictEqual(b.throttle.remainingSec(), 0);
});

test('앱을 다시 켜도(새 인스턴스) 막힌 상태가 이어진다', () => {
  const { settings, clock, throttle } = setup();
  for (let i = 0; i < 5; i++) throttle.recordFail();
  assert.strictEqual(createThrottle(settings, clock.now).remainingSec(), 30);
});
