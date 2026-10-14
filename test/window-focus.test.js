const test = require('node:test');
const assert = require('node:assert');
const { bringMainForward, sendWhenLoaded } = require('../main/shared/window-focus');

// 필요한 만큼만 흉내 낸 BrowserWindow — 호출 기록만 남긴다
function fakeWin({ loading = false, crashed = false, focused = true, visible = true } = {}) {
  const calls = [];
  const once = {};
  const wc = {
    isLoading: () => loading,
    isCrashed: () => crashed,
    reload: () => calls.push('reload'),
    send: (ch, p) => calls.push(`send:${ch}:${p}`),
    once: (ev, fn) => (once[ev] = fn),
  };
  const win = {
    webContents: wc,
    calls,
    onceHandlers: once,
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => visible,
    isFocused: () => focused,
    restore: () => calls.push('restore'),
    setAlwaysOnTop: (v) => calls.push(`top:${v}`),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    moveTop: () => calls.push('moveTop'),
    flashFrame: (v) => calls.push(`flash:${v}`),
  };
  win.once = (ev, fn) => (win.winOnce = { ...(win.winOnce || {}), [ev]: fn });
  return win;
}

test('화면이 로딩 중이면 이동 요청은 로딩이 끝난 뒤에 보낸다', () => {
  const win = fakeWin({ loading: true });
  sendWhenLoaded(win, 'itda:navigate', '#/memo/5');
  assert.ok(!win.calls.some((c) => c.startsWith('send:')), '로딩 중엔 안 보냄');
  win.onceHandlers['did-finish-load']();
  assert.deepStrictEqual(win.calls, ['send:itda:navigate:#/memo/5']);
});

test('로딩이 끝난 화면엔 바로 보낸다', () => {
  const win = fakeWin();
  sendWhenLoaded(win, 'itda:navigate', '#/memo/5');
  assert.deepStrictEqual(win.calls, ['send:itda:navigate:#/memo/5']);
});

test('창이 없으면 false를 돌려주고 진단 로그에 이유를 남긴다', () => {
  const notes = [];
  assert.strictEqual(bringMainForward(null, '#/memo/1', { note: (e, d) => notes.push(`${e} ${d}`) }), false);
  assert.match(notes[0], /open-main-failed .*no-window/);
});

test('정상이면 보여주고 이동 요청을 보낸다 — 포커스를 받았으면 추가 조치 없음', async () => {
  const win = fakeWin();
  assert.strictEqual(bringMainForward(win, '#/memo/1', { verifyMs: 0 }), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(win.calls.includes('show') && win.calls.includes('send:itda:navigate:#/memo/1'));
  assert.ok(!win.calls.includes('flash:true'));
});

test('포커스를 못 받으면 한 번 더 올리고 작업표시줄을 깜박이며 로그를 남긴다', async () => {
  const win = fakeWin({ focused: false });
  const notes = [];
  bringMainForward(win, '#/inbox', { verifyMs: 0, note: (e, d) => notes.push(`${e} ${d}`) });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(win.calls.includes('moveTop'));
  assert.ok(win.calls.includes('flash:true'));
  assert.match(notes[0], /open-main-unfocused .*focused=false/);
});

test('렌더러가 죽어 있으면 다시 불러온다', () => {
  const win = fakeWin({ crashed: true });
  bringMainForward(win, null, { verifyMs: 100000 });
  assert.ok(win.calls.includes('reload'));
});
