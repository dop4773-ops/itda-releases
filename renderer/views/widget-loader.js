import '../shared/error-report.js'; // window.onerror/unhandledrejection → main 로그 파일 (side-effect only)

// widget.html은 하나뿐이고, ?type=으로 어떤 위젯을 띄울지 결정한다.
// 새 위젯 종류를 추가할 땐 이 레지스트리에 한 줄만 추가하면 된다.
const REGISTRY = {
  postit: () => import('./postit-widget.js'),
  'today-schedule': () => import('./widgets/today-schedule.js'),
  'today-todo': () => import('./widgets/today-todo.js'),
  'postit-board': () => import('./widgets/postit-board.js'),
  'google-calendar-mini': () => import('./widgets/google-calendar-mini.js'),
  inbox: () => import('./widgets/inbox-widget.js'),
  dday: () => import('./widgets/dday.js'),
  'todo-item': () => import('./widgets/todo-item.js'),
  'memo-item': () => import('./widgets/memo-item.js'),
  'event-item': () => import('./widgets/event-item.js'),
};

const type = new URLSearchParams(location.search).get('type');
const loader = REGISTRY[type];

if (loader) {
  // 위젯 모듈 로드/초기화가 실패해도 빈 창으로 두지 않고 최소한 이유를 보여준다(error-report.js가 로그도 남김).
  Promise.resolve()
    .then(loader)
    .catch((e) => {
      console.error(`[widget] '${type}' 로드 실패`, e);
      document.getElementById('widget-root').innerHTML = `<div class="widget-error">위젯을 불러오지 못했어요</div>`;
    });
} else {
  document.getElementById('widget-root').innerHTML = `<div class="widget-error">알 수 없는 위젯이에요</div>`;
}
