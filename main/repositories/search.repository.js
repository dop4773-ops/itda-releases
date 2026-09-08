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

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

function snippetLabel(row) {
  const title = (row.title || '').trim();
  if (title) return title;
  return stripTags(row.content).slice(0, 60) || '(제목 없음)';
}

// 본문에서 검색어 근처 ~90자를 잘라 미리보기 문구를 만든다(결과 구분용). 매치가 없으면 앞부분.
function makeSnippet(content, tokens) {
  const plain = stripTags(content);
  if (!plain) return '';
  const lc = plain.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const i = lc.indexOf(t.toLowerCase());
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return plain.slice(0, 90) + (plain.length > 90 ? '…' : '');
  const start = Math.max(0, idx - 30);
  const end = Math.min(plain.length, start + 90);
  return (start > 0 ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '');
}

// "최신도" 가산 — 같은 매치 품질(_rank) 안에서 최근에 고친 항목을 위로.
function recencyBoost(updatedAt) {
  if (!updatedAt) return 0;
  const days = (Date.now() - new Date(String(updatedAt).replace(' ', 'T')).getTime()) / 86400000;
  if (!(days >= 0)) return 0;
  if (days < 2) return 3;
  if (days < 14) return 2;
  if (days < 60) return 1;
  return 0;
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

// 태그(카테고리) 필터 — search_index엔 category_id가 없어 원본 테이블에서 후처리로 좁힌다.
// 태그명은 대소문자 무관. inbox엔 태그가 없어 태그 필터가 걸리면 통째로 빠진다.
function applyTagFilter(db, rows, tagName) {
  if (!tagName) return rows;
  const cat = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(String(tagName));
  if (!cat) return [];
  const byType = {};
  rows.forEach((r) => {
    (byType[r.entity_type] = byType[r.entity_type] || []).push(r.entity_id);
  });
  const ok = new Set();
  for (const [t, ids] of Object.entries(byType)) {
    const tbl = META_TABLE[t];
    if (!tbl || t === 'inbox') continue;
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT id FROM ${tbl} WHERE category_id = ? AND id IN (${ph})`)
      .all(cat.id, ...ids)
      .forEach((x) => ok.add(`${t}:${x.id}`));
  }
  return rows.filter((r) => ok.has(`${r.entity_type}:${r.entity_id}`));
}

// 검색 결과의 일정(event) 행에 start_at/all_day를 붙인다 — UI가 목록에서 "9/10 (수)"처럼 표시.
function attachEventMeta(db, rows) {
  const ids = rows.filter((r) => r.entity_type === 'event').map((r) => r.entity_id);
  if (!ids.length) return rows;
  const ph = ids.map(() => '?').join(',');
  const meta = {};
  db.prepare(`SELECT id, start_at, all_day FROM events WHERE id IN (${ph})`)
    .all(...ids)
    .forEach((x) => {
      meta[x.id] = { eventStart: x.start_at, eventAllDay: !!x.all_day };
    });
  rows.forEach((r) => {
    if (r.entity_type === 'event' && meta[r.entity_id]) Object.assign(r, meta[r.entity_id]);
  });
  return rows;
}

module.exports = function createSearchRepository(db) {
  const repo = {
    // 통합검색. 랭킹: 제목 정확 > 제목 시작 > 제목 포함 > 초성(제목) > 본문 포함.
    // 반환: [{ entity_type, entity_id, title, content, matchedIn: 'title'|'chosung'|'content' }]
    // (entity_type/entity_id 이름은 예전 FTS 결과와 동일 — 기존 소비자 호환)
    // dateFrom/dateTo('YYYY-MM-DD') · status('done'|'open') · tag(카테고리명)는 원본 테이블 조회로 후처리 필터.
    query(rawQuery, { types = null, tag = null, limit = 40, dateFrom = null, dateTo = null, status = null } = {}) {
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
          `SELECT entity_type, entity_id, title, content, chosung, updated_at
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
        return {
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          title: r.title,
          content: r.content,
          matchedIn,
          snippet: matchedIn === 'content' ? makeSnippet(r.content, tokens) : '',
          _rank: rank,
          _recency: recencyBoost(r.updated_at),
        };
      });
      // 매치 품질(_rank)이 먼저 — 그 안에서 최근에 고친 것 위로 → 제목 짧은 것 순.
      scored.sort((a, b) => a._rank - b._rank || b._recency - a._recency || (a.title || '').length - (b.title || '').length);
      let filtered = applyMetaFilters(db, scored, { dateFrom, dateTo, status });
      filtered = applyTagFilter(db, filtered, tag);
      return attachEventMeta(db, filtered.slice(0, limit).map(({ _rank, _recency, ...rest }) => rest));
    },

    // 검색어 없이 타입/태그 프리픽스만 입력했을 때("메모 ", "#재활") — 그 범위의 최근 항목을 나열.
    browse({ type = null, tag = null, limit = 20 } = {}) {
      const types = type ? [type] : ['todo', 'event', 'memo', 'postit'];
      const catId = tag
        ? (db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(String(tag)) || {}).id
        : null;
      if (tag && !catId) return [];
      const rows = [];
      for (const t of types) {
        const tbl = META_TABLE[t];
        if (!tbl || t === 'inbox') continue;
        const titleExpr = t === 'memo' || t === 'postit' ? "coalesce(nullif(title,''), substr(content,1,120))" : 'title';
        let sql = `SELECT '${t}' AS entity_type, id AS entity_id, ${titleExpr} AS title, updated_at
                   FROM ${tbl} WHERE deleted_at IS NULL`;
        const params = [];
        if (catId) {
          sql += ' AND category_id = ?';
          params.push(catId);
        }
        sql += ' ORDER BY updated_at DESC LIMIT ?';
        params.push(limit);
        rows.push(...db.prepare(sql).all(...params));
      }
      rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      return attachEventMeta(
        db,
        rows.slice(0, limit).map((r) => ({
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          title: r.title || '',
          content: '',
          snippet: '',
          matchedIn: 'title',
        }))
      );
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

    // [{type,id}] 목록을 search_index에서 조회(살아있는 것만, 입력 순서 유지). "최근 연 항목"용.
    indexedByKeys(keys) {
      if (!Array.isArray(keys) || !keys.length) return [];
      const stmt = db.prepare('SELECT entity_type, entity_id, title, content FROM search_index WHERE entity_type = ? AND entity_id = ?');
      const out = [];
      const seen = new Set();
      for (const k of keys) {
        const key = `${k.type}:${k.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = stmt.get(String(k.type), Number(k.id));
        if (r) out.push({ entity_type: r.entity_type, entity_id: r.entity_id, title: r.title, content: r.content });
      }
      return attachEventMeta(db, out);
    },

    // 검색 시작화면의 "최근 항목" — todo/event/memo/postit을 updated_at 최신순으로 섞어서.
    recentItems(limit = 8) {
      const per = Math.max(limit, 6);
      const pull = (type, table, titleExpr) =>
        db
          .prepare(
            `SELECT '${type}' AS entity_type, id AS entity_id, ${titleExpr} AS title, updated_at
             FROM ${table} WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`
          )
          .all(per);
      const rows = [
        ...pull('todo', 'todos', 'title'),
        ...pull('event', 'events', 'title'),
        ...pull('memo', 'memos', "coalesce(nullif(title,''), substr(content,1,120))"),
        ...pull('postit', 'postits', "coalesce(nullif(title,''), substr(content,1,120))"),
      ];
      rows.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      return attachEventMeta(
        db,
        rows.slice(0, limit).map((r) => ({ entity_type: r.entity_type, entity_id: r.entity_id, title: r.title || '', content: '' }))
      );
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
