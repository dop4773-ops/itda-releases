/**
 * scripts/make-icons.js — 소스 PNG 하나로 앱/트레이/사이드바 아이콘을 전부 만든다.
 *   node scripts/make-icons.js <source.png>
 * 만드는 것:
 *   build/icon.ico              (Windows 앱/작업표시줄 — 16~256px PNG를 담은 ICO)
 *   build/icon.png              (electron-builder 자동생성용 512px 원본)
 *   build/icons/app-icon.png    (사이드바 로고 — 256px)
 * 트레이 아이콘(build/icons/tray-icon.png)은 16px에서 읽혀야 해서 상세 아이콘을 그냥 줄이면
 * 뭉개진다 — 별도의 단순 글리프가 필요하므로 이 스크립트는 건드리지 않는다.
 * 의존성 없음: 리사이즈는 macOS 내장 sips, ICO 조립은 여기서 직접(PNG를 그대로 담는 최신 ICO 포맷).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const src = process.argv[2] || path.join(__dirname, '..', 'build', 'icon-source.png');
if (!fs.existsSync(src)) {
  console.error('소스 PNG가 없어요: ', src, '\n사용법: node scripts/make-icons.js [source.png]');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const ICONS = path.join(BUILD, 'icons');
const TMP = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'itda-icons-'));

function resize(size, out) {
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' });
  return fs.readFileSync(out);
}

// ---- ICO 조립 (PNG 페이로드) ----
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = ICO_SIZES.map((s) => ({ size: s, data: resize(s, path.join(TMP, `i${s}.png`)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

const entries = Buffer.alloc(16 * pngs.length);
let offset = 6 + entries.length;
pngs.forEach((p, i) => {
  const e = i * 16;
  entries.writeUInt8(p.size >= 256 ? 0 : p.size, e + 0); // width (0 = 256)
  entries.writeUInt8(p.size >= 256 ? 0 : p.size, e + 1); // height
  entries.writeUInt8(0, e + 2); // palette
  entries.writeUInt8(0, e + 3); // reserved
  entries.writeUInt16LE(1, e + 4); // color planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(p.data.length, e + 8);
  entries.writeUInt32LE(offset, e + 12);
  offset += p.data.length;
});

fs.writeFileSync(path.join(BUILD, 'icon.ico'), Buffer.concat([header, entries, ...pngs.map((p) => p.data)]));

// ---- PNG 아이콘들 ----
fs.mkdirSync(ICONS, { recursive: true });
fs.writeFileSync(path.join(ICONS, 'app-icon.png'), resize(256, path.join(TMP, 'app.png')));
// electron-builder가 PNG로부터 자동 생성할 때도 쓰도록 큰 원본 하나
fs.writeFileSync(path.join(BUILD, 'icon.png'), resize(512, path.join(TMP, 'icon512.png')));

fs.rmSync(TMP, { recursive: true, force: true });
console.log('아이콘 생성 완료:', ['build/icon.ico', 'build/icon.png', 'build/icons/app-icon.png'].join(', '));
