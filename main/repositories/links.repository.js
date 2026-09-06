// item_links 조회 시 각 타입별로 "미리보기"에 쓸 제목/부가정보를 가져오는 쿼리.
// deleted_at까지 같이 가져와서, 연결된 쪽이 휴지통에 가 있으면 상위 레이어에서 걸러낼 수 있게 한다.
const PREVIEW_QUERIES = {
  todo: `SELECT id, title AS label, due_date, due_time, is_done, deleted_at FROM todos WHERE id = ?`,
  event: `SELECT id, title AS label, start_at, deleted_at FROM events WHERE id = ?`,
  // memo/postit은 content가 HTML(볼드/글씨크기 서식)일 수 있어서, 태그를 감안해 넉넉히 잘라
  // 렌더러 쪽에서 stripHtmlToPlainText로 순수텍스트로 바꾼 뒤 다시 짧게 자른다.
  // (여기서 짧게 자르면 "<span style=...>" 같은 태그만 남고 실제 글자가 하나도 안 남을 수 있음)
  memo: `SELECT id, coalesce(title, substr(content,1,300)) AS label, deleted_at FROM memos WHERE id = ?`,
  postit: `SELECT id, coalesce(title, substr(content,1,300)) AS label, deleted_at FROM postits WHERE id = ?`,
  // inbox_items엔 소프트 삭제(deleted_at)가 없어서 항상 NULL로 맞춰 반환 — 다른 타입과 동일한 모양 유지
  inbox: `SELECT id, substr(content,1,300) AS label, NULL AS deleted_at FROM inbox_items WHERE id = ?`,
};

// item_links의 타입 → 실제 테이블. 고아 연결(상대 항목이 완전삭제됨) 판별에 쓴다.
const LINK_TABLES = { todo: 'todos', event: 'events', memo: 'memos', postit: 'postits', inbox: 'inbox_items' };

// 자동 관련 항목 발견 — 카테고리(태그)가 있는 4개 타입 전부(포스트잇도 category_id가 생겼음)
const CATEGORY_TABLES = { todo: 'todos', event: 'events', memo: 'memos', postit: 'postits' };

// search: search.repository — "@검색"과 "비슷한 내용" 추천이 통합검색과 같은 매칭을 쓰게 한다.
module.exports = function createLinksRepository(db, search) {
  return {
    // link는 { a_type, a_id, b_type, b_id } 형태로, 이미 정규화되어 들어온다고 가정 (정규화는 ipc 레이어 책임)
    insertIgnore(link) {
      db.prepare(`INSERT OR IGNORE INTO item_links (a_type, a_id, b_type, b_id) VALUES (?, ?, ?, ?)`).run(
        link.a_type,
        link.a_id,
        link.b_type,
        link.b_id
      );
    },

    find(link) {
      return db
        .prepare(`SELECT * FROM item_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`)
        .get(link.a_type, link.a_id, link.b_type, link.b_id);
    },

    remove(link) {
      db.prepare(`DELETE FROM item_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`).run(
        link.a_type,
        link.a_id,
        link.b_type,
        link.b_id
      );
    },

    listRawFor(type, id) {
      return db
        .prepare(
          `SELECT a_type, a_id, b_type, b_id FROM item_links
           WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`
        )
        .all(type, id, type, id);
    },

    getPreview(type, id) {
      const query = PREVIEW_QUERIES[type];
      if (!query) return null;
      return db.prepare(query).get(id);
    },

    // 목록 화면에서 "이 항목에 연결이 있나 / 어떤 종류가 연결됐나"만 알고 싶을 때 —
    // 항목마다 listFor(+getPreview) N번 도는 대신, 한 방에 { id: Set(연결된 종류) } 를 만든다.
    // 상대 항목이 완전삭제된 고아 연결은 제외한다(예: 완전삭제된 Todo에만 걸려있던 포스트잇에
    // "Todo 연결됨" 배지가 계속 뜨던 것). listFor와 동일하게 소프트삭제(휴지통)는 남긴다.
    kindsForMany(type, ids) {
      const out = {};
      if (!Array.isArray(ids) || ids.length === 0) return out;
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT a_type, a_id, b_type, b_id FROM item_links
           WHERE (a_type = ? AND a_id IN (${placeholders}))
              OR (b_type = ? AND b_id IN (${placeholders}))`
        )
        .all(type, ...ids, type, ...ids);

      // 상대편(type,id) 후보를 종류별로 모아 존재 여부를 종류당 한 번의 쿼리로 확인
      const wantByType = {};
      const pairs = rows.map((r) => {
        const isA = r.a_type === type && ids.includes(r.a_id);
        const selfId = isA ? r.a_id : r.b_id;
        const otherType = isA ? r.b_type : r.a_type;
        const otherId = isA ? r.b_id : r.a_id;
        (wantByType[otherType] = wantByType[otherType] || new Set()).add(otherId);
        return { selfId, otherType, otherId };
      });
      const existsByType = {};
      for (const [ot, idSet] of Object.entries(wantByType)) {
        const table = LINK_TABLES[ot];
        if (!table) continue;
        const list = [...idSet];
        const ph = list.map(() => '?').join(',');
        existsByType[ot] = new Set(
          db.prepare(`SELECT id FROM ${table} WHERE id IN (${ph})`).all(...list).map((x) => x.id)
        );
      }

      for (const p of pairs) {
        if (!existsByType[p.otherType] || !existsByType[p.otherType].has(p.otherId)) continue; // 고아 연결
        (out[p.selfId] = out[p.selfId] || new Set()).add(p.otherType);
      }
      return out;
    },

    deleteAllFor(type, id) {
      db.prepare(`DELETE FROM item_links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`).run(type, id, type, id);
    },

    // "@검색" 빠른 연결용 — 통합검색과 동일한 매칭(search.candidates). inbox는 연결 대상 아님.
    searchCandidates(keyword, excludeType, excludeId) {
      return search.candidates(keyword, excludeType, excludeId);
    },

    // "연결을 관리하는 프로그램이 아니라 연결을 발견하게 해주는 프로그램" — 사용자가 직접 연결하지 않아도
    // 카테고리(태그)가 같거나 제목/내용이 비슷한 항목을 자동으로 찾아 추천한다.
    // 오탐 우려 때문에(문서 6번 요구사항) 직접 연결(item_links)과는 항상 분리해서 반환하고,
    // 이미 직접 연결된 항목/자기 자신은 추천 후보에서 제외한다.
    discoverRelated(type, id) {
      const preview = this.getPreview(type, id);
      if (!preview) return { sameCategory: [], similar: [] };

      const alreadyLinked = new Set([`${type}:${id}`]);
      this.listRawFor(type, id).forEach((r) => {
        const isA = r.a_type === type && r.a_id === id;
        alreadyLinked.add(isA ? `${r.b_type}:${r.b_id}` : `${r.a_type}:${r.a_id}`);
      });

      // 1) 같은 카테고리(태그) — todo/event/memo만 category_id를 가짐 (postit엔 없음)
      let sameCategory = [];
      const selfTable = CATEGORY_TABLES[type];
      let categoryInfo = null;
      if (selfTable) {
        const row = db.prepare(`SELECT category_id FROM ${selfTable} WHERE id = ?`).get(id);
        if (row?.category_id) {
          categoryInfo = db.prepare(`SELECT id, name, color_hex FROM categories WHERE id = ?`).get(row.category_id);
          if (categoryInfo) {
            const rows = [
              ...db
                .prepare(`SELECT id, title AS label FROM todos WHERE category_id = ? AND deleted_at IS NULL`)
                .all(categoryInfo.id)
                .map((r) => ({ type: 'todo', ...r })),
              ...db
                .prepare(`SELECT id, title AS label FROM events WHERE category_id = ? AND deleted_at IS NULL`)
                .all(categoryInfo.id)
                .map((r) => ({ type: 'event', ...r })),
              ...db
                .prepare(`SELECT id, coalesce(title, substr(content,1,300)) AS label FROM memos WHERE category_id = ? AND deleted_at IS NULL`)
                .all(categoryInfo.id)
                .map((r) => ({ type: 'memo', ...r })),
              ...db
                .prepare(`SELECT id, coalesce(title, substr(content,1,300)) AS label FROM postits WHERE category_id = ? AND deleted_at IS NULL`)
                .all(categoryInfo.id)
                .map((r) => ({ type: 'postit', ...r })),
            ];
            sameCategory = rows
              .filter((r) => !alreadyLinked.has(`${r.type}:${r.id}`))
              .slice(0, 6)
              .map((r) => ({
                type: r.type,
                id: r.id,
                label: (r.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '(제목 없음)',
                tagName: categoryInfo.name,
                tagColor: categoryInfo.color_hex,
              }));
          }
        }
      }

      // 2) 비슷한 내용 — 제목(또는 본문 대체 텍스트)에서 뽑은 키워드로 넓게(OR) 훑는다.
      const plainText = (preview.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const tokens = [...new Set(plainText.split(' ').filter((t) => t.length >= 2))].slice(0, 8);
      const excludeKeys = new Set([...alreadyLinked, ...sameCategory.map((sc) => `${sc.type}:${sc.id}`)]);
      const similar = search
        .similarTo(tokens, excludeKeys)
        .slice(0, 6)
        .map((r) => ({
          type: r.type,
          id: r.id,
          label: (r.title || '').trim() || (r.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '(제목 없음)',
        }));

      return { sameCategory, similar };
    },
  };
};
