/**
 * events 테이블 전용 SQL.
 * google_calendar_events는 별도 테이블(읽기전용 제약을 구조로 강제)이라 여기서 다루지 않는다.
 */
module.exports = function createEventsRepository(db) {
  return {
    // "오늘"이란 date(start_at) = 오늘뿐 아니라, 어제 이전에 시작해서 오늘까지 이어지는
    // 하루종일 일정(휴가 등)도 포함해야 한다 — range()와 같은 이유로 같은 방식(구간 겹침)을 쓴다.
    today() {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.deleted_at IS NULL
             AND date(e.start_at) <= date('now','localtime') AND date(e.end_at) >= date('now','localtime')
           ORDER BY e.start_at ASC`
        )
        .all();
    },

    // date(start_at) BETWEEN fromDate AND toDate로 필터하면 "시작일"만 그 구간에 있는지 보므로,
    // 여러 날에 걸친 하루종일 일정(예: 8/13~15 휴가)을 8/14나 8/15만 조회할 때(일간 뷰 등)
    // 시작일이 구간 밖이라 통째로 안 잡히는 버그가 있었다 — 이제 일정의 [start,end] 구간이
    // 조회 구간 [fromDate,toDate]과 "겹치기만" 하면 포함시킨다(구간 겹침 조건).
    range(fromDate, toDate) {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.deleted_at IS NULL AND date(e.start_at) <= date(?) AND date(e.end_at) >= date(?)
           ORDER BY e.start_at ASC`
        )
        .all(toDate, fromDate);
    },

    getById(id) {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id WHERE e.id = ?`
        )
        .get(id);
    },

    insert({ title, categoryId, location, startAt, endAt, allDay, recurrenceRule, recurrenceParentId, memo }) {
      const info = db
        .prepare(
          `INSERT INTO events (title, category_id, location, start_at, end_at, all_day, recurrence_rule, recurrence_parent_id, memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          title,
          categoryId ?? null,
          location ?? null,
          startAt,
          endAt,
          allDay ? 1 : 0,
          recurrenceRule ?? null,
          recurrenceParentId ?? null,
          memo ?? null
        );
      return { id: info.lastInsertRowid };
    },

    // 반복 생성 — 부모의 시작~종료 "시간 간격"은 유지한 채 날짜만 각 발생일로 옮긴다.
    insertSeries(parent, occurrenceDates) {
      const durationMs = new Date(parent.end_at.replace(' ', 'T')).getTime() - new Date(parent.start_at.replace(' ', 'T')).getTime();
      const timePart = parent.start_at.slice(10); // ' HH:MM:SS'
      const stmt = db.prepare(
        `INSERT INTO events (title, category_id, location, start_at, end_at, all_day, recurrence_rule, recurrence_parent_id, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const pad = (n) => String(n).padStart(2, '0');
      const insertMany = db.transaction((dates) => {
        for (const date of dates) {
          const startAt = `${date}${timePart}`;
          const start = new Date(startAt.replace(' ', 'T'));
          const end = new Date(start.getTime() + durationMs);
          const endAtStr = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())} ${pad(end.getHours())}:${pad(end.getMinutes())}:${pad(end.getSeconds())}`;
          stmt.run(parent.title, parent.category_id, parent.location, startAt, endAtStr, parent.all_day, parent.recurrence_rule, parent.id, parent.memo);
        }
      });
      insertMany(occurrenceDates);
    },

    listSeriesFrom(id, fromDate) {
      const self = db.prepare('SELECT id, recurrence_parent_id, start_at FROM events WHERE id = ?').get(id);
      if (!self) return [];
      const parentId = self.recurrence_parent_id ?? self.id;
      const clauses = ['(id = ? OR recurrence_parent_id = ?)', 'deleted_at IS NULL'];
      const params = [parentId, parentId];
      if (fromDate) {
        clauses.push('date(start_at) >= date(?)');
        params.push(fromDate);
      }
      return db.prepare(`SELECT id FROM events WHERE ${clauses.join(' AND ')}`).all(...params);
    },

    update({ id, title, categoryId, location, startAt, endAt, allDay, memo }) {
      db.prepare(
        `UPDATE events SET title = ?, category_id = ?, location = ?, start_at = ?, end_at = ?, all_day = ?, memo = ?
         WHERE id = ?`
      ).run(title, categoryId, location, startAt, endAt, allDay, memo, id);
    },

    softDelete(id) {
      db.prepare(`UPDATE events SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },
  };
};
