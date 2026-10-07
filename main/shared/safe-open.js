const path = require('path');

// 메모 본문의 파일 경로 링크를 눌렀을 때 "실행"되면 안 되는 확장자 — 바이러스·스크립트가 링크 한 번으로 돌아가는 걸 막는다.
// 이런 파일은 실행하지 않고 탐색기에서 위치만 보여준다(폴더·문서·이미지 등은 그대로 연결 프로그램으로 열림).
const RISKY_EXT = new Set([
  '.exe', '.com', '.scr', '.pif', '.msi', '.msp', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.hta', '.lnk', '.url', '.reg', '.jar', '.cpl', '.msc', '.dll', '.gadget', '.appref-ms',
  '.app', '.command', '.sh', '.workflow',
]);

function isRiskyPath(p) {
  // 윈도우는 끝의 공백·점을 무시하고("a.exe. "), 확장자 뒤 ":스트림"도 같은 파일로 취급하므로 그걸 걷어낸 뒤 확장자를 본다
  const name = path.win32.basename(String(p).trim().replace(/[\\/]+$/, '')).replace(/:.*$/, '').replace(/[\s.]+$/, '');
  return RISKY_EXT.has(path.win32.extname(name).toLowerCase());
}

/**
 * shell.openPath의 안전판 — 위험 확장자면 실행 대신 탐색기에서 위치만 보여준다.
 * @returns {Promise<{ok:boolean, err:string|null, revealed?:boolean}>}
 */
async function openLocalPath(shell, target) {
  if (isRiskyPath(target)) {
    shell.showItemInFolder(target);
    return { ok: true, err: null, revealed: true };
  }
  const err = await shell.openPath(target);
  return { ok: !err, err: err || null };
}

module.exports = { isRiskyPath, openLocalPath };
