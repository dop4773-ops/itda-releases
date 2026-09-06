const { isChosungQuery } = require('../shared/hangul');
const { normalizeQuery, queryForms, columnLike } = require('../shared/search-text');

const ALL_TYPES = ['todo', 'event', 'memo', 'postit', 'inbox'];

// 기간/상태 필터가 참조하는 "대표 날짜" 컬럼 — search_index엔 날짜가 없어 원본 테이블에서 가져온다.
const META_TABLE = { todo: 'todos', event: 'events', memo: 'memos', postit: 'postits', inbox: 'inbox_items' };
const META_DATE = {
  todo: 'due_date',
  event: "substr(start_at,1,10)",
  memo: "substr(created_at,1,10)",
  postit: "substr(created_at,1,10)",
  inbox: "substr(created_at,1,10)",
};

function snippetLabel(row) {
  const title = (row.title || '').trim();
  if (title) return title;
  const plain = (row.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 60) || '(제목 없음)';
}

// 검색 결과에 기간(dateFrom/dateTo, 'YYYY-MM-DD')·상태(status: 'done'|'open') 필터를 적용.
// 날짜가 없는 항목(기한 없는 Todo 등)은 기간 필터가 걸리면 제외. 상태는 Todo에만.
function applyMetaFilters(db, rows, { dateFrom, dateTo, status }) {
  if (!dateFrom && !dateTo && !status) return rows;
  const byType = {};
  rows.forEach((r) => {
    (byType[r.entity_type] = byType[r.entity_type] || []).push(r.entity_id);
  });
  const meta = {};
  for (const [t, ids] of Object.entries(byType)) {
    if (!META_TABLE[t]) continue;
    const ph = ids.map(() => '?').join(',');
    const extra = t === 'todo' ? ', is_done' : '';
    db.prepare(`SELECT id, ${META_DATE[t]} AS d${extra} FROM ${META_TABLE[t]} WHERE id IN (${ph})`)
      .all(...ids)
      .forEach((x) => {
        meta[`${t}:${x.id}`] = { date: x.d || null, isDone: t === 'todo' ? !!x.is_done : null };
      });
  }
  return rows.filter((r) => {
    const m = meta[`${r.entity_type}:${r.entity_id}`] || {};
    if (dateFrom || dateTo) {
      if (!m.date) return false;
      if (dateFrom && m.date < dateFrom) return false;
      if (dateTo && m.date > dateTo) return false;
    }
    if (status && r.entity_type === 'todo') {
      if (status === 'done' && !m.isDone) return false;
      if (status === 'open' && m.isDone) return false;
    }
    return true;
  });
}

module.exports = function createSearchRepository(db) {
  const repo = {
    // 통합검색. 랭킹: 제목 정확 > 제목 시작 > 제목 포함 > 초성(제목) > 본문 포함.
    // 반환: [{ entity_type, entity_id, title, content, matchedIn: 'title'|'chosung'|'content' }]
    // (entity_type/entity_id 이름은 예전 FTS 결과와 동일 — 기존 소비자 호환)
    // dateFrom/dateTo('YYYY-MM-DD') · status('done'|'open')는 원본 테이블 조회로 후처리 필터.
    query(rawQuery, { types = null, limit = 40, dateFrom = null, dateTo = null, status = null } = {}) {
      const q = normalizeQuery(rawQuery);
      if (!q) return [];
      const { tokens, flat } = queryForms(q);
      const useChosung = isChosungQuery(q);

      const titleC = columnLike('title', tokens, flat);
      const contentC = columnLike('content', tokens, flat);
      const clauses = [titleC.sql, contentC.sql];
      const params = [...titleC.params, ...contentC.params];
      if (useChosung) {
        clauses.push('chosung LIKE ?');
        params.push(`%${flat}%`);
      }

      let typeClause = '';
      const valid = Array.isArray(types) ? types.filter((t) => ALL_TYPES.includes(t)) : [];
      if (valid.length) {
        typeClause = ` AND entity_type IN (${valid.map(() => '?').join(',')})`;
        params.push(...valid);
      }

      const rows = db
        .prepare(
          `SELECT entity_type, entity_id, title, content, chosung
           FROM search_index
           WHERE (${clauses.join(' OR ')})${typeClause}`
        )
        .all(...params);

      // 랭크/일치이유는 JS에서 계산(SQL CASE로 짜면 파라미터가 폭증). 결과가 수십 건 수준이라 부담 없음.
      const qLower = q.toLowerCase();
      const flatLower = flat.toLowerCase();
      const scored = rows.map((r) => {
        const t = (r.title || '').toLowerCase();
        let rank;
        let matchedIn;
        if (t && (t === qLower || t === flatLower)) {
          rank = 0;
          matchedIn = 'title';
        } else if (t && (t.startsWith(flatLower) || t.startsWith(qLower))) {
          rank = 1;
          matchedIn = 'title';
        } else if (t && (t.includes(flatLower) || tokens.every((tok) => t.includes(tok.toLowerCase())))) {
          rank = 2;
          matchedIn = 'title';
        } else if (useChosung && (r.chosung || '').includes(flatLower)) {
          rank = 3;
          matchedIn = 'chosung';
        } else {
          rank = 4;
          matchedIn = 'content';
        }
        return { entity_type: r.entity_type, entity_id: r.entity_id, title: r.title, content: r.content, matchedIn, _rank: rank };
      });
      scored.sort((a, b) => a._rank - b._rank || (a.title || '').length - (b.title || '').length);
      const filtered = applyMetaFilters(db, scored, { dateFrom, dateTo, status });
      return filtered.slice(0, limit).map(({ _rank, ...rest }) => rest);
    },

    // "@검색" 빠른 연결 후보 (inbox 제외, 상위 8건) — 예전 links.repository.searchCandidates.
    candidates(rawQuery, excludeType, excludeId) {
      return repo
        .query(rawQuery, { types: ['todo', 'event', 'memo', 'postit'], limit: 20 })
        .filter(
          (h) => !(excludeType && excludeId != null && h.entity_type === excludeType && Number(h.entity_id) === Number(excludeId))
        )
        .slice(0, 8)
        .map((h) => ({ type: h.entity_type, id: h.entity_id, label: snippetLabel(h) }));
    },

    // discoverRelated "비슷한 내용" — 키워드 여러 개를 넓게(OR) 훑는다.
    similarTo(keywords, excludeKeys = new Set()) {
      const toks = [...new Set((keywords || []).filter((k) => k && k.length >= 2))].slice(0, 8);
      if (!toks.length) return [];
      const where = toks.map(() => '(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)').join(' OR ');
      const params = toks.flatMap((t) => [`%${t}%`, `%${t}%`]);
      return db
        .prepare(
          `SELECT entity_type AS type, entity_id AS id, title, content FROM search_index
           WHERE (${where}) AND entity_type IN ('todo','event','memo','postit') LIMIT 30`
        )
        .all(...params)
        .filter((r) => !excludeKeys.has(`${r.type}:${r.id}`));
    },
  };
  return repo;
};

module.exports.snippetLabel = snippetLabel;
