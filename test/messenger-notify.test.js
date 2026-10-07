const test = require('node:test');
const assert = require('node:assert');
const { pendingNotice } = require('../main/messenger/notify');

test('확인 필요가 없으면 알림 없음', () => {
  assert.strictEqual(pendingNotice({ deletes: [], vanished: [] }), null);
  assert.strictEqual(pendingNotice(undefined), null);
});

test('알림 문구에는 건수만 있고 제목·이름은 없다', () => {
  const n = pendingNotice({ deletes: [{ key: 'a', title: '입원 3명 김영자' }], vanished: [{ source: 'admission', ext_id: '9' }, { source: 'outing', ext_id: '2' }] });
  assert.match(n.body, /지울 일정 1건 · 메신저에서 사라진 항목 2건/);
  assert.ok(!/김영자|입원 3명/.test(n.title + n.body));
});

test('같은 대상이면 같은 키(순서 무관), 대상이 바뀌면 다른 키', () => {
  const a = pendingNotice({ deletes: [{ key: 'x' }, { key: 'y' }], vanished: [] });
  const b = pendingNotice({ deletes: [{ key: 'y' }, { key: 'x' }], vanished: [] });
  const c = pendingNotice({ deletes: [{ key: 'x' }, { key: 'z' }], vanished: [] });
  assert.strictEqual(a.key, b.key);
  assert.notStrictEqual(a.key, c.key);
});
