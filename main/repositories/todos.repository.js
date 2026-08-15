/**
 * todos / todo_subtasks 테이블 전용 SQL.
 * 필터 조립(list), 상태 동기화(status<->is_done) 같은 "쿼리 구성" 로직까지는 여기 둔다.
 * "제목 필수" 같은 입력 검증은 ipc/todos.ipc.js(호출부)의 책임.
 */
module.exports = function createTodosRepository(db) {
  return {
    // "오늘 할 일" 위젯 전용 — 오늘 마감이거나 마감일이 아예 없는 할 일을 보여준다.
    // 완료된 건 여기서 아예 제외해서, 위젯에서 체크하면 (취소선으로 남는 게 아니라) 바로 사라진다.
    listToday() {
      return db
        .prepare(
          `SELECT t.*, c.name AS category_name, c.color_hex
           FROM todos t LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.deleted_at IS NULL
             AND t.is_done = 0
             AND (t.due_date = date('now','localtime') OR t.due_date IS NULL)
           ORDER BY t.due_date IS NULL, t.priority ASC, t.due_time ASC`
        )
        .all();
    },

    // 필터: categoryId, isDone, status, isFavorite, fromDate~toDate, keyword
    list(filter = {}) {
      const { categoryId, isDone, status, isFavorite, fromDate, toDate, keyword } = filter;
      const clauses = ['t.deleted_at IS NULL'];
      const params = [];

      if (categoryId != null) {
        clauses.push('t.category_id = ?');
        params.push(categoryId);
      }
      if (isDone != null) {
        clauses.push('t.is_done = ?');
        params.push(isDone ? 1 : 0);
      }
      if (status != null) {
        clauses.push('t.status = ?');
        params.push(status);
      }
      if (isFavorite != null) {
        clauses.push('t.is_favorite = ?');
        params.push(isFavorite ? 1 : 0);
      }
      if (fromDate) {
        clauses.push('t.due_date >= ?');
        params.push(fromDate);
      }
      if (toDate) {
        clauses.push('t.due_date <= ?');
        params.push(toDate);
      }
      if (keyword) {
        clauses.push('t.title LIKE ?');
        params.push(`%${keyword}%`);
      }

      const sql = `
        SELECT t.*, c.name AS category_name, c.color_hex
        FROM todos t LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.due_date IS NULL, t.due_date ASC, t.priority ASC`;
      return db.prepare(sql).all(...params);
    },

    getById(id) {
      return db
        .prepare(
          `SELECT t.*, c.name AS category_name, c.color_hex
           FROM todos t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`
        )
        .get(id);
    },

    insert({ title, memo, categoryId, dueDate, dueTime, priority, sourceInboxId, recurrenceRule, recurrenceParentId }) {
      const info = db
        .prepare(
          `INSERT INTO todos (title, memo, category_id, due_date, due_time, priority, source_inbox_id, recurrence_rule, recurrence_parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          title,
          memo ?? null,
          categoryId ?? null,
          dueDate ?? null,
          dueTime ?? null,
          priority ?? 2,
          sourceInboxId ?? null,
          recurrenceRule ?? null,
          recurrenceParentId ?? null
        );
      return { id: info.lastInsertRowid };
    },

    // 반복 생성 시 부모 하나 만든 뒤 이 메서드로 나머지 발생일들을 한 번에 채워넣는다.
    // 부모의 제목/카테고리/시간/우선순위는 그대로 복사하고 날짜만 다르게.
    insertSeries(parent, occurrenceDates) {
      const stmt = db.prepare(
        `INSERT INTO todos (title, memo, category_id, due_date, due_time, priority, recurrence_rule, recurrence_parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertMany = db.transaction((dates) => {
        for (const date of dates) {
          stmt.run(parent.title, parent.memo, parent.category_id, date, parent.due_time, parent.priority, parent.recurrence_rule, parent.id);
        }
      });
      insertMany(occurrenceDates);
    },

    // scope 처리(this/following)용 — id가 부모든 자식이든 그 반복 시리즈 전체를 찾는다.
    // fromDate를 주면 그 날짜 이상인 것만(자기 자신 포함), 안 주면 시리즈 전체.
    listSeriesFrom(id, fromDate) {
      const self = db.prepare('SELECT id, recurrence_parent_id, due_date FROM todos WHERE id = ?').get(id);
      if (!self) return [];
      const parentId = self.recurrence_parent_id ?? self.id;
      const clauses = ['(id = ? OR recurrence_parent_id = ?)', 'deleted_at IS NULL'];
      const params = [parentId, parentId];
      if (fromDate) {
        clauses.push('due_date >= ?');
        params.push(fromDate);
      }
      return db.prepare(`SELECT id FROM todos WHERE ${clauses.join(' AND ')}`).all(...params);
    },

    update({ id, title, memo, categoryId, dueDate, dueTime, priority }) {
      db.prepare(
        `UPDATE todos SET title = ?, memo = ?, category_id = ?, due_date = ?, due_time = ?, priority = ?
         WHERE id = ?`
      ).run(title, memo, categoryId, dueDate, dueTime, priority, id);
    },

    // 체크박스 토글용: is_done만 뒤집고 status/completed_at을 함께 동기화
    setDone(id, isDone) {
      db.prepare(
        `UPDATE todos SET is_done = ?, status = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
         WHERE id = ?`
      ).run(isDone ? 1 : 0, isDone ? 'done' : 'todo', isDone ? 1 : 0, id);
    },

    // 칸반 보드 컬럼 이동용: status를 직접 지정하고 is_done을 함께 동기화
    setStatus(id, status) {
      const isDone = status === 'done' ? 1 : 0;
      db.prepare(
        `UPDATE todos SET status = ?, is_done = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END
         WHERE id = ?`
      ).run(status, isDone, isDone, id);
    },

    setFavorite(id, isFavorite) {
      db.prepare('UPDATE todos SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, id);
    },

    setRecurrenceRule(id, rule) {
      db.prepare('UPDATE todos SET recurrence_rule = ? WHERE id = ?').run(rule, id);
    },

    softDelete(id) {
      db.prepare(`UPDATE todos SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },

    // ---------- 하위 할 일 ----------
    listSubtasks(todoId) {
      return db.prepare(`SELECT * FROM todo_subtasks WHERE todo_id = ? ORDER BY sort_order ASC, id ASC`).all(todoId);
    },

    insertSubtask({ todoId, title }) {
      const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM todo_subtasks WHERE todo_id = ?`).get(todoId).m;
      const info = db
        .prepare(`INSERT INTO todo_subtasks (todo_id, title, sort_order) VALUES (?, ?, ?)`)
        .run(todoId, title, maxOrder + 1);
      return { id: info.lastInsertRowid };
    },

    getSubtaskDoneState(id) {
      return db.prepare('SELECT is_done, todo_id FROM todo_subtasks WHERE id = ?').get(id);
    },

    setSubtaskDone(id, isDone) {
      db.prepare('UPDATE todo_subtasks SET is_done = ? WHERE id = ?').run(isDone ? 1 : 0, id);
    },

    removeSubtask(id) {
      db.prepare('DELETE FROM todo_subtasks WHERE id = ?').run(id);
    },
  };
};
