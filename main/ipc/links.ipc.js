const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

const VALID_TYPES = ['todo', 'event', 'memo', 'postit', 'inbox'];

function assertValidType(type) {
  if (!VALID_TYPES.includes(type)) throw new Error(`연결할 수 없는 항목 타입입니다: ${type}`);
}

// (a,b)와 (b,a)가 별개 행으로 중복 저장되는 걸 막기 위한 정규화.
// 타입 순서를 고정(VALID_TYPES 인덱스)하고, 같은 타입이면 id로 비교해서 항상 "작은 쪽"을 a로 둔다.
function canonicalizeLink(aType, aId, bType, bId) {
  assertValidType(aType);
  assertValidType(bType);
  if (aType === bType && Number(aId) === Number(bId)) {
    throw new Error('같은 항목끼리는 연결할 수 없습니다.');
  }
  const aRank = VALID_TYPES.indexOf(aType);
  const bRank = VALID_TYPES.indexOf(bType);
  const aFirst = aRank !== bRank ? aRank < bRank : Number(aId) < Number(bId);
  return aFirst
    ? { a_type: aType, a_id: Number(aId), b_type: bType, b_id: Number(bId) }
    : { a_type: bType, a_id: Number(bId), b_type: aType, b_id: Number(aId) };
}

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
  ipcMain.handle('links:listFor', (event, { type, id }) => {
    assertValidType(type);
    const rows = links.listRawFor(type, id);

    return rows
      .map((r) => {
        const isA = r.a_type === type && r.a_id === id;
        const otherType = isA ? r.b_type : r.a_type;
        const otherId = isA ? r.b_id : r.a_id;
        const preview = links.getPreview(otherType, otherId);
        if (!preview) return null; // 상대 항목이 아예 삭제(완전삭제)된 경우 — 고아 연결이므로 목록에서 제외
        return { type: otherType, ...preview };
      })
      .filter(Boolean);
  });

  // "@검색" 빠른 연결 — 메모/포스트잇 본문에서 @를 입력하면 이 핸들러로 후보를 찾는다.
  ipcMain.handle('links:search', (event, { keyword, excludeType, excludeId }) => {
    if (!keyword || !keyword.trim()) return [];
    return links.searchCandidates(keyword.trim(), excludeType, excludeId ?? null);
  });

  // 자동 관련 항목 발견 — 사용자가 연결을 직접 지정하지 않아도 같은 카테고리/비슷한 내용의 항목을 추천한다.
  ipcMain.handle('links:discover', (event, { type, id }) => {
    assertValidType(type);
    return links.discoverRelated(type, Number(id));
  });

  // 특정 항목이 완전 삭제될 때(trash:permanentlyDelete) 그 항목이 걸려있는 연결도 같이 정리하기 위한 내부 헬퍼.
  function deleteLinksFor(type, id) {
    links.deleteAllFor(type, id);
  }

  return { deleteLinksFor };
};
