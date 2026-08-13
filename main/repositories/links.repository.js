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

// 사용자가 입력한 검색어를 FTS5 MATCH 문법에 안전하게 넣기 위한 변환.
// 토큰마다 큰따옴표로 감싸고 뒤에 *를 붙여 "접두어 일치"로 검색한다(예: "회의"* "준" 준 처럼 앞부분만 쳐도 걸리게).
// 큰따옴표로 감싸두면 FTS5 예약 문자(-, :, ( 등)가 섞여 들어와도 구문 에러 없이 안전하게 리터럴로 처리된다.
function buildFtsPrefixQuery(raw) {
  const tokens = (raw || '')
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

// title이 비어있는 경우(memo/postit은 제목 없이 본문만 있을 수 있음) content로 대체하되,
// 검색 인덱스의 content는 저장된 HTML 그대로일 수 있어 태그를 벗겨서 짧게 자른다(정밀 파싱은 렌더러 몫).
function snippetLabel(row) {
  const title = (row.title || '').trim();
  if (title) return title;
  const plain = (row.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 60) || '(제목 없음)';
}

// 자동 관련 항목 발견 — 카테고리(태그)가 있는 4개 타입 전부(포스트잇도 category_id가 생겼음)
const CATEGORY_TABLES = { todo: 'todos', event: 'events', memo: 'memos', postit: 'postits' };

module.exports = function createLinksRepository(db) {
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

    deleteAllFor(type, id) {
      db.prepare(`DELETE FROM item_links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`).run(type, id, type, id);
    },

    // "@검색" 빠른 연결용 — search_index(FTS5)를 그대로 활용해 todo/event/memo/postit 전체에서
    // 접두어 일치로 후보를 찾는다. inbox는 연결 대상 타입이 아니므로 제외.
    // (소프트 삭제된 항목은 search_index 트리거가 이미 빼놨으므로 여기서 따로 필터링할 필요 없음)
    searchCandidates(keyword, excludeType, excludeId) {
      const ftsQuery = buildFtsPrefixQuery(keyword);
      if (!ftsQuery) return [];
      let rows;
      try {
        rows = db
          .prepare(
            `SELECT entity_type AS type, entity_id AS id, title, content
             FROM search_index
             WHERE search_index MATCH ? AND entity_type IN ('todo','event','memo','postit')
             ORDER BY rank
             LIMIT 20`
          )
          .all(ftsQuery);
      } catch (e) {
        return []; // 검색어에 FTS5가 못 씹는 문자가 섞여도(따옴표 escape 실패 등) 조용히 빈 결과만 반환
      }
      return rows
        .filter((r) => !(excludeType && excludeId != null && r.type === excludeType && Number(r.id) === Number(excludeId)))
        .slice(0, 8)
        .map((r) => ({ type: r.type, id: r.id, label: snippetLabel(r) }));
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

      // 2) 비슷한 내용 — 제목(또는 본문 대체 텍스트)에서 뽑은 키워드를 OR로 묶어 FTS 검색.
      //    빠른연결(searchCandidates)은 사용자가 타이핑한 걸 좁혀가는 AND 검색이지만,
      //    여긴 자동 추천이라 하나라도 겹치면 후보로 보이게 OR로 넓게 잡는다.
      const plainText = (preview.label || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const tokens = [...new Set(plainText.split(' ').filter((t) => t.length >= 2))].slice(0, 8);
      let similar = [];
      if (tokens.length) {
        const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
        try {
          const rows = db
            .prepare(
              `SELECT entity_type AS type, entity_id AS id, title, content
               FROM search_index
               WHERE search_index MATCH ? AND entity_type IN ('todo','event','memo','postit')
               ORDER BY rank
               LIMIT 20`
            )
            .all(ftsQuery);
          similar = rows
            .filter((r) => !alreadyLinked.has(`${r.type}:${r.id}`))
            .filter((r) => !sameCategory.some((sc) => sc.type === r.type && sc.id === r.id))
            .slice(0, 6)
            .map((r) => ({ type: r.type, id: r.id, label: snippetLabel(r) }));
        } catch (e) {
          similar = [];
        }
      }

      return { sameCategory, similar };
    },
  };
};
