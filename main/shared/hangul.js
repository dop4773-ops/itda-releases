/**
 * main/shared/hangul.js — 초성(첫 자음) 검색용 한글 유틸.
 * SQLite에 db.function('chosung', ...)로 등록해서 트리거/쿼리에서도 쓴다(main/db.js).
 */

// 현대 한글 초성 19자 (유니코드 조합형 순서)
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// "홍길동 평가" → "ㅎㄱㄷ ㅍㄱ". 완성형 한글은 초성으로, 그 외(공백/영문/숫자/이미 자음)는 그대로 둔다.
function chosung(str) {
  let out = '';
  for (const ch of String(str || '')) {
    const code = ch.codePointAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

// 검색어가 "초성만"으로 이뤄졌는지 (ㅎㄱㄷ 처럼) — 이럴 때만 chosung 컬럼을 함께 뒤진다.
// 공백은 허용, 완성형 한글이나 다른 문자가 섞이면 일반 검색으로 취급.
function isChosungQuery(str) {
  const s = String(str || '').replace(/\s+/g, '');
  return s.length > 0 && /^[ㄱ-ㅎ]+$/.test(s);
}

module.exports = { chosung, isChosungQuery };
