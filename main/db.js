const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');
const { chosung } = require('./shared/hangul');

// 경량 마이그레이션 "세대" 번호. schema/itda_schema_v1.sql은 항상 최신 상태로 관리되므로
// 새로 만든 DB는 곧바로 이 번호로 스탬프하고, 기존 DB는 runLightweightMigrations가
// 여기까지 끌어올린 뒤 user_version에 이 값을 기록한다. 이미 이 값 이상이면 점검 자체를 건너뛴다.
// ⚠ 아래 마이그레이션 단계를 새로 추가하면 이 번호를 +1 한다.
//   v2: item_links 고아 연결(상대 항목이 완전삭제됨) 1회성 청소
//   v3: search_index를 FTS5 → 일반 테이블로 재구축(한글 부분일치·초성검색 지원) + chosung 컬럼
//   v4: search_index에 updated_at 컬럼 (검색 랭킹의 "최신도" 가산용)
//   v5: inbox_items에 is_favorite 컬럼 (Inbox 별표)
const SCHEMA_VERSION = 5;

// SQLite에 초성 추출 함수를 등록 — search_index 트리거와 초성 검색 쿼리가 SQL 안에서 바로 쓴다.
// 커넥션마다 등록해야 하므로 initDb / 테스트 양쪽에서 이 함수를 부른다.
function registerSqlFunctions(db) {
  db.function('chosung', { deterministic: true }, (s) => chosung(s));
}

/**
 * 앱 최초 실행 시 userData 경로에 assistant.db를 생성하고
 * schema/itda_schema_v1.sql 을 적용한다.
 * 이미 DB가 있으면 연결 후 runLightweightMigrations로 스키마를 최신 세대까지 끌어올린다.
 */
function initDb() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'assistant.db');
  const isNew = !fs.existsSync(dbPath);

  const db = new Database(dbPath);
  registerSqlFunctions(db); // chosung() — 스키마/마이그레이션의 트리거가 쓰므로 exec 전에 등록
  // WAL + synchronous=NORMAL: WAL 모드에선 안전(전원 차단 시 마지막 트랜잭션만 유실, 손상 없음)
  //   하면서 기본값(FULL)보다 쓰기가 눈에 띄게 빠르다 — SQLite 공식 권장 조합.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // 자동 백업/체크포인트와 겹쳐도 잠깐 기다렸다 진행
  db.pragma('cache_size = -16000'); // 16MB 페이지 캐시(기본 ~2MB) — 목록/검색 반복 조회가 빨라짐
  db.pragma('temp_store = MEMORY'); // ORDER BY/임시 인덱스를 디스크 대신 메모리에
  db.pragma('mmap_size = 67108864'); // 64MB memory-map 읽기

  if (isNew) {
    const schemaPath = path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    rebuildSearchIndex(db); // search_index는 schema.sql이 아니라 여기서 만든다(초성 함수 의존)
    db.pragma(`user_version = ${SCHEMA_VERSION}`); // 최신 스키마로 만들었으니 마이그레이션 점검 불필요
    console.log('[itda] 새 데이터베이스 생성:', dbPath);
  } else {
    console.log('[itda] 기존 데이터베이스 연결:', dbPath);
    runLightweightMigrations(db);
  }

  // 쿼리 플래너 통계 갱신 — 연결할 때마다 가볍게(초기 실행 후엔 거의 즉시). 인덱스 선택이 좋아진다.
  try {
    db.pragma('optimize');
  } catch (e) {
    /* 통계 갱신 실패는 치명적이지 않음 */
  }

  return db;
}

// 앱 종료 직전 호출 — 통계 최종 갱신 + WAL 파일을 본체로 합쳐(TRUNCATE) 크기를 되돌린다.
function closeDb(db) {
  if (!db || !db.open) return;
  try {
    db.pragma('optimize');
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    /* 무시 — 어차피 닫는 중 */
  }
  db.close();
}

/**
 * 정식 마이그레이션 시스템이 생기기 전까지 쓰는 경량 대응책.
 * PRAGMA table_info로 컬럼 존재 여부를 확인한 뒤, 없으면 ALTER TABLE로 추가한다.
 * (SQLite는 컬럼 존재 여부를 사전에 확인해야 안전 — "ADD COLUMN IF NOT EXISTS" 문법이
 *  버전에 따라 다르게 지원되므로 여기서는 직접 체크하는 방식을 쓴다.)
 *
 * 안전장치 2가지:
 *   1) user_version 게이트 — 이미 최신 세대면 아래 점검을 통째로 건너뛴다(매 실행 반복 방지).
 *   2) 단일 트랜잭션 — 모든 단계 + user_version 기록을 한 트랜잭션에서 처리한다. 도중에
 *      전원이 나가거나 한 단계가 throw하면 통째로 롤백되어 "반쪽만 적용된 스키마"가 남지 않는다.
 *      (SQLite는 DDL도, PRAGMA user_version도 트랜잭션에 함께 커밋/롤백된다.)
 *   개별 단계는 여전히 전부 멱등(if !hasColumn / if !hasTable)이라, 어떤 중간 상태의 DB에서
 *   시작해도 안전하게 최신으로 수렴한다.
 */
function runLightweightMigrations(db) {
  if (db.pragma('user_version', { simple: true }) >= SCHEMA_VERSION) return;
  db.transaction(() => {
    applyLightweightMigrations(db);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    console.log(`[itda] 마이그레이션 점검 완료 — user_version=${SCHEMA_VERSION}`);
  })();
}

function applyLightweightMigrations(db) {
  const hasColumn = (table, column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  // v3: search_index(FTS5 → 일반 테이블 + chosung). 다른 단계보다 먼저 — 이후 단계가 원본 테이블을
  // 건드리면 동기화 트리거가 도는데, 새 트리거/테이블이 이미 자리잡아 있어야 한다.
  // FTS5 unicode61은 한글을 공백 없는 한 덩어리 토큰으로 잡아 "홍 길동"≠"홍길동", "길동" 단독 검색이
  // 안 되는 등 한국어 부분일치가 취약했다. 개인 규모 DB(수천 건)에선 title/content LIKE 스캔이 1ms
  // 안쪽이라, 정확한 부분일치 + 초성(chosung) 컬럼을 갖춘 일반 테이블이 낫다.
  const searchTblSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='search_index'`)
    .get()?.sql;
  if (
    !searchTblSql ||
    searchTblSql.includes('fts5') ||
    !hasColumn('search_index', 'chosung') ||
    !hasColumn('search_index', 'updated_at') // v4
  ) {
    rebuildSearchIndex(db);
    console.log('[itda] 마이그레이션: search_index 재구축(일반 테이블 + 초성 + updated_at)');
  }

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
  if (!hasColumn('inbox_items', 'is_favorite')) {
    // v5: Inbox 개편 — "먼저 처리할 항목" 별표. 기존 항목은 전부 0(별표 없음)으로 시작.
    db.exec(`ALTER TABLE inbox_items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`);
    console.log('[itda] 마이그레이션: inbox_items.is_favorite 컬럼 추가');
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

  // (예전 "검색 트리거 소프트삭제 누락" 수정 블록은 v3 rebuildSearchIndex가 대체 —
  //  항상 deleted_at IS NULL 조건의 올바른 트리거를 새로 만들고 원본에서 다시 채운다.)

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
  if (!hasColumn('memos', 'is_locked')) {
    db.exec(`ALTER TABLE memos ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0`);
    console.log('[itda] 마이그레이션: memos.is_locked 컬럼 추가');
  }

  // item_links 고아 연결 청소 — 상대 항목이 "완전삭제"돼서 실제 행이 사라진 연결.
  // 하드삭제 경로(trash purgeOne / inbox:delete)는 이제 deleteLinksFor로 같이 지우지만,
  // 그 처리가 없던 예전 버전에서 쌓인 잔재가 있을 수 있어 한 번 훑는다.
  // (소프트삭제=휴지통 항목은 행이 남아있으므로 대상 아님 — 복원하면 연결도 살아있어야 함)
  if (hasTable('item_links')) {
    const info = db.prepare(`
      DELETE FROM item_links WHERE
           (a_type='todo'   AND a_id NOT IN (SELECT id FROM todos))
        OR (b_type='todo'   AND b_id NOT IN (SELECT id FROM todos))
        OR (a_type='event'  AND a_id NOT IN (SELECT id FROM events))
        OR (b_type='event'  AND b_id NOT IN (SELECT id FROM events))
        OR (a_type='memo'   AND a_id NOT IN (SELECT id FROM memos))
        OR (b_type='memo'   AND b_id NOT IN (SELECT id FROM memos))
        OR (a_type='postit' AND a_id NOT IN (SELECT id FROM postits))
        OR (b_type='postit' AND b_id NOT IN (SELECT id FROM postits))
        OR (a_type='inbox'  AND a_id NOT IN (SELECT id FROM inbox_items))
        OR (b_type='inbox'  AND b_id NOT IN (SELECT id FROM inbox_items))
    `).run();
    if (info.changes > 0) console.log(`[itda] 마이그레이션: 고아 연결 ${info.changes}건 정리`);
  }
}

// search_index(일반 테이블) + 동기화 트리거를 만들고 원본 5개 테이블에서 다시 채운다.
// 신규 DB(schema.sql 적용 직후)와 v3 마이그레이션이 공유한다 — 단일 소스.
function rebuildSearchIndex(db) {
  // 타입별 트리거 생성기 — todo/event는 (title, coalesce(memo,'')), memo/postit은 (coalesce(title,''), content).
  const softTrigger = (t, tbl, titleE, contE) => `
    DROP TRIGGER IF EXISTS trg_${t}s_ai; DROP TRIGGER IF EXISTS trg_${t}s_au; DROP TRIGGER IF EXISTS trg_${t}s_ad;
    CREATE TRIGGER trg_${t}s_ai AFTER INSERT ON ${tbl} BEGIN
      INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT '${t}', new.id, ${titleE}, ${contE}, chosung(${titleE}), new.updated_at WHERE new.deleted_at IS NULL;
    END;
    CREATE TRIGGER trg_${t}s_au AFTER UPDATE ON ${tbl} BEGIN
      DELETE FROM search_index WHERE entity_type='${t}' AND entity_id = old.id;
      INSERT INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT '${t}', new.id, ${titleE}, ${contE}, chosung(${titleE}), new.updated_at WHERE new.deleted_at IS NULL;
    END;
    CREATE TRIGGER trg_${t}s_ad AFTER DELETE ON ${tbl} BEGIN
      DELETE FROM search_index WHERE entity_type='${t}' AND entity_id = old.id;
    END;`;
  const softTriggers = [
    softTrigger('todo', 'todos', 'new.title', "coalesce(new.memo,'')"),
    softTrigger('event', 'events', 'new.title', "coalesce(new.memo,'')"),
    softTrigger('memo', 'memos', "coalesce(new.title,'')", 'new.content'),
    softTrigger('postit', 'postits', "coalesce(new.title,'')", 'new.content'),
  ].join('\n');

  db.exec(`
    DROP TRIGGER IF EXISTS trg_inbox_ai;   DROP TRIGGER IF EXISTS trg_inbox_ad;
    DROP TABLE IF EXISTS search_index;

    CREATE TABLE search_index (
      entity_type TEXT NOT NULL,      -- 'todo' | 'event' | 'memo' | 'postit' | 'inbox'
      entity_id   INTEGER NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',   -- memo/postit은 저장된 HTML 그대로(조회 측에서 태그 제거)
      chosung     TEXT NOT NULL DEFAULT '',   -- title의 초성 (예: "홍길동" → "ㅎㄱㄷ")
      updated_at  TEXT NOT NULL DEFAULT '',   -- 원본의 updated_at(inbox는 created_at) — 검색 랭킹 "최신도"용
      PRIMARY KEY (entity_type, entity_id)
    ) WITHOUT ROWID;
    CREATE INDEX idx_search_type ON search_index(entity_type);

    ${softTriggers}

    -- inbox_items: deleted_at 없음(하드 삭제) → INSERT/DELETE만. updated_at이 없어 created_at을 쓴다.
    CREATE TRIGGER trg_inbox_ai AFTER INSERT ON inbox_items BEGIN
      INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      VALUES ('inbox', new.id, '', new.content, '', new.created_at);
    END;
    CREATE TRIGGER trg_inbox_ad AFTER DELETE ON inbox_items BEGIN
      DELETE FROM search_index WHERE entity_type='inbox' AND entity_id = old.id;
    END;
  `);

  db.exec(`
    INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT 'todo', id, title, coalesce(memo,''), chosung(title), updated_at FROM todos WHERE deleted_at IS NULL;
    INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT 'event', id, title, coalesce(memo,''), chosung(title), updated_at FROM events WHERE deleted_at IS NULL;
    INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT 'memo', id, coalesce(title,''), content, chosung(coalesce(title,'')), updated_at FROM memos WHERE deleted_at IS NULL;
    INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT 'postit', id, coalesce(title,''), content, chosung(coalesce(title,'')), updated_at FROM postits WHERE deleted_at IS NULL;
    INSERT OR REPLACE INTO search_index(entity_type,entity_id,title,content,chosung,updated_at)
      SELECT 'inbox', id, '', content, '', created_at FROM inbox_items;
  `);
}

module.exports = { initDb, runLightweightMigrations, closeDb, registerSqlFunctions, rebuildSearchIndex, SCHEMA_VERSION };
