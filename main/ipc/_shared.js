/**
 * ipc/* 도메인 모듈들이 공통으로 쓰는 작은 헬퍼.
 * 이 파일 자체에는 ipcMain.handle을 등록하지 않는다 (등록은 각 도메인 파일의 책임).
 */

const TRASH_TABLES = {
  todo: 'todos',
  event: 'events',
  memo: 'memos',
  postit: 'postits',
};

// item_links가 다룰 수 있는 항목 타입. inbox는 링크 대상이지만 실제로는 markProcessed로만 연결된다.
const LINK_TYPES = ['todo', 'event', 'memo', 'postit', 'inbox'];

function assertNonEmpty(value, message) {
  if (!value || !String(value).trim()) throw new Error(message);
}

function assertLinkType(type) {
  if (!LINK_TYPES.includes(type)) throw new Error(`연결할 수 없는 항목 타입입니다: ${type}`);
}

// (a,b)와 (b,a)가 별개 행으로 중복 저장되는 걸 막기 위한 정규화.
// 타입 순서를 고정(LINK_TYPES 인덱스)하고, 같은 타입이면 id로 비교해서 항상 "작은 쪽"을 a로 둔다.
// 순수 함수 — test/links.test.js에서 단독 검증한다.
function canonicalizeLink(aType, aId, bType, bId) {
  assertLinkType(aType);
  assertLinkType(bType);
  if (aType === bType && Number(aId) === Number(bId)) {
    throw new Error('같은 항목끼리는 연결할 수 없습니다.');
  }
  const aRank = LINK_TYPES.indexOf(aType);
  const bRank = LINK_TYPES.indexOf(bType);
  const aFirst = aRank !== bRank ? aRank < bRank : Number(aId) < Number(bId);
  return aFirst
    ? { a_type: aType, a_id: Number(aId), b_type: bType, b_id: Number(bId) }
    : { a_type: bType, a_id: Number(bId), b_type: aType, b_id: Number(aId) };
}

/**
 * 항목을 새로 만든 직후 "따라붙는" 쓰기(연결 생성 / Inbox 처리표시)를 한다.
 * ⚠ 반드시 항목 insert와 같은 트랜잭션(repos.transaction) 안에서 호출해야 원자성이 보장된다 —
 *   전환/캡처 도중 실패 시 "연결 없는 고아 항목"이나 "안 지워진 Inbox 항목"이 남지 않게.
 *
 * @param {'todo'|'event'|'memo'|'postit'} selfType 방금 만든 항목의 타입
 * @param {number} selfId 방금 만든 항목의 id
 * @param {{ link?: {type:string, id:number}, fromInbox?: number }} opts
 */
function linkNewItem(repos, selfType, selfId, { link, fromInbox } = {}) {
  if (link && link.id != null) {
    repos.links.insertIgnore(canonicalizeLink(selfType, Number(selfId), link.type, Number(link.id)));
  }
  if (fromInbox != null) {
    repos.inbox.markProcessed({ id: Number(fromInbox), type: selfType, refId: Number(selfId) });
  }
}

module.exports = { TRASH_TABLES, LINK_TYPES, assertNonEmpty, assertLinkType, canonicalizeLink, linkNewItem };
