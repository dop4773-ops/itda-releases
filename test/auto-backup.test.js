const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { selectBackupsToDelete, backupBeforeMigration } = require('../main/auto-backup');

const name = (d) => `itda-auto-${d}T03-00-00-000Z.db`;

test('보관: 최근 7개 + 그 이전은 주마다 하나씩 4주치만 남긴다', () => {
  // 2026-08-01 ~ 2026-10-07 매일 백업
  const names = [];
  for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2026, 9, 7); t += 86400000) names.push(name(new Date(t).toISOString().slice(0, 10)));
  const del = new Set(selectBackupsToDelete(names));
  const kept = names.filter((n) => !del.has(n));
  assert.strictEqual(kept.length, 7 + 4);
  assert.ok(kept.includes(name('2026-10-07')) && kept.includes(name('2026-10-01'))); // 최근 7개
  assert.ok(!kept.includes(name('2026-09-01'))); // 5주 넘게 지난 건 삭제
  // 오래된 주 대표는 그 주의 가장 최신 파일(일요일) — 10/01 직전 4주: 9/7~9/13, 9/14~, 9/21~, 9/28~
  assert.ok(kept.includes(name('2026-09-27')) && kept.includes(name('2026-09-06') ) === false);
});

test('보관: 이름을 해석 못 하는 파일은 지우지 않고, 개수가 적으면 아무것도 안 지운다', () => {
  assert.deepStrictEqual(selectBackupsToDelete([name('2026-10-01'), name('2026-10-02')]), []);
  const many = ['itda-auto-weird.db', ...Array.from({ length: 12 }, (_, i) => name(`2026-10-${String(i + 1).padStart(2, '0')}`))];
  assert.ok(!selectBackupsToDelete(many).includes('itda-auto-weird.db'));
});

test('마이그레이션 전 백업: 현재 데이터가 담긴 사본이 만들어지고 최근 3개만 남는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-bk-'));
  const db = new Database(path.join(dir, 'src.db'));
  db.pragma('journal_mode = WAL');
  db.exec("CREATE TABLE t(v TEXT); INSERT INTO t VALUES ('남아야 하는 데이터');");
  for (let v = 1; v <= 5; v++) backupBeforeMigration(db, v, path.join(dir, 'backups'));
  const files = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.strictEqual(files.length, 3);
  const copy = new Database(path.join(dir, 'backups', files[2]), { readonly: true });
  assert.strictEqual(copy.prepare('SELECT v FROM t').get().v, '남아야 하는 데이터');
});
