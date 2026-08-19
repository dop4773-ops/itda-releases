const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

/**
 * 앱 최초 실행 시 userData 경로에 assistant.db를 생성하고
 * schema/itda_schema_v1.sql 을 적용한다.
 * 이미 DB가 있으면 그대로 연결만 한다 (마이그레이션은 별도 처리 예정).
 */
function initDb() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'assistant.db');
  const isNew = !fs.existsSync(dbPath);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 2000');

  if (isNew) {
    const schemaPath = path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('[itda] 새 데이터베이스 생성:', dbPath);
  } else {
    console.log('[itda] 기존 데이터베이스 연결:', dbPath);
    runLightweightMigrations(db);
  }

  return db;
}

/**
 * 정식 마이그레이션 시스템이 생기기 전까지 쓰는 경량 대응책.
 * PRAGMA table_info로 컬럼 존재 여부를 확인한 뒤, 없으면 ALTER TABLE로 추가한다.
 * (SQLite는 컬럼 존재 여부를 사전에 확인해야 안전 — "ADD COLUMN IF NOT EXISTS" 문법이
 *  버전에 따라 다르게 지원되므로 여기서는 직접 체크하는 방식을 쓴다.)
 */
function runLightweightMigrations(db) {
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  if (!hasColumn('todos', 'status')) {
    db.exec(`ALTER TABLE todos ADD COLUMN status TEXT NOT NULL DEFAULT 'todo'`);
    db.exec(`UPDATE todos SET status = CASE WHEN is_done = 1 THEN 'done' ELSE 'todo' END`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status, deleted_at)`);
    console.log('[itda] 마이그레이션: todos.status 컬럼 추가');
  }
  if (!hasColumn('todos', 'is_favorite')) {
    db.exec(`ALTER TABLE todos ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`);
    console.log('[itda] 마이그레이션: todos.is_favorite 컬럼 추가');
  }
  if (!hasColumn('todos', 'recurrence_rule')) {
    // events는 스키마 v1부터 반복 컬럼이 있었지만 todos는 없었음 — 간단 반복(매일/매주/매월) 기능 추가하며 뒤늦게 추가
    db.exec(`ALTER TABLE todos ADD COLUMN recurrence_rule TEXT`);
    db.exec(`ALTER TABLE todos ADD COLUMN recurrence_parent_id INTEGER REFERENCES todos(id) ON DELETE CASCADE`);
    console.log('[itda] 마이그레이션: todos.recurrence_rule/recurrence_parent_id 컬럼 추가');
  }
  if (!hasColumn('categories', 'text_color')) {
    // 캘린더 일정 블록의 글자색. 기본은 검정(대부분의 파스텔 카테고리색 배경에서 더 잘 읽힘) —
    // 어두운 색 배경을 쓰는 카테고리는 사용자가 흰색으로 바꿀 수 있게.
    db.exec(`ALTER TABLE categories ADD COLUMN text_color TEXT NOT NULL DEFAULT '#000000'`);
    console.log('[itda] 마이그레이션: categories.text_color 컬럼 추가');
  }
  if (!hasColumn('postits', 'category_id')) {
    // 태그(카테고리)를 "정보 탐색" 축으로 쓰려면 4개 타입 모두 태깅 가능해야 하는데,
    // 포스트잇만 category_id가 없었다(원래 색상만 자유 팔레트로 개인화). 뒤늦게 추가.
    db.exec(`ALTER TABLE postits ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);
    console.log('[itda] 마이그레이션: postits.category_id 컬럼 추가');
  }
  {
    // 포스트잇 기본 크기를 220x160 → 288x288 → 295x295(실제 포스트잇 7.8cm 정사각형, 96dpi 기준)로
    // 두 차례 조정했는데, 스키마 기본값(DEFAULT)은 "새로 만드는 포스트잇"에만 적용되고 이미
    // 만들어둔 포스트잇은 그때 저장된 값 그대로 남아있어서 "크기가 안 바뀐다"는 문제가 있었다.
    // 사용자가 직접 리사이즈해서 다른 값으로 바꿔놓은 포스트잇은 건드리지 않기 위해,
    // 정확히 예전 기본값(220x160 또는 288x288)과 "완전히 똑같은" 것만 골라서 최신 기본값으로 올려준다.
    // 이 보정은 딱 한 번만 실행해야 한다 — 매번 실행되면 사용자가 나중에 우연히 같은 크기로
    // 되돌려도 계속 강제로 리사이즈해버리게 되므로, app_settings에 완료 여부를 표시해둔다.
    const MARK_KEY = 'migration_postit_default_size_v295_done';
    const already = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MARK_KEY);
    if (!already) {
      const legacyDefaults = [
        [220, 160],
        [288, 288],
      ];
      let migratedCount = 0;
      for (const [w, h] of legacyDefaults) {
        const info = db
          .prepare('UPDATE postits SET width = 295, height = 295 WHERE width = ? AND height = ?')
          .run(w, h);
        migratedCount += info.changes;
      }
      db.prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(MARK_KEY);
      if (migratedCount > 0) {
        console.log(`[itda] 마이그레이션: 포스트잇 ${migratedCount}개 기본 크기를 295x295로 갱신`);
      }
    }
  }

  const hasTable = (table) =>
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);

  if (!hasTable('todo_subtasks')) {
    db.exec(`
      CREATE TABLE todo_subtasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        todo_id     INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        is_done     INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX idx_todo_subtasks_todo ON todo_subtasks(todo_id);
    `);
    console.log('[itda] 마이그레이션: todo_subtasks 테이블 생성');
  }

  if (!hasTable('item_links')) {
    db.exec(`
      CREATE TABLE item_links (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        a_type      TEXT NOT NULL,
        a_id        INTEGER NOT NULL,
        b_type      TEXT NOT NULL,
        b_id        INTEGER NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        UNIQUE(a_type, a_id, b_type, b_id)
      );
      CREATE INDEX idx_item_links_a ON item_links(a_type, a_id);
      CREATE INDEX idx_item_links_b ON item_links(b_type, b_id);
    `);
    console.log('[itda] 마이그레이션: item_links 테이블 생성');
  }

  // 예전 버전엔 소프트삭제(deleted_at 설정)해도 검색 인덱스(search_index)에서 안 빠지는 버그가 있었음.
  // 트리거를 "deleted_at이 NULL일 때만 재등록"하도록 재정의하고, 이미 잘못 남아있던 잔재도 한 번 청소한다.
  // 트리거 재정의는 데이터에 영향이 없어 매번 실행해도 안전(idempotent)하므로 버전 체크 없이 항상 적용한다.
  const needsSearchTriggerFix = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_todos_au'`)
    .get()?.sql?.includes('WHERE new.deleted_at IS NULL') === false;
  if (needsSearchTriggerFix) {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_todos_au;
      CREATE TRIGGER trg_todos_au AFTER UPDATE ON todos BEGIN
        DELETE FROM search_index WHERE entity_type='todo' AND entity_id = old.id;
        INSERT INTO search_index(entity_type, entity_id, title, content)
        SELECT 'todo', new.id, new.title, coalesce(new.memo, '') WHERE new.deleted_at IS NULL;
      END;

      DROP TRIGGER IF EXISTS trg_events_au;
      CREATE TRIGGER trg_events_au AFTER UPDATE ON events BEGIN
        DELETE FROM search_index WHERE entity_type='event' AND entity_id = old.id;
        INSERT INTO search_index(entity_type, entity_id, title, content)
        SELECT 'event', new.id, new.title, coalesce(new.memo, '') WHERE new.deleted_at IS NULL;
      END;

      DROP TRIGGER IF EXISTS trg_memos_au;
      CREATE TRIGGER trg_memos_au AFTER UPDATE ON memos BEGIN
        DELETE FROM search_index WHERE entity_type='memo' AND entity_id = old.id;
        INSERT INTO search_index(entity_type, entity_id, title, content)
        SELECT 'memo', new.id, coalesce(new.title, ''), new.content WHERE new.deleted_at IS NULL;
      END;

      DROP TRIGGER IF EXISTS trg_postits_au;
      CREATE TRIGGER trg_postits_au AFTER UPDATE ON postits BEGIN
        DELETE FROM search_index WHERE entity_type='postit' AND entity_id = old.id;
        INSERT INTO search_index(entity_type, entity_id, title, content)
        SELECT 'postit', new.id, coalesce(new.title, ''), new.content WHERE new.deleted_at IS NULL;
      END;
    `);
    // 이미 소프트삭제된 채로 검색 인덱스에 남아있던 잔재 청소 (1회성이지만 조건상 매번 돌아도 무해)
    db.exec(`
      DELETE FROM search_index WHERE entity_type='todo' AND entity_id IN (SELECT id FROM todos WHERE deleted_at IS NOT NULL);
      DELETE FROM search_index WHERE entity_type='event' AND entity_id IN (SELECT id FROM events WHERE deleted_at IS NOT NULL);
      DELETE FROM search_index WHERE entity_type='memo' AND entity_id IN (SELECT id FROM memos WHERE deleted_at IS NOT NULL);
      DELETE FROM search_index WHERE entity_type='postit' AND entity_id IN (SELECT id FROM postits WHERE deleted_at IS NOT NULL);
    `);
    console.log('[itda] 마이그레이션: 검색 트리거 수정(소프트삭제 항목 검색 노출 버그) + 기존 잔재 정리');
  }

  // google_calendar_events는 스키마 v1부터 있었지만, 아주 초기 버전 DB까지 방어적으로 대비
  if (!hasTable('google_calendar_events')) {
    db.exec(`
      CREATE TABLE google_calendar_events (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        google_event_id   TEXT NOT NULL UNIQUE,
        google_calendar_id TEXT NOT NULL,
        title             TEXT,
        location          TEXT,
        start_at          TEXT,
        end_at            TEXT,
        all_day           INTEGER NOT NULL DEFAULT 0,
        raw_json          TEXT,
        last_synced_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX idx_gcal_range ON google_calendar_events(start_at, end_at);
    `);
    console.log('[itda] 마이그레이션: google_calendar_events 테이블 생성(방어적 안전장치)');
  }

  // 메모 파일/사진 첨부. 실제 파일은 DB가 아니라 userData/attachments 폴더에 저장하고
  // (stored_name = 그 폴더 안의 실제 파일명, 충돌 방지용으로 UUID 사용), 여기엔 메타데이터만 둔다.
  if (!hasTable('memo_attachments')) {
    db.exec(`
      CREATE TABLE memo_attachments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memo_id     INTEGER NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
        file_name   TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        mime_type   TEXT,
        size        INTEGER,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX idx_memo_attachments_memo ON memo_attachments(memo_id);
    `);
    console.log('[itda] 마이그레이션: memo_attachments 테이블 생성');
  }

  // 메모 폴더(애플 메모장 스타일 분류) — 카테고리 태그와는 별개 축.
  if (!hasTable('memo_folders')) {
    db.exec(`
      CREATE TABLE memo_folders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
    `);
    console.log('[itda] 마이그레이션: memo_folders 테이블 생성');
  }
  if (!hasColumn('memos', 'folder_id')) {
    db.exec(`ALTER TABLE memos ADD COLUMN folder_id INTEGER REFERENCES memo_folders(id) ON DELETE SET NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_memos_folder ON memos(folder_id) WHERE deleted_at IS NULL`);
    console.log('[itda] 마이그레이션: memos.folder_id 컬럼 추가');
  }
}

module.exports = { initDb, runLightweightMigrations };
