// `npm test` 진입점. better-sqlite3가 Electron의 Node ABI로 빌드돼 있어서, 테스트는 일반 node가
// 아니라 Electron을 Node 모드(ELECTRON_RUN_AS_NODE)로 띄워서 돌려야 한다. OS/셸에 관계없이
// 동작하도록 인라인 환경변수 대신 여기서 spawn 한다 (cross-env 같은 의존성 없이).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const electron = require('electron'); // 일반 node에서 require하면 실행 파일 경로 문자열을 준다
const testDir = path.join(__dirname, '..', 'test');

const res = spawnSync(electron, ['--test', testDir], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

process.exit(res.status ?? 1);
