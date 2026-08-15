/**
 * main/trash-cleanup/index.js
 *
 * 휴지통 30일 자동 삭제 — 다른 기능과 결합하지 않는 독립 모듈(updater/tray와 동일 원칙).
 * main.js는 initTrashCleanup() 한 줄만 호출한다.
 *
 * deleted_at은 항상 'YYYY-MM-DD HH:MM:SS' 로컬시간 문자열(datetime('now','localtime'))로
 * 저장되므로, Date 객체로 재파싱하는 대신 같은 포맷의 문자열을 만들어 사전식 비교한다
 * (타임존 재해석 실수를 원천적으로 피함).
 */
const RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 트레이 상주로 며칠씩 켜둘 수 있어 하루 주기로 재점검

function cutoffString(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sweep(trash, purgeOne) {
  const cutoff = cutoffString(RETENTION_DAYS);
  const expired = trash.listTrashed().filter((item) => item.deleted_at < cutoff);
  expired.forEach((item) => {
    try {
      purgeOne(item.type, item.id);
    } catch (err) {
      console.error('[itda] 휴지통 자동 삭제 실패:', item.type, item.id, err);
    }
  });
  if (expired.length) {
    console.log(`[itda] 휴지통 자동 정리: ${RETENTION_DAYS}일 경과 ${expired.length}개 항목 영구 삭제`);
  }
}

function initTrashCleanup(trash, purgeOne) {
  sweep(trash, purgeOne); // 시작 시 1회
  setInterval(() => sweep(trash, purgeOne), SWEEP_INTERVAL_MS);
}

module.exports = { initTrashCleanup, RETENTION_DAYS };
