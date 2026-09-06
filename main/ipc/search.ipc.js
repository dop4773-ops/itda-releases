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
    // 2) 같은 카테고리(태그) 항목
    let disc;
    try {
      disc = repos.links.discoverRelated(h.entity_type, h.entity_id);
    } catch (e) {
      disc = { sameCategory: [] };
    }
    for (const sc of disc.sameCategory || []) {
      const key = `${sc.type}:${sc.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ entity_type: sc.type, entity_id: sc.id, title: sc.label || '', content: '', relatedReason: 'tag', tagName: sc.tagName || '' });
    }
  }
  return out.slice(0, cap);
}

function registerSearchIpc(ipcMain, repos) {
  ipcMain.handle('search:recentItems', () => repos.search.recentItems(8));

  ipcMain.handle('search:query', (event, arg) => {
    // 하위호환: 예전엔 검색어 문자열만 넘겼음.
    // 지금은 { query, types, limit, dateFrom, dateTo, status, related }도 받는다.
    const { query, types, limit, dateFrom, dateTo, status, related } =
      typeof arg === 'string' ? { query: arg } : arg || {};
    if (!query || !String(query).trim()) return related ? { direct: [], related: [] } : [];
    const direct = repos.search.query(query, { types, limit, dateFrom, dateTo, status });
    if (!related) return direct; // 기본: 예전과 동일하게 평평한 배열
    return { direct, related: relatedFor(repos, direct) };
  });
}

module.exports = registerSearchIpc;
module.exports.relatedFor = relatedFor; // test/search-related.test.js
