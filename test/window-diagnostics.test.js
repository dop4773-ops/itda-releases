const test = require('node:test');
const assert = require('node:assert');
const { labelOf, formatLine } = require('../main/shared/window-diagnostics');

test('창 주소에서 어떤 창인지 알아볼 수 있는 이름을 만든다', () => {
  assert.strictEqual(labelOf('file:///Users/x/itda/renderer/widget.html?type=memo-item&id=3'), 'widget:memo-item#3');
  assert.strictEqual(labelOf('file:///C:/app/renderer/widget.html?type=admission'), 'widget:admission');
  assert.strictEqual(labelOf('file:///C:/app/renderer/day-alert.html?kind=a'), 'day-alert:a');
  assert.strictEqual(labelOf('file:///C:/app/renderer/index.html#/today'), 'index');
  assert.strictEqual(labelOf('not a url'), 'unknown');
});

test('로그 한 줄은 시각 + 사건 + 내용', () => {
  assert.strictEqual(formatLine(new Date('2026-10-08T01:02:03.000Z'), 'close', 'widget:memo-item#3 by=screen-or-os'), '[2026-10-08T01:02:03.000Z] close widget:memo-item#3 by=screen-or-os\n');
  assert.strictEqual(formatLine(new Date('2026-10-08T01:02:03.000Z'), 'resume'), '[2026-10-08T01:02:03.000Z] resume\n');
});
