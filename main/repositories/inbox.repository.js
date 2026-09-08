// inbox_items는 deleted_at 컬럼이 없음 → remove()는 하드 삭제(설계상 의도)
module.exports = function createInboxRepository(db) {
  return {
    insert(content) {
      const info = db.prepare('INSERT INTO inbox_items (content) VALUES (?)').run(content);
      return { id: info.lastInsertRowid };
    },

    // 여러 줄 붙여넣기 → 줄마다 항목 하나. 한 트랜잭션. 빈 줄은 버린다.
    insertMany(contents) {
      const stmt = db.prepare('INSERT INTO inbox_items (content) VALUES (?)');
      const ids = [];
      db.transaction(() => {
        for (const c of contents) {
          const t = String(c || '').trim();
          if (t) ids.push(stmt.run(t).lastInsertRowid);
        }
      })();
      return { ids };
    },

    list(onlyUnprocessed) {
      const sql = onlyUnprocessed
        ? 'SELECT * FROM inbox_items WHERE is_processed = 0 ORDER BY created_at DESC'
        : 'SELECT * FROM inbox_items ORDER BY created_at DESC';
      return db.prepare(sql).all();
    },

    setFavorite(id, isFavorite) {
      db.prepare('UPDATE inbox_items SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, id);
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
