module.exports = function createMemosRepository(db) {
  return {
    recent(limit) {
      return db.prepare(`SELECT * FROM memos WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`).all(limit);
    },

    // folderId: undefined면 폴더 무관 전체, null이면 "미분류"(folder_id IS NULL)만, 숫자면 그 폴더만.
    list({ keyword, onlyPinned, folderId } = {}) {
      const clauses = ['deleted_at IS NULL'];
      const params = [];
      if (onlyPinned) clauses.push('is_pinned = 1');
      if (folderId !== undefined) {
        clauses.push(folderId === null ? 'folder_id IS NULL' : 'folder_id = ?');
        if (folderId !== null) params.push(folderId);
      }
      if (keyword) {
        clauses.push('(title LIKE ? OR content LIKE ?)');
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      // 목록에 "첨부 있음" 표시 + 첫 번째 사진 썸네일을 보여주기 위한 경량 집계.
      // 이미지 바이트 자체는 안 실어서(별도 IPC로 필요할 때만 지연 로드) 목록 조회가 무거워지지 않는다.
      return db
        .prepare(
          `SELECT m.*,
             (SELECT COUNT(*) FROM memo_attachments a WHERE a.memo_id = m.id) AS attachment_count,
             (SELECT a.id FROM memo_attachments a WHERE a.memo_id = m.id AND a.mime_type LIKE 'image/%' ORDER BY a.created_at ASC LIMIT 1) AS first_image_id
           FROM memos m WHERE ${clauses.join(' AND ')} ORDER BY is_pinned DESC, updated_at DESC`
        )
        .all(...params);
    },

    getById(id) {
      return db.prepare('SELECT * FROM memos WHERE id = ?').get(id);
    },

    insert({ title, content, categoryId, colorHex, folderId }) {
      const info = db
        .prepare('INSERT INTO memos (title, content, category_id, color_hex, folder_id) VALUES (?, ?, ?, ?, ?)')
        .run(title ?? null, content, categoryId ?? null, colorHex ?? '#FBE28A', folderId ?? null);
      return { id: info.lastInsertRowid };
    },

    update({ id, title, content, categoryId, colorHex, folderId }) {
      db.prepare('UPDATE memos SET title = ?, content = ?, category_id = ?, color_hex = ?, folder_id = ? WHERE id = ?').run(
        title,
        content,
        categoryId,
        colorHex,
        folderId,
        id
      );
    },

    // 폴더 이동처럼 "내용을 안 고친" 변경 뒤에 호출 — trg_memos_updated_at 트리거가
    // 방금 올려버린 updated_at을 원래 값으로 되돌린다(old≠new이라 트리거가 다시 안 탄다).
    restoreUpdatedAt(id, value) {
      db.prepare('UPDATE memos SET updated_at = ? WHERE id = ?').run(value, id);
    },

    setPinned(id, isPinned) {
      db.prepare('UPDATE memos SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, id);
    },

    setLocked(id, isLocked) {
      db.prepare('UPDATE memos SET is_locked = ? WHERE id = ?').run(isLocked ? 1 : 0, id);
    },

    softDelete(id) {
      db.prepare(`UPDATE memos SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
    },
  };
};
