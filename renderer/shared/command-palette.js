import { escapeHtml } from './ui-utils.js';

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
    { id: 'search', icon: SEARCH_ICON, label: '전체 검색', run: () => goToThen('#/search') },
    { id: 'new-memo', icon: PLUS_ICON, label: '새 메모', run: () => goToThen('#/memo', () => document.getElementById('m-newBtn')?.click()) },
    { id: 'new-todo', icon: PLUS_ICON, label: '새 투두', run: () => goToThen('#/todo', () => document.getElementById('t-title')?.focus()) },
    { id: 'new-event', icon: PLUS_ICON, label: '새 일정', run: () => goToThen('#/calendar', () => document.getElementById('c-openAdd')?.click()) },
    { id: 'new-inbox', icon: PLUS_ICON, label: '새 인박스 (빠른입력)', run: () => openQuickCapture() },
    { id: 'new-postit', icon: PLUS_ICON, label: '포스트잇 만들기', run: () => goToThen('#/postit', () => document.getElementById('p-newCard')?.click()) },
    {
      id: 'today',
      icon: CAL_ICON,
      label: '오늘 일정 보기',
      run: () => goToThen('#/calendar', () => document.querySelector('.tab[data-view="day"]')?.click()),
    },
    { id: 'dashboard', icon: HOME_ICON, label: '대시보드 열기', run: () => goToThen('#/dashboard') },
    { id: 'settings', icon: GEAR_ICON, label: '설정 열기', run: () => goToThen('#/settings') },
  ];
}

export function initCommandPalette({ openQuickCapture }) {
  const commands = buildCommands({ openQuickCapture });
  let overlay = null;
  let listEl = null;
  let inputEl = null;
  let filtered = commands;
  let activeIndex = 0;

  function render() {
    listEl.innerHTML = filtered.length
      ? filtered
          .map(
            (c, i) => `
        <div class="cmdk-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
          <span class="cmdk-item-icon">${c.icon}</span>
          <span class="cmdk-item-label">${escapeHtml(c.label)}</span>
        </div>`
          )
          .join('')
      : `<div class="cmdk-empty">일치하는 명령이 없어요</div>`;

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

  function filterCommands(keyword) {
    const q = keyword.trim().toLowerCase();
    filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    activeIndex = 0;
    render();
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
    filtered = commands;
    activeIndex = 0;
    inputEl.value = '';
    render();
    overlay.classList.add('open');
    setTimeout(() => inputEl.focus(), 30);
  }

  function close() {
    overlay?.classList.remove('open');
  }

  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const modOk = isMac ? e.metaKey : e.ctrlKey;
    if (modOk && e.shiftKey && e.key.toLowerCase() === 'p') {
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
