// STEP 4 — "항목 생성 + 연결/Inbox 처리표시"가 한 트랜잭션으로 원자적인지.
// _shared.linkNewItem + repos.transaction 조합을 실제 in-memory DB로 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const createRepositories = require('../main/repositories');
const { linkNewItem } = require('../main/ipc/_shared');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf-8');

function freshRepos() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return { db, repos: createRepositories(db) };
}

const linkCount = (db) => db.prepare('SELECT COUNT(*) c FROM item_links').get().c;
const todoCount = (db) => db.prepare('SELECT COUNT(*) c FROM todos').get().c;

test('happy: todos:add 흐름 — 항목 + 연결이 같은 트랜잭션에서 함께 커밋', () => {
  const { db, repos } = freshRepos();
  const memo = repos.memos.insert({ title: '기존 메모', content: '' });

  const result = repos.transaction(() => {
    const r = repos.todos.insert({ title: '전환된 할 일' });
    linkNewItem(repos, 'todo', r.id, { link: { type: 'memo', id: memo.id } });
    return r;
  })();

  assert.equal(todoCount(db), 1);
  assert.equal(linkCount(db), 1);
  const row = db.prepare('SELECT a_type, b_type FROM item_links').get();
  assert.deepEqual(row, { a_type: 'todo', b_type: 'memo' }); // canonicalize: todo 랭크가 앞
  assert.ok(repos.links.kindsForMany('todo', [result.id])[result.id].has('memo'));
  db.close();
});

test('rollback: 연결 단계가 throw하면 항목 insert도 되돌아감', () => {
  const { db, repos } = freshRepos();

  assert.throws(() => {
    repos.transaction(() => {
      repos.todos.insert({ title: '고아가 되면 안 되는 할 일' });
      // 자기 자신 연결 → canonicalizeLink가 throw
      linkNewItem(repos, 'todo', 1, { link: { type: 'todo', id: 1 } });
    })();
  }, /같은 항목/);

  assert.equal(todoCount(db), 0, '항목이 롤백되어 고아가 안 남음');
  assert.equal(linkCount(db), 0);
  db.close();
});

test('happy: fromInbox — 항목 + Inbox 처리표시가 함께 커밋', () => {
  const { db, repos } = freshRepos();
  const inboxItem = repos.inbox.insert('회의 준비');

  repos.transaction(() => {
    const r = repos.todos.insert({ title: '회의 준비', sourceInboxId: inboxItem.id });
    linkNewItem(repos, 'todo', r.id, { fromInbox: inboxItem.id });
    return r;
  })();

  const inbox = db.prepare('SELECT is_processed, processed_type, processed_ref_id FROM inbox_items WHERE id = ?').get(inboxItem.id);
  assert.equal(inbox.is_processed, 1);
  assert.equal(inbox.processed_type, 'todo');
  assert.equal(inbox.processed_ref_id, 1);
  db.close();
});

test('rollback: fromInbox 뒤 실패 시 Inbox 처리표시도 되돌아감', () => {
  const { db, repos } = freshRepos();
  const inboxItem = repos.inbox.insert('되돌려질 항목');

  assert.throws(() => {
    repos.transaction(() => {
      const r = repos.todos.insert({ title: 'x' });
      linkNewItem(repos, 'todo', r.id, { fromInbox: inboxItem.id });
      throw new Error('그 다음 단계에서 실패');
    })();
  });

  const inbox = db.prepare('SELECT is_processed FROM inbox_items WHERE id = ?').get(inboxItem.id);
  assert.equal(inbox.is_processed, 0, 'Inbox 항목이 미처리로 되돌아감');
  assert.equal(todoCount(db), 0);
  db.close();
});

test('link/fromInbox 없으면 linkNewItem은 아무 것도 안 함', () => {
  const { db, repos } = freshRepos();
  const r = repos.todos.insert({ title: '그냥 추가' });
  linkNewItem(repos, 'todo', r.id, {});
  assert.equal(linkCount(db), 0);
  db.close();
});
