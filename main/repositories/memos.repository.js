module.exports = function createMemosRepository(db) {
  return {
    recent(limit) {
      return db.prepare(`SELECT * FROM memos WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`).all(limit);
    },

    list({ keyword, onlyPinned } = {}) {
      const clauses = ['deleted_at IS NULL'];
      const params = [];
      if (onlyPinned) clauses.push('is_pinned = 1');
      if (keyword) {
        clauses.push('(title LIKE ? OR content LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      return db
        .prepare(`SELECT * FROM memos WHERE ${clauses.join(' AND ')} ORDER BY is_pinned DESC, updated_at DESC`)
        .all(...params);
    },

    getById(id) {
      return db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
    },

    insert({ title, content, categoryId, colorHex }) {
      const info = db
        .prepare('INSERT INTO memos (title, content, category_id, color_hex) VALUES (?, ?, ?, ?)')
        .run(title ?? null, content, categoryId ?? null, colorHex ?? '#FBE28A');
      return { id: info.lastInsertRowid };
    },

    update({ id, title, content, categoryId, colorHex }) {
      db.prepare('UPDATE memos SET title = ?, content = ?, category_id = ?, color_hex = ? WHERE id = ?').run(
        title,
        content,
        categoryId,
        colorHex,
        id
      );
    },

    setPinned(id, isPinned) {
      db.prepare('UPDATE memos SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, id);
    },

    softDelete(id) {
      db.prepare(`UPDATE memos SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },
  };
};
