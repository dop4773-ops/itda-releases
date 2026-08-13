/**
 * scripts/postinstall-electron-fix.js
 *
 * 목적: "npm start" 할 때 아래 두 가지가 반복적으로 사람이 수동 개입해야 했던 문제를
 * npm install 과정에서 자동으로 감지하고 스스로 고치도록 만든다.
 *
 *   1. Electron 바이너리 미설치/손상
 *      - electron 패키지 자체의 postinstall(install.js)이 allow-scripts류 정책에
 *        막혀 실행되지 않는 경우
 *      - Node.js 24.16.0+/26.1.0+ 에서 발생하는 압축해제 버그(electron/electron#51619)로
 *        다운로드는 됐는데 dist 폴더에 locales만 남고 실행파일이 없는 경우
 *   2. macOS Gatekeeper가 서명되지 않은 개발용 Electron.app을
 *      "악성 코드" 경고와 함께 차단하는 경우
 *
 * 이 파일은 프로젝트 자신의 postinstall(package.json)에서 실행되므로,
 * 의존성 패키지의 설치 스크립트를 막는 보안 정책과 무관하게 항상 실행된다.
 * 실패해도 npm install 자체를 실패시키지 않는다(경고만 남기고 0으로 종료) —
 * 이 스크립트가 못 고치는 경우에도 사용자가 README.md를 보고 수동으로
 * 이어갈 수 있어야 하기 때문이다.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');

function log(msg) {
  console.log(`[itda:postinstall] ${msg}`);
}

function warn(msg) {
  console.warn(`[itda:postinstall] ⚠ ${msg}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function tryRun(cmd, args, opts = {}) {
  try {
    run(cmd, args, opts);
    return true;
  } catch (e) {
    return false;
  }
}

function expectedBinaryPath() {
  const dist = path.join(ELECTRON_DIR, 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dist, 'electron'); // linux
}

function electronAppBundlePath() {
  return path.join(ELECTRON_DIR, 'dist', 'Electron.app');
}

function cacheDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'electron');
  }
  return path.join(os.homedir(), '.cache', 'electron');
}

function requiredElectronVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf-8'));
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

function findCachedZip() {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return null;

  const results = [];
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^electron-v.*\.zip$/i.test(entry.name)) results.push(full);
    }
  }
  walk(dir);
  if (results.length === 0) return null;

  // ~/Library/Caches/electron(또는 Windows의 %LOCALAPPDATA%\electron\Cache)은 이 컴퓨터의
  // 다른 Electron 프로젝트들과 공유하는 "전역" 캐시다. 예전엔 여기서 그냥 가장 최근 수정된
  // zip 하나를 집어서 풀었는데, 그게 이 프로젝트가 필요로 하는 버전이 아닌 경우(다른 프로젝트가
  // 최근에 다른 Electron 버전을 받아놔서 그게 더 최근 파일인 경우)에도 "복구 성공"으로
  // 오판하고 완전히 다른 버전을 설치해버리는 실제 버그가 있었다 — better-sqlite3가 나중에
  // "다른 Node.js 버전으로 컴파일됨(NODE_MODULE_VERSION 불일치)" 에러를 내는 근본 원인이었다.
  // node_modules/electron/package.json에 적힌 "이 프로젝트가 실제로 필요로 하는 버전"과
  // 파일명이 정확히 일치하는 것만 후보로 삼는다.
  const wanted = requiredElectronVersion();
  if (wanted) {
    const versionMatched = results.filter((p) => path.basename(p).startsWith(`electron-v${wanted}-`));
    if (versionMatched.length === 0) {
      warn(`전역 캐시에 electron-v${wanted}용 zip이 없습니다(다른 프로젝트가 받아둔 다른 버전만 있음) — 버전이 다른 캐시는 안전하지 않아 사용하지 않습니다.`);
      return null;
    }
    versionMatched.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return versionMatched[0];
  }

  // package.json을 못 읽어서 필요한 버전을 확인할 수 없는 예외적인 경우에만, 기존 방식(가장 최근 파일)으로 동작한다.
  results.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return results[0];
}

function binaryExists() {
  const p = expectedBinaryPath();
  if (!fs.existsSync(p)) return false;
  // Node 24.16+/26.1+의 압축해제 버그(electron/electron#51619)는 파일 자체는 만들어놓고
  // 내용이 0바이트인 채로 끝나는 경우가 있다. existsSync만으로는 이런 "존재하지만 깨진"
  // 상태를 놓쳐서 진단 스크립트가 잘못 "정상 설치됨"이라고 판단하는 실제 버그가 있었다.
  // 정상적인 electron 실행파일은 최소 수십MB는 되므로, 1MB 미만이면 손상된 것으로 간주한다.
  try {
    const size = fs.statSync(p).size;
    return size > 1024 * 1024;
  } catch (e) {
    return false;
  }
}

function attemptOfficialInstall() {
  const installScript = path.join(ELECTRON_DIR, 'install.js');
  if (!fs.existsSync(installScript)) return false;
  log('electron 자체 설치 스크립트를 직접 실행합니다 (allow-scripts 등으로 건너뛰어졌을 수 있음)...');
  return tryRun(process.execPath, [installScript], { cwd: ELECTRON_DIR });
}

function attemptManualExtract() {
  const zip = findCachedZip();
  if (!zip) {
    warn('캐시된 Electron 바이너리 zip을 찾지 못했습니다. (다운로드 자체가 안 된 상태로 보입니다)');
    return false;
  }
  log(`캐시된 파일을 찾았습니다: ${zip}`);
  const distDir = path.join(ELECTRON_DIR, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const ok = tryRun('tar', ['-xf', zip, '-C', distDir]);
  if (!ok) {
    warn('tar로 압축 해제하는 데 실패했습니다. (Windows라면 10 1803 이상인지 확인해주세요)');
    return false;
  }

  // node_modules/electron/index.js는 path.txt(dist 폴더가 아니라 electron 루트)를 읽어
  // 실행 파일 경로를 찾는다. 줄바꿈이 들어가면 깨지므로 정확히 이 방식으로 써야 한다.
  const pathTxt = path.join(ELECTRON_DIR, 'path.txt');
  const exeName = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  fs.writeFileSync(pathTxt, exeName);

  return binaryExists();
}

function fixMacGatekeeper() {
  if (process.platform !== 'darwin') return;
  const appPath = electronAppBundlePath();
  if (!fs.existsSync(appPath)) return;

  log('macOS Gatekeeper가 개발용 Electron.app을 차단하지 않도록 미리 처리합니다...');

  // 1) 다운로드 격리(quarantine) 속성 제거
  const xattrOk = tryRun('xattr', ['-cr', appPath]);
  // 2) 애드혹 서명 — 서명 자체가 없어서 "악성 코드"로 표시되는 경우를 방지
  const codesignOk = tryRun('codesign', ['--force', '--deep', '--sign', '-', appPath]);

  if (xattrOk || codesignOk) {
    log('macOS 보안 경고 예방 처리 완료 (xattr/codesign).');
  } else {
    warn('xattr/codesign 명령을 실행할 수 없었습니다. 앱 실행 시 "악성 코드" 경고가 뜨면 다음을 직접 실행해주세요:');
    warn(`  xattr -cr "${appPath}"`);
  }
}

function main() {
  if (!fs.existsSync(ELECTRON_DIR)) {
    warn('node_modules/electron이 없습니다. npm install이 아직 끝나지 않았거나 electron이 devDependencies에서 빠진 것 같습니다.');
    process.exit(0);
  }

  if (binaryExists()) {
    log('Electron 바이너리가 정상적으로 설치되어 있습니다.');
    fixMacGatekeeper();
    process.exit(0);
  }

  warn('Electron 바이너리가 없거나 손상되어 있습니다 (0바이트 등 — allow-scripts 정책 또는 압축해제 버그로 보입니다). 자동 복구를 시도합니다...');

  if (attemptOfficialInstall() && binaryExists()) {
    log('electron 자체 설치 스크립트로 복구 성공.');
    fixMacGatekeeper();
    process.exit(0);
  }

  if (attemptManualExtract()) {
    log('캐시에서 수동 압축 해제로 복구 성공.');
    fixMacGatekeeper();
    process.exit(0);
  }

  warn('자동 복구에 실패했습니다. README.md의 "Electron 압축 해제 실패" 항목을 참고해 수동으로 진행해주세요.');
  warn('(이 경고는 npm install 자체를 실패시키지 않습니다 — 계속 진행됩니다.)');
  process.exit(0); // npm install 전체를 실패시키지 않기 위해 항상 0으로 종료
}

main();
