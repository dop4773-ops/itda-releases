// inbox_items는 deleted_at 컬럼이 없음 → remove()는 하드 삭제(설계상 의도)
module.exports = function createInboxRepository(db) {
  return {
    insert(content) {
      const info = db.prepare('INSERT INTO inbox_items (content) VALUES (?)').run(content);
      return { id: info.lastInsertRowid };
    },

    list(onlyUnprocessed) {
      const sql = onlyUnprocessed
        ? 'SELECT * FROM inbox_items WHERE is_processed = 0 ORDER BY created_at DESC'
        : 'SELECT * FROM inbox_items ORDER BY created_at DESC';
      return db.prepare(sql).all();
    },

    markProcessed({ id, type, refId }) {
      db.prepare(
        `UPDATE inbox_items SET is_processed = 1, processed_type = ?, processed_ref_id = ?, processed_at = datetime('now','localtime')
         WHERE id = ?`
      ).run(type, refId, id);
    },

    remove(id) {
      db.prepare('DELETE FROM inbox_items WHERE id = ?').run(id);
    },
  };
};
