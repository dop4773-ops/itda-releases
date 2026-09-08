// macOS Spotlight식 작은 창 — 잇다 본체를 안 띄우고 화면 가운데에 검색/입력만.
// main/spotlight/window-manager.js 가 이 페이지를 frameless 창에 띄운다.
import { debounce } from './shared/ui-utils.js';
import { stripHtmlToPlainText } from './shared/rich-text.js';
import { parseQuery, describeScope, eventDateLabel, TYPE_EMOJI, TYPE_LABEL, ITEM_ROUTE } from './shared/quick-find-core.js';

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
let items = []; // { icon, label, sub?, _rank, _section, run }
let active = 0;

const ITEM_LIMIT = 20;
let currentScope = ''; // 활성 타입/태그 프리픽스 표시("메모", "#재활")

// "큰 카테고리" — 화면 + 설정 세부 탭. route에 '#/settings/<탭>'을 주면 본체가 그 탭을 바로 연다(router.js).
const SCREEN_COMMANDS = [
  { icon: '🏠', label: '대시보드', kw: '대시보드 홈 dashboard', route: '#/dashboard' },
  { icon: '📥', label: 'Inbox (빠른 입력함)', kw: 'inbox 인박스', route: '#/inbox' },
  { icon: '✅', label: 'Todo (할 일)', kw: 'todo 투두 할일', route: '#/todo' },
  { icon: '📅', label: '일정 (캘린더)', kw: 'calendar 캘린더 일정', route: '#/calendar' },
  { icon: '📝', label: '메모', kw: 'memo 메모 노트', route: '#/memo' },
  { icon: '📌', label: '포스트잇', kw: 'postit 포스트잇', route: '#/postit' },
  { icon: '🔍', label: '전체 검색', kw: 'search 검색', route: '#/search' },
  { icon: '⚙️', label: '설정', kw: 'settings 설정 환경설정', route: '#/settings' },
  // 설정 세부 탭 (settings.js TABS와 같은 id — 탭 추가 시 여기도 한 줄)
  { icon: '🎨', label: '설정 · 화면', kw: '설정 화면 배율 다크모드 테마 글꼴 폰트 글자색', route: '#/settings/display' },
  { icon: '📊', label: '설정 · 대시보드', kw: '설정 대시보드 위젯배치 레이아웃', route: '#/settings/dashboard' },
  { icon: '🏷️', label: '설정 · 태그', kw: '설정 태그 카테고리', route: '#/settings/tags' },
  { icon: '🧩', label: '설정 · 위젯', kw: '설정 위젯', route: '#/settings/widgets' },
  { icon: '⌨️', label: '설정 · 단축키', kw: '설정 단축키 키보드', route: '#/settings/shortcuts' },
  { icon: '🔒', label: '설정 · 보안', kw: '설정 보안 잠금 비밀번호 pin', route: '#/settings/security' },
  { icon: '🎛️', label: '설정 · 편의 기능', kw: '설정 편의기능 자동추천 자동실행 시작프로그램 관련항목', route: '#/settings/convenience' },
  { icon: '📆', label: '설정 · Google Calendar', kw: '설정 구글 캘린더 google calendar 동기화', route: '#/settings/gcal' },
  { icon: '💾', label: '설정 · 데이터 & 백업', kw: '설정 데이터 백업 복원 내보내기 가져오기', route: '#/settings/data' },
  { icon: '🔄', label: '설정 · 업데이트', kw: '설정 업데이트 버전 최신', route: '#/settings/update' },
];
let tagCommands = []; // 카테고리 태그 → '#/settings/tags'
let tagNames = []; // 태그 프리픽스(#재활) 해석용 — 존재하는 태그명만 프리픽스로 인정

function close() {
  window.itda.spotlight.close();
}

function openRoute(route) {
  window.itda.widgets.openMainApp(route).catch(() => {});
  close();
}

function openItem(row) {
  window.itda.search?.recordOpen?.({ type: row.entity_type, id: row.entity_id }); // "최근 연 항목" 기록
  if (row.entity_type === 'inbox') {
    window.itda.widgets.openMainApp('#/inbox').catch(() => {});
  } else {
    // 본체를 그 항목까지 바로 연다 — 메모가 다른 폴더에 있어도, Todo가 필터에 안 걸려도 열림(#/type/id)
    window.itda.widgets.openMainApp(`${ITEM_ROUTE[row.entity_type] || '#/dashboard'}/${row.entity_id}`).catch(() => {});
  }
  close();
}

// search 결과 행 → spotlight 항목 엔트리
function itemEntry(row, exactKey) {
  const label = stripHtmlToPlainText(row.title || row.content || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(제목 없음)';
  const snip = row.snippet ? stripHtmlToPlainText(row.snippet).replace(/\s+/g, ' ').trim().slice(0, 90) : '';
  const dateLbl = row.entity_type === 'event' ? eventDateLabel(row.eventStart, row.eventAllDay) : '';
  const sub = [dateLbl, snip || (dateLbl ? '' : TYPE_LABEL[row.entity_type] || '')].filter(Boolean).join('  ·  ');
  return {
    icon: TYPE_EMOJI[row.entity_type] || '•',
    label,
    sub,
    _rank: exactKey !== undefined && label.toLowerCase() === exactKey ? 0 : 2,
    _section: 'item',
    run: () => openItem(row),
  };
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
          placeholder="${mode === 'find' ? '찾기…  (예: 메모 김부수, #재활)' : 'Inbox에 바로 저장할 내용…'}" />
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
  if (!items.length) {
    resultsEl.innerHTML = `<div class="sp-empty">${inputEl && inputEl.value.trim() ? '일치하는 항목이 없어요' : '최근 항목이 없어요'}</div>`;
    return;
  }
  // 섹션 헤더: 앞의 카테고리(_section != 'item') 블록과 뒤의 항목 블록 사이에 하나. 빈 검색어일 땐 _section 라벨 그대로.
  let lastSection = null;
  resultsEl.innerHTML = items
    .map((it, i) => {
      let header = '';
      if (it._section && it._section !== lastSection) {
        lastSection = it._section;
        const base = { open: '최근 연 항목', recent: '최근 항목', item: '항목', shortcut: '바로가기' }[it._section];
        const label = it._section === 'item' && currentScope ? `${currentScope} · 항목` : base;
        if (label && !(it._section === 'item' && !items.some((x) => x._section !== 'item'))) {
          header = `<div class="sp-section">${label}</div>`;
        }
      }
      return `${header}<div class="sp-item ${i === active ? 'active' : ''}" data-i="${i}">
        <span class="sp-item-icon">${it.icon}</span>
        <span class="sp-item-text"><span class="sp-item-label">${escapeHtml(it.label)}</span>${it.sub ? `<span class="sp-item-sub">${escapeHtml(it.sub)}</span>` : ''}</span>
      </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function onInput() {
  if (mode === 'find') refreshFind(inputEl.value);
}

// 이번 검색어에 걸린 "큰 카테고리"(화면·설정탭·태그). _rank 0 = 정확히 일치, 1 = 부분 일치.
let categoryEntries = [];

// 정렬 규칙: (0) 정확히 일치 → (1) 큰 카테고리(부분 일치) → (2) 개별 항목.
// 같은 rank 안에서는 들어온 순서 유지(카테고리 먼저 넣으므로 "큰 카테고리부터").
function rebuildItems(itemEntries) {
  items = [...categoryEntries, ...itemEntries].map((e, i) => ({ ...e, _i: i })).sort((a, b) => a._rank - b._rank || a._i - b._i);
  active = 0;
  renderResults();
}

// 빈 검색어 시작화면 — 최근 연 항목 + 최근 만든/고친 항목 (화면 목록은 타이핑하면 나옴)
let startToken = 0;
async function loadRecentStart() {
  const mine = ++startToken;
  let opened = [];
  let recent = [];
  try {
    [opened, recent] = await Promise.all([
      window.itda.search.recentOpened().catch(() => []),
      window.itda.search.recentItems().catch(() => []),
    ]);
  } catch (e) {
    /* 무시 */
  }
  if (mine !== startToken || inputEl.value.trim()) return; // 그 사이 타이핑/재호출했으면 버림
  const openedKeys = new Set(opened.map((r) => `${r.entity_type}:${r.entity_id}`));
  items = [
    ...opened.slice(0, 8).map((r) => ({ ...itemEntry(r), _section: 'open', _rank: 0 })),
    ...recent
      .filter((r) => !openedKeys.has(`${r.entity_type}:${r.entity_id}`))
      .slice(0, 8)
      .map((r) => ({ ...itemEntry(r), _section: 'recent', _rank: 1 })),
  ].map((e, i) => ({ ...e, _i: i }));
  active = 0;
  renderResults();
}

// 카테고리(화면/설정탭/태그) 항목의 rank 계산. k에 안 걸리면 null(제외).
function categoryRank(c, k) {
  if (!k) return 1;
  const label = c.label.toLowerCase();
  const kwTokens = (c.kw || '').toLowerCase().split(/\s+/).filter(Boolean);
  const labelWords = label.split(/[·・\s()]+/).filter(Boolean);
  if (label === k || labelWords.includes(k) || kwTokens.includes(k)) return 0; // 정확히 일치
  if (label.includes(k) || kwTokens.some((t) => t.includes(k))) return 1; // 부분 일치
  return null;
}

const samePar = (a, b) => a.type === b.type && a.tag === b.tag && a.text.trim() === b.text.trim();

const debouncedItemSearch = debounce(async (parsed) => {
  let rows = [];
  try {
    rows = await window.itda.search.query(
      parsed.text
        ? { query: parsed.text, type: parsed.type, tag: parsed.tag, limit: ITEM_LIMIT }
        : { type: parsed.type, tag: parsed.tag, limit: ITEM_LIMIT }
    );
  } catch (e) {
    rows = [];
  }
  if (!samePar(parseQuery(inputEl.value, tagNames), parsed)) return; // 그 사이 입력이 바뀌었으면 버림
  const k = parsed.text.trim().toLowerCase();
  rebuildItems(rows.slice(0, ITEM_LIMIT).map((row) => itemEntry(row, k)));
}, 150);

function refreshFind(raw) {
  const parsed = parseQuery(raw, tagNames);
  const scoped = !!(parsed.type || parsed.tag);
  currentScope = describeScope(parsed);
  const k = parsed.text.toLowerCase();
  if (!k && !scoped) {
    categoryEntries = [];
    items = [];
    renderResults();
    loadRecentStart(); // 최근 연 항목 + 최근 항목
    return;
  }
  // 프리픽스로 좁혔으면(메모 …, #재활 …) 화면·태그 바로가기는 빼고 항목만.
  categoryEntries = scoped
    ? []
    : [...SCREEN_COMMANDS, ...tagCommands]
        .map((c) => ({ c, _rank: categoryRank(c, k) }))
        .filter((x) => x._rank !== null)
        .map(({ c, _rank }) => ({ icon: c.icon, label: c.label, _rank, _section: 'shortcut', run: () => openRoute(c.route) }));
  rebuildItems([]);
  debouncedItemSearch(parsed);
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
  if (mode === 'find') loadTagCommands();
});

// 카테고리 태그를 "큰 카테고리"처럼 검색 가능하게 — '#/settings/tags'로 이동.
async function loadTagCommands() {
  try {
    const cats = await window.itda.categories.list();
    tagNames = (cats || []).map((c) => c.name);
    tagCommands = (cats || []).map((c) => ({
      icon: '🏷️',
      label: `태그 · ${c.name}`,
      kw: `태그 카테고리 ${c.name}`,
      route: '#/settings/tags',
    }));
  } catch (e) {
    tagCommands = [];
    tagNames = [];
  }
}

(async () => {
  await applyMinimalTheme();
  render();
  if (mode === 'find') loadTagCommands();
})();
