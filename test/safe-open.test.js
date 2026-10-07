const test = require('node:test');
const assert = require('node:assert');
const { isRiskyPath, openLocalPath } = require('../main/shared/safe-open');

test('실행 파일·스크립트는 위험 경로로 판단(대소문자·끝 공백/점·스트림 우회 포함)', () => {
  for (const p of ['C:\\a\\run.exe', 'C:\\a\\RUN.EXE', 'C:\\a\\x.bat', '\\\\srv\\share\\m.lnk', 'C:\\a\\x.exe. ', 'C:\\a\\x.exe:evil', 'C:\\a\\setup.msi']) {
    assert.ok(isRiskyPath(p), p);
  }
  for (const p of ['C:\\a\\보고서.xlsx', 'C:\\a\\폴더', 'C:\\a\\사진.JPG', 'C:\\a\\notes.txt', 'D:\\exe\\문서.pdf']) {
    assert.ok(!isRiskyPath(p), p);
  }
});

test('위험 경로는 열지 않고 위치만 보여주고, 안전한 경로는 연다', async () => {
  const calls = [];
  const shell = { showItemInFolder: (p) => calls.push(['reveal', p]), openPath: async (p) => (calls.push(['open', p]), '') };
  assert.deepStrictEqual(await openLocalPath(shell, 'C:\\a\\x.exe'), { ok: true, err: null, revealed: true });
  assert.deepStrictEqual(await openLocalPath(shell, 'C:\\a\\x.pdf'), { ok: true, err: null });
  assert.deepStrictEqual(calls, [['reveal', 'C:\\a\\x.exe'], ['open', 'C:\\a\\x.pdf']]);
});
