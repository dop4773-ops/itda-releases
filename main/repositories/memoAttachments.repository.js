/**
 * memo_attachments 테이블 전용 SQL.
 * 실제 파일 바이트는 여기서 다루지 않는다(경로/파일 I/O는 main/memo-attachments/storage.js 담당) —
 * 여기는 순수하게 메타데이터 행에 대한 CRUD만.
 */
module.exports = function createMemoAttachmentsRepository(db) {
  return {
    listForMemo(memoId) {
      return db.prepare(`SELECT * FROM memo_attachments WHERE memo_id = ? ORDER BY created_at ASC`).all(memoId);
    },

    getById(id) {
      return db.prepare(`SELECT * FROM memo_attachments WHERE id = ?`).get(id);
    },

    insert({ memoId, fileName, storedName, mimeType, size }) {
      const info = db
        .prepare(`INSERT INTO memo_attachments (memo_id, file_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?)`)
        .run(memoId, fileName, storedName, mimeType ?? null, size ?? null);
      return this.getById(info.lastInsertRowid);
    },

    delete(id) {
      db.prepare(`DELETE FROM memo_attachments WHERE id = ?`).run(id);
    },
  };
};
