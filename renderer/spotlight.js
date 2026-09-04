// macOS Spotlight식 작은 창 — 잇다 본체를 안 띄우고 화면 가운데에 검색/입력만.
// main/spotlight/window-manager.js 가 이 페이지를 frameless 창에 띄운다.
import { debounce } from './shared/ui-utils.js';
import { stripHtmlToPlainText } from './shared/rich-text.js';

// 이 작은 팝업에는 다크모드 + UI 테마 팔레트만 맞춰준다(배율/폰트는 굳이 안 함 — shell.js
// 전체 테마 로직을 끌어오면 의존성이 커진다).
async function applyMinimalTheme() {
  try {
    const s = await window.itda.settings.getMany(['theme', 'ui_theme', 'app_theme']);
    if (s.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    if (s.ui_theme && s.ui_theme !== 'light' && s.ui_theme !== 'dark') document.documentElement.dataset.uitheme = s.ui_theme;
    if (s.app_theme) document.documentElement.dataset.apptheme = s.app_theme;
  } catch (e) {
    /* 기본(라이트) */
  }
}

const params = new URLSearchParams(location.search);
let mode = params.get('mode') === 'find' ? 'find' : 'capture';

const root = document.getElementById('sp-root');
let inputEl = null;
let resultsEl = null;
let items = []; // { icon, label, run }
let active = 0;

const SCREEN_COMMANDS = [
  { icon: '🏠', label: '대시보드', kw: '대시보드 홈 dashboard', route: '#/dashboard' },
  { icon: '📥', label: 'Inbox (빠른 입력함)', kw: 'inbox 인박스', route: '#/inbox' },
  { icon: '☑', label: 'Todo (할 일)', kw: 'todo 투두 할일', route: '#/todo' },
  { icon: '📅', label: '일정 (캘린더)', kw: 'calendar 캘린더 일정', route: '#/calendar' },
  { icon: '📝', label: '메모', kw: 'memo 메모 노트', route: '#/memo' },
  { icon: '📌', label: '포스트잇', kw: 'postit 포스트잇', route: '#/postit' },
  { icon: '🔍', label: '전체 검색', kw: 'search 검색', route: '#/search' },
  { icon: '⚙️', label: '설정', kw: 'settings 설정 환경설정', route: '#/settings' },
];
const TYPE_EMOJI = { todo: '☑', event: '📅', memo: '📝', postit: '📌', inbox: '📥' };

function close() {
  window.itda.spotlight.close();
}

function openRoute(route) {
  window.itda.widgets.openMainApp(route).catch(() => {});
  close();
}

function openItem(row) {
  if (row.entity_type === 'postit') window.itda.postitWidget.open(row.entity_id).catch(() => {});
  else if (row.entity_type === 'inbox') window.itda.widgets.openMainApp('#/inbox').catch(() => {});
  else window.itda.itemWidget.open({ type: row.entity_type, id: row.entity_id }).catch(() => {});
  close();
}

function render() {
  document.body.dataset.mode = mode;
  // 카드 밖(투명한 여백)을 누르면 닫힘 — blur가 안 잡히는 경우 대비 + 맥 Spotlight 감각
  root.onmousedown = (e) => {
    if (!e.target.closest('.sp-card')) close();
  };
  root.innerHTML = `
    <div class="sp-card">
      <div class="sp-input-row">
        <span class="sp-icon">${mode === 'find'
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>'}</span>
        <input id="sp-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="${mode === 'find' ? '항목·화면 찾기…' : 'Inbox에 바로 저장할 내용…'}" />
        <span class="sp-hint">${mode === 'find' ? 'Enter 열기 · Esc 닫기' : 'Enter 저장 · Esc 닫기'}</span>
      </div>
      <div id="sp-results"></div>
    </div>`;
  inputEl = document.getElementById('sp-input');
  resultsEl = document.getElementById('sp-results');
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeyDown);
  // 리스너는 한 번만(위임) — 키 입력마다 붙였다 떼면 버벅인다.
  resultsEl.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.sp-item');
    if (!el) return;
    e.preventDefault();
    items[Number(el.dataset.i)]?.run();
  });
  resultsEl.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.sp-item');
    if (!el || Number(el.dataset.i) === active) return;
    active = Number(el.dataset.i);
    syncActive();
  });
  setTimeout(() => inputEl.focus(), 20);
  if (mode === 'find') refreshFind('');
}

function renderResults() {
  if (mode !== 'find') {
    resultsEl.innerHTML = '';
    return;
  }
  resultsEl.innerHTML = items.length
    ? items
        .map(
          (it, i) => `<div class="sp-item ${i === active ? 'active' : ''}" data-i="${i}">
            <span class="sp-item-icon">${it.icon}</span><span class="sp-item-label">${escapeHtml(it.label)}</span>
          </div>`
        )
        .join('')
    : `<div class="sp-empty">일치하는 항목이 없어요</div>`;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function onInput() {
  if (mode === 'find') refreshFind(inputEl.value);
}

const debouncedItemSearch = debounce(async (kw) => {
  let rows = [];
  try {
    rows = await window.itda.search.query(kw);
  } catch (e) {
    rows = [];
  }
  if (inputEl.value.trim() !== kw.trim()) return;
  const itemMatches = rows.slice(0, 8).map((row) => ({
    icon: TYPE_EMOJI[row.entity_type] || '•',
    // 메모/포스트잇 content는 HTML이라 태그를 벗겨서 순수 텍스트로.
    label: stripHtmlToPlainText(row.title || row.content || '').replace(/\s+/g, ' ').trim().slice(0, 70) || '(제목 없음)',
    run: () => openItem(row),
  }));
  items = [...itemMatches, ...items];
  active = 0;
  renderResults();
}, 160);

function refreshFind(kw) {
  const k = kw.trim().toLowerCase();
  const screenMatches = SCREEN_COMMANDS.filter((c) => !k || c.kw.includes(k) || c.label.toLowerCase().includes(k)).map((c) => ({
    icon: c.icon,
    label: c.label,
    run: () => openRoute(c.route),
  }));
  items = screenMatches;
  active = 0;
  renderResults();
  if (k) debouncedItemSearch(kw);
}

async function submitCapture() {
  const v = inputEl.value.trim();
  if (!v) return;
  try {
    await window.itda.inbox.add(v);
  } catch (e) {
    /* 저장 실패해도 창은 닫는다 — 재시도는 사용자 몫 */
  }
  close();
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (mode === 'capture') {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCapture();
    }
    return;
  }
  // find
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active = Math.min(active + 1, items.length - 1);
    syncActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active = Math.max(active - 1, 0);
    syncActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    items[active]?.run();
  }
}

function syncActive() {
  resultsEl.querySelectorAll('.sp-item').forEach((el, i) => el.classList.toggle('active', i === active));
  resultsEl.querySelector('.sp-item.active')?.scrollIntoView({ block: 'nearest' });
}

// 창을 재사용해 모드가 바뀌면(capture ↔ find) 다시 그린다
window.itda.spotlight.onSetMode?.((m) => {
  mode = m === 'find' ? 'find' : 'capture';
  items = [];
  render();
});

(async () => {
  await applyMinimalTheme();
  render();
})();
