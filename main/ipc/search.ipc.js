// 사용자가 입력한 자유 텍스트를 FTS5 MATCH 쿼리 문법으로 그대로 넘기면
// 공백(다중 단어), 큰따옴표, 괄호, AND/OR/NOT 같은 예약어에서 문법 오류가 난다.
// 각 토큰을 큰따옴표로 감싸서 "리터럴 구문"으로 취급되게 하고(내부 큰따옴표는 ""로 이스케이프),
// 접두 검색을 위해 토큰 뒤에 *를 붙인 뒤 AND로 연결한다.
// 예: 'AND (김OO)' -> '"AND"* AND "(김OO)"*'  — 전부 리터럴 취급되어 문법 오류가 안 남.
function buildFtsMatchQuery(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
}

module.exports = function registerSearchIpc(ipcMain, repos) {
  const { search } = repos;

  ipcMain.handle('search:query', (event, keyword) => {
    if (!keyword || !keyword.trim()) return [];
    const ftsQuery = buildFtsMatchQuery(keyword);
    if (!ftsQuery) return [];
    return search.query(ftsQuery);
  });
};
