const { assertNonEmpty, assertLinkType, canonicalizeLink } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

module.exports = function registerLinksIpc(ipcMain, repos) {
  const { links } = repos;

  ipcMain.handle('links:add', (event, { aType, aId, bType, bId }) => {
    assertNonEmpty(aType, '연결할 항목 타입이 필요합니다.');
    assertNonEmpty(bType, '연결할 항목 타입이 필요합니다.');
    const link = canonicalizeLink(aType, aId, bType, bId);
    // 이미 같은 연결이 있으면(UNIQUE 제약) 조용히 기존 것을 반환 — 중복 연결 시도를 에러로 취급하지 않음
    links.insertIgnore(link);
    broadcastDataChanged('link');
    return links.find(link);
  });

  ipcMain.handle('links:remove', (event, { aType, aId, bType, bId }) => {
    const link = canonicalizeLink(aType, aId, bType, bId);
    links.remove(link);
    broadcastDataChanged('link');
    return { ok: true };
  });

  // type/id를 가진 항목 기준으로, 연결된 "상대방" 목록을 미리보기 정보와 함께 반환한다.
  // (휴지통에 간 상대도 그대로 보여준다 — 링크 위젯의 기존 동작 유지. 완전삭제된 고아만 제외)
  ipcMain.handle('links:listFor', (event, { type, id }) => {
    assertLinkType(type);
    return links.listForWithPreview(type, id, { includeTrashed: true });
  });

  // 목록 화면 배지용 — 여러 항목의 "연결된 종류"를 한 번의 IPC/쿼리로. { id: ['todo','event'] }
  ipcMain.handle('links:kindsFor', (event, { type, ids }) => {
    assertLinkType(type);
    const map = links.kindsForMany(type, (ids || []).map(Number));
    return Object.fromEntries(Object.entries(map).map(([k, set]) => [k, [...set]]));
  });

  // "@검색" 빠른 연결 — 메모/포스트잇 본문에서 @를 입력하면 이 핸들러로 후보를 찾는다.
  ipcMain.handle('links:search', (event, { keyword, excludeType, excludeId }) => {
    if (!keyword || !keyword.trim()) return [];
    return links.searchCandidates(keyword.trim(), excludeType, excludeId ?? null);
  });

  // 자동 관련 항목 발견 — 사용자가 연결을 직접 지정하지 않아도 같은 카테고리/비슷한 내용의 항목을 추천한다.
  ipcMain.handle('links:discover', (event, { type, id }) => {
    assertLinkType(type);
    return links.discoverRelated(type, Number(id));
  });

  // 특정 항목이 완전 삭제될 때(trash:permanentlyDelete) 그 항목이 걸려있는 연결도 같이 정리하기 위한 내부 헬퍼.
  function deleteLinksFor(type, id) {
    links.deleteAllFor(type, id);
  }

  return { deleteLinksFor };
};
