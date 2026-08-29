const { app, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { backupsDir } = require('../auto-backup');

// exportJson이 만든 데이터를 실제로 DB에 밀어넣는 로직. IPC 핸들러 밖에 둬서
// db.transaction으로 통째로 감쌀 수 있게(하나라도 실패하면 전부 롤백) 분리했다.
function importAllTables(db, data) {
  const counts = { categories: 0, todos: 0, todo_subtasks: 0, todo_tags: 0, events: 0, memos: 0, postits: 0, inbox_items: 0, item_links: 0 };

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
    (data.todos || []).forEach((t) => {
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
      const newTodoId = todoIdMap.get(tg.todo_id);
      if (!newTodoId) return;
      db.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag) VALUES (?, ?)').run(newTodoId, tg.tag);
      counts.todo_tags += 1;
    });

    // ---------- 일정 ----------
    const eventIdMap = new Map();
    (data.events || []).forEach((e) => {
      const info = db
        .prepare(
          `INSERT INTO events (title, category_id, location, start_at, end_at, all_day, recurrence_rule, memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(e.title, mapCategory(e.category_id), e.location ?? null, e.start_at, e.end_at, e.all_day ? 1 : 0, e.recurrence_rule ?? null, e.memo ?? null);
      eventIdMap.set(e.id, info.lastInsertRowid);
      counts.events += 1;
    });

    // ---------- 메모 ----------
    const memoIdMap = new Map();
    (data.memos || []).forEach((m) => {
      const info = db
        .prepare('INSERT INTO memos (title, content, category_id, color_hex, is_pinned) VALUES (?, ?, ?, ?, ?)')
        .run(m.title ?? null, m.content, mapCategory(m.category_id), m.color_hex || '#FBE28A', m.is_pinned ? 1 : 0);
      memoIdMap.set(m.id, info.lastInsertRowid);
      counts.memos += 1;
    });

    // ---------- 포스트잇 ----------
    const postitIdMap = new Map();
    (data.postits || []).forEach((p) => {
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
      db.prepare('INSERT INTO inbox_items (content, is_processed) VALUES (?, ?)').run(i.content, i.is_processed ? 1 : 0);
      counts.inbox_items += 1;
    });

    // ---------- 항목 간 연결: 양쪽 다 이번에 성공적으로 매핑된 경우만 복원 ----------
    const idMaps = { todo: todoIdMap, event: eventIdMap, memo: memoIdMap, postit: postitIdMap };
    (data.item_links || []).forEach((l) => {
      const newA = idMaps[l.a_type]?.get(l.a_id);
      const newB = idMaps[l.b_type]?.get(l.b_id);
      if (!newA || !newB) return;
      db.prepare('INSERT OR IGNORE INTO item_links (a_type, a_id, b_type, b_id) VALUES (?, ?, ?, ?)').run(l.a_type, newA, l.b_type, newB);
      counts.item_links += 1;
    });
  });

  run();
  return counts;
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
  ipcMain.handle('data:restore', async () => {
    const win = getWin();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '복원할 백업 파일 선택',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 백업 파일', extensions: ['db'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return { cancelled: true };

    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['취소', '복원하고 재시작'],
      defaultId: 0,
      cancelId: 0,
      title: '데이터 복원',
      message: '현재 잇다의 모든 데이터를 백업 파일 내용으로 덮어씁니다.',
      detail: '이 작업은 되돌릴 수 없습니다. 복원이 끝나면 앱이 자동으로 재시작됩니다.',
    });
    if (confirm.response !== 1) return { cancelled: true };

    db.close();
    // WAL 모드 보조 파일이 남아있으면 복원한 DB와 내용이 안 맞을 수 있어 같이 정리한다
    [dbPath + '-wal', dbPath + '-shm'].forEach((p) => {
      try {
        fs.unlinkSync(p);
      } catch (e) {
        /* 없으면 무시 */
      }
    });
    fs.copyFileSync(filePaths[0], dbPath);

    app.relaunch();
    app.exit(0);
    return { cancelled: false };
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

    const tables = ['categories', 'todos', 'todo_subtasks', 'todo_tags', 'events', 'memos', 'postits', 'inbox_items', 'item_links'];
    const data = { exportedAt: new Date().toISOString(), appVersion: app.getVersion() };
    for (const t of tables) {
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
      detail: '기존 데이터는 지워지지 않고, 가져온 항목이 전부 새로 추가돼요. 되돌리려면 미리 백업을 만들어두는 걸 권장해요.',
    });
    if (confirm.response !== 1) return { cancelled: true };

    const counts = importAllTables(db, data);
    return { cancelled: false, counts };
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
      ['item_links', 'todo_subtasks', 'todo_tags', 'todos', 'events', 'memos', 'postits', 'inbox_items', 'google_calendar_events'].forEach(
        (t) => db.prepare(`DELETE FROM ${t}`).run()
      );
      db.prepare(`DELETE FROM categories WHERE is_system = 0`).run();
    });
    tx();
    return { cancelled: false };
  });
};
