const { isChosungQuery } = require('../shared/hangul');
const { normalizeQuery, queryForms, columnLike } = require('../shared/search-text');

const ALL_TYPES = ['todo', 'event', 'memo', 'postit', 'inbox'];

function snippetLabel(row) {
  const title = (row.title || '').trim();
  if (title) return title;
  const plain = (row.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 60) || '(제목 없음)';
}

module.exports = function createSearchRepository(db) {
  const repo = {
    // 통합검색. 랭킹: 제목 정확 > 제목 시작 > 제목 포함 > 초성(제목) > 본문 포함.
    // 반환: [{ entity_type, entity_id, title, content, matchedIn: 'title'|'chosung'|'content' }]
    // (entity_type/entity_id 이름은 예전 FTS 결과와 동일 — 기존 소비자 호환)
    query(rawQuery, { types = null, limit = 40 } = {}) {
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
      return scored.slice(0, limit).map(({ _rank, ...rest }) => rest);
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
