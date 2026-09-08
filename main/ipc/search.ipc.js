// 통합검색 IPC. 검색어 정규화·랭킹·초성 매칭은 repos.search가 담당한다(search.repository.js).

// 직접 일치 결과들과 "연결/같은 태그로 이어진" 항목을 모은다 (목업의 "관련 항목" 섹션).
// direct에 이미 있는 항목·중복은 제외. 상위 몇 건의 직접일치만 훑어서 과하지 않게.
function relatedFor(repos, direct, cap = 10) {
  const seen = new Set(direct.map((h) => `${h.entity_type}:${h.entity_id}`));
  const out = [];
  for (const h of direct.slice(0, 6)) {
    if (out.length >= cap) break;
    // 1) 직접 연결된 항목 (item_links) — 휴지통/고아 제외
    for (const l of repos.links.listForWithPreview(h.entity_type, h.entity_id)) {
      const key = `${l.type}:${l.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ entity_type: l.type, entity_id: l.id, title: l.label || '', content: '', relatedReason: 'link', via: h.title || '' });
    }
    // 2) 관련 항목(같은 태그·날짜·키워드로 이어진 것)
    let disc;
    try {
      disc = repos.links.discoverRelated(h.entity_type, h.entity_id);
    } catch (e) {
      disc = { related: [] };
    }
    for (const rel of disc.related || []) {
      const key = `${rel.type}:${rel.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tagReason = (rel.reasons || []).find((r) => r.kind === 'tag');
      out.push({
        entity_type: rel.type,
        entity_id: rel.id,
        title: rel.label || '',
        content: '',
        relatedReason: tagReason ? 'tag' : 'related',
        tagName: tagReason ? tagReason.tagName : '',
      });
    }
  }
  return out.slice(0, cap);
}

const OPENED_KEY = 'search_opened';
const OPENED_MAX = 20;

function registerSearchIpc(ipcMain, repos) {
  ipcMain.handle('search:recentItems', () => repos.search.recentItems(8));

  // 항목을 "열었다"고 기록 — 라우터가 #/type/id 로 이동할 때마다 호출. 최근 20개, 같은 항목은 앞으로.
  ipcMain.handle('search:recordOpen', (event, { type, id } = {}) => {
    if (!['todo', 'event', 'memo', 'postit', 'inbox'].includes(type) || !id) return { ok: false };
    let list = [];
    try {
      list = JSON.parse(repos.settings.get(OPENED_KEY) || '[]');
    } catch (e) {
      list = [];
    }
    const key = `${type}:${Number(id)}`;
    list = [{ type, id: Number(id) }, ...list.filter((e) => `${e.type}:${e.id}` !== key)].slice(0, OPENED_MAX);
    repos.settings.set(OPENED_KEY, JSON.stringify(list));
    return { ok: true };
  });

  // 최근 연 항목 (완전삭제/휴지통 간 것은 search_index에 없어 자동 제외)
  ipcMain.handle('search:recentOpened', () => {
    let list = [];
    try {
      list = JSON.parse(repos.settings.get(OPENED_KEY) || '[]');
    } catch (e) {
      return [];
    }
    return repos.search.indexedByKeys(Array.isArray(list) ? list.slice(0, 12) : []);
  });

  ipcMain.handle('search:query', (event, arg) => {
    // 하위호환: 예전엔 검색어 문자열만 넘겼음.
    // 지금은 { query, type|types, tag, limit, offset, sort, dateFrom, dateTo, status, related, paged }도 받는다.
    const { query, type, types, tag, limit, offset, sort, dateFrom, dateTo, status, related, paged } =
      typeof arg === 'string' ? { query: arg } : arg || {};
    const typeList = type ? [type] : types;

    // 통합검색 화면(paged): { items, total, typeCounts } — 검색어 없으면 빈 결과.
    if (paged) {
      if (!query || !String(query).trim()) return { items: [], total: 0, typeCounts: {} };
      return repos.search.searchPaged(query, { types: typeList, tag, limit, offset, sort, dateFrom, dateTo, status });
    }

    if (!query || !String(query).trim()) {
      // 검색어 없이 타입/태그 프리픽스만 왔으면 그 범위의 최근 목록을 준다("메모 ", "#재활").
      if ((type || tag) && !related) return repos.search.browse({ type, tag, limit });
      return related ? { direct: [], related: [] } : [];
    }
    const direct = repos.search.query(query, { types: typeList, tag, limit, offset, sort, dateFrom, dateTo, status });
    if (!related) return direct; // 기본: 예전과 동일하게 평평한 배열
    return { direct, related: relatedFor(repos, direct) };
  });
}

module.exports = registerSearchIpc;
module.exports.relatedFor = relatedFor; // test/search-related.test.js
