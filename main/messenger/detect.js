/**
 * 메신저 DB(messenger.db) 위치 자동 찾기 — 설정 화면의 "자동 찾기"용. 파일은 열지 않고 존재만 확인한다.
 * 메신저가 쓰는 폴더 이름은 실제 PC에서만 확인할 수 있어서, 흔한 데이터 폴더 아래에서 이름에 mirae/messenger/미래가 든
 * 폴더를 얕게(깊이 3) 훑는다.
 */
const fs = require('node:fs');
const path = require('node:path');

const NAME_HINT = /mirae|messenger|미래/i;
const MAX_DEPTH = 3;
const MAX_ENTRIES = 4000;

function findMessengerDbs(roots) {
  const found = new Map();
  let seen = 0;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      seen++;
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name.toLowerCase() === 'messenger.db') {
        try {
          const st = fs.statSync(full);
          found.set(full, { path: full, size: st.size, modified: st.mtime.toISOString() });
        } catch (e) {
          /* 권한 등으로 못 읽으면 건너뜀 */
        }
      } else if (ent.isDirectory() && depth < MAX_DEPTH) walk(full, depth + 1);
    }
  };
  for (const root of roots.filter(Boolean)) {
    let top;
    try {
      top = fs.readdirSync(root, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of top) if (ent.isDirectory() && NAME_HINT.test(ent.name)) walk(path.join(root, ent.name), 1);
  }
  return [...found.values()].sort((a, b) => b.modified.localeCompare(a.modified));
}

module.exports = { findMessengerDbs };
