module.exports = function createPostitsRepository(db) {
  return {
    list() {
      return db
        .prepare(
          `SELECT p.*, c.name AS category_name, c.color_hex AS category_color
           FROM postits p LEFT JOIN categories c ON c.id = p.category_id
           WHERE p.deleted_at IS NULL ORDER BY p.is_pinned DESC, p.updated_at DESC`
        )
        .all();
    },

    getById(id) {
      return db.prepare('SELECT * FROM postits WHERE id = ?').get(id);
    },

    insert({ title, content, colorHex, categoryId, posX, posY, width, height }) {
      const info = db
        .prepare(
          `INSERT INTO postits (title, content, color_hex, category_id, pos_x, pos_y, width, height, is_always_on_top)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(title ?? null, content, colorHex ?? '#FBE28A', categoryId ?? null, posX ?? null, posY ?? null, width ?? 295, height ?? 295);
      return { id: info.lastInsertRowid };
    },

    update({ id, title, content, colorHex, categoryId, posX, posY, width, height, opacity }) {
      db.prepare(
        `UPDATE postits SET title = ?, content = ?, color_hex = ?, category_id = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, opacity = ?
         WHERE id = ?`
      ).run(title, content, colorHex, categoryId, posX, posY, width, height, opacity, id);
    },

    // 위젯 만료 시각 — null이면 계속(만료로 위젯이 닫히며 해제할 때도 씀). 트리거 때문에 수정 시각은 갱신된다.
    setExpiresAt(id, expiresAt) {
      db.prepare('UPDATE postits SET expires_at = ? WHERE id = ?').run(expiresAt ?? null, id);
    },

    setPinned(id, isPinned) {
      db.prepare('UPDATE postits SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, id);
    },

    setAlwaysOnTop(id, isAlwaysOnTop) {
      db.prepare('UPDATE postits SET is_always_on_top = ? WHERE id = ?').run(isAlwaysOnTop ? 1 : 0, id);
    },

    softDelete(id) {
      db.prepare(`UPDATE postits SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },
  };
};
