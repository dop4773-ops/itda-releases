/**
 * memo_folders 테이블 전용 SQL — 애플 메모장 스타일 폴더 분류(카테고리 태그와는 별개 축).
 */
module.exports = function createMemoFoldersRepository(db) {
  return {
    // memo_count는 소프트 삭제 제외한 그 폴더의 메모 개수 — 폴더 목록에 배지로 보여주기 위함.
    list() {
      return db
        .prepare(
          `SELECT f.*, (SELECT COUNT(*) FROM memos WHERE folder_id = f.id AND deleted_at IS NULL) AS memo_count
           FROM memo_folders f ORDER BY f.sort_order ASC, f.created_at ASC`
        )
        .all();
    },

    insert({ name, sortOrder }) {
      const info = db.prepare('INSERT INTO memo_folders (name, sort_order) VALUES (?, ?)').run(name, sortOrder ?? 99);
      return { id: info.lastInsertRowid };
    },

    rename(id, name) {
      db.prepare('UPDATE memo_folders SET name = ? WHERE id = ?').run(name, id);
    },

    // ids 배열의 순서대로 sort_order를 0,1,2… 로 다시 매긴다(드래그로 폴더 순서 바꾸기).
    reorder(ids) {
      const stmt = db.prepare('UPDATE memo_folders SET sort_order = ? WHERE id = ?');
      const tx = db.transaction((list) => list.forEach((id, i) => stmt.run(i, id)));
      tx(ids);
    },

    remove(id) {
      // 이 폴더에 있던 메모는 folder_id NULL로(FK ON DELETE SET NULL) — 메모 자체는 삭제 안 됨
      db.prepare('DELETE FROM memo_folders WHERE id = ?').run(id);
    },
  };
};
