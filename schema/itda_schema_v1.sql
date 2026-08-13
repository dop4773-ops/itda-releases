-- ============================================================
-- 잇다 (Itda) MVP v1 — SQLite 스키마
-- 원칙: AI 미사용 / 로컬 우선 / 구글 캘린더 읽기전용(단방향) /
--       카테고리 색상(고정)과 포스트잇 색상(자유)은 완전히 분리
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ------------------------------------------------------------
-- 1. categories : Todo/일정 전용 고정 카테고리 팔레트
--    포스트잇 색상과는 절대 공유하지 않는다 (개인화 팔레트는 postits.color)
-- ------------------------------------------------------------
CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,        -- 예: '회의·업무', '상담', '교육', '외래'
  color_hex   TEXT NOT NULL,               -- 예: '#3C6BEF'
  text_color  TEXT NOT NULL DEFAULT '#000000', -- 캘린더 블록 글자색 — 기본 검정, 어두운 배경엔 흰색 선택 가능
  is_system   INTEGER NOT NULL DEFAULT 0,  -- 1=기본 제공(삭제 불가), 0=사용자 추가
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 시스템 기본 4개 카테고리 (UI 파스텔 팔레트와 일치)
INSERT INTO categories (name, color_hex, is_system, sort_order) VALUES
  ('회의·업무', '#6C8CF5', 1, 1),
  ('상담',      '#4FB897', 1, 2),
  ('교육',      '#E8A34D', 1, 3),
  ('외래',      '#A78BE0', 1, 4);


-- ------------------------------------------------------------
-- 2. inbox_items : "빠른 입력". 자동 분류 없음. 단순 저장.
-- ------------------------------------------------------------
CREATE TABLE inbox_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content         TEXT NOT NULL,
  is_processed    INTEGER NOT NULL DEFAULT 0,   -- 사용자가 todo/일정/메모로 정리했는지
  processed_type  TEXT,                          -- 'todo' | 'event' | 'memo' | NULL
  processed_ref_id INTEGER,                      -- 위 타입 테이블의 id
  created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  processed_at    TEXT
);

CREATE INDEX idx_inbox_unprocessed ON inbox_items(is_processed, created_at);


-- ------------------------------------------------------------
-- 3. todos
-- ------------------------------------------------------------
CREATE TABLE todos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  memo             TEXT,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  priority         INTEGER NOT NULL DEFAULT 2,   -- 1=높음 2=보통 3=낮음
  due_date         TEXT,                          -- 'YYYY-MM-DD'
  due_time         TEXT,                          -- 'HH:MM', nullable
  is_done          INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'todo',  -- 칸반 상태: 'todo'|'doing'|'done' (is_done과 함께 동기화됨)
  is_favorite      INTEGER NOT NULL DEFAULT 0,    -- 중요 표시(별표)
  completed_at     TEXT,
  source_inbox_id  INTEGER REFERENCES inbox_items(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  deleted_at       TEXT                            -- NULL이 아니면 휴지통
);

CREATE INDEX idx_todos_due ON todos(due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_todos_active ON todos(is_done, deleted_at);
CREATE INDEX idx_todos_status ON todos(status, deleted_at);

CREATE TABLE todo_tags (
  todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (todo_id, tag)
);

-- 할 일 상세 패널의 "하위 할 일" 체크리스트. 부모 todo가 완전 삭제(휴지통 비우기)될 때만 함께 삭제된다.
CREATE TABLE todo_subtasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id     INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  is_done     INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_todo_subtasks_todo ON todo_subtasks(todo_id);


-- ------------------------------------------------------------
-- 3-1. item_links : 일정/Todo/메모/포스트잇 "항목 간 연결" (Notion Relation의 단순화 버전)
--    데이터를 복사하지 않고, 두 항목을 가리키는 참조 행 하나만 만든다.
--    양방향이므로 (a,b)와 (b,a)가 중복 저장되지 않도록 항상 정해진 순서로 정규화해서 저장한다
--    (정규화 규칙은 main/ipc/links.ipc.js의 canonicalizeLink 참고).
-- ------------------------------------------------------------
CREATE TABLE item_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  a_type      TEXT NOT NULL,   -- 'todo' | 'event' | 'memo' | 'postit'
  a_id        INTEGER NOT NULL,
  b_type      TEXT NOT NULL,
  b_id        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(a_type, a_id, b_type, b_id)
);

CREATE INDEX idx_item_links_a ON item_links(a_type, a_id);
CREATE INDEX idx_item_links_b ON item_links(b_type, b_id);


-- ------------------------------------------------------------
-- 4. events : 잇다에서 직접 만드는 개인 일정만 존재.
--    구글 캘린더 데이터는 절대 이 테이블에 섞이지 않는다 (섹션 5 참고)
-- ------------------------------------------------------------
CREATE TABLE events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  title                 TEXT NOT NULL,
  category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  location              TEXT,
  start_at              TEXT NOT NULL,   -- ISO datetime 'YYYY-MM-DD HH:MM'
  end_at                TEXT NOT NULL,
  all_day               INTEGER NOT NULL DEFAULT 0,
  recurrence_rule       TEXT,            -- RRULE 문자열, 반복 없으면 NULL
  recurrence_parent_id  INTEGER REFERENCES events(id) ON DELETE CASCADE,
  memo                  TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  deleted_at            TEXT
);

CREATE INDEX idx_events_range ON events(start_at, end_at) WHERE deleted_at IS NULL;


-- ------------------------------------------------------------
-- 5. google_calendar_events : 구글 캘린더 읽기전용 캐시
--    - 오직 동기화 프로세스만 INSERT/UPDATE/DELETE 한다.
--    - 앱 UI(잇다)에서는 SELECT만 허용 — 이 원칙을 스키마로 강제하기 위해
--      events 테이블과 물리적으로 완전히 분리했다.
--    - 잇다 → 구글 반영은 설계상 애초에 불가능 (쓰기 경로 자체가 없음)
-- ------------------------------------------------------------
CREATE TABLE google_calendar_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  google_event_id   TEXT NOT NULL UNIQUE,
  google_calendar_id TEXT NOT NULL,   -- 복수 구글 계정/캘린더 대비 (현재는 1개만 사용)
  title             TEXT,
  location          TEXT,
  start_at          TEXT,
  end_at            TEXT,
  all_day           INTEGER NOT NULL DEFAULT 0,
  raw_json          TEXT,             -- 원본 보존 (디버깅/재동기화용)
  last_synced_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_gcal_range ON google_calendar_events(start_at, end_at);


-- ------------------------------------------------------------
-- 6. memos
--    color_hex: 포스트잇과 동일한 개인화 팔레트를 공유 (스티커노트 감성)
--    categories(고정 팔레트)와는 무관 — postits.color_hex와 같은 성격의 자유 색상
-- ------------------------------------------------------------
CREATE TABLE memos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT,
  content      TEXT NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,  -- 선택적 태깅
  color_hex    TEXT NOT NULL DEFAULT '#FBE28A',
  is_pinned    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  deleted_at   TEXT
);

CREATE INDEX idx_memos_active ON memos(updated_at) WHERE deleted_at IS NULL;

-- 메모 파일/사진 첨부 — 실제 파일은 DB가 아니라 userData/attachments 폴더에 저장하고
-- (stored_name = 그 폴더 안의 실제 파일명, 충돌 방지용 UUID), 여기엔 메타데이터만 둔다.
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


-- ------------------------------------------------------------
-- 7. postits : 개인화 색상 팔레트 사용 (categories와 무관, 자유 hex)
-- ------------------------------------------------------------
CREATE TABLE postits (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT,
  content            TEXT NOT NULL,
  category_id        INTEGER REFERENCES categories(id) ON DELETE SET NULL,  -- 선택적 태깅(문서 7번 — 카테고리를 정보탐색용 "태그"로 확장)
  color_hex          TEXT NOT NULL DEFAULT '#FBE28A',  -- 개인화 팔레트, 자유 값
  pos_x              INTEGER,
  pos_y              INTEGER,
  width              INTEGER NOT NULL DEFAULT 295,
  height             INTEGER NOT NULL DEFAULT 295,
  opacity            REAL NOT NULL DEFAULT 1.0,
  is_always_on_top   INTEGER NOT NULL DEFAULT 0,   -- 화면에 항상 띄우기
  is_pinned          INTEGER NOT NULL DEFAULT 0,   -- 대시보드 상단 고정
  created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  deleted_at         TEXT
);

CREATE INDEX idx_postits_active ON postits(is_always_on_top) WHERE deleted_at IS NULL;


-- ------------------------------------------------------------
-- 8. 통합검색 : FTS5 가상 테이블 (todos/events/memos/postits/inbox 전체)
-- ------------------------------------------------------------
CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type,   -- 'todo' | 'event' | 'memo' | 'postit' | 'inbox'
  entity_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61'
);

-- 각 테이블 변경 시 search_index를 동기화하는 트리거
CREATE TRIGGER trg_todos_ai AFTER INSERT ON todos BEGIN
  INSERT INTO search_index(entity_type, entity_id, title, content)
  VALUES ('todo', new.id, new.title, coalesce(new.memo, ''));
END;
-- 소프트삭제(deleted_at 설정)되면 검색 인덱스에서도 함께 빠지도록,
-- new.deleted_at이 NULL일 때만 다시 넣는다(복원 시엔 다시 NULL이 되므로 자동으로 재등록됨).
CREATE TRIGGER trg_todos_au AFTER UPDATE ON todos BEGIN
  DELETE FROM search_index WHERE entity_type='todo' AND entity_id = old.id;
  INSERT INTO search_index(entity_type, entity_id, title, content)
  SELECT 'todo', new.id, new.title, coalesce(new.memo, '') WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER trg_todos_ad AFTER DELETE ON todos BEGIN
  DELETE FROM search_index WHERE entity_type='todo' AND entity_id = old.id;
END;

CREATE TRIGGER trg_events_ai AFTER INSERT ON events BEGIN
  INSERT INTO search_index(entity_type, entity_id, title, content)
  VALUES ('event', new.id, new.title, coalesce(new.memo, ''));
END;
CREATE TRIGGER trg_events_au AFTER UPDATE ON events BEGIN
  DELETE FROM search_index WHERE entity_type='event' AND entity_id = old.id;
  INSERT INTO search_index(entity_type, entity_id, title, content)
  SELECT 'event', new.id, new.title, coalesce(new.memo, '') WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER trg_events_ad AFTER DELETE ON events BEGIN
  DELETE FROM search_index WHERE entity_type='event' AND entity_id = old.id;
END;

CREATE TRIGGER trg_memos_ai AFTER INSERT ON memos BEGIN
  INSERT INTO search_index(entity_type, entity_id, title, content)
  VALUES ('memo', new.id, coalesce(new.title, ''), new.content);
END;
CREATE TRIGGER trg_memos_au AFTER UPDATE ON memos BEGIN
  DELETE FROM search_index WHERE entity_type='memo' AND entity_id = old.id;
  INSERT INTO search_index(entity_type, entity_id, title, content)
  SELECT 'memo', new.id, coalesce(new.title, ''), new.content WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER trg_memos_ad AFTER DELETE ON memos BEGIN
  DELETE FROM search_index WHERE entity_type='memo' AND entity_id = old.id;
END;

CREATE TRIGGER trg_postits_ai AFTER INSERT ON postits BEGIN
  INSERT INTO search_index(entity_type, entity_id, title, content)
  VALUES ('postit', new.id, coalesce(new.title, ''), new.content);
END;
CREATE TRIGGER trg_postits_au AFTER UPDATE ON postits BEGIN
  DELETE FROM search_index WHERE entity_type='postit' AND entity_id = old.id;
  INSERT INTO search_index(entity_type, entity_id, title, content)
  SELECT 'postit', new.id, coalesce(new.title, ''), new.content WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER trg_postits_ad AFTER DELETE ON postits BEGIN
  DELETE FROM search_index WHERE entity_type='postit' AND entity_id = old.id;
END;

CREATE TRIGGER trg_inbox_ai AFTER INSERT ON inbox_items BEGIN
  INSERT INTO search_index(entity_type, entity_id, title, content)
  VALUES ('inbox', new.id, '', new.content);
END;
CREATE TRIGGER trg_inbox_ad AFTER DELETE ON inbox_items BEGIN
  DELETE FROM search_index WHERE entity_type='inbox' AND entity_id = old.id;
END;


-- ------------------------------------------------------------
-- 9. updated_at 자동 갱신 트리거
-- ------------------------------------------------------------
CREATE TRIGGER trg_todos_updated_at AFTER UPDATE ON todos
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE todos SET updated_at = datetime('now', 'localtime') WHERE id = new.id;
END;

CREATE TRIGGER trg_events_updated_at AFTER UPDATE ON events
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE events SET updated_at = datetime('now', 'localtime') WHERE id = new.id;
END;

CREATE TRIGGER trg_memos_updated_at AFTER UPDATE ON memos
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE memos SET updated_at = datetime('now', 'localtime') WHERE id = new.id;
END;

CREATE TRIGGER trg_postits_updated_at AFTER UPDATE ON postits
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE postits SET updated_at = datetime('now', 'localtime') WHERE id = new.id;
END;


-- ------------------------------------------------------------
-- 10. app_settings : 사이드바 접힘 상태, 프레즌스 상태 등 로컬 UI 설정
--     (키-값 구조라 새 설정 추가 시 스키마 마이그레이션 불필요)
-- ------------------------------------------------------------
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO app_settings (key, value) VALUES
  ('sidebar_collapsed', '0'),
  ('presence_status', 'working'),   -- 'working' | 'away' | 'offline' 등
  ('mini_calendar_open', '0');


-- ------------------------------------------------------------
-- 휴지통(v1) 조회 예시 : deleted_at IS NOT NULL 인 항목
--   SELECT * FROM todos  WHERE deleted_at IS NOT NULL;
--   SELECT * FROM events WHERE deleted_at IS NOT NULL;
--   SELECT * FROM memos  WHERE deleted_at IS NOT NULL;
--   SELECT * FROM postits WHERE deleted_at IS NOT NULL;
-- 완전 삭제(하드 삭제) 전용 배치는 v1 범위 밖 — 필요 시 별도 정책으로 추가
-- ============================================================
