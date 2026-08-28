/**
 * main/ipc/dashboardImages.ipc.js
 *
 * 대시보드 "사진 블록"용 이미지 저장. 렌더러가 축소한 JPEG dataURL을 넘기면
 * userData/dashboard-images/ 폴더에 파일로 저장하고 파일명만 돌려준다 —
 * 설정(app_settings)에는 파일명만 들어가서 JSON이 비대해지지 않는다.
 * 표시할 때는 memo 첨부와 같은 방식(main이 읽어서 dataURL로 반환)으로 준다
 * (sandbox+contextIsolation 환경이라 file:// <img> 로딩이 불안정해서).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

function dir() {
  const d = path.join(app.getPath('userData'), 'dashboard-images');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
const safeName = (name) => /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(name || '');

module.exports = function registerDashboardImagesIpc(ipcMain) {
  ipcMain.handle('dashboardImages:save', (event, { dataUrl }) => {
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(dataUrl || '');
    if (!m) throw new Error('이미지 데이터 형식이 올바르지 않습니다.');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(dir(), name), Buffer.from(m[2], 'base64'));
    return { name };
  });

  ipcMain.handle('dashboardImages:get', (event, name) => {
    if (!safeName(name)) return null;
    const p = path.join(dir(), name);
    if (!fs.existsSync(p)) return null;
    const ext = path.extname(name).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  });

  ipcMain.handle('dashboardImages:delete', (event, name) => {
    if (!safeName(name)) return { ok: false };
    try {
      const p = path.join(dir(), name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.error('[itda] 대시보드 이미지 삭제 실패(무시):', e.message);
    }
    return { ok: true };
  });
};
