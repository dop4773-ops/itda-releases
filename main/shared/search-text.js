/**
 * main/shared/search-text.js — 통합검색·"@빠른연결"·관련항목 추천이 공유하는 텍스트 매칭 로직.
 * search_index가 일반 테이블(LIKE 스캔)로 바뀌면서, FTS5 MATCH 문법 대신 여기로 통일한다.
 */

// 검색어 정규화 — 공백 정리 + 아주 흔한 꼬리말만 제거. 공격적인 자동보정은 안 한다.
function normalizeQuery(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/(.)님$/, '$1'); // "김부수님" → "김부수"
  s = s.replace(/\s+(환자|선생님)$/, ''); // "김부수 환자" → "김부수"
  return s.trim();
}

// "김 부수" 처럼 공백이 있으면 [토큰들, 공백제거형] 둘 다 후보로 본다.
function queryForms(normalized) {
  const tokens = normalized.split(' ').filter(Boolean);
  const flat = normalized.replace(/\s+/g, '');
  return { tokens, flat };
}

// 한 컬럼에 대해 "모든 토큰이 들어있음(AND)" + "공백제거형이 들어있음" 조건을 만든다.
// 반환: { sql: '(col LIKE ? AND col LIKE ? ) OR col LIKE ?', params: [...] }
function columnLike(col, tokens, flat) {
  const parts = tokens.map(() => `${col} LIKE ? COLLATE NOCASE`);
  const params = tokens.map((t) => `%${t}%`);
  parts.push(`${col} LIKE ? COLLATE NOCASE`);
  params.push(`%${flat}%`);
  // (t1 AND t2 ...) OR flat
  const andPart = tokens.length ? `(${parts.slice(0, tokens.length).join(' AND ')})` : '0';
  return { sql: `(${andPart} OR ${parts[parts.length - 1]})`, params };
}

module.exports = { normalizeQuery, queryForms, columnLike };
