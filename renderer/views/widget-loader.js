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
  loader();
} else {
  document.getElementById('widget-root').innerHTML = `<div class="widget-error">알 수 없는 위젯이에요</div>`;
}
