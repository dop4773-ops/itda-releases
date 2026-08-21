/**
 * renderer/shared/pending-saves.js
 *
 * 메모/포스트잇/태그/설정 등 여러 화면이 똑같이 쓰는 "타이핑 후 500ms 디바운스 자동저장"
 * 타이머들을 한곳에 등록해두고, 자동 업데이트 설치처럼 앱이 예고 없이 재시작되기 직전에
 * 전부 강제로 지금 당장 저장시키기 위한 것 — 그래야 디바운스 타이머가 아직 안 끝난 마지막
 * 몇 글자가 재시작과 함께 사라지지 않는다.
 *
 * 창(BrowserWindow)마다 별도의 JS 컨텍스트라 이 모듈도 창마다 따로 로드되므로, main
 * 프로세스가 각 창의 webContents.executeJavaScript로 `window.__itdaFlushPendingSaves()`를
 * 호출하면 그 창 안에서 대기 중이던 저장만 실행된다(main/updater/index.js 참고).
 */

const pending = new Set(); // Set<() => Promise<void> | void> — 지금 디바운스 대기 중인 flush 함수들

/**
 * saveFn을 감싸서 "짧게 여러 번 부르면 마지막 한 번만, delay 후에 실행"하는 스케줄러를 만든다.
 * 기존 화면들의 `let saveTimer; const scheduleSave = () => { clearTimeout(...); saveTimer = setTimeout(saveFn, 500); }`
 * 패턴을 그대로 대체한다 — 호출부는 scheduleSave() 그대로 쓰면 된다.
 */
export function wrapAutosave(saveFn, delay = 500) {
  let timer = null;
  const flushNow = () => {
    clearTimeout(timer);
    timer = null;
    pending.delete(flushNow);
    return saveFn();
  };
  return () => {
    clearTimeout(timer);
    pending.add(flushNow);
    timer = setTimeout(flushNow, delay);
  };
}

/** 지금 대기 중인 자동저장을 전부 즉시 실행한다. 실패한 게 있어도 나머지는 계속 진행. */
export async function flushAllPendingSaves() {
  const fns = [...pending];
  pending.clear();
  await Promise.allSettled(fns.map((fn) => fn()));
}

// main 프로세스가 executeJavaScript로 직접 호출할 수 있게 전역에 하나 걸어둔다(각 창의
// "메인 월드"에서 실행되므로 contextIsolation과 무관하게 보인다 — preload가 아니라 이
// 모듈을 import하는 페이지 스크립트 쪽 전역이라서).
window.__itdaFlushPendingSaves = flushAllPendingSaves;
