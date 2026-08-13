/**
 * Esc 키로 "지금 열려있는 걸 닫는다"는 동작을 앱 전체에서 통일하기 위한 헬퍼.
 * isOpen()이 true일 때만 Esc에 반응해서 onClose()를 호출한다 — 아무것도 안 열려있으면
 * Esc를 눌러도 다른 동작(라우팅 등)을 방해하지 않는다.
 *
 * @param {() => boolean} isOpen - 지금 이 패널/모달이 열려있는지
 * @param {() => void} onClose - 닫는 동작
 * @returns {() => void} unsubscribe
 */
export function registerEscClose(isOpen, onClose) {
  const handler = (e) => {
    if (e.key === 'Escape' && isOpen()) onClose();
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
