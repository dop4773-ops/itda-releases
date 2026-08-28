import { toast, errorToast, emptyStateBlock, escapeHtml } from './ui-utils.js';
import { computeNotifications, NOTIF_ICON } from './notifications.js';
import { initCommandPalette } from './command-palette.js';
import { SHORTCUTS, preloadShortcuts, getCachedBinding, matchesAccelerator, labelForAccelerator } from './shortcuts.js';
import { initEventReminders, getActiveReminders, snoozeReminder } from './event-reminders.js';
import { initUpdateOverlay } from './update-overlay.js';

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

  // 설정 > 단축키에서 바꿀 수 있음 (기본 Ctrl/Cmd+\). 입력 중에도(메모 작성 등) 걸리게
  // 텍스트 편집 여부를 따로 체크하지 않음(Ctrl+K 빠른입력과 동일한 정책).
  document.addEventListener('keydown', (e) => {
    if (matchesAccelerator(e, getCachedBinding('toggleSidebar'))) {
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
    if (matchesAccelerator(e, getCachedBinding('quickCapture'))) {
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
  const reminders = getActiveReminders(); // 일정 전 알림(설정 > 편의 기능) — 켜져 있고 지금 알릴 시각 근처인 것들
  dot.style.display = items.length > 0 || reminders.length > 0 ? 'block' : 'none';
  if (items.length === 0 && reminders.length === 0) {
    listEl.innerHTML = `<div class="empty notif-empty">새로운 알림이 없어요.</div>`;
    return;
  }

  const reminderHtml = reminders
    .map(
      ({ event: e, minutesUntil }) => `
      <div class="notif-item ${minutesUntil <= 0 ? 'urgent' : ''}" style="align-items:center;" data-reminder-id="${e.id}">
        <div class="notif-icon notif-icon-event">${NOTIF_ICON.event}</div>
        <div class="notif-body">
          <b>"${escapeHtml(e.title)}" 일정</b>
          <span>${minutesUntil <= 0 ? '지금 시작해요' : `${Math.round(minutesUntil)}분 후 시작해요`}</span>
        </div>
        <button class="btn-secondary" style="font-size:11px;padding:4px 8px;flex-shrink:0;" data-snooze-id="${e.id}" type="button">다시 알림</button>
      </div>`
    )
    .join('');

  const itemsHtml = items
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

  listEl.innerHTML = reminderHtml + itemsHtml;

  listEl.querySelectorAll('button[data-snooze-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await snoozeReminder(Number(btn.dataset.snoozeId));
      await refreshGlobalNotifications();
    });
  });
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

  async function toggleBell() {
    const opening = !bellWrap.classList.contains('open');
    bellWrap.classList.toggle('open');
    if (opening) await refreshGlobalNotifications(); // 열 때마다 최신 상태로 갱신
  }
  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleBell();
  });
  document.addEventListener('click', (e) => {
    if (!bellWrap.contains(e.target)) bellWrap.classList.remove('open');
  });
  // 설정 > 단축키에서 바꿀 수 있음(기본 Cmd/Ctrl+Shift+N). 대시보드를 포함해 어느 화면에서든 동작.
  document.addEventListener('keydown', (e) => {
    if (matchesAccelerator(e, getCachedBinding('toggleNotifications'))) {
      e.preventDefault();
      toggleBell();
      return;
    }
    if (e.key === 'Escape' && bellWrap.classList.contains('open')) bellWrap.classList.remove('open');
  });

  refreshGlobalNotifications(); // 처음 켰을 때도 빨간 점 표시를 위해 한 번 계산

  // ================= 빠른 설정 (프로필 버튼 드롭다운) =================
  // 여기서 바꾸는 값은 설정 화면(화면/편의 기능/위젯/시작) 탭들과 완전히 같은 키를 읽고 쓴다 —
  // 별도로 저장하지 않고, 자주 쓰는 토글 4개만 여기서도 바로 바꿀 수 있게 뽑아낸 것.
  const qsWrap = document.getElementById('gt-quickSettingsWrap');
  const qsDark = document.getElementById('qs-darkToggle');
  const qsNotif = document.getElementById('qs-notifToggle');
  const qsWidgetTop = document.getElementById('qs-widgetTopToggle');
  const qsAutoLaunch = document.getElementById('qs-autoLaunchToggle');
  const qsMoreLink = document.getElementById('qs-moreLink');

  async function refreshQuickSettings() {
    if (qsDark) qsDark.checked = document.documentElement.dataset.theme === 'dark';
    if (qsNotif) qsNotif.checked = (await window.itda.settings.get('notif_event_enabled')) !== '0';
    if (qsWidgetTop) qsWidgetTop.checked = (await window.itda.settings.get('widget_always_on_top')) !== '0';
    if (qsAutoLaunch) {
      try {
        qsAutoLaunch.checked = (await window.itda.app.getAutoLaunch()).enabled;
      } catch (e) {
        qsAutoLaunch.checked = false;
      }
    }
  }

  if (profileBtn && qsWrap) {
    profileBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const opening = !qsWrap.classList.contains('open');
      qsWrap.classList.toggle('open');
      if (opening) await refreshQuickSettings();
    });
    document.addEventListener('click', (e) => {
      if (!qsWrap.contains(e.target)) qsWrap.classList.remove('open');
    });
    qsMoreLink?.addEventListener('click', () => qsWrap.classList.remove('open'));

    qsDark?.addEventListener('change', async () => {
      await toggleTheme();
      renderThemeIcon();
    });
    qsNotif?.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'notif_event_enabled', value: qsNotif.checked ? '1' : '0' });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        qsNotif.checked = !qsNotif.checked;
      }
    });
    qsWidgetTop?.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'widget_always_on_top', value: qsWidgetTop.checked ? '1' : '0' });
        await window.itda.widgets.applyAppearance();
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        qsWidgetTop.checked = !qsWidgetTop.checked;
      }
    });
    qsAutoLaunch?.addEventListener('change', async () => {
      try {
        await window.itda.app.setAutoLaunch(qsAutoLaunch.checked);
      } catch (e) {
        errorToast(e, e.message || '개발 모드에서는 켤 수 없어요');
        qsAutoLaunch.checked = !qsAutoLaunch.checked;
      }
    });
  }
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
export const APP_THEMES = [
  { id: '', label: '기본(블루)', brand: '#6C8CF5' },
  { id: 'green', label: '그린', brand: '#2FA279' },
  { id: 'purple', label: '퍼플', brand: '#8A5CD1' },
  { id: 'rose', label: '로즈', brand: '#D9628A' },
  { id: 'amber', label: '앰버', brand: '#D5891F' },
  { id: 'teal', label: '틸', brand: '#1F9AA8' },
  { id: 'graphite', label: '그래파이트', brand: '#5A6270' },
];

export async function applyTheme() {
  const theme = await window.itda.settings.get('theme');
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : '';
  const appTheme = await window.itda.settings.get('app_theme');
  if (appTheme && APP_THEMES.some((t) => t.id === appTheme)) document.documentElement.dataset.apptheme = appTheme;
  else delete document.documentElement.dataset.apptheme;
  // 전역 UI 테마(분위기) — 라이트/다크·강조색 위에 겹쳐서 앱 전체 팔레트/형태를 바꾼다.
  const uiTheme = await window.itda.settings.get('ui_theme');
  const uit = UI_THEMES.find((t) => t.id === uiTheme);
  if (uit && uit.uitheme) document.documentElement.dataset.uitheme = uit.uitheme;
  else delete document.documentElement.dataset.uitheme;
  await applyTextColorOverride(); // 라이트/다크 전환 시 그 모드에 저장된 글자색(없으면 기본값)을 다시 맞춘다
}

// ================= 전역 UI 테마 + 세부 조정(모서리/그림자/밀도) =================
// 테마는 "기본 디자인 언어"를 한 번에 정하고, 세부 조정은 그 위에서 몇 가지만 더 튜닝한다.
// 전부 documentElement의 data-* 속성 하나로 표현되고 CSS 변수 오버라이드로만 동작한다(컴포넌트 코드 무변경).
export const UI_THEMES = [
  { id: 'light', label: '라이트', dark: false, uitheme: '' },
  { id: 'dark', label: '다크', dark: true, uitheme: '' },
  { id: 'midnight', label: '미드나잇', dark: true, uitheme: 'midnight' },
  { id: 'cozy', label: '코지 · 웜', dark: false, uitheme: 'cozy' },
  { id: 'soft', label: '소프트', dark: false, uitheme: 'soft' },
  { id: 'cool', label: '쿨', dark: false, uitheme: 'cool' },
  { id: 'pastel', label: '파스텔', dark: false, uitheme: 'pastel' },
  { id: 'glass', label: '글래스', dark: false, uitheme: 'glass' },
  { id: 'retro', label: '레트로', dark: false, uitheme: 'retro' },
  { id: 'minimal', label: '미니멀', dark: false, uitheme: 'minimal' },
  { id: 'professional', label: '프로페셔널', dark: false, uitheme: 'professional' },
];

const UI_ADJUSTS = {
  radius: { key: 'ui_radius', values: ['sharp', 'default', 'round'], def: 'default' },
  shadow: { key: 'ui_shadow', values: ['none', 'soft', 'default', 'strong'], def: 'default' },
  density: { key: 'ui_density', values: ['compact', 'default', 'comfortable'], def: 'default' },
};

export async function getUiTheme() {
  const saved = await window.itda.settings.get('ui_theme');
  return UI_THEMES.some((t) => t.id === saved) ? saved : null; // null = 아직 안 골랐음(하위호환: 다크토글만 사용)
}

export async function setUiTheme(id) {
  const t = UI_THEMES.find((x) => x.id === id);
  if (!t) return;
  await window.itda.settings.set({ key: 'ui_theme', value: id });
  await window.itda.settings.set({ key: 'theme', value: t.dark ? 'dark' : 'light' });
  await applyTheme();
}

export async function getUiAdjust(name) {
  const cfg = UI_ADJUSTS[name];
  const saved = await window.itda.settings.get(cfg.key);
  return cfg.values.includes(saved) ? saved : cfg.def;
}

export async function setUiAdjust(name, value) {
  const cfg = UI_ADJUSTS[name];
  if (!cfg || !cfg.values.includes(value)) return;
  await window.itda.settings.set({ key: cfg.key, value });
  await applyUiAdjusts();
}

export async function applyUiAdjusts() {
  for (const [name, cfg] of Object.entries(UI_ADJUSTS)) {
    const saved = await window.itda.settings.get(cfg.key);
    const v = cfg.values.includes(saved) ? saved : cfg.def;
    if (v === cfg.def) delete document.documentElement.dataset[name];
    else document.documentElement.dataset[name] = v;
  }
}

// ================= 사이드바 개인화 (통일성 유지 범위 안에서) =================
export const SIDEBAR_STYLES = ['default', 'compact', 'floating', 'glass', 'retro'];
export const SIDEBAR_WIDTH_MIN = 176;
export const SIDEBAR_WIDTH_MAX = 300;
const SIDEBAR_WIDTH_DEFAULT = 220;

export async function getSidebarWidth() {
  const n = Number(await window.itda.settings.get('sidebar_width'));
  return n >= SIDEBAR_WIDTH_MIN && n <= SIDEBAR_WIDTH_MAX ? n : SIDEBAR_WIDTH_DEFAULT;
}

export async function getSidebarStyle() {
  const s = await window.itda.settings.get('sidebar_style');
  return SIDEBAR_STYLES.includes(s) ? s : 'default';
}

export async function applySidebarPersonalization() {
  const sb = document.getElementById('sidebar');
  document.documentElement.style.setProperty('--sidebar-w', (await getSidebarWidth()) + 'px');
  if (!sb) return;
  const style = await getSidebarStyle();
  SIDEBAR_STYLES.forEach((s) => sb.classList.toggle('sb-' + s, s === style));
  sb.classList.toggle('icon-only', (await window.itda.settings.get('sidebar_labels')) === 'icon');
}

export async function setSidebarSetting(key, value) {
  await window.itda.settings.set({ key, value: String(value) });
  await applySidebarPersonalization();
}

// 우측 하단 빠른 입력(+) 버튼 표시/숨김 — 숨겨도 ⌘K 단축키는 그대로 동작한다.
export async function applyFabVisibility() {
  const hidden = (await window.itda.settings.get('fab_hidden')) === '1';
  document.body.classList.toggle('fab-hidden', hidden);
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
// 예전엔 10%씩 6단계 드롭다운이었는데, 더 세밀하게 조절하고 싶다는 요청으로 슬라이더(5% 단위)로
// 바꿨다 — 그래서 고정 목록 대신 범위로 검증한다.
export const DISPLAY_SCALE_MIN = 50;
export const DISPLAY_SCALE_MAX = 200;
export const DISPLAY_SCALE_STEP = 5;
const DEFAULT_DISPLAY_SCALE = 100;

export async function getDisplayScale() {
  const saved = await window.itda.settings.get('display_scale');
  const n = Number(saved);
  return n >= DISPLAY_SCALE_MIN && n <= DISPLAY_SCALE_MAX ? n : DEFAULT_DISPLAY_SCALE;
}

export async function applyDisplayScale() {
  const scale = await getDisplayScale();
  document.documentElement.style.zoom = String(scale / 100);
}

export async function setDisplayScale(scale) {
  const oldScale = await getDisplayScale();
  if (oldScale !== scale) await rescaleDashboardLayout(oldScale, scale);
  await window.itda.settings.set({ key: 'display_scale', value: String(scale) });
  await applyDisplayScale();
}

// 배율이 바뀌면 CSS zoom이 폰트/레이아웃을 전부 다시 흘려보내면서, zoom 아래에서 측정되는
// "유효 CSS px" 폭 자체가 달라진다(zoom이 클수록 같은 물리 화면에 들어가는 CSS px가 줄어듦).
// 그런데 대시보드 위젯은 이미 확정된 픽셀 좌표(x/y/w/h)로 절대 배치돼 있어서, 이 변화에
// 맞춰 저절로 다시 흐르지 않고 그대로 남아있다가 좁아진 폭에서 넘치거나(고배율) 남는
// 공간을 못 채우고(저배율) 만다. 좌표를 (이전배율/새배율) 비율로 그대로 곱해주면 카드들의
// 상대적인 배치/비율은 그대로 유지한 채 새 유효 폭에 맞게 같이 줄었다 늘었다 한다.
const MIN_WIDGET_W = 260;
const MIN_WIDGET_H = 140;
async function rescaleDashboardLayout(oldScale, newScale) {
  const ratio = oldScale / newScale;
  try {
    const raw = await window.itda.settings.get('dashboard_layout');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.widgets) {
        const widgets = {};
        Object.entries(parsed.widgets).forEach(([id, p]) => {
          widgets[id] = {
            x: Math.max(0, Math.round(p.x * ratio)),
            y: Math.max(0, Math.round(p.y * ratio)),
            w: Math.max(MIN_WIDGET_W, Math.round(p.w * ratio)),
            h: Math.max(MIN_WIDGET_H, Math.round(p.h * ratio)),
          };
        });
        await window.itda.settings.set({ key: 'dashboard_layout', value: JSON.stringify({ preset: parsed.preset, widgets }) });
      }
    }
  } catch (e) {
    // 저장된 배치가 없거나 깨졌으면 그냥 둔다 — 다음에 대시보드를 열 때 기본 배치로 다시 계산됨
  }
  try {
    const rawWidth = await window.itda.settings.get('dashboard_side_width');
    const n = Number(rawWidth);
    if (n) await window.itda.settings.set({ key: 'dashboard_side_width', value: String(Math.round(n * ratio)) });
  } catch (e) {
    // 무시 — 다음에 열 때 기본 폭으로 대체됨
  }
}

// 글꼴 — Pretendard(기본)/손글씨 3종은 로컬 번들(woff2, OFL 라이선스)이라 항상 뜨고,
// 나머지는 전부 윈도우/맥에 이미 깔려있는 OS 기본 글꼴이라(별도 파일 없이) 병원 PC
// 오프라인 환경에서도 바로 동작한다.
export const FONT_FAMILY_OPTIONS = {
  pretendard: { label: 'Pretendard (기본)', stack: '"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif' },
  system: { label: '시스템 기본', stack: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif' },
  malgun: { label: '맑은 고딕', stack: '"Malgun Gothic","맑은 고딕",-apple-system,sans-serif' },
  dotum: { label: '돋움', stack: '"Dotum","돋움",-apple-system,sans-serif' },
  batang: { label: '바탕 (명조)', stack: '"Batang","바탕",serif' },
  jua: { label: '주아 (둥근 고딕)', stack: '"Jua",-apple-system,sans-serif' },
  dongle: { label: '동글 (아주 동글)', stack: '"Dongle",-apple-system,sans-serif' },
  gowundodum: { label: '고운돋움 (부드러움)', stack: '"Gowun Dodum",-apple-system,sans-serif' },
  himelody: { label: '하이멜로디 (아기자기)', stack: '"Hi Melody",-apple-system,sans-serif' },
  gaegu: { label: '개구쟁이 (손글씨)', stack: '"Gaegu",-apple-system,sans-serif' },
  gamjaflower: { label: '감자꽃 (손글씨)', stack: '"Gamja Flower",-apple-system,sans-serif' },
  nanumpen: { label: '나눔손글씨 펜', stack: '"Nanum Pen Script",-apple-system,sans-serif' },
};
const DEFAULT_FONT_FAMILY = 'pretendard';

export async function getFontFamily() {
  const saved = await window.itda.settings.get('font_family');
  return FONT_FAMILY_OPTIONS[saved] ? saved : DEFAULT_FONT_FAMILY;
}

export async function applyFontFamily() {
  const key = await getFontFamily();
  document.documentElement.style.setProperty('--app-font-family', FONT_FAMILY_OPTIONS[key].stack);
}

export async function setFontFamily(key) {
  await window.itda.settings.set({ key: 'font_family', value: key });
  await applyFontFamily();
}

// 윈도우에서 Alt 키를 두 번 연달아 누르거나 누르고 있으면 단축키 목록을 보여준다
// (main.js가 네이티브 메뉴를 꺼둬서 Alt가 메뉴 포커스로 뺏기지 않고 여기로 온다).
// 다른 키와 조합해서 누른 거면(=진짜 단축키 사용) 오버레이 대상이 아니다.
// 지금 열려있는 화면이 자기 화면 전용 단축키(예: 메모의 굵게/정렬)를 등록해두면
// Alt 오버레이가 전역 단축키 목록 아래에 이어서 보여준다. rebind 대상이 아닌 하드코딩된 단축키라
// SHORTCUTS(shortcuts.js)의 id/accelerator 체계 대신 {label, keys}만 받는 훨씬 단순한 형태.
// 화면이 바뀔 때마다 그 화면의 mount()가 등록하고 언마운트 시 반드시 비워야 다른 화면에서도 안 남는다.
let screenShortcutsTitle = '';
let screenShortcuts = [];
export function setScreenShortcuts(title, list) {
  screenShortcutsTitle = title || '';
  screenShortcuts = list || [];
}

function initAltShortcutOverlay() {
  let overlayEl = null;
  let holdTimer = null;
  let altCombined = false;
  let shownByHold = false;
  let lastAltUpTime = 0;
  const HOLD_MS = 500;
  const DOUBLE_TAP_MS = 400;

  function buildOverlay() {
    const el = document.createElement('div');
    el.className = 'alt-shortcuts-overlay';
    el.innerHTML = `
      <div class="alt-shortcuts-card">
        <h3>단축키</h3>
        <div class="alt-shortcuts-list">
          ${SHORTCUTS.map(
            (s) => `
            <div class="alt-shortcuts-row">
              <span>${escapeHtml(s.label)}</span>
              <kbd>${escapeHtml(labelForAccelerator(getCachedBinding(s.id)))}</kbd>
            </div>`
          ).join('')}
        </div>
        ${
          screenShortcuts.length
            ? `<div class="alt-shortcuts-subhead">${escapeHtml(screenShortcutsTitle)}</div>
               <div class="alt-shortcuts-list">
                 ${screenShortcuts
                   .map(
                     (s) => `
                   <div class="alt-shortcuts-row">
                     <span>${escapeHtml(s.label)}</span>
                     <kbd>${escapeHtml(s.keys)}</kbd>
                   </div>`
                   )
                   .join('')}
               </div>`
            : ''
        }
        <p class="alt-shortcuts-hint">Alt를 떼거나 Esc를 누르면 닫혀요</p>
      </div>`;
    return el;
  }

  function showOverlay(byHold) {
    if (overlayEl) return;
    shownByHold = byHold;
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
  }
  function hideOverlay() {
    overlayEl?.remove();
    overlayEl = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !e.repeat) {
      altCombined = false;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => showOverlay(true), HOLD_MS);
      return;
    }
    if (e.altKey && e.key !== 'Alt') altCombined = true; // Alt+무언가 = 실제 단축키 조합, 오버레이 대상 아님
    if (e.key === 'Escape' && overlayEl) hideOverlay();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt') return;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (altCombined) {
      altCombined = false;
      return;
    }
    if (shownByHold) {
      hideOverlay();
      return;
    }
    const now = Date.now();
    if (now - lastAltUpTime < DOUBLE_TAP_MS) {
      showOverlay(false);
      lastAltUpTime = 0; // 연타로 계속 다시 열리지 않게
    } else {
      lastAltUpTime = now;
    }
  });
  window.addEventListener('blur', () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    altCombined = false;
    if (overlayEl && shownByHold) hideOverlay(); // 창 밖으로 포커스가 빠지면(Alt+Tab 등) keyup을 못 받으니 여기서 정리
  });
}

export async function initShell() {
  await preloadShortcuts(); // 아래 키다운 리스너들이 걸리기 전에 사용자가 바꾼 단축키를 먼저 읽어둠
  await applyTheme();
  await applyUiAdjusts();
  await applySidebarPersonalization();
  await applyFabVisibility();
  await applyDisplayScale();
  await applyFontFamily();
  await initSidebarCollapse();
  await applySidebarUserName();
  initQuickCapture();
  initGlobalTopbar();
  initEventReminders(refreshGlobalNotifications); // 일정 전 알림(설정 > 편의 기능) — 30초마다 확인
  initUpdateOverlay(); // 수동 업데이트 모드의 다운로드 진행/재시작 확인을 화면과 무관하게 전역으로 표시
  initErrorSafetyNet();
  initCommandPalette({ openQuickCapture }); // Ctrl/Cmd+Shift+P — 어느 화면에서든 주요 동작을 키보드로 바로 실행
  initAltShortcutOverlay();
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
