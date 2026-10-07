// 앱 잠금 상태의 "메인 프로세스 쪽 사본". 잠금 화면 자체는 메인 창의 렌더러 오버레이라서,
// 그것만으로는 잠금 중에도 전역 단축키 빠른 찾기·당일 알림 팝업 같은 별도 창이 내용을 그대로 보여준다.
// 이 상태를 보고 그런 창들이 내용을 가리게 한다. 풀리는 건 main이 비밀번호를 직접 검증했을 때(auth:verify)뿐이다.
let locked = false;
const unlockListeners = [];

module.exports = {
  init(settings) {
    locked = !!settings.get('security_password_hash'); // 비밀번호가 있으면 앱은 잠긴 채로 시작
  },
  isLocked: () => locked,
  lock() {
    locked = true;
  },
  unlock() {
    if (!locked) return;
    locked = false;
    unlockListeners.forEach((fn) => fn());
  },
  onUnlock(fn) {
    unlockListeners.push(fn);
  },
};
