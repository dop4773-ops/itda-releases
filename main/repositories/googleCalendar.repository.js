module.exports = function createGoogleCalendarRepository(db) {
  const insertStmt = db.prepare(`
    INSERT INTO google_calendar_events
      (google_event_id, google_calendar_id, title, location, start_at, end_at, all_day, raw_json, last_synced_at)
    VALUES (@googleEventId, @googleCalendarId, @title, @location, @startAt, @endAt, @allDay, @rawJson, datetime('now','localtime'))
  `);

  return {
    // events.repository.js의 range()와 같은 이유로 구간 겹침 조건을 쓴다 — date(start_at)만
    // 보면 여러 날짜에 걸친 하루종일 일정(휴가 등)이 시작일이 아닌 날(예: 일간 뷰로 중간/마지막
    // 날짜만 조회할 때)엔 안 잡히는 버그가 있었다. end_at은 컬럼이 nullable이라 없으면
    // start_at으로 대체(COALESCE)해서 "그 하루만 있는 일정"으로 취급한다.
    range(fromDate, toDate) {
      return db
        .prepare(
          `SELECT * FROM google_calendar_events
           WHERE date(start_at) <= date(?) AND date(COALESCE(end_at, start_at)) >= date(?)
           ORDER BY start_at ASC`
        )
        .all(toDate, fromDate);
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
