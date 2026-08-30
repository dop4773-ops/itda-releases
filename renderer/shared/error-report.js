/**
 * renderer/shared/error-report.js
 *
 * 메인 월드에서 window.onerror / unhandledrejection을 잡아 preload가 노출한 __itdaReportError로
 * main에 보낸다(→ userData/logs/error.log). contextIsolation 때문에 preload에서는 메인 월드의
 * 에러 이벤트가 안 보이므로, 앱/위젯의 진입 스크립트(shell.js, widget-loader.js)가 이 모듈을
 * side-effect import 한다.
 */
const report = (payload) => {
  try {
    window.__itdaReportError?.(payload);
  } catch (e) {
    /* preload 없이 로드된 경우 등 — 조용히 무시 */
  }
};

const src = () => (location.pathname.endsWith('widget.html') ? 'renderer:widget' : 'renderer');

window.addEventListener('error', (e) => {
  report({
    source: src(),
    message: e.message || String(e.error || 'error'),
    stack: (e.error && e.error.stack) || `${e.filename || location.pathname}:${e.lineno}:${e.colno}`,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  report({
    source: src(),
    message: (r && r.message) || `unhandledrejection: ${String(r)}`,
    stack: (r && r.stack) || location.pathname,
  });
});
