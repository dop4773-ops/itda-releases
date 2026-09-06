import { escapeHtml, debounce } from './ui-utils.js';
import { TABS as SETTINGS_TABS } from '../views/settings.js';
import { TAG_ICON } from '../views/tags.js';
import { TYPE_EMOJI, TYPE_ROUTE, plainLabel } from './links-ui.js';
import { getCachedBinding, matchesAccelerator } from './shortcuts.js';

// 설정 화면 하위 탭(화면/위젯/단축키/보안/Google Calendar/데이터 & 백업/업데이트)마다 실제
// 설정 화면과 같은 목록(settings.js의 TABS)을 그대로 써서, 탭이 추가/변경돼도 여기서 따로 안 고쳐도 된다.
// keywords는 그 탭 안에 있는 세부 설정 이름 — 사용자가 "배율"을 검색해도 "화면" 탭이 걸리게 하기 위함.
const SETTINGS_TAB_KEYWORDS = {
  display: '배율 다크모드 테마 화면크기 글꼴 폰트 글자색 텍스트색',
  security: '잠금 비밀번호 PIN',
  convenience: '편의기능 업데이트자동확인 자동실행 시작프로그램 자동추천 관련항목',
  data: '백업 복원 내보내기 가져오기',
  update: '버전 업데이트확인',
};

// Obsidian의 Command Palette를 참고한 "빠른 실행" 메뉴 (문서 9번).
// 기존 단축키(Ctrl/Cmd+K = 빠른입력, OS 전역 Ctrl/Cmd+Alt+I = 어디서든 빠른입력)와
// 겹치지 않도록, "커맨드 팔레트" 자체는 VSCode/Slack 등에서 널리 쓰는 Ctrl/Cmd+Shift+P를 쓴다.
// (그냥 Ctrl+P는 웹 관례상 "인쇄"로 강하게 인식되는 조합이라 의도적으로 피함)
const ACCELERATOR_LABEL_MAC = '⌘⇧P';
const ACCELERATOR_LABEL_WIN = 'Ctrl+Shift+P';const SEARCH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const PLUS_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>`;
const HOME_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l9-7 9 7"/><path d="M5 9v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V9"/></svg>`;
const GEAR_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.36.4.66.73.85"/></svg>`;
const CAL_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

// 목적지 화면으로 이동한 뒤(이미 그 화면이면 즉시, 아니면 mount가 끝나는 걸 기다렸다가) 후속 동작을 실행한다.
// router.js가 mount 직후 쏘는 'itda:route-mounted' 이벤트를 활용 — 화면 전환 애니메이션/비동기 로딩 중에
// 아직 없는 엘리먼트를 찾다가 실패하는 걸 막아준다.
function goToThen(hash, then) {
  if (location.hash === hash) {
    then?.();
    return;
  }
  const handler = (e) => {
    if (e.detail.hash !== hash) return;
    window.removeEventListener('itda:route-mounted', handler);
    then?.();
  };
  window.addEventListener('itda:route-mounted', handler);
  location.hash = hash;
}

function buildCommands({ openQuickCapture }) {
  return [
    { id: 'search', icon: SEARCH_ICON, label: '전체 검색', keywords: '검색', run: () => goToThen('#/search') },
    { id: 'new-memo', icon: PLUS_ICON, label: '새 메모 만들기', keywords: '메모 작성', run: () => goToThen('#/memo', () => document.getElementById('m-newBtn')?.click()) },
    { id: 'new-todo', icon: PLUS_ICON, label: '새 Todo 만들기', keywords: '투두 할일', run: () => goToThen('#/todo', () => document.getElementById('t-title')?.focus()) },
    { id: 'new-event', icon: PLUS_ICON, label: '새 일정 추가', keywords: '캘린더 이벤트', run: () => goToThen('#/calendar', () => document.getElementById('c-openAdd')?.click()) },
    { id: 'new-inbox', icon: PLUS_ICON, label: '새 인박스 (빠른입력)', keywords: '빠른입력 캡처', run: () => openQuickCapture() },
    { id: 'new-postit', icon: PLUS_ICON, label: '새 포스트잇 만들기', keywords: '포스트잇', run: () => goToThen('#/postit', () => document.getElementById('p-newCard')?.click()) },
    {
      id: 'today',
      icon: CAL_ICON,
      label: '오늘 일정 보기',
      run: () => goToThen('#/calendar', () => document.querySelector('.tab[data-view="day"]')?.click()),
    },
    { id: 'dashboard', icon: HOME_ICON, label: '대시보드 열기', run: () => goToThen('#/dashboard') },
    { id: 'settings', icon: GEAR_ICON, label: '설정 열기', run: () => goToThen('#/settings') },
    ...SETTINGS_TABS.map((t) => ({
      id: `settings-${t.id}`,
      icon: GEAR_ICON,
      label: `설정 - ${t.label}`,
      keywords: SETTINGS_TAB_KEYWORDS[t.id] || '',
      run: () => goToThen('#/settings', () => document.querySelector(`.settings-tab[data-tab="${t.id}"]`)?.click()),
    })),
  ];
}

// 태그(카테고리)를 눌러서 이동한 뒤, settings.js 안에 이미 있는 "이 태그의 항목 보기" 버튼을
// 그대로 클릭해서 연다 — tags.js 내부 openBrowse()를 새로 export하지 않고, 커맨드 팔레트도
// goToThen처럼 "화면으로 이동한 뒤 이미 있는 버튼을 클릭" 패턴을 그대로 재사용한다.
function buildTagCommand(category) {
  return {
    id: `tag-${category.id}`,
    icon: `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${category.color_hex};"></span>`,
    label: `# ${category.name}`,
    keywords: '태그',
    run: () =>
      goToThen('#/settings', () => {
        document.querySelector('.settings-tab[data-tab="tags"]')?.click();
        document.querySelector(`#tags-panelRoot .list-row[data-id="${category.id}"] [data-action="browse"]`)?.click();
      }),
  };
}

// 실제 항목(Todo/일정/메모/포스트잇/Inbox)을 검색어로 바로 찾아서, 목록 화면이 아니라
// 그 항목의 상세(위젯)로 바로 연다 — "디테일하게 접근"의 핵심. inbox는 낱개 위젯이 없어서
// Inbox 목록 화면으로만 이동한다.
const MATCH_LABEL = { title: '제목 일치', chosung: '초성 일치', content: '본문 일치' };

function buildItemCommand(row) {
  const label = plainLabel(row.title || row.content);
  const emoji = TYPE_EMOJI[row.entity_type] || '';
  return {
    id: `item-${row.entity_type}-${row.entity_id}`,
    icon: `<span>${emoji}</span>`,
    label,
    _kind: 'item',
    matchedIn: row.matchedIn || null,
    run: () => {
      if (row.entity_type === 'inbox') {
        location.hash = '#/inbox';
        return;
      }
      if (row.entity_type === 'postit') {
        window.itda.postitWidget.open(row.entity_id);
        return;
      }
      goToThen(TYPE_ROUTE[row.entity_type], () => window.itda.itemWidget.open({ type: row.entity_type, id: row.entity_id }));
    },
  };
}

export function initCommandPalette({ openQuickCapture }) {
  const staticCommands = buildCommands({ openQuickCapture });
  let tagCommands = [];
  let overlay = null;
  let listEl = null;
  let inputEl = null;
  let filtered = staticCommands;
  let activeIndex = 0;
  let searchGeneration = 0; // 빠르게 타이핑할 때 늦게 도착한 옛 검색 결과가 최신 결과를 덮어쓰는 것 방지

  async function refreshTagCommands() {
    try {
      const categories = await window.itda.categories.list();
      tagCommands = categories.map(buildTagCommand);
    } catch (e) {
      tagCommands = [];
    }
  }

  function allStaticCommands() {
    return [...staticCommands, ...tagCommands];
  }

  function render() {
    if (!filtered.length) {
      listEl.innerHTML = `<div class="cmdk-empty">일치하는 게 없어요</div>`;
      return;
    }
    // 섹션 구분선: "검색 결과"(항목) 블록이 시작되는 지점, "명령" 블록이 시작되는 지점에 헤더를 낀다.
    const firstItem = queryActive ? filtered.findIndex((c) => c._kind === 'item' && c._rank !== 0) : -1;
    const firstCmd = queryActive ? filtered.findIndex((c) => c._kind !== 'item' && c._rank !== 0) : -1;
    listEl.innerHTML = filtered
      .map((c, i) => {
        const badge = c._kind === 'item' && MATCH_LABEL[c.matchedIn] ? `<span class="cmdk-badge">${MATCH_LABEL[c.matchedIn]}</span>` : '';
        const header =
          (i === firstItem && firstItem !== -1 ? `<div class="cmdk-section">검색 결과</div>` : '') +
          (i === firstCmd && firstCmd !== -1 ? `<div class="cmdk-section">명령</div>` : '');
        return `${header}<div class="cmdk-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
          <span class="cmdk-item-icon">${c.icon}</span>
          <span class="cmdk-item-label">${escapeHtml(c.label)}${badge}</span>
        </div>`;
      })
      .join('');

    listEl.querySelectorAll('.cmdk-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        run(Number(row.dataset.index));
      });
      row.addEventListener('mouseenter', () => {
        activeIndex = Number(row.dataset.index);
        listEl.querySelectorAll('.cmdk-item').forEach((r) => r.classList.toggle('active', r === row));
      });
    });
  }

  let commandMatches = []; // 이번 검색어에 걸린 명령(정적+태그)
  let itemMatchesCache = []; // 이번 검색어에 걸린 실제 항목
  let queryActive = false; // 검색어가 있을 때만 "검색 결과 / 명령" 섹션 헤더를 보인다

  // 정렬: (0) 정확히 일치(명령 라벨/키워드 토큰, 항목 제목) → (1) 항목 → (2) 명령.
  // "검색 결과"(항목)를 "명령"보다 위에 두는 목업 구성 + 정확일치는 무조건 최상단.
  function mergeSorted() {
    filtered = [...commandMatches, ...itemMatchesCache]
      .map((c, i) => ({ ...c, _i: i }))
      .sort((a, b) => a._rank - b._rank || a._i - b._i);
    activeIndex = 0;
    render();
  }

  const debouncedItemSearch = debounce(async (keyword, generation) => {
    let rows = [];
    try {
      rows = await window.itda.search.query(keyword);
    } catch (e) {
      rows = [];
    }
    if (generation !== searchGeneration) return; // 그 사이 입력이 더 바뀌었으면 이 결과는 버림
    const q = keyword.trim().toLowerCase();
    itemMatchesCache = rows.slice(0, 8).map((row) => {
      const c = buildItemCommand(row);
      c._rank = (row.title || '').trim().toLowerCase() === q ? 0 : 1;
      return c;
    });
    mergeSorted();
  }, 150);

  // 명령은 라벨 전체가 검색어와 같을 때만 "정확히 일치"(0). 그 외엔 2(명령 섹션).
  // "메모" 입력에 "새 메모 만들기"가 정확일치로 튀어오르지 않게 — 그건 제목이 "메모"인 항목 몫.
  function commandRank(c, q) {
    return c.label.toLowerCase() === q ? 0 : 2;
  }

  function filterCommands(keyword) {
    searchGeneration += 1;
    const q = keyword.trim().toLowerCase();
    queryActive = !!q;
    const all = allStaticCommands();
    if (!q) {
      commandMatches = all.map((c) => ({ ...c, _rank: 2 }));
      itemMatchesCache = [];
      mergeSorted();
      return;
    }
    commandMatches = all
      .filter((c) => `${c.label} ${c.keywords || ''}`.toLowerCase().includes(q))
      .map((c) => ({ ...c, _rank: commandRank(c, q) }));
    itemMatchesCache = []; // 항목 결과는 debounce 뒤에 채워짐
    mergeSorted();
    if (q.length >= 1) debouncedItemSearch(q, searchGeneration);
  }

  function run(index) {
    const cmd = filtered[index];
    if (!cmd) return;
    close();
    cmd.run();
  }

  function ensureBuilt() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay cmdk-overlay';
    overlay.innerHTML = `
      <div class="cmdk-card">
        <div class="cmdk-input-row">
          <span class="cmdk-input-icon">${SEARCH_ICON}</span>
          <input type="text" id="cmdk-input" placeholder="무엇을 할까요?" autocomplete="off" />
        </div>
        <div class="cmdk-list" id="cmdk-list"></div>
        <div class="cmdk-hint-row">↑↓ 이동 · Enter 실행 · Esc 닫기</div>
      </div>
    `;
    document.body.appendChild(overlay);
    listEl = overlay.querySelector('#cmdk-list');
    inputEl = overlay.querySelector('#cmdk-input');

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
    inputEl.addEventListener('input', () => filterCommands(inputEl.value));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) {
          activeIndex = (activeIndex + 1) % filtered.length;
          render();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) {
          activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
          render();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        run(activeIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
  }

  function open() {
    ensureBuilt();
    inputEl.value = '';
    filterCommands(''); // 태그 새로고침 전엔 지금까지 캐시된 명령으로 즉시
    overlay.classList.add('open');
    setTimeout(() => inputEl.focus(), 30);
    refreshTagCommands().then(() => {
      if (overlay.classList.contains('open') && !inputEl.value.trim()) filterCommands(''); // 새 태그 목록 반영
    });
  }

  function close() {
    overlay?.classList.remove('open');
  }

  document.addEventListener('keydown', (e) => {
    if (matchesAccelerator(e, getCachedBinding('commandPalette'))) {
      e.preventDefault();
      if (overlay?.classList.contains('open')) {
        close();
      } else {
        open();
      }
    }
  });
}

export const COMMAND_PALETTE_HINT = navigator.platform?.toUpperCase().includes('MAC') ? ACCELERATOR_LABEL_MAC : ACCELERATOR_LABEL_WIN;
