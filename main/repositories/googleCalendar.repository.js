module.exports = function createGoogleCalendarRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO google_calendar_events
      (google_event_id, google_calendar_id, title, location, start_at, end_at, all_day, raw_json, last_synced_at)
    VALUES (@googleEventId, @googleCalendarId, @title, @location, @startAt, @endAt, @allDay, @rawJson, datetime('now','localtime'))
  `);

  return {
    range(fromDate, toDate) {
      return db
        .prepare(
          `SELECT * FROM google_calendar_events
           WHERE date(start_at) BETWEEN date(?) AND date(?)
           ORDER BY start_at ASC`
        )
        .all(fromDate, toDate);
    },

    // 매 동기화마다 전체를 비우고 새로 채운다. 취소되거나 시간이 바뀐 일정도
    // 복잡한 diff 로직 없이 자연스럽게 반영되는 가장 단순하고 안전한 방식.
    replaceAll(events) {
      const tx = db.transaction((items) => {
        db.prepare('DELETE FROM google_calendar_events').run();
        for (const e of items) {
          insertStmt.run({
            googleEventId: e.googleEventId,
            googleCalendarId: e.googleCalendarId,
            title: e.title,
            location: e.location,
            startAt: e.startAt,
            endAt: e.endAt,
            allDay: e.allDay ? 1 : 0,
            rawJson: e.rawJson,
          });
        }
      });
      tx(events);
    },

    clearAll() {
      db.prepare('DELETE FROM google_calendar_events').run();
    },

    lastSyncedAt() {
      const row = db.prepare('SELECT MAX(last_synced_at) AS t FROM google_calendar_events').get();
      return row?.t || null;
    },
  };
};
