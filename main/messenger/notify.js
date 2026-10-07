/**
 * 메신저 자동 불러오기가 "확인 필요"로 멈췄을 때 알려주는 문구와 중복 방지 키.
 * 환자·일정 제목은 알림창에 그대로 뜨면 곤란하니(잠금 화면·화면 공유) 건수만 쓴다.
 */
function pendingNotice(pending) {
  const deletes = (pending && pending.deletes) || [];
  const vanished = (pending && pending.vanished) || [];
  if (!deletes.length && !vanished.length) return null;
  const parts = [];
  if (deletes.length) parts.push(`지울 일정 ${deletes.length}건`);
  if (vanished.length) parts.push(`메신저에서 사라진 항목 ${vanished.length}건`);
  // 같은 대상이 계속 남아 있어도 알림은 한 번만 — 대상이 바뀌면 다시 알린다
  const key = [...deletes.map((d) => `d:${d.key}`), ...vanished.map((v) => `v:${v.source}:${v.ext_id}`)].sort().join('|');
  return { title: '메신저 불러오기 — 확인이 필요해요', body: `${parts.join(' · ')}. 잇다 설정 > 메신저 연동에서 확인해주세요.`, key };
}

module.exports = { pendingNotice };
