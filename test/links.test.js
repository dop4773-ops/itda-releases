// main/ipc/links.ipc.js canonicalizeLink — (a,b)와 (b,a)를 같은 정규형으로 접어 중복 연결 방지
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeLink } = require('../main/ipc/links.ipc');

// VALID_TYPES 순서: ['todo','event','memo','postit','inbox'] — 타입 랭크가 낮은 쪽이 a
test('타입이 다르면 랭크 낮은 쪽이 a (방향 무관 동일 결과)', () => {
  const fwd = canonicalizeLink('memo', 5, 'todo', 9);
  const rev = canonicalizeLink('todo', 9, 'memo', 5);
  assert.deepEqual(fwd, { a_type: 'todo', a_id: 9, b_type: 'memo', b_id: 5 });
  assert.deepEqual(fwd, rev);
});

test('같은 타입이면 id 작은 쪽이 a', () => {
  assert.deepEqual(canonicalizeLink('todo', 20, 'todo', 3), { a_type: 'todo', a_id: 3, b_type: 'todo', b_id: 20 });
  assert.deepEqual(canonicalizeLink('todo', 3, 'todo', 20), { a_type: 'todo', a_id: 3, b_type: 'todo', b_id: 20 });
});

test('문자열 id도 숫자로 정규화', () => {
  assert.deepEqual(canonicalizeLink('memo', '5', 'memo', '2'), { a_type: 'memo', a_id: 2, b_type: 'memo', b_id: 5 });
});

test('자기 자신 연결은 거부', () => {
  assert.throws(() => canonicalizeLink('todo', 7, 'todo', 7), /같은 항목/);
  assert.throws(() => canonicalizeLink('todo', 7, 'todo', '7'), /같은 항목/);
});

test('알 수 없는 타입은 거부', () => {
  assert.throws(() => canonicalizeLink('todo', 1, 'bogus', 2), /연결할 수 없는/);
});
