/**
 * categories 테이블 전용 SQL. 여기엔 검증/에러 판단 로직을 넣지 않는다 —
 * "시스템 카테고리는 삭제 불가" 같은 규칙은 ipc/categories.ipc.js(호출부)의 책임.
 */
module.exports = function createCategoriesRepository(db) {
  return {
    // item_count는 이 태그를 쓰고 있는 4개 타입(소프트 삭제 제외) 합계 — 태그 화면에서
    // "몇 개 항목에 쓰이는지" 배지로 보여주기 위함. 카테고리 수가 적어(수십 개 수준)
    // 상관 서브쿼리 4개를 매 행마다 돌려도 성능에 영향 없다.
    list() {
      return db
        .prepare(
          `SELECT c.*,
            (SELECT COUNT(*) FROM todos WHERE category_id = c.id AND deleted_at IS NULL) +
            (SELECT COUNT(*) FROM events WHERE category_id = c.id AND deleted_at IS NULL) +
            (SELECT COUNT(*) FROM memos WHERE category_id = c.id AND deleted_at IS NULL) +
            (SELECT COUNT(*) FROM postits WHERE category_id = c.id AND deleted_at IS NULL) AS item_count
           FROM categories c ORDER BY c.sort_order ASC`
        )
        .all();
    },

    getById(id) {
      return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    },

    insert({ name, colorHex, textColor, sortOrder }) {
      const info = db
        .prepare('INSERT INTO categories (name, color_hex, text_color, is_system, sort_order) VALUES (?, ?, ?, 0, ?)')
        .run(name, colorHex, textColor || '#000000', sortOrder ?? 99);
      return { id: info.lastInsertRowid };
    },

    update({ id, name, colorHex, textColor, sortOrder }) {
      db.prepare('UPDATE categories SET name = ?, color_hex = ?, text_color = ?, sort_order = ? WHERE id = ?').run(
        name,
        colorHex,
        textColor || '#000000',
        sortOrder,
        id
      );
    },

    remove(id) {
      // 이 카테고리를 참조하던 todo/event는 category_id NULL로 (FK ON DELETE SET NULL)
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    },

    // 태그 탐색(문서 7번) — 이 카테고리를 쓰고 있는 항목을 4개 타입 전부에서 모아온다.
    // 소프트 삭제된 항목은 제외. 타입별로 배열을 나눠 반환해서 렌더러가 아이콘별로 그룹핑하기 쉽게 한다.
    itemsFor(categoryId) {
      const todos = db
        .prepare(`SELECT id, title AS label, is_done FROM todos WHERE category_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`)
        .all(categoryId);
      const events = db
        .prepare(`SELECT id, title AS label, start_at FROM events WHERE category_id = ? AND deleted_at IS NULL ORDER BY start_at DESC`)
        .all(categoryId);
      const memos = db
        .prepare(
          `SELECT id, coalesce(title, substr(content,1,300)) AS label FROM memos WHERE category_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`
        )
        .all(categoryId);
      const postits = db
        .prepare(
          `SELECT id, coalesce(title, substr(content,1,300)) AS label FROM postits WHERE category_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`
        )
        .all(categoryId);
      return {
        todo: todos.map((r) => ({ type: 'todo', ...r })),
        event: events.map((r) => ({ type: 'event', ...r })),
        memo: memos.map((r) => ({ type: 'memo', label: (r.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '(제목 없음)', id: r.id })),
        postit: postits.map((r) => ({ type: 'postit', label: (r.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '(제목 없음)', id: r.id })),
      };
    },
  };
};
