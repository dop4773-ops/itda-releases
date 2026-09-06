// STEP 5 — 고아 연결(상대 항목이 완전삭제됨) 처리:
//  1) kindsForMany가 고아 연결을 종류 집계에서 제외한다 (배지가 계속 뜨던 것)
//  2) 마이그레이션이 기존 고아 item_links 행을 1회 청소한다
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const createRepositories = require('../main/repositories');
const { runLightweightMigrations } = require('../main/db.js');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf-8');
const fresh = () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
};

test('kindsForMany: 살아있는 상대는 집계, 완전삭제된 상대는 제외', () => {
  const db = fresh();
  const repos = createRepositories(db);
  const p = repos.postits.insert({ content: '포스트잇' });
  const liveTodo = repos.todos.insert({ title: '살아있는 할 일' });
  repos.links.insertIgnore({ a_type: 'todo', a_id: liveTodo.id, b_type: 'postit', b_id: p.id });
  // event와의 연결을 만든 뒤 그 event를 완전삭제(행 자체 제거)
  const goneEvent = repos.events.insert({ title: '지워질 일정', startAt: '2026-01-01 10:00:00', endAt: '2026-01-01 11:00:00' });
  repos.links.insertIgnore({ a_type: 'event', a_id: goneEvent.id, b_type: 'postit', b_id: p.id });
  db.prepare('DELETE FROM events WHERE id = ?').run(goneEvent.id); // 완전삭제 흉내

  const kinds = repos.links.kindsForMany('postit', [p.id]);
  assert.deepEqual([...kinds[p.id]].sort(), ['todo'], 'todo만 남고 event(고아)는 빠짐');
  db.close();
});

test('kindsForMany: 소프트삭제(휴지통) 상대는 그대로 유지 (행이 남아있음)', () => {
  const db = fresh();
  const repos = createRepositories(db);
  const p = repos.postits.insert({ content: '포스트잇' });
  const t = repos.todos.insert({ title: '휴지통 갈 할 일' });
  repos.links.insertIgnore({ a_type: 'todo', a_id: t.id, b_type: 'postit', b_id: p.id });
  db.prepare("UPDATE todos SET deleted_at = datetime('now') WHERE id = ?").run(t.id); // 소프트삭제

  const kinds = repos.links.kindsForMany('postit', [p.id]);
  assert.deepEqual([...kinds[p.id]], ['todo'], '소프트삭제는 유지 (복원 대비)');
  db.close();
});

test('마이그레이션: 기존 고아 item_links 행을 청소한다', () => {
  const db = fresh();
  const repos = createRepositories(db);
  const t = repos.todos.insert({ title: '살아있는 할 일' });
  const m = repos.memos.insert({ title: '살아있는 메모', content: '' });
  repos.links.insertIgnore({ a_type: 'todo', a_id: t.id, b_type: 'memo', b_id: m.id }); // 정상
  // 상대가 존재하지 않는 고아 행을 직접 주입 (예전 버전 잔재)
  db.prepare("INSERT INTO item_links (a_type, a_id, b_type, b_id) VALUES ('todo', ?, 'memo', 99999)").run(t.id);
  db.prepare("INSERT INTO item_links (a_type, a_id, b_type, b_id) VALUES ('postit', 88888, 'memo', ?)").run(m.id);
  db.pragma('user_version = 0'); // 구버전으로 되돌려 마이그레이션이 돌게

  runLightweightMigrations(db);

  const rows = db.prepare('SELECT a_type, a_id, b_type, b_id FROM item_links').all();
  assert.equal(rows.length, 1, '정상 연결 1건만 남음');
  assert.deepEqual(rows[0], { a_type: 'todo', a_id: t.id, b_type: 'memo', b_id: m.id });
  db.close();
});
