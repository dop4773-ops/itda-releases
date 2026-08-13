const { TRASH_TABLES } = require('../ipc/_shared');

module.exports = function createTrashRepository(db) {
  return {
    listTrashed() {
      const todos = db
        .prepare('SELECT id, title AS label, category_id, deleted_at FROM todos WHERE deleted_at IS NOT NULL')
        .all()
        .map((r) => ({ ...r, type: 'todo' }));
      const events = db
        .prepare('SELECT id, title AS label, category_id, deleted_at FROM events WHERE deleted_at IS NOT NULL')
        .all()
        .map((r) => ({ ...r, type: 'event' }));
      // memo/postit은 content가 서식(HTML)을 담고 있을 수 있어서 넉넉히 잘라서 넘기고,
      // 태그를 걷어내 짧게 표시하는 건 렌더러(stripHtmlToPlainText)가 담당한다.
      const memos = db
        .prepare("SELECT id, coalesce(title, substr(content,1,300)) AS label, NULL AS category_id, deleted_at FROM memos WHERE deleted_at IS NOT NULL")
        .all()
        .map((r) => ({ ...r, type: 'memo' }));
      const postits = db
        .prepare("SELECT id, coalesce(title, substr(content,1,300)) AS label, NULL AS category_id, deleted_at FROM postits WHERE deleted_at IS NOT NULL")
        .all()
        .map((r) => ({ ...r, type: 'postit' }));
      return [...todos, ...events, ...memos, ...postits].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
    },

    restore(type, id) {
      const table = TRASH_TABLES[type];
      if (!table) return false;
      db.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`).run(id);
      return true;
    },

    permanentlyDelete(type, id) {
      const table = TRASH_TABLES[type];
      if (!table) return false;
      db.prepare(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`).run(id);
      return true;
    },
  };
};
