/**
 * 메신저 연동의 잇다 쪽 저장소 — 불러온 항목(messenger_items), 잇다 일정과의 연결(messenger_links), 불러오기 기록.
 * 메신저 DB 자체에는 접근하지 않는다(그건 main/messenger/reader.js, 읽기 전용).
 */
const { maskName } = require('../messenger/format');

const ITEM_FIELDS = ['kind', 'date', 'end_date', 'patient', 'rm', 'ward', 'room', 'to_ward', 'to_room', 'time_text', 'time_text2', 'note', 'reason', 'revision'];

module.exports = function createMessengerRepository(db) {
  const getItem = db.prepare('SELECT * FROM messenger_items WHERE source = ? AND ext_id = ?');
  return {
    getItem: (source, extId) => getItem.get(source, extId),

    // 같은 내용이면 건드리지 않는다(마지막으로 본 시각만 갱신). 'inserted' | 'updated' | 'same'
    upsertItem(it) {
      const row = getItem.get(it.source, it.ext_id);
      if (!row) {
        db.prepare(
          `INSERT INTO messenger_items (source, ext_id, ${ITEM_FIELDS.join(', ')}, state) VALUES (@source, @ext_id, ${ITEM_FIELDS.map((f) => `@${f}`).join(', ')}, 'active')`
        ).run({ ...it, end_date: it.end_date ?? null });
        return 'inserted';
      }
      const changed = row.state !== 'active' || ITEM_FIELDS.some((f) => (row[f] ?? null) !== ((it[f] ?? null)));
      if (!changed) {
        db.prepare("UPDATE messenger_items SET last_seen_at = datetime('now','localtime') WHERE source = ? AND ext_id = ?").run(it.source, it.ext_id);
        return 'same';
      }
      db.prepare(
        `UPDATE messenger_items SET ${ITEM_FIELDS.map((f) => `${f} = @${f}`).join(', ')}, state = 'active', last_seen_at = datetime('now','localtime') WHERE source = @source AND ext_id = @ext_id`
      ).run({ ...it, end_date: it.end_date ?? null });
      return 'updated';
    },

    markGone(source, extId) {
      return db.prepare("UPDATE messenger_items SET state = 'gone' WHERE source = ? AND ext_id = ? AND state = 'active'").run(source, extId).changes;
    },

    activeItems: () => db.prepare("SELECT * FROM messenger_items WHERE state = 'active' ORDER BY date, ext_id").all(),

    // 조회 기간과 "겹치는" 활성 항목(외박은 기간이 걸쳐 있음) — 메신저에서 사라졌는지 판단할 대상
    activeInWindow: (fromDate, toDate) =>
      db
        .prepare("SELECT * FROM messenger_items WHERE state = 'active' AND date <= ? AND COALESCE(end_date, date) >= ?")
        .all(toDate, fromDate),

    // 위젯용 — 기간과 겹치는 활성 항목(날짜·시각순)
    itemsBetween: (fromDate, toDate) =>
      db
        .prepare("SELECT * FROM messenger_items WHERE state = 'active' AND date <= ? AND COALESCE(end_date, date) >= ? ORDER BY date, ext_id")
        .all(toDate, fromDate),

    // "이름 표시" 설정을 더 엄격하게 바꿨을 때 저장돼 있던 이름을 바로 가린다(숨김이면 비움)
    scrubNames(mode) {
      const upd = db.prepare('UPDATE messenger_items SET patient = ? WHERE source = ? AND ext_id = ?');
      let n = 0;
      for (const r of db.prepare("SELECT source, ext_id, patient FROM messenger_items WHERE patient <> ''").all()) {
        const m = maskName(r.patient, mode);
        if (m !== r.patient) {
          upd.run(m, r.source, r.ext_id);
          n++;
        }
      }
      return n;
    },

    getLink: (key) => db.prepare('SELECT * FROM messenger_links WHERE link_key = ?').get(key),
    listLinks: () => db.prepare('SELECT * FROM messenger_links').all(),
    saveLink(l) {
      db.prepare(
        `INSERT INTO messenger_links (link_key, event_id, last_title, last_auto, last_start, last_end, last_category, dismissed, synced_at)
         VALUES (@link_key, @event_id, @last_title, @last_auto, @last_start, @last_end, @last_category, @dismissed, datetime('now','localtime'))
         ON CONFLICT(link_key) DO UPDATE SET event_id = excluded.event_id, last_title = excluded.last_title, last_auto = excluded.last_auto,
           last_start = excluded.last_start, last_end = excluded.last_end, last_category = excluded.last_category, dismissed = excluded.dismissed, synced_at = excluded.synced_at`
      ).run({ dismissed: 0, last_category: null, ...l });
    },
    deleteLink: (key) => db.prepare('DELETE FROM messenger_links WHERE link_key = ?').run(key),

    addLog(trigger, summary) {
      db.prepare('INSERT INTO messenger_log (trigger, summary_json) VALUES (?, ?)').run(trigger, JSON.stringify(summary));
      db.prepare('DELETE FROM messenger_log WHERE id NOT IN (SELECT id FROM messenger_log ORDER BY id DESC LIMIT 50)').run(); // 최근 50회만
    },
    listLog: (limit = 10) =>
      db
        .prepare('SELECT id, at, trigger, summary_json FROM messenger_log ORDER BY id DESC LIMIT ?')
        .all(limit)
        .map((r) => ({ ...r, summary: JSON.parse(r.summary_json) })),
  };
};
