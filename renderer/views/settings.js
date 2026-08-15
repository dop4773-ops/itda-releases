import { escapeHtml, toast, errorToast } from '../shared/ui-utils.js';
import { applyTheme, getUserName, applySidebarUserName, DISPLAY_SCALE_OPTIONS, getDisplayScale, setDisplayScale, getFontFamily, setFontFamily, getTextColorOverride, setTextColorOverride, resetTextColorOverride } from '../shared/shell.js';
import { lockNow } from '../shared/lock-screen.js';
import { mountTagsPanel, TAG_ICON } from './tags.js';

const LOCK_SHORTCUT_HINT = navigator.platform?.toUpperCase().includes('MAC') ? '⌘⌥L' : 'Ctrl+Alt+L';

const SETTINGS_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
const DISPLAY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const CAL_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const BACKUP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0018 0V5"/><path d="M3 12a9 3 0 0018 0"/></svg>`;
const UPDATE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 22v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L21 8M3 16l2.64 2.36A9 9 0 0020.49 15"/></svg>`;

const WIDGET_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;
const KEY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const LOCK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
const SLIDERS_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>`;

export const TABS = [
  { id: 'display', label: '화면', icon: DISPLAY_ICON },
  { id: 'tags', label: '태그', icon: TAG_ICON },
  { id: 'widgets', label: '위젯', icon: WIDGET_ICON },
  { id: 'shortcuts', label: '단축키', icon: KEY_ICON },
  { id: 'security', label: '보안', icon: LOCK_ICON },
  { id: 'convenience', label: '편의 기능', icon: SLIDERS_ICON },
  { id: 'gcal', label: 'Google Calendar', icon: CAL_ICON },
  { id: 'data', label: '데이터 & 백업', icon: BACKUP_ICON },
  { id: 'update', label: '업데이트', icon: UPDATE_ICON },
];

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon">${SETTINGS_ICON}</div>
        <div><h1>설정</h1><p>잇다를 내 방식대로 설정하고 관리하세요.</p></div>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-tabs">
        ${TABS.map((t, i) => `<button class="settings-tab ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}
      </div>
      <div class="settings-content">
        <div class="settings-panel active" data-panel="display">
          <div class="panel" style="margin-bottom:16px;">
            <div class="panel-head"><h3>사용자 정보</h3></div>
            <div class="form-row">
              <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;flex:1;max-width:220px;">
                이름
                <input type="text" id="user-nameInput" class="input" placeholder="이름을 입력하세요" />
              </label>
            </div>
            <p style="font-size:11px;color:var(--text-faint);margin:8px 0 0;">사이드바와 대시보드 인사말에 반영돼요.</p>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>화면</h3></div>
            <div class="update-row">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">다크 모드</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">어두운 화면으로 바꿔요. 다른 테마(색상 선택 등)는 추후 추가될 예정이에요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="theme-darkToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">화면 배율</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">글씨/버튼 크기를 키우거나 줄여요. 저해상도 모니터에서 화면이 너무 작게 보일 때 조정해보세요.</div>
              </div>
              <select id="display-scaleSelect" class="select" style="width:90px;">
                ${DISPLAY_SCALE_OPTIONS.map((v) => `<option value="${v}">${v}%</option>`).join('')}
              </select>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">글꼴</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">Pretendard는 둥글고 부드러운 느낌, 시스템 기본은 윈도우 맑은 고딕 등 OS 기본 글꼴이에요.</div>
              </div>
              <select id="display-fontSelect" class="select" style="width:140px;">
                <option value="pretendard">Pretendard (기본)</option>
                <option value="system">시스템 기본</option>
              </select>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">라이트 모드 글자색</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">화면 전체 기본 글자색이에요. 잘못 골라서 안 보이게 되면 옆 "기본값" 버튼으로 되돌리세요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="color" id="display-textColorLight" class="rich-color-btn" style="width:30px;height:30px;" />
                <button class="btn-danger" id="display-textColorLightReset">기본값</button>
              </div>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">다크 모드 글자색</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">다크 모드일 때만 적용돼요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="color" id="display-textColorDark" class="rich-color-btn" style="width:30px;height:30px;" />
                <button class="btn-danger" id="display-textColorDarkReset">기본값</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="tags">
          <div id="tags-panelRoot"></div>
        </div>

        <div class="settings-panel" data-panel="widgets">
          <div class="panel">
            <div class="panel-head"><h3>위젯</h3></div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 12px;">
              바탕화면에 항상 떠있는 작은 창들이에요. 여기서는 어떤 위젯을 쓸지 켜고 끌 수 있고,
              실제로 여는 건 각 화면(Todo/일정/메모/포스트잇/Inbox) 상단의 위젯 아이콘 버튼을 누르면 돼요.
              위치와 크기는 옮긴 대로 기억됩니다.
            </p>
            <div id="widget-list"></div>
          </div>
        </div>

        <div class="settings-panel" data-panel="shortcuts">
          <div class="panel">
            <div class="panel-head"><h3>단축키</h3></div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 12px;">
              지금은 아래 단축키가 고정으로 적용돼요. 나중에 원하는 키로 직접 바꿀 수 있는 기능을 추가할 예정이에요.
            </p>
            <div class="shortcut-list">
              <div class="shortcut-row"><span>어디서든 빠른 입력 (Inbox에 바로 저장) — 잇다 안에서</span><kbd>Ctrl/⌘ + K</kbd></div>
              <div class="shortcut-row"><span>어디서든 빠른 입력 — 다른 프로그램을 쓰고 있어도 (전역 단축키)</span><kbd>Ctrl/⌘ + Alt + I</kbd></div>
              <div class="shortcut-row"><span>빠른 실행 (원하는 화면·태그·항목으로 바로 이동)</span><kbd>Ctrl/⌘ + Shift + P</kbd></div>
              <div class="shortcut-row"><span>사이드바 접기/펼치기</span><kbd>Ctrl/⌘ + \\</kbd></div>
              <div class="shortcut-row"><span>지금 잠그기 — 다른 프로그램을 쓰고 있어도 (전역 단축키)</span><kbd>Ctrl/⌘ + Alt + L</kbd></div>
              <div class="shortcut-row"><span>열려있는 패널·모달·위젯 닫기</span><kbd>Esc</kbd></div>
              <div class="shortcut-row"><span>빠른 입력창에서 저장</span><kbd>Enter</kbd></div>
            </div>
            <p style="font-size:11px;color:var(--text-faint);margin:10px 0 0;">
              전역 단축키는 다른 프로그램이 같은 조합을 이미 쓰고 있으면 동작하지 않을 수 있어요.
            </p>
          </div>
        </div>

        <div class="settings-panel" data-panel="security">
          <div class="panel">
            <div class="panel-head"><h3>비밀번호 잠금</h3></div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 12px;">
              켜두면 잇다를 실행할 때마다 비밀번호를 입력해야 열려요. 비밀번호는 이 PC에만 저장되고 외부로 전송되지 않아요.
            </p>
            <div id="security-panelBody">불러오는 중…</div>
          </div>
        </div>

        <div class="settings-panel" data-panel="convenience">
          <div class="panel">
            <div class="panel-head"><h3>편의 기능</h3></div>
            <div class="update-row">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">업데이트 자동 확인</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">앱을 켤 때마다 새 버전이 있는지 조용히 한 번 확인해요(다운로드는 안 함). 꺼도 설정 → 업데이트에서 직접 확인할 수 있어요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="conv-autoUpdateToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">윈도우 시작 시 자동 실행</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">컴퓨터를 켜면 잇다가 자동으로 함께 실행돼요(트레이로 시작). 패키징된 설치 버전에서만 켤 수 있어요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="conv-autoLaunchToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text);">관련 항목 자동 추천</div>
                <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">Todo·일정·메모·포스트잇 상세에서 "🔗 연결된 항목" 아래에 같은 태그·비슷한 내용의 항목을 자동으로 추천해줘요. 꺼도 직접 연결하는 기능은 그대로 써요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="conv-autoSuggestToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="gcal">
          <div class="panel">
            <div class="panel-head"><h3>Google Calendar</h3></div>
            <p style="font-size:12px;color:var(--text-faint);margin:0 0 12px;">
              읽기 전용으로만 연동돼요. 잇다에서 만든 일정은 Google로 올라가지 않고, Google 쪽 일정도 잇다에서 수정·삭제할 수 없어요.
            </p>
            <div id="gcal-panel"><div class="empty">불러오는 중…</div></div>
          </div>
        </div>

        <div class="settings-panel" data-panel="data">
          <div class="panel">
            <div class="panel-head"><h3>데이터 & 백업</h3></div>
            <div class="data-action-row">
              <div><b>데이터 백업</b><span>전체 데이터를 백업 파일로 저장합니다.</span></div>
              <button class="btn-secondary" id="data-backupBtn">백업하기</button>
            </div>
            <div class="data-action-row">
              <div><b>데이터 복원</b><span>백업된 파일에서 데이터를 복원합니다. (복원 후 앱 재시작)</span></div>
              <button class="btn-secondary" id="data-restoreBtn">복원하기</button>
            </div>
            <div class="data-action-row">
              <div><b>모든 데이터 내보내기</b><span>JSON 파일로 내보내기 (다른 기기에서 가져오기 가능)</span></div>
              <button class="btn-secondary" id="data-exportBtn">내보내기</button>
            </div>
            <div class="data-action-row">
              <div><b>JSON 데이터 가져오기</b><span>내보낸 JSON 파일을 지금 잇다에 추가로 불러옵니다(기존 데이터 유지).</span></div>
              <button class="btn-secondary" id="data-importBtn">가져오기</button>
            </div>
            <div class="data-action-row danger-row">
              <div><b>모든 데이터 삭제</b><span>Todo·일정·메모·포스트잇·Inbox·연결·휴지통이 영구적으로 삭제됩니다.</span></div>
              <button class="btn-danger" id="data-deleteBtn">삭제하기</button>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="update">
          <div class="panel">
            <div class="panel-head"><h3>업데이트</h3></div>
            <div class="update-row">
              <div>
                <div id="upd-version" style="font-size:13px;font-weight:600;color:var(--text);">버전 확인 중…</div>
                <div id="upd-status" style="font-size:12px;color:var(--text-faint);margin-top:2px;">-</div>
              </div>
              <div id="upd-actions"></div>
            </div>
            <div id="upd-releaseNotes" class="update-release-notes" style="display:none;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);

  // ================= 탭 전환 =================
  root.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t === tab));
      root.querySelectorAll('.settings-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    });
  });

  // ================= 사용자 정보 =================
  async function initUserPanel() {
    const input = $('user-nameInput');
    input.value = await getUserName();
    let saveTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await window.itda.settings.set({ key: 'user_name', value: input.value.trim() });
          await applySidebarUserName(); // 사이드바에도 즉시 반영
        } catch (e) {
          errorToast(e, '이름을 저장하지 못했어요');
        }
      }, 500);
    });
  }

  // ================= 화면 (다크모드 + 배율) =================
  async function initDisplayPanel() {
    const toggle = $('theme-darkToggle');
    const current = await window.itda.settings.get('theme');
    toggle.checked = current === 'dark';
    toggle.addEventListener('change', async () => {
      const value = toggle.checked ? 'dark' : 'light';
      try {
        await window.itda.settings.set({ key: 'theme', value });
        await applyTheme();
      } catch (e) {
        errorToast(e, '테마를 저장하지 못했어요');
        toggle.checked = !toggle.checked;
      }
    });

    const scaleSelect = $('display-scaleSelect');
    scaleSelect.value = String(await getDisplayScale());
    scaleSelect.addEventListener('change', async () => {
      const prev = scaleSelect.dataset.prev || scaleSelect.value;
      try {
        await setDisplayScale(Number(scaleSelect.value));
        scaleSelect.dataset.prev = scaleSelect.value;
      } catch (e) {
        errorToast(e, '화면 배율을 저장하지 못했어요');
        scaleSelect.value = prev;
      }
    });
    scaleSelect.dataset.prev = scaleSelect.value;

    const fontSelect = $('display-fontSelect');
    fontSelect.value = await getFontFamily();
    fontSelect.addEventListener('change', async () => {
      const prev = fontSelect.dataset.prev || fontSelect.value;
      try {
        await setFontFamily(fontSelect.value);
        fontSelect.dataset.prev = fontSelect.value;
      } catch (e) {
        errorToast(e, '글꼴을 저장하지 못했어요');
        fontSelect.value = prev;
      }
    });
    fontSelect.dataset.prev = fontSelect.value;

    // 기본 CSS 값 — 사용자가 지정 안 했을 때 색상피커에 뭐라도 보여주기 위함(실제 적용 여부와는 별개)
    const DEFAULT_TEXT_COLOR = { light: '#2B2E3A', dark: '#E8E9EE' };
    async function initTextColorRow(theme, inputId, resetId) {
      const input = $(inputId);
      const override = await getTextColorOverride(theme);
      input.value = override || DEFAULT_TEXT_COLOR[theme];
      input.addEventListener('input', async () => {
        try {
          await setTextColorOverride(theme, input.value);
        } catch (e) {
          errorToast(e, '글자색을 저장하지 못했어요');
        }
      });
      $(resetId).addEventListener('click', async () => {
        try {
          await resetTextColorOverride(theme);
          input.value = DEFAULT_TEXT_COLOR[theme];
          toast('기본 글자색으로 되돌렸어요');
        } catch (e) {
          errorToast(e, '되돌리지 못했어요');
        }
      });
    }
    await initTextColorRow('light', 'display-textColorLight', 'display-textColorLightReset');
    await initTextColorRow('dark', 'display-textColorDark', 'display-textColorDarkReset');
  }

  // ================= 보안 (실행 시 비밀번호 잠금) =================
  async function loadSecurityPanel() {
    const body = $('security-panelBody');
    let status;
    try {
      status = await window.itda.auth.getStatus();
    } catch (e) {
      body.innerHTML = `<p style="font-size:12.5px;color:var(--danger);">상태를 확인하지 못했어요.</p>`;
      return;
    }

    if (!status.enabled) {
      body.innerHTML = `
        <div class="update-row">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text);">잠금 꺼짐</div>
            <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">비밀번호 없이 바로 열려요.</div>
          </div>
          <button class="btn-secondary" id="sec-enableBtn">비밀번호 설정</button>
        </div>
        <div class="form-row" id="sec-setForm" style="display:none;margin-top:12px;border-top:1px solid var(--divider);padding-top:12px;">
          <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;flex:1;max-width:220px;">
            새 비밀번호 (4자 이상)
            <input type="password" id="sec-newPw" class="input" autocomplete="new-password" />
          </label>
          <button class="btn" id="sec-setSaveBtn" style="align-self:flex-end;">저장</button>
        </div>
        <div id="sec-error" style="display:none;font-size:11.5px;color:var(--danger);margin-top:6px;"></div>
      `;
      $('sec-enableBtn').addEventListener('click', () => {
        $('sec-setForm').style.display = 'flex';
        $('sec-newPw').focus();
      });
      $('sec-setSaveBtn').addEventListener('click', async () => {
        const pw = $('sec-newPw').value;
        const errEl = $('sec-error');
        errEl.style.display = 'none';
        try {
          await window.itda.auth.setPassword({ newPassword: pw });
          toast('비밀번호 잠금을 켰어요');
          await loadSecurityPanel();
        } catch (e) {
          errEl.textContent = e.message || '저장하지 못했어요';
          errEl.style.display = 'block';
        }
      });
    } else {
      body.innerHTML = `
        <div class="update-row">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text);">잠금 켜짐</div>
            <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">실행할 때마다 비밀번호를 입력해야 해요.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" id="sec-lockNowBtn">지금 잠그기</button>
            <button class="btn-secondary" id="sec-changeBtn">비밀번호 변경</button>
            <button class="btn-secondary" id="sec-disableBtn" style="color:var(--danger);">잠금 끄기</button>
          </div>
        </div>
        <p style="font-size:11px;color:var(--text-faint);margin:8px 0 0;">단축키 ${LOCK_SHORTCUT_HINT}로 어디서든 바로 잠글 수 있어요.</p>
        <div class="form-row" id="sec-changeForm" style="display:none;flex-direction:column;gap:8px;margin-top:12px;border-top:1px solid var(--divider);padding-top:12px;max-width:260px;">
          <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;">
            현재 비밀번호
            <input type="password" id="sec-curPw" class="input" autocomplete="current-password" />
          </label>
          <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;">
            새 비밀번호 (4자 이상)
            <input type="password" id="sec-newPw2" class="input" autocomplete="new-password" />
          </label>
          <button class="btn" id="sec-changeSaveBtn">변경 저장</button>
        </div>
        <div id="sec-error" style="display:none;font-size:11.5px;color:var(--danger);margin-top:6px;"></div>
      `;
      $('sec-lockNowBtn').addEventListener('click', () => lockNow());
      $('sec-changeBtn').addEventListener('click', () => {
        $('sec-changeForm').style.display = 'flex';
        $('sec-curPw').focus();
      });
      $('sec-changeSaveBtn').addEventListener('click', async () => {
        const errEl = $('sec-error');
        errEl.style.display = 'none';
        try {
          await window.itda.auth.setPassword({
            currentPassword: $('sec-curPw').value,
            newPassword: $('sec-newPw2').value,
          });
          toast('비밀번호를 변경했어요');
          await loadSecurityPanel();
        } catch (e) {
          errEl.textContent = e.message || '변경하지 못했어요';
          errEl.style.display = 'block';
        }
      });
      $('sec-disableBtn').addEventListener('click', async () => {
        const pw = prompt('잠금을 끄려면 현재 비밀번호를 입력해주세요');
        if (pw === null) return;
        try {
          await window.itda.auth.disable({ currentPassword: pw });
          toast('비밀번호 잠금을 껐어요');
          await loadSecurityPanel();
        } catch (e) {
          errorToast(e, '잠금을 끄지 못했어요');
        }
      });
    }
  }

  // ================= 편의 기능 (업데이트 자동확인 / 윈도우 자동실행 / 관련 항목 자동추천) =================
  async function initConveniencePanel() {
    const autoUpdateToggle = $('conv-autoUpdateToggle');
    // 값이 아예 없던 적(신규 설치 직후)엔 켜진 것으로 취급 — main/updater/index.js의 기본값과 맞춤
    autoUpdateToggle.checked = (await window.itda.settings.get('update_auto_check')) !== '0';
    autoUpdateToggle.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'update_auto_check', value: autoUpdateToggle.checked ? '1' : '0' });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        autoUpdateToggle.checked = !autoUpdateToggle.checked;
      }
    });

    const autoLaunchToggle = $('conv-autoLaunchToggle');
    let autoLaunchStatus;
    try {
      autoLaunchStatus = await window.itda.app.getAutoLaunch();
    } catch (e) {
      autoLaunchStatus = { enabled: false };
    }
    autoLaunchToggle.checked = autoLaunchStatus.enabled;
    autoLaunchToggle.addEventListener('change', async () => {
      try {
        await window.itda.app.setAutoLaunch(autoLaunchToggle.checked);
      } catch (e) {
        errorToast(e, e.message || '개발 모드에서는 켤 수 없어요');
        autoLaunchToggle.checked = !autoLaunchToggle.checked;
      }
    });

    const autoSuggestToggle = $('conv-autoSuggestToggle');
    // 값이 아예 없던 적(신규 설치 직후)엔 켜진 것으로 취급 — 지금까지의 기본 동작과 맞춤
    autoSuggestToggle.checked = (await window.itda.settings.get('links_auto_suggest')) !== '0';
    autoSuggestToggle.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'links_auto_suggest', value: autoSuggestToggle.checked ? '1' : '0' });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        autoSuggestToggle.checked = !autoSuggestToggle.checked;
      }
    });
  }

  // ================= Google Calendar 연동 =================
  function formatSyncedAt(iso) {
    if (!iso) return '';
    return iso.replace('T', ' ').slice(0, 16);
  }

  async function loadGcalPanel() {
    const panel = $('gcal-panel');
    let status;
    try {
      status = await window.itda.googleCalendar.status();
    } catch (e) {
      panel.innerHTML = `<p style="font-size:12.5px;color:var(--danger);">상태를 확인하지 못했어요.</p>`;
      return;
    }

    if (!status.hasCredentialsFile) {
      panel.innerHTML = `
        <p style="font-size:12.5px;color:var(--text-soft);">
          연동 파일이 아직 없어요. Google Cloud Console에서 발급받은 OAuth 클라이언트 JSON을
          <code style="background:var(--bg);padding:1px 5px;border-radius:4px;">config/google-credentials.json</code>
          경로에 넣어주세요.
        </p>`;
      return;
    }

    if (status.connected) {
      panel.innerHTML = `
        <div class="update-row">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text);">연결됨</div>
            <div style="font-size:12px;color:var(--text-faint);margin-top:2px;">
              ${status.lastSyncedAt ? `마지막 동기화: ${formatSyncedAt(status.lastSyncedAt)}` : '아직 동기화 전이에요'}
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" id="gcal-syncBtn">지금 동기화</button>
            <button class="btn-secondary" id="gcal-disconnectBtn" style="color:var(--danger);">연결 해제</button>
          </div>
        </div>
        <div class="form-row" style="margin-top:12px;border-top:1px solid var(--divider);padding-top:12px;">
          <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;flex:1;">
            동기화할 캘린더
            <select id="gcal-calendarSelect" class="select">
              <option value="">불러오는 중…</option>
            </select>
          </label>
        </div>`;
      $('gcal-syncBtn').addEventListener('click', async () => {
        $('gcal-syncBtn').disabled = true;
        try {
          const result = await window.itda.googleCalendar.syncNow();
          toast(`${result.count}건 동기화했어요`);
          await loadGcalPanel();
        } catch (e) {
          errorToast(e, '동기화하지 못했어요');
          $('gcal-syncBtn').disabled = false;
        }
      });
      $('gcal-disconnectBtn').addEventListener('click', async () => {
        try {
          await window.itda.googleCalendar.disconnect();
          toast('연결을 해제했어요');
          await loadGcalPanel();
        } catch (e) {
          errorToast(e, '연결 해제하지 못했어요');
        }
      });

      const select = $('gcal-calendarSelect');
      try {
        const calendars = await window.itda.googleCalendar.listCalendars();
        select.innerHTML = calendars
          .map(
            (c) =>
              `<option value="${escapeHtml(c.id)}" ${c.id === status.selectedCalendar.id ? 'selected' : ''}>${escapeHtml(c.summary)}${c.primary ? ' (기본)' : ''}</option>`
          )
          .join('');
      } catch (e) {
        select.innerHTML = `<option value="">캘린더 목록을 불러오지 못했어요</option>`;
        errorToast(e, '캘린더 목록을 불러오지 못했어요. 콘솔 로그를 확인해주세요.');
        return;
      }
      select.addEventListener('change', async () => {
        const option = select.selectedOptions[0];
        select.disabled = true;
        try {
          const result = await window.itda.googleCalendar.selectCalendar({ id: select.value, name: option.textContent });
          toast(`"${option.textContent}" 캘린더로 동기화했어요 (${result.count}건)`);
          await loadGcalPanel();
        } catch (e) {
          errorToast(e, '캘린더를 변경하지 못했어요');
          select.disabled = false;
        }
      });
    } else {
      panel.innerHTML = `
        <div class="update-row">
          <div style="font-size:12.5px;color:var(--text-soft);">아직 연결되지 않았어요.</div>
          <button class="btn" id="gcal-connectBtn">Google Calendar 연결하기</button>
        </div>`;
      $('gcal-connectBtn').addEventListener('click', async () => {
        $('gcal-connectBtn').disabled = true;
        $('gcal-connectBtn').textContent = '브라우저에서 로그인 중…';
        try {
          const result = await window.itda.googleCalendar.connect();
          toast(`연결됐어요 (${result.count}건 동기화)`);
          await loadGcalPanel();
        } catch (e) {
          errorToast(e, '연결하지 못했어요');
          await loadGcalPanel();
        }
      });
    }
  }

  // ================= 위젯 =================
  const WIDGET_META = {
    'today-schedule': { label: '오늘 일정', desc: '오늘 하루 일정을 시간순으로' },
    'today-todo': { label: '오늘 할 일', desc: '오늘 마감인 할 일 체크리스트' },
    'postit-board': { label: '포스트잇', desc: '최근 포스트잇 미니 보드' },
    'quick-memo': { label: '빠른 메모', desc: '최근 메모 목록' },
    'google-calendar-mini': { label: '구글 캘린더', desc: '이번 달 미니 달력 (읽기 전용)' },
    inbox: { label: '받은 업무 (Inbox)', desc: '아직 처리 안 한 Inbox 항목' },
    dday: { label: 'D-DAY', desc: '가까운 마감일 순으로' },
  };

  async function loadWidgetsPanel() {
    const listEl = $('widget-list');
    let statuses;
    try {
      statuses = await window.itda.widgets.listStatus();
    } catch (e) {
      listEl.innerHTML = `<p style="font-size:12.5px;color:var(--danger);">위젯 상태를 불러오지 못했어요.</p>`;
      return;
    }

    listEl.innerHTML = statuses
      .map(
        ({ type, open }) => `
        <div class="data-action-row">
          <div><b>${WIDGET_META[type]?.label || type}</b><span>${WIDGET_META[type]?.desc || ''}</span></div>
          <label class="switch">
            <input type="checkbox" data-type="${type}" ${open ? 'checked' : ''} />
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        const type = toggle.dataset.type;
        try {
          if (toggle.checked) await window.itda.widgets.open(type);
          else await window.itda.widgets.close(type);
        } catch (e) {
          errorToast(e, '위젯을 전환하지 못했어요');
          toggle.checked = !toggle.checked;
        }
      });
    });
  }

  // ================= 데이터 & 백업 =================
  function initDataPanel() {
    $('data-backupBtn').addEventListener('click', async () => {
      $('data-backupBtn').disabled = true;
      try {
        const result = await window.itda.data.backup();
        if (!result.cancelled) toast('백업을 저장했어요');
      } catch (e) {
        errorToast(e, '백업하지 못했어요');
      } finally {
        $('data-backupBtn').disabled = false;
      }
    });

    $('data-restoreBtn').addEventListener('click', async () => {
      $('data-restoreBtn').disabled = true;
      try {
        const result = await window.itda.data.restore();
        if (result.cancelled) $('data-restoreBtn').disabled = false;
        // 취소 안 됐으면 앱이 곧 재시작되므로 여기서 더 할 일 없음
      } catch (e) {
        errorToast(e, '복원하지 못했어요');
        $('data-restoreBtn').disabled = false;
      }
    });

    $('data-exportBtn').addEventListener('click', async () => {
      $('data-exportBtn').disabled = true;
      try {
        const result = await window.itda.data.exportJson();
        if (!result.cancelled) toast('JSON으로 내보냈어요');
      } catch (e) {
        errorToast(e, '내보내지 못했어요');
      } finally {
        $('data-exportBtn').disabled = false;
      }
    });

    $('data-importBtn').addEventListener('click', async () => {
      $('data-importBtn').disabled = true;
      try {
        const result = await window.itda.data.importJson();
        if (!result.cancelled) {
          const c = result.counts || {};
          toast(`가져왔어요 (Todo ${c.todos ?? 0} · 일정 ${c.events ?? 0} · 메모 ${c.memos ?? 0} · 포스트잇 ${c.postits ?? 0})`);
        }
      } catch (e) {
        errorToast(e, '가져오지 못했어요');
      } finally {
        $('data-importBtn').disabled = false;
      }
    });

    $('data-deleteBtn').addEventListener('click', async () => {
      $('data-deleteBtn').disabled = true;
      try {
        const result = await window.itda.data.deleteAll();
        if (!result.cancelled) toast('모든 데이터를 삭제했어요');
      } catch (e) {
        errorToast(e, '삭제하지 못했어요');
      } finally {
        $('data-deleteBtn').disabled = false;
      }
    });
  }

  // ================= 업데이트 (GitHub Releases 기반, main/updater 참고) =================
  function renderUpdateActions(html) {
    $('upd-actions').innerHTML = html;
  }

  function applyUpdateStatus(data) {
    const statusEl = $('upd-status');
    const notesEl = $('upd-releaseNotes');
    if (data.status !== 'available') {
      notesEl.style.display = 'none';
      notesEl.textContent = '';
    }
    switch (data.status) {
      case 'dev-mode':
        statusEl.textContent = '개발 모드에서는 업데이트 확인을 지원하지 않아요.';
        renderUpdateActions('');
        break;
      case 'checking':
        statusEl.textContent = '업데이트를 확인하는 중…';
        renderUpdateActions('');
        break;
      case 'not-available':
        statusEl.textContent = '최신 버전을 사용하고 있어요.';
        renderUpdateActions(`<button class="btn-secondary" id="upd-checkBtn">다시 확인</button>`);
        bindCheckBtn();
        break;
      case 'available':
        statusEl.textContent = `새 버전 ${data.version}이(가) 있어요.`;
        renderUpdateActions(`<button class="btn" id="upd-downloadBtn">다운로드</button>`);
        if (data.releaseNotes) {
          notesEl.textContent = data.releaseNotes;
          notesEl.style.display = 'block';
        }
        $('upd-downloadBtn').addEventListener('click', async () => {
          renderUpdateActions('');
          statusEl.textContent = '다운로드를 시작합니다…';
          await window.itda.updater.downloadUpdate();
        });
        break;
      case 'downloading':
        statusEl.textContent = `다운로드 중… ${data.percent ?? 0}%`;
        renderUpdateActions('');
        break;
      case 'downloaded':
        statusEl.textContent = `버전 ${data.version} 다운로드 완료. 재시작하면 적용돼요.`;
        renderUpdateActions(`<button class="btn" id="upd-installBtn">재시작 후 설치</button>`);
        $('upd-installBtn').addEventListener('click', () => window.itda.updater.quitAndInstall());
        break;
      case 'error':
        statusEl.textContent = `확인하지 못했어요: ${data.message || '알 수 없는 오류'}`;
        renderUpdateActions(`<button class="btn-secondary" id="upd-checkBtn">다시 시도</button>`);
        bindCheckBtn();
        break;
      case 'checked':
        break;
      default:
        break;
    }
  }

  function bindCheckBtn() {
    const btn = $('upd-checkBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      $('upd-status').textContent = '업데이트를 확인하는 중…';
      renderUpdateActions('');
      try {
        await window.itda.updater.checkNow();
      } catch (e) {
        errorToast(e, '업데이트 확인에 실패했어요');
      }
    });
  }

  async function initUpdatePanel() {
    try {
      const version = await window.itda.updater.getVersion();
      $('upd-version').textContent = `현재 버전 v${version}`;
    } catch (e) {
      $('upd-version').textContent = '버전 정보를 불러오지 못했어요';
    }
    renderUpdateActions(`<button class="btn-secondary" id="upd-checkBtn">업데이트 확인</button>`);
    bindCheckBtn();
  }

  const unsubscribeUpdater = window.itda.updater.onStatus(applyUpdateStatus);

  await initUserPanel();
  await initDisplayPanel();
  const unmountTagsPanel = await mountTagsPanel($('tags-panelRoot'));
  await loadWidgetsPanel();
  await loadSecurityPanel();
  await initConveniencePanel();
  initDataPanel();
  await initUpdatePanel();
  await loadGcalPanel();

  return () => {
    if (typeof unsubscribeUpdater === 'function') unsubscribeUpdater();
    if (typeof unmountTagsPanel === 'function') unmountTagsPanel();
  };
}
