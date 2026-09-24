/**
 * main/shared/search-text.js — 통합검색·"@빠른연결"·관련항목 추천이 공유하는 텍스트 매칭 로직.
 * search_index가 일반 테이블(LIKE 스캔)로 바뀌면서, FTS5 MATCH 문법 대신 여기로 통일한다.
 */

// 검색어 정규화 — 공백 정리 + 아주 흔한 꼬리말만 제거. 공격적인 자동보정은 안 한다.
function normalizeQuery(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  s = s.replace(/(.)님$/, '$1'); // "홍길동님" → "홍길동"
  s = s.replace(/\s+(환자|선생님)$/, ''); // "홍길동 환자" → "홍길동"
  return s.trim();
}

// "홍 길동" 처럼 공백이 있으면 [토큰들, 공백제거형] 둘 다 후보로 본다.
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

// 레벤슈타인 편집거리 — 오타 보정 폴백 전용(정확 매치가 0건일 때만 씀). 외부 라이브러리 없이도
// 표준 DP 한 함수면 충분해서 별도 의존성 추가 안 함.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// 오타로 봐줄 최대 편집거리 — 검색어가 짧으면 1글자, 길면 2글자까지 다른 것도 후보로 인정.
function typoThreshold(len) {
  return len <= 6 ? 1 : 2;
}

// 제목/본문에서 오타 후보 단어를 뽑는다 — 한글/영문/숫자가 아닌 문자(공백, 문장부호 등) 기준으로 쪼갬.
function wordsOf(text) {
  return String(text || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

module.exports = { normalizeQuery, queryForms, columnLike, levenshtein, typoThreshold, wordsOf };
