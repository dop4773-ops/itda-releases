/**
 * events 테이블 전용 SQL.
 * google_calendar_events는 별도 테이블(읽기전용 제약을 구조로 강제)이라 여기서 다루지 않는다.
 */
module.exports = function createEventsRepository(db) {
  return {
    today() {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.deleted_at IS NULL AND date(e.start_at) = date('now','localtime')
           ORDER BY e.start_at ASC`
        )
        .all();
    },

    range(fromDate, toDate) {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.deleted_at IS NULL AND date(e.start_at) BETWEEN date(?) AND date(?)
           ORDER BY e.start_at ASC`
        )
        .all(fromDate, toDate);
    },

    getById(id) {
      return db
        .prepare(
          `SELECT e.*, c.name AS category_name, c.color_hex, c.text_color
           FROM events e LEFT JOIN categories c ON c.id = e.category_id WHERE e.id = ?`
        )
        .get(id);
    },

    insert({ title, categoryId, location, startAt, endAt, allDay, recurrenceRule, memo }) {
      const info = db
        .prepare(
          `INSERT INTO events (title, category_id, location, start_at, end_at, all_day, recurrence_rule, memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(title, categoryId ?? null, location ?? null, startAt, endAt, allDay ? 1 : 0, recurrenceRule ?? null, memo ?? null);
      return { id: info.lastInsertRowid };
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
