// 통합검색 IPC. 검색어 정규화·랭킹·초성 매칭은 전부 repos.search가 담당한다(search.repository.js).
module.exports = function registerSearchIpc(ipcMain, repos) {
  ipcMain.handle('search:query', (event, arg) => {
    // 하위호환: 예전엔 검색어 문자열만 넘겼음. 지금은 { query, types, limit }도 받는다.
    const { query, types, limit } = typeof arg === 'string' ? { query: arg } : arg || {};
    if (!query || !String(query).trim()) return [];
    return repos.search.query(query, { types, limit });
  });
};
