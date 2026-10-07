const { app, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { backupsDir, backupBeforeRestore, listBackups, isBackupName } = require('../auto-backup');
const { SCHEMA_VERSION } = require('../db');
const { openLogsFolder } = require('../logger');

const DATA_TABLES = ['categories', 'todos', 'todo_subtasks', 'todo_tags', 'events', 'memos', 'postits', 'inbox_items', 'item_links', 'holidays'];

// data:mergeFromBackup 전용 — 백업 .db 파일을 읽기전용으로 열어 exportJson과 같은 모양의
// { categories, todos, ... } 객체로 덤프한다. importAllTables가 그대로 받아 병합할 수 있게.
function readAllTablesFromDbFile(filePath) {
  const backupDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const data = {};
    for (const t of DATA_TABLES) {
      // 오래된 백업엔 없는 테이블(예: holidays)이 있을 수 있어 건너뛴다
      const exists = backupDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      data[t] = exists ? backupDb.prepare(`SELECT * FROM ${t}`).all() : [];
    }
    return data;
  } finally {
    backupDb.close();
  }
}

// 복원할 파일이 정말 쓸 수 있는 잇다 백업인지 미리 본다 — 아무 파일이나 덮어써서 앱이 안 열리는 일을 막는다.
// 돌려주는 값: { ok:true, counts } 또는 { ok:false, error }
function inspectBackupFile(filePath) {
  let bk;
  try {
    bk = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (e) {
    return { ok: false, error: '백업 파일을 열 수 없어요. 잇다의 백업(.db) 파일이 맞는지 확인해주세요.' };
  }
  try {
    if (bk.pragma('quick_check', { simple: true }) !== 'ok') return { ok: false, error: '백업 파일이 손상된 것 같아요.' };
    const has = (t) => !!bk.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!['todos', 'events', 'memos', 'categories'].every(has)) return { ok: false, error: '잇다의 백업 파일이 아니에요.' };
    if (bk.pragma('user_version', { simple: true }) > SCHEMA_VERSION) return { ok: false, error: '더 새로운 버전의 잇다에서 만든 백업이에요. 잇다를 먼저 업데이트해주세요.' };
    const n = (t) => bk.prepare(`SELECT COUNT(*) n FROM ${t} WHERE deleted_at IS NULL`).get().n;
    return { ok: true, counts: { todos: n('todos'), events: n('events'), memos: n('memos') } };
  } catch (e) {
    return { ok: false, error: '백업 파일을 읽지 못했어요.' };
  } finally {
    bk.close();
  }
}

// exportJson이 만든 데이터를 실제로 DB에 밀어넣는 로직. IPC 핸들러 밖에 둬서
// db.transaction으로 통째로 감쌀 수 있게(하나라도 실패하면 전부 롤백) 분리했다.
//
// 중복 제외: 이미 같은 항목이 있으면(휴지통에 있는 건 제외하고 비교) 새로 만들지 않고 skipped에만 센다.
//   Todo 제목+마감일+마감시각 / 일정 제목+시작+끝+종일 / 메모 제목+내용 / 포스트잇 제목+내용 / Inbox 내용
// 건너뛴 항목의 하위 할 일·태그는 가져오지 않고(이미 있는 쪽을 그대로 둠), 연결(item_links)은 기존 항목에 이어붙인다.
// 가져올 파일 안에서 이미 휴지통에 있던 항목은 되살리지 않고 같이 건너뛴다.
function importAllTables(db, data) {
  const counts = { categories: 0, todos: 0, todo_subtasks: 0, todo_tags: 0, events: 0, memos: 0, postits: 0, inbox_items: 0, item_links: 0, holidays: 0 };
  const skipped = { todos: 0, events: 0, memos: 0, postits: 0, inbox_items: 0, trashed: 0 };
  const findTodo = db.prepare("SELECT id FROM todos WHERE deleted_at IS NULL AND title = ? AND COALESCE(due_date, '') = ? AND COALESCE(due_time, '') = ?");
  const findEvent = db.prepare('SELECT id FROM events WHERE deleted_at IS NULL AND title = ? AND start_at = ? AND end_at = ? AND all_day = ?');
  const findMemo = db.prepare("SELECT id FROM memos WHERE deleted_at IS NULL AND COALESCE(title, '') = ? AND content = ?");
  const findPostit = db.prepare("SELECT id FROM postits WHERE deleted_at IS NULL AND COALESCE(title, '') = ? AND content = ?");
  const findInbox = db.prepare('SELECT id FROM inbox_items WHERE content = ?');

  const run = db.transaction(() => {
    // ---------- 카테고리: 이름이 같으면 재사용, 없으면 새로 생성 ----------
    const categoryIdMap = new Map(); // 예전 id -> 새 id
    (data.categories || []).forEach((c) => {
      const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name);
      if (existing) {
        categoryIdMap.set(c.id, existing.id);
        return;
      }
      const info = db
        .prepare('INSERT INTO categories (name, color_hex, is_system, sort_order) VALUES (?, ?, 0, ?)')
        .run(c.name, c.color_hex || '#6B7280', c.sort_order ?? 99);
      categoryIdMap.set(c.id, info.lastInsertRowid);
      counts.categories += 1;
    });
    const mapCategory = (oldId) => (oldId == null ? null : categoryIdMap.get(oldId) ?? null);

    // ---------- Todo ----------
    const todoIdMap = new Map();
    const skippedTodoIds = new Set(); // 이미 있어서 건너뛴 Todo — 하위 할 일·태그도 안 가져온다
    (data.todos || []).forEach((t) => {
      if (t.deleted_at) return void skipped.trashed++;
      const dup = findTodo.get(t.title, t.due_date ?? '', t.due_time ?? '');
      if (dup) {
        todoIdMap.set(t.id, dup.id);
        skippedTodoIds.add(t.id);
        skipped.todos += 1;
        return;
      }
      const info = db
        .prepare(
          `INSERT INTO todos (title, memo, category_id, priority, due_date, due_time, is_done, status, is_favorite, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          t.title,
          t.memo ?? null,
          mapCategory(t.category_id),
          t.priority ?? 2,
          t.due_date ?? null,
          t.due_time ?? null,
          t.is_done ? 1 : 0,
          t.status || 'todo',
          t.is_favorite ? 1 : 0,
          t.completed_at ?? null
        );
      todoIdMap.set(t.id, info.lastInsertRowid);
      counts.todos += 1;
    });

    (data.todo_subtasks || []).forEach((s) => {
      if (skippedTodoIds.has(s.todo_id)) return;
      const newTodoId = todoIdMap.get(s.todo_id);
      if (!newTodoId) return; // 부모 todo가 없으면(가져오기 대상에 없었으면) 건너뜀
      db.prepare('INSERT INTO todo_subtasks (todo_id, title, is_done, sort_order) VALUES (?, ?, ?, ?)').run(
        newTodoId,
        s.title,
        s.is_done ? 1 : 0,
        s.sort_order ?? 0
      );
      counts.todo_subtasks += 1;
    });

    (data.todo_tags || []).forEach((tg) => {
      if (skippedTodoIds.has(tg.todo_id)) return;
      const newTodoId = todoIdMap.get(tg.todo_id);
      if (!newTodoId) return;
      db.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag) VALUES (?, ?)').run(newTodoId, tg.tag);
      counts.todo_tags += 1;
    });

    // ---------- 일정 ----------
    const eventIdMap = new Map();
    (data.events || []).forEach((e) => {
      if (e.deleted_at) return void skipped.trashed++;
      const dup = findEvent.get(e.title, e.start_at, e.end_at, e.all_day ? 1 : 0);
      if (dup) {
        eventIdMap.set(e.id, dup.id);
        skipped.events += 1;
        return;
      }
      const info = db
        .prepare(
          `INSERT INTO events (title, category_id, location, start_at, end_at, all_day, recurrence_rule, memo, color_hex, text_color)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          e.title,
          mapCategory(e.category_id),
          e.location ?? null,
          e.start_at,
          e.end_at,
          e.all_day ? 1 : 0,
          e.recurrence_rule ?? null,
          e.memo ?? null,
          e.color_hex ?? null,
          e.text_color ?? null
        );
      eventIdMap.set(e.id, info.lastInsertRowid);
      counts.events += 1;
    });

    // ---------- 메모 ----------
    const memoIdMap = new Map();
    (data.memos || []).forEach((m) => {
      if (m.deleted_at) return void skipped.trashed++;
      const dup = findMemo.get(m.title ?? '', m.content);
      if (dup) {
        memoIdMap.set(m.id, dup.id);
        skipped.memos += 1;
        return;
      }
      const info = db
        .prepare('INSERT INTO memos (title, content, category_id, color_hex, is_pinned) VALUES (?, ?, ?, ?, ?)')
        .run(m.title ?? null, m.content, mapCategory(m.category_id), m.color_hex || '#FBE28A', m.is_pinned ? 1 : 0);
      memoIdMap.set(m.id, info.lastInsertRowid);
      counts.memos += 1;
    });

    // ---------- 포스트잇 ----------
    const postitIdMap = new Map();
    (data.postits || []).forEach((p) => {
      if (p.deleted_at) return void skipped.trashed++;
      const dup = findPostit.get(p.title ?? '', p.content);
      if (dup) {
        postitIdMap.set(p.id, dup.id);
        skipped.postits += 1;
        return;
      }
      const info = db
        .prepare(
          `INSERT INTO postits (title, content, color_hex, pos_x, pos_y, width, height, opacity, is_always_on_top, is_pinned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(p.title ?? null, p.content, p.color_hex || '#FBE28A', null, null, p.width || 220, p.height || 160, p.opacity ?? 1.0, 0, p.is_pinned ? 1 : 0);
      postitIdMap.set(p.id, info.lastInsertRowid);
      counts.postits += 1;
    });

    // ---------- Inbox (연결관계 없음, 그대로 추가) ----------
    (data.inbox_items || []).forEach((i) => {
      if (findInbox.get(i.content)) return void (skipped.inbox_items += 1);
      db.prepare('INSERT INTO inbox_items (content, is_processed) VALUES (?, ?)').run(i.content, i.is_processed ? 1 : 0);
      counts.inbox_items += 1;
    });

    // ---------- 공휴일: 이미 있는 날짜는 그대로 두고 없는 날짜만 추가 ----------
    (data.holidays || []).forEach((h) => {
      counts.holidays += db
        .prepare('INSERT OR IGNORE INTO holidays (date, name, source) VALUES (?, ?, ?)')
        .run(h.date, h.name, h.source || 'manual').changes;
    });

    // ---------- 항목 간 연결: 양쪽 다 이번에 성공적으로 매핑된 경우만 복원 ----------
    const idMaps = { todo: todoIdMap, event: eventIdMap, memo: memoIdMap, postit: postitIdMap };
    (data.item_links || []).forEach((l) => {
      const newA = idMaps[l.a_type]?.get(l.a_id);
      const newB = idMaps[l.b_type]?.get(l.b_id);
      if (!newA || !newB) return;
      counts.item_links += db.prepare('INSERT OR IGNORE INTO item_links (a_type, a_id, b_type, b_id) VALUES (?, ?, ?, ?)').run(l.a_type, newA, l.b_type, newB).changes;
    });
  });

  run();
  return { counts, skipped };
}

// 백업/복원은 repository 계층(개별 도메인 SQL)이 아니라 DB 파일 자체를 다루는 작업이라
// 여기서만 예외적으로 db 인스턴스와 파일 경로를 직접 받는다.
module.exports = function registerDataIpc(ipcMain, repos, db) {
  const dbPath = path.join(app.getPath('userData'), 'assistant.db');

  function getWin() {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  }

  // 데이터 백업: 지금 상태 그대로 SQLite 파일 하나로 복사 (better-sqlite3의 온라인 백업 API 사용 —
  // 앱을 끄거나 잠글 필요 없이 안전하게 복사됨)
  ipcMain.handle('data:backup', async () => {
    const defaultName = `itda-backup-${new Date().toISOString().slice(0, 10)}.db`;
    const { canceled, filePath } = await dialog.showSaveDialog(getWin(), {
      title: '잇다 데이터 백업',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'SQLite 백업 파일', extensions: ['db'] }],
    });
    if (canceled || !filePath) return { cancelled: true };
    await db.backup(filePath);
    return { cancelled: false, filePath };
  });

  // 자동 백업이 저장되는 폴더 경로 조회/열기 (설정 화면의 "저장 위치" 표시용)
  ipcMain.handle('data:getBackupsDir', () => backupsDir(repos.settings));
  ipcMain.handle('data:openBackupsFolder', () => {
    shell.openPath(backupsDir(repos.settings));
    return { opened: true };
  });

  // 오류 로그(userData/logs/error.log) 폴더 열기 — 문제 발생 시 원인 파악용
  ipcMain.handle('data:openLogsFolder', () => {
    openLogsFolder();
    return { opened: true };
  });

  // 자동 백업 저장 폴더 변경 / 기본값으로 되돌리기
  ipcMain.handle('data:chooseBackupsDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
      title: '자동 백업을 저장할 폴더 선택',
      defaultPath: backupsDir(repos.settings),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { cancelled: true };
    repos.settings.set('backup_auto_dir', filePaths[0]);
    return { cancelled: false, dir: backupsDir(repos.settings) };
  });
  ipcMain.handle('data:resetBackupsDir', () => {
    repos.settings.set('backup_auto_dir', '');
    return { dir: backupsDir(repos.settings) };
  });

  // 데이터 복원: 선택한 백업 파일로 현재 DB를 완전히 덮어쓴다.
  // 실행 중인 커넥션을 안전하게 바꿔치기하기 어려우므로(다른 모듈들이 이미 이 db 인스턴스로
  // prepared statement를 만들어둔 상태), 파일 교체 후 앱을 재시작해서 깨끗하게 다시 연다.
  // 순서: 파일 검사 → 확인 → 지금 상태를 사본으로 남김(itda-prerestore-*) → 덮어쓰기 → 재시작.
  async function restoreFrom(filePath, label) {
    const win = getWin();
    const info = inspectBackupFile(filePath);
    if (!info.ok) throw new Error(info.error);
    const c = info.counts;
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['취소', '복원하고 재시작'],
      defaultId: 0,
      cancelId: 0,
      title: '데이터 복원',
      message: `현재 잇다의 모든 데이터를 이 백업(${label})으로 덮어씁니다.`,
      detail: `백업 안: 할 일 ${c.todos}건 · 일정 ${c.events}건 · 메모 ${c.memos}건\n\n복원 직전의 현재 상태는 백업 폴더에 "복원 직전" 사본으로 남겨 두니, 마음에 안 들면 그 사본으로 다시 되돌릴 수 있어요. 복원이 끝나면 앱이 자동으로 재시작됩니다.`,
    });
    if (confirm.response !== 1) return { cancelled: true };

    try {
      backupBeforeRestore(db, backupsDir(repos.settings));
    } catch (e) {
      throw new Error('복원 전에 현재 상태를 저장하지 못해서 복원을 멈췄어요: ' + e.message);
    }
    db.close();
    // WAL 모드 보조 파일이 남아있으면 복원한 DB와 내용이 안 맞을 수 있어 같이 정리한다
    [dbPath + '-wal', dbPath + '-shm'].forEach((p) => {
      try {
        fs.unlinkSync(p);
      } catch (e) {
        /* 없으면 무시 */
      }
    });
    fs.copyFileSync(filePath, dbPath);

    app.relaunch();
    app.exit(0);
    return { cancelled: false };
  }

  ipcMain.handle('data:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
      title: '복원할 백업 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 백업 파일', extensions: ['db'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { cancelled: true };
    return restoreFrom(filePaths[0], path.basename(filePaths[0]));
  });

  // 설정의 "백업 목록"에서 고른 항목으로 복원 — 이름만 받아서 백업 폴더 안의 파일로 한정한다(경로 조작 방지)
  ipcMain.handle('data:listBackups', () => listBackups(backupsDir(repos.settings)));
  ipcMain.handle('data:restoreFromBackup', async (event, name) => {
    if (!isBackupName(name)) throw new Error('백업 파일 이름이 올바르지 않아요.');
    const file = path.join(backupsDir(repos.settings), name);
    if (!fs.existsSync(file)) throw new Error('백업 파일을 찾을 수 없어요. 목록을 새로고침해주세요.');
    return restoreFrom(file, name);
  });

  // 데이터 병합: 복원(덮어쓰기)과 달리 현재 데이터는 그대로 두고, 백업 .db 파일 내용을
  // "추가로" 불러온다. importAllTables가 이미 JSON 가져오기에서 하는 일(이름 같은 카테고리는
  // 재사용, 나머진 새 id로 삽입)을 그대로 재사용 — 백업 파일을 읽어서 같은 모양으로만 만들어주면 됨.
  ipcMain.handle('data:mergeFromBackup', async () => {
    const win = getWin();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '병합할 백업 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 백업 파일', extensions: ['db'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { cancelled: true };

    let data;
    try {
      data = readAllTablesFromDbFile(filePaths[0]);
    } catch (e) {
      throw new Error('백업 파일을 읽을 수 없어요. 잇다의 백업(.db) 파일이 맞는지 확인해주세요.');
    }

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['취소', '병합하기'],
      defaultId: 0,
      cancelId: 0,
      title: '데이터 병합',
      message: '선택한 백업 파일의 데이터를 지금 잇다에 추가로 불러옵니다.',
      detail: '기존 데이터는 지워지지 않아요. 백업 안의 항목 중 이미 있는 것(Todo·일정·메모·포스트잇·Inbox가 제목·날짜·내용까지 같은 경우)은 건너뛰고 나머지만 추가해요. 같은 이름 카테고리는 재사용해요. 되돌리려면 미리 백업을 만들어두는 걸 권장해요.',
    });
    if (confirm.response !== 1) return { cancelled: true };

    const { counts, skipped } = importAllTables(db, data);
    return { cancelled: false, counts, skipped };
  });

  // JSON으로 내보내기: 다른 기기로 옮기거나 눈으로 확인하기 좋은 형태로 전체 데이터를 덤프.
  // (가져오기 기능은 별도 요청 시 추가 — 지금은 내보내기만)
  ipcMain.handle('data:exportJson', async () => {
    const defaultName = `itda-export-${new Date().toISOString().slice(0, 10)}.json`;
    const { canceled, filePath } = await dialog.showSaveDialog(getWin(), {
      title: 'JSON으로 내보내기',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { cancelled: true };

    const data = { exportedAt: new Date().toISOString(), appVersion: app.getVersion() };
    for (const t of DATA_TABLES) {
      data[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { cancelled: false, filePath };
  });

  // JSON 가져오기: exportJson으로 내보낸 파일을 다시 불러온다.
  // 기존 id를 그대로 쓰면 지금 DB에 이미 있는 항목과 충돌할 수 있어서,
  // 전부 "새 항목"으로 INSERT하고 예전 id -> 새 id 매핑표를 만들어서
  // 하위할일(todo_subtasks)/연결(item_links) 같은 내부 참조를 새 id로 다시 이어붙인다.
  // 카테고리만 예외로, 이름이 같으면 기존 카테고리를 재사용(기본 카테고리 중복 생성 방지).
  ipcMain.handle('data:importJson', async () => {
    const win = getWin();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '가져올 JSON 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { cancelled: true };

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch (e) {
      throw new Error('JSON 파일을 읽을 수 없어요. 잇다에서 내보낸 파일이 맞는지 확인해주세요.');
    }
    const requiredKeys = ['todos', 'events', 'memos', 'postits'];
    if (!requiredKeys.every((k) => Array.isArray(data[k]))) {
      throw new Error('잇다의 내보내기 파일 형식이 아니에요.');
    }

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['취소', '가져오기'],
      defaultId: 0,
      cancelId: 0,
      title: '데이터 가져오기',
      message: '선택한 파일의 데이터를 지금 잇다에 추가로 불러옵니다.',
      detail: '기존 데이터는 지워지지 않아요. 이미 있는 항목(제목·날짜·내용까지 같은 경우)은 건너뛰고 나머지만 새로 추가해요. 되돌리려면 미리 백업을 만들어두는 걸 권장해요.',
    });
    if (confirm.response !== 1) return { cancelled: true };

    const { counts, skipped } = importAllTables(db, data);
    return { cancelled: false, counts, skipped };
  });

  // 전체 삭제: Todo/일정/메모/포스트잇/Inbox/연결/휴지통 내용과 사용자가 추가한 카테고리를 지운다.
  // 앱 설정(테마, Google Calendar 연결 등)은 "데이터"라기보다 "앱 환경설정"이라 건드리지 않는다 —
  // 확인 대화상자에 정확히 뭐가 지워지는지 명시해서 오해를 막는다.
  ipcMain.handle('data:deleteAll', async () => {
    const win = getWin();
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['취소', '전부 삭제'],
      defaultId: 0,
      cancelId: 1,
      title: '모든 데이터 삭제',
      message: 'Todo, 일정, 메모, 포스트잇, Inbox, 연결, 휴지통 내용을 전부 영구 삭제합니다.',
      detail: '되돌릴 수 없습니다. 진행 전에 백업을 권장해요. (테마·Google Calendar 연결 같은 앱 설정은 유지됩니다)',
    });
    if (confirm.response !== 1) return { cancelled: true };

    const tx = db.transaction(() => {
      ['item_links', 'todo_subtasks', 'todo_tags', 'todos', 'events', 'memos', 'postits', 'inbox_items', 'google_calendar_events', 'messenger_items', 'messenger_links', 'messenger_log'].forEach(
        (t) => db.prepare(`DELETE FROM ${t}`).run()
      );
      db.prepare(`DELETE FROM categories WHERE is_system = 0`).run();
    });
    tx();
    return { cancelled: false };
  });
};
module.exports.importAllTables = importAllTables; // 테스트용
module.exports.inspectBackupFile = inspectBackupFile; // 테스트용
