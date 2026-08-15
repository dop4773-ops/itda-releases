import { toast, emptyStateBlock, escapeHtml } from './ui-utils.js';
import { computeNotifications, NOTIF_ICON } from './notifications.js';
import { initCommandPalette } from './command-palette.js';

// 사이드바 접기/펼치기 — app_settings 테이블에 상태 저장 (localStorage 대신 SQLite로 통일)
async function initSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('collapseBtn');
  if (!sidebar || !btn) return;

  const saved = await window.itda.settings.get('sidebar_collapsed');
  if (saved === '1') sidebar.classList.add('collapsed');

  async function toggle() {
    sidebar.classList.toggle('collapsed');
    const value = sidebar.classList.contains('collapsed') ? '1' : '0';
    await window.itda.settings.set({ key: 'sidebar_collapsed', value });
  }
  btn.addEventListener('click', toggle);

  // Ctrl/Cmd+\ — VSCode 등에서 널리 쓰는 "사이드바 접기/펼치기" 관례. 입력 중에도(메모 작성 등)
  // 걸리게 텍스트 편집 여부를 따로 체크하지 않음(Ctrl+K 빠른입력과 동일한 정책).
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      toggle();
    }
  });
}

// 다른 모듈(커맨드 팔레트 등)이 이 모달을 재사용할 수 있게 열기 함수를 내보낸다.
// initQuickCapture()가 실행된 뒤에만 실제로 동작(그 전엔 아무 것도 안 함 — 안전한 기본값).
let _openQuickCapture = () => {};
export function openQuickCapture() {
  _openQuickCapture();
}

// 전역 빠른 입력 (⌘K / Ctrl+K) — 어느 화면에 있든 Inbox에 바로 저장
function initQuickCapture() {
  const fab = document.getElementById('fab');
  const overlay = document.getElementById('modalOverlay');
  const input = document.getElementById('quickInput');
  if (!fab || !overlay || !input) return;

  function open() {
    overlay.classList.add('open');
    setTimeout(() => input.focus(), 30);
  }
  function close() {
    overlay.classList.remove('open');
    input.value = '';
  }
  _openQuickCapture = open;

  fab.addEventListener('click', open);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open();
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const content = input.value.trim();
    if (!content) return;
    await window.itda.inbox.add(content);
    toast('Inbox에 저장했어요');
    close();
    // 대시보드가 열려 있어도 자동 새로고침은 하지 않음 — 화면 전환 시 최신 데이터로 로드됨
  });

  // OS 전역 단축키(Ctrl/Cmd+Alt+I)로 다른 프로그램 쓰다가도 바로 이 모달을 열 수 있게 연결
  // (main/global-shortcut에서 메인 창을 focus한 뒤 이 이벤트를 보냄)
  window.itda.onOpenQuickCapture(open);
}

// 전역 알림 벨 — 예전엔 대시보드에서만 있었지만, 이제 모든 화면에서 공통으로 보이는
// 상단바로 옮겨서 화면을 이동해도 계속 유지된다. 드롭다운을 열 때마다 다시 계산해서
// 최신 상태를 보여준다(화면 이동 중 생긴 변화도 놓치지 않도록).
async function refreshGlobalNotifications() {
  const dot = document.getElementById('gt-bellDot');
  const listEl = document.getElementById('gt-notifList');
  if (!dot || !listEl) return;
  let items;
  try {
    items = await computeNotifications();
  } catch (e) {
    listEl.innerHTML = emptyStateBlock({ title: '알림을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
    return;
  }
  dot.style.display = items.length > 0 ? 'block' : 'none';
  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty notif-empty">새로운 알림이 없어요.</div>`;
    return;
  }
  listEl.innerHTML = items
    .map(
      (n) => `
      <a class="notif-item ${n.urgent ? 'urgent' : ''}" href="${n.href}">
        <div class="notif-icon notif-icon-${n.type}">${NOTIF_ICON[n.type]}</div>
        <div class="notif-body">
          <b>${escapeHtml(n.title)}</b>
          <span>${escapeHtml(n.subtitle)}</span>
        </div>
      </a>`
    )
    .join('');
}

const SUN_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON_ICON = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>`;

function initGlobalTopbar() {
  const searchBtn = document.getElementById('gt-searchBtn');
  const profileBtn = document.getElementById('gt-profileBtn');
  const bellWrap = document.getElementById('gt-bellWrap');
  const bellBtn = document.getElementById('gt-bellBtn');
  const themeBtn = document.getElementById('gt-themeBtn');
  if (!bellWrap || !bellBtn) return;

  searchBtn?.addEventListener('click', () => {
    location.hash = '#/search';
  });
  profileBtn?.addEventListener('click', () => {
    location.hash = '#/settings';
  });

  function renderThemeIcon() {
    if (!themeBtn) return;
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeBtn.innerHTML = isDark ? SUN_ICON : MOON_ICON;
    themeBtn.title = isDark ? '라이트모드로 전환' : '다크모드로 전환';
  }
  renderThemeIcon();
  themeBtn?.addEventListener('click', async () => {
    await toggleTheme();
    renderThemeIcon();
  });

  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const opening = !bellWrap.classList.contains('open');
    bellWrap.classList.toggle('open');
    if (opening) await refreshGlobalNotifications(); // 열 때마다 최신 상태로 갱신
  });
  document.addEventListener('click', (e) => {
    if (!bellWrap.contains(e.target)) bellWrap.classList.remove('open');
  });

  refreshGlobalNotifications(); // 처음 켰을 때도 빨간 점 표시를 위해 한 번 계산
}

// 사용자 이름 — app_settings에 저장. 사이드바 프로필과 대시보드 인사말이 이 값을 공유한다.
const DEFAULT_USER_NAME = '홍길동';

export async function getUserName() {
  const saved = await window.itda.settings.get('user_name');
  return saved && saved.trim() ? saved.trim() : DEFAULT_USER_NAME;
}

export async function applySidebarUserName() {
  const el = document.getElementById('sb-userName');
  if (!el) return;
  el.textContent = await getUserName();
}

// 다크모드 토글 — 대시보드의 빠른 토글 버튼과 설정 화면이 공유해서 쓰는 헬퍼.
// 로직을 한 곳에만 두어 두 군데에서 서로 다르게 동작하는 일이 없게 한다.
export async function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const next = isDark ? 'light' : 'dark';
  await window.itda.settings.set({ key: 'theme', value: next });
  await applyTheme();
  return next;
}


// 다른 화면(settings.js)에서도 토글 직후 반영해야 해서 재사용 가능하게 export.
export async function applyTheme() {
  const theme = await window.itda.settings.get('theme');
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : '';
  await applyTextColorOverride(); // 라이트/다크 전환 시 그 모드에 저장된 글자색(없으면 기본값)을 다시 맞춘다
}

// 라이트/다크 모드별 기본 글자색(--text) 직접 지정 — 설정 → 화면에서 색상피커로 고른다.
// documentElement 인라인 스타일이라 :root/[data-theme=dark] CSS 규칙보다 항상 우선한다.
const SAFE_HEX_COLOR = /^#[0-9a-f]{6}$/i;

function textColorSettingKey(theme) {
  return theme === 'dark' ? 'text_color_dark' : 'text_color_light';
}

export async function getTextColorOverride(theme) {
  const saved = await window.itda.settings.get(textColorSettingKey(theme));
  return saved && SAFE_HEX_COLOR.test(saved) ? saved : null;
}

export async function applyTextColorOverride() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const override = await getTextColorOverride(theme);
  if (override) document.documentElement.style.setProperty('--text', override);
  else document.documentElement.style.removeProperty('--text'); // 지정 안 했으면 CSS 기본값 그대로
}

export async function setTextColorOverride(theme, hex) {
  if (!SAFE_HEX_COLOR.test(hex)) return; // <input type=color>는 항상 #rrggbb를 주지만 방어적으로 한 번 더 체크
  await window.itda.settings.set({ key: textColorSettingKey(theme), value: hex });
  await applyTextColorOverride();
}

export async function resetTextColorOverride(theme) {
  await window.itda.settings.set({ key: textColorSettingKey(theme), value: '' });
  await applyTextColorOverride();
}

// 화면 배율 — 저해상도 병원 PC에서 글씨/UI가 너무 작게 보이는 문제 대응.
// macOS는 Windows처럼 OS 차원의 디스플레이 배율 설정이 없어서(또는 접근이 불편해서)
// 앱 자체에 배율 조정을 넣어달라는 요청 반영. CSS zoom은 폰트뿐 아니라 레이아웃까지
// 함께 확대/축소되어(transform:scale과 달리 reflow가 일어남) 이 용도에 가장 적합하다.
// 위젯(widget.html)은 별도 렌더러라 이 배율의 영향을 받지 않음 — 위젯은 이미 작은 고정 크기라 대상 아님.
export const DISPLAY_SCALE_OPTIONS = [80, 90, 100, 110, 120, 130];
const DEFAULT_DISPLAY_SCALE = 100;

export async function getDisplayScale() {
  const saved = await window.itda.settings.get('display_scale');
  const n = Number(saved);
  return DISPLAY_SCALE_OPTIONS.includes(n) ? n : DEFAULT_DISPLAY_SCALE;
}

export async function applyDisplayScale() {
  const scale = await getDisplayScale();
  document.documentElement.style.zoom = String(scale / 100);
}

export async function setDisplayScale(scale) {
  await window.itda.settings.set({ key: 'display_scale', value: String(scale) });
  await applyDisplayScale();
}

// 글꼴 — Pretendard(기본, 둥글고 부드러운 인상) vs 시스템 기본(윈도우 맑은 고딕 등).
// --app-font-family 하나만 바꾸면 body 전체에 이미 반영되게 CSS에서 만들어뒀다.
export const FONT_FAMILY_OPTIONS = {
  pretendard: '"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif',
  system: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif',
};

export async function getFontFamily() {
  const saved = await window.itda.settings.get('font_family');
  return saved === 'system' ? 'system' : 'pretendard';
}

export async function applyFontFamily() {
  const key = await getFontFamily();
  document.documentElement.style.setProperty('--app-font-family', FONT_FAMILY_OPTIONS[key]);
}

export async function setFontFamily(key) {
  await window.itda.settings.set({ key: 'font_family', value: key });
  await applyFontFamily();
}

export async function initShell() {
  await applyTheme();
  await applyDisplayScale();
  await applyFontFamily();
  await initSidebarCollapse();
  await applySidebarUserName();
  initQuickCapture();
  initGlobalTopbar();
  initErrorSafetyNet();
  initCommandPalette({ openQuickCapture }); // Ctrl/Cmd+Shift+P — 어느 화면에서든 주요 동작을 키보드로 바로 실행
}

// 화면 코드에서 try/catch를 빠뜨린 경우를 위한 마지막 안전망.
// 정상적으로는 각 화면이 자체적으로 에러를 처리하지만, 놓친 경우
// 조용히 아무 반응 없는 상태가 되는 것보다는 최소한 알려주는 게 낫다.
function initErrorSafetyNet() {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[itda] unhandled promise rejection:', event.reason);
    toast('예기치 않은 오류가 발생했어요');
  });
  window.addEventListener('error', (event) => {
    console.error('[itda] unhandled error:', event.error || event.message);
  });
}
