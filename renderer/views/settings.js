import { escapeHtml, toast, errorToast, emptyStateBlock } from '../shared/ui-utils.js';
import { registerEscClose } from '../shared/esc-close.js';
import { wrapAutosave } from '../shared/pending-saves.js';
import { applyTheme, getUserName, applySidebarUserName, DISPLAY_SCALE_MIN, DISPLAY_SCALE_MAX, DISPLAY_SCALE_STEP, getDisplayScale, setDisplayScale, FONT_FAMILY_OPTIONS, getFontFamily, setFontFamily, getTextColorOverride, setTextColorOverride, resetTextColorOverride } from '../shared/shell.js';
import { lockNow } from '../shared/lock-screen.js';
import { mountTagsPanel, TAG_ICON } from './tags.js';
import { SHORTCUTS, getAllBindings, setBinding, getBinding, acceleratorFromEvent, isBareKey, findConflict, labelForAccelerator } from '../shared/shortcuts.js';
import { DASHBOARD_CARDS } from './dashboard.js';
import { LAYOUT_PRESETS, getPreset, scaleForPreview, WIDGET_CARD_IDS } from '../shared/dashboard-layouts.js';
import { promptText } from '../shared/text-prompt.js';

const SETTINGS_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`;
const DISPLAY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const CAL_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const BACKUP_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0018 0V5"/><path d="M3 12a9 3 0 0018 0"/></svg>`;
const UPDATE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 22v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L21 8M3 16l2.64 2.36A9 9 0 0020.49 15"/></svg>`;

const WIDGET_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;
const KEY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;
const LOCK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;
const SLIDERS_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>`;
const DASHBOARD_TAB_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
const TRASH_MINI_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

export const TABS = [
  { id: 'display', label: '화면', icon: DISPLAY_ICON, tone: 'blue' },
  { id: 'dashboard', label: '대시보드', icon: DASHBOARD_TAB_ICON, tone: 'purple' },
  { id: 'tags', label: '태그', icon: TAG_ICON, tone: 'yellow' },
  { id: 'widgets', label: '위젯', icon: WIDGET_ICON, tone: 'pink' },
  { id: 'shortcuts', label: '단축키', icon: KEY_ICON, tone: 'green' },
  { id: 'security', label: '보안', icon: LOCK_ICON, tone: 'danger' },
  { id: 'convenience', label: '편의 기능', icon: SLIDERS_ICON, tone: 'blue' },
  { id: 'gcal', label: 'Google Calendar', icon: CAL_ICON, tone: 'green' },
  { id: 'data', label: '데이터 & 백업', icon: BACKUP_ICON, tone: 'purple' },
  { id: 'update', label: '업데이트', icon: UPDATE_ICON, tone: 'pink' },
];

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon tone-blue">${SETTINGS_ICON}</div>
        <div><h1>설정</h1><p>잇다를 내 방식대로 설정하고 관리하세요.</p></div>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-tabs">
        ${TABS.map(
          (t, i) => `<button class="settings-tab tone-${t.tone} ${i === 0 ? 'active' : ''}" data-tab="${t.id}"><span class="settings-tab-icon">${t.icon}</span><span>${t.label}</span></button>`
        ).join('')}
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
                <div class="settings-row-title">다크 모드</div>
                <div class="settings-row-desc">어두운 화면으로 바꿔요. 다른 테마(색상 선택 등)는 추후 추가될 예정이에요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="theme-darkToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">화면 배율</div>
                <div class="settings-row-desc">글씨/버튼 크기를 키우거나 줄여요. 저해상도 모니터에서 화면이 너무 작게 보일 때 조정해보세요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="range" id="display-scaleRange" min="${DISPLAY_SCALE_MIN}" max="${DISPLAY_SCALE_MAX}" step="${DISPLAY_SCALE_STEP}" style="width:140px;" />
                <span id="display-scaleValue" style="font-size:12px;color:var(--text-soft);width:36px;text-align:right;">100%</span>
              </div>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">글꼴</div>
                <div class="settings-row-desc">목록에서 각 글꼴의 실제 모양을 미리 볼 수 있어요.</div>
              </div>
              <select id="display-fontSelect" class="select" style="width:140px;">
                ${Object.entries(FONT_FAMILY_OPTIONS)
                  .map(([key, f]) => `<option value="${key}" style='font-family:${f.stack};'>${escapeHtml(f.label)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">라이트 모드 글자색</div>
                <div class="settings-row-desc">화면 전체 기본 글자색이에요. 잘못 골라서 안 보이게 되면 옆 "기본값" 버튼으로 되돌리세요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="color" id="display-textColorLight" class="rich-color-btn" style="width:30px;height:30px;" />
                <button class="btn-danger" id="display-textColorLightReset">기본값</button>
              </div>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">다크 모드 글자색</div>
                <div class="settings-row-desc">다크 모드일 때만 적용돼요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="color" id="display-textColorDark" class="rich-color-btn" style="width:30px;height:30px;" />
                <button class="btn-danger" id="display-textColorDarkReset">기본값</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="dashboard">
          <div class="panel">
            <div class="panel-head"><h3>카드 구성</h3></div>
            <p class="settings-panel-desc">대시보드에 어떤 카드를 보여줄지 정해요. 카드 위치/크기는 대시보드에서 그립(⠿)을 드래그하거나 모서리를 끌어서 직접 바꿀 수 있어요.</p>
            <div id="dashboard-cardList"></div>
          </div>

          <div class="panel" style="margin-top:16px;">
            <div class="panel-head"><h3>배치 프리셋</h3></div>
            <p class="settings-panel-desc">미리 만들어둔 배치로 한 번에 정렬해요. 커서를 올리면 예시 구조를 볼 수 있어요. 이후에 직접 옮기거나 크기를 바꾼 카드는 그 위치가 우선돼요.</p>
            <div class="form-row" id="dashboard-presetList"></div>
            <div class="form-row" style="margin-top:10px;">
              <button class="btn-secondary" id="dashboard-savePresetBtn">현재 배치를 프리셋으로 저장</button>
              <button class="btn-secondary" id="dashboard-resetLayoutBtn">기본 배치로 되돌리기</button>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="tags">
          <div id="tags-panelRoot"></div>
        </div>

        <div class="settings-panel" data-panel="widgets">
          <div class="panel" style="margin-bottom:16px;">
            <div class="panel-head"><h3>위젯 화면</h3></div>
            <div class="update-row">
              <div>
                <div class="settings-row-title">투명도</div>
                <div class="settings-row-desc">위젯 창을 얼마나 비치게 할지 정해요. 이미 열려있는 위젯에도 바로 적용돼요.</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <input type="range" id="widget-opacityRange" min="40" max="100" step="5" style="width:120px;" />
                <span id="widget-opacityValue" style="font-size:12px;color:var(--text-faint);width:34px;text-align:right;">100%</span>
              </div>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">항상 위에 표시</div>
                <div class="settings-row-desc">아래 위젯들을 다른 프로그램 창보다 항상 앞에 띄워요. (포스트잇은 각자 핀 버튼으로 따로 정해요)</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="widget-alwaysOnTopToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><h3>위젯</h3></div>
            <p class="settings-panel-desc">
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
            <p class="settings-panel-desc">
              "변경"을 누르고 원하는 키 조합을 누르면 바로 바뀌어요. 다른 단축키와 겹치면 저장하지 않고 알려줘요.
            </p>
            <div class="shortcut-list" id="shortcuts-list"></div>
            <div class="shortcut-list" style="margin-top:8px;">
              <div class="shortcut-row"><span>열려있는 패널·모달·위젯 닫기</span><kbd>Esc</kbd></div>
              <div class="shortcut-row"><span>빠른 입력창에서 저장</span><kbd>Enter</kbd></div>
            </div>
            <p style="font-size:11px;color:var(--text-faint);margin:10px 0 0;">
              전역 단축키(다른 프로그램을 쓰고 있어도 동작하는 것)는 다른 프로그램이 같은 조합을 이미 쓰고 있으면 등록되지 않을 수 있어요.
            </p>
          </div>
        </div>

        <div class="settings-panel" data-panel="security">
          <div class="panel">
            <div class="panel-head"><h3>비밀번호 잠금</h3></div>
            <p class="settings-panel-desc">
              켜두면 잇다를 실행할 때마다 비밀번호를 입력해야 열려요. 비밀번호는 이 PC에만 저장되고 외부로 전송되지 않아요.
            </p>
            <div id="security-panelBody">불러오는 중…</div>
          </div>

          <div class="panel" style="margin-top:16px;">
            <div class="panel-head"><h3>잠긴 메모 목록 표시</h3></div>
            <p class="settings-panel-desc">
              메모를 개별로 잠그면(메모 화면에서 🔒) 목록에서 이 방식으로 보여요. 열 때는 위 비밀번호로 확인해요.
            </p>
            <div style="margin-top:10px;">
              <label class="data-action-row" style="cursor:pointer;">
                <div>
                  <b>잠긴 메모로 표시 <span class="badge badge-neutral">기본값</span></b>
                  <span>제목·내용 모두 가리고 "🔒 잠긴 메모"라고만 보여요</span>
                </div>
                <input type="radio" name="memo-lock-mode" id="memlock-hidden" value="hidden" />
              </label>
              <label class="data-action-row" style="cursor:pointer;">
                <div>
                  <b>제목만 표시</b>
                  <span>제목은 보이고 내용 미리보기만 가려요</span>
                </div>
                <input type="radio" name="memo-lock-mode" id="memlock-title" value="title" />
              </label>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="convenience">
          <div class="panel">
            <div class="panel-head"><h3>편의 기능</h3></div>
            <div class="update-row">
              <div>
                <div class="settings-row-title">윈도우 시작 시 자동 실행</div>
                <div class="settings-row-desc">컴퓨터를 켜면 잇다가 자동으로 함께 실행돼요(트레이로 시작). 패키징된 설치 버전에서만 켤 수 있어요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="conv-autoLaunchToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">관련 항목 자동 추천</div>
                <div class="settings-row-desc">Todo·일정·메모·포스트잇 상세에서 "🔗 연결된 항목" 아래에 같은 태그·비슷한 내용의 항목을 자동으로 추천해줘요. 꺼도 직접 연결하는 기능은 그대로 써요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="conv-autoSuggestToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
          </div>

          <div class="panel" style="margin-top:16px;">
            <div class="panel-head"><h3>일정 알림</h3></div>
            <div class="update-row">
              <div>
                <div class="settings-row-title">일정 전 알림</div>
                <div class="settings-row-desc">오늘 일정이 시작하기 전에 이 PC 알림으로 미리 알려줘요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="notif-eventEnabledToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">몇 분 전에 알릴지</div>
              </div>
              <select id="notif-leadSelect" class="select" style="width:100px;">
                <option value="5">5분 전</option>
                <option value="10">10분 전</option>
                <option value="15">15분 전</option>
                <option value="30">30분 전</option>
                <option value="60">1시간 전</option>
              </select>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">기본 다시 알림 (Snooze)</div>
                <div class="settings-row-desc">알림에서 "다시 알림"을 누르면 이 시간 뒤에 다시 알려줘요.</div>
              </div>
              <select id="notif-snoozeSelect" class="select" style="width:100px;">
                <option value="10">10분</option>
                <option value="30">30분</option>
                <option value="60">1시간</option>
                <option value="1440">내일</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-panel" data-panel="gcal">
          <div class="panel">
            <div class="panel-head"><h3>Google Calendar</h3></div>
            <p class="settings-panel-desc">
              읽기 전용으로만 연동돼요. 잇다에서 만든 일정은 Google로 올라가지 않고, Google 쪽 일정도 잇다에서 수정·삭제할 수 없어요.
            </p>
            <div id="gcal-panel"><div class="empty">불러오는 중…</div></div>
          </div>
        </div>

        <div class="settings-panel" data-panel="data">
          <div class="panel" style="margin-bottom:16px;">
            <div class="panel-head"><h3>자동 백업</h3></div>
            <div class="update-row">
              <div>
                <div class="settings-row-title">자동 백업</div>
                <div class="settings-row-desc">앱이 켜져 있는 동안 이 PC에 주기적으로 자동 저장돼요(백업 폴더에 최근 5개만 보관). 다른 위치로 직접 저장하려면 아래 "백업하기"를 쓰세요.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="backup-autoToggle" />
                <span class="switch-track"><span class="switch-thumb"></span></span>
              </label>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">백업 주기</div>
                <div id="backup-lastAt" class="settings-row-desc">마지막 자동 백업: -</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <select id="backup-periodSelect" class="select" style="width:90px;">
                  <option value="daily">매일</option>
                  <option value="weekly">매주</option>
                  <option value="monthly">매월</option>
                </select>
                <select id="backup-weekdaySelect" class="select" style="width:80px;display:none;">
                  <option value="0">일요일</option>
                  <option value="1">월요일</option>
                  <option value="2">화요일</option>
                  <option value="3">수요일</option>
                  <option value="4">목요일</option>
                  <option value="5">금요일</option>
                  <option value="6">토요일</option>
                </select>
                <select id="backup-monthdaySelect" class="select" style="width:70px;display:none;"></select>
                <input type="time" id="backup-timeInput" class="input" style="width:100px;" />
              </div>
            </div>
            <div class="update-row" style="margin-top:10px;">
              <div>
                <div class="settings-row-title">저장 위치</div>
                <div id="backup-dirPath" style="font-size:11.5px;color:var(--text-faint);margin-top:2px;word-break:break-all;">불러오는 중…</div>
              </div>
              <button class="btn-secondary" id="backup-openDirBtn">폴더 열기</button>
            </div>
          </div>
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
            <div class="settings-row-title">현재 버전 <span id="upd-version">확인 중…</span></div>

            <div style="margin-top:14px;">
              <label class="data-action-row" style="cursor:pointer;">
                <div>
                  <b>자동</b>
                  <span>새 버전이 있으면 알아서 받아서 프로그램을 껐다 켭니다</span>
                </div>
                <input type="radio" name="upd-mode" id="upd-modeAuto" value="auto" />
              </label>
              <label class="data-action-row" style="cursor:pointer;">
                <div>
                  <b>수동 <span class="badge badge-neutral">기본값·권장</span></b>
                  <span>내가 아래 「지금 확인」 버튼을 눌렀을 때만 업데이트합니다 — 진료·업무 중 갑자기 꺼졌다 켜지는 일이 없습니다</span>
                </div>
                <input type="radio" name="upd-mode" id="upd-modeManual" value="manual" />
              </label>
            </div>

            <label class="panel-section-label">업데이트 소스</label>
            <div class="update-source-box" id="upd-source">-</div>
            <div class="settings-row-desc">새 버전은 GitHub에서만 받아옵니다. 손댈 필요 없고, 「지금 확인」만 누르면 됩니다.</div>

            <div class="update-row" style="margin-top:14px;">
              <div id="upd-status" class="settings-row-desc">-</div>
              <div style="display:flex;gap:8px;flex-shrink:0;">
                <div id="upd-actions"></div>
                <button class="btn-secondary" id="upd-logBtn">업데이트 로그</button>
              </div>
            </div>
            <div id="upd-releaseNotes" class="update-release-notes" style="display:none;"></div>
          </div>
        </div>

        <div class="modal-overlay" id="upd-logOverlay">
          <div class="modal-card" style="width:520px;">
            <h3>업데이트 로그</h3>
            <div id="upd-logList"><div class="empty">불러오는 중…</div></div>
            <div class="modal-actions">
              <button class="btn-secondary" id="upd-logClose">닫기</button>
            </div>
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
    input.addEventListener(
      'input',
      wrapAutosave(async () => {
        try {
          await window.itda.settings.set({ key: 'user_name', value: input.value.trim() });
          await applySidebarUserName(); // 사이드바에도 즉시 반영
        } catch (e) {
          errorToast(e, '이름을 저장하지 못했어요');
        }
      })
    );
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

    const scaleRange = $('display-scaleRange');
    const scaleValue = $('display-scaleValue');
    const initialScale = await getDisplayScale();
    scaleRange.value = String(initialScale);
    scaleValue.textContent = `${initialScale}%`;
    // 드래그하는 동안은 라이브 미리보기만(퍼센트 표시 + 화면 확대/축소) — 대시보드 좌표
    // 재계산까지 매 픽셀마다 하면 낭비라 저장은 손을 뗀 시점(change)에 한 번만 한다.
    scaleRange.addEventListener('input', () => {
      scaleValue.textContent = `${scaleRange.value}%`;
      document.documentElement.style.zoom = String(Number(scaleRange.value) / 100);
    });
    scaleRange.addEventListener('change', async () => {
      const prev = scaleRange.dataset.prev || String(initialScale);
      try {
        await setDisplayScale(Number(scaleRange.value));
        scaleRange.dataset.prev = scaleRange.value;
      } catch (e) {
        errorToast(e, '화면 배율을 저장하지 못했어요');
        scaleRange.value = prev;
        scaleValue.textContent = `${prev}%`;
        document.documentElement.style.zoom = String(Number(prev) / 100);
      }
    });
    scaleRange.dataset.prev = String(initialScale);

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

  // ================= 단축키 =================
  async function initShortcutsPanel() {
    const listEl = $('shortcuts-list');
    const bindings = await getAllBindings();

    listEl.innerHTML = SHORTCUTS.map(
      (s) => `
        <div class="shortcut-row" data-id="${s.id}">
          <span>${escapeHtml(s.label)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <kbd data-kbd="${s.id}">${escapeHtml(labelForAccelerator(bindings[s.id]))}</kbd>
            <button class="btn-secondary" data-action="edit" data-id="${s.id}">변경</button>
            <button class="btn-secondary" data-action="reset" data-id="${s.id}">기본값</button>
          </div>
        </div>`
    ).join('');

    async function applyBinding(id, accelerator) {
      const kbdEl = listEl.querySelector(`kbd[data-kbd="${id}"]`);
      let status;
      try {
        status = await setBinding(id, accelerator);
      } catch (e) {
        errorToast(e, '단축키를 저장하지 못했어요');
        return;
      }
      kbdEl.textContent = labelForAccelerator(accelerator);
      if (status && status[id] === false) {
        errorToast(new Error('conflict'), '다른 프로그램이 이미 이 조합을 쓰고 있어서 등록되지 않았어요. 다른 조합으로 바꿔보세요.');
      } else {
        toast('단축키를 바꿨어요');
      }
    }

    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const { id } = btn.dataset;
      const kbdEl = listEl.querySelector(`kbd[data-kbd="${id}"]`);

      if (btn.dataset.action === 'reset') {
        applyBinding(id, SHORTCUTS.find((s) => s.id === id).default);
        return;
      }

      // 편집: 다음 키 입력을 기다림 (Esc면 취소)
      const prevText = kbdEl.textContent;
      kbdEl.textContent = '키를 눌러주세요…';
      btn.disabled = true;

      const onKey = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === 'Escape') {
          cleanup();
          kbdEl.textContent = prevText;
          return;
        }
        if (isBareKey(ev)) return; // 조합키 없이 단독 키는 무시하고 계속 대기
        const accelerator = acceleratorFromEvent(ev);
        const conflict = findConflict(accelerator, id);
        cleanup();
        if (conflict) {
          kbdEl.textContent = prevText;
          errorToast(new Error('conflict'), `이미 "${conflict.label}"에서 쓰고 있는 조합이에요.`);
          return;
        }
        applyBinding(id, accelerator);
      };
      function cleanup() {
        document.removeEventListener('keydown', onKey, true);
        btn.disabled = false;
      }
      document.addEventListener('keydown', onKey, true);
    });
  }

  // ================= 보안 (실행 시 비밀번호 잠금) =================
  async function loadSecurityPanel() {
    const body = $('security-panelBody');
    const lockShortcutHint = labelForAccelerator(await getBinding('lockNow'));
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
            <div class="settings-row-title">잠금 꺼짐</div>
            <div class="settings-row-desc">비밀번호 없이 바로 열려요.</div>
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
            <div class="settings-row-title">잠금 켜짐</div>
            <div class="settings-row-desc">실행할 때마다 비밀번호를 입력해야 해요.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn-secondary" id="sec-lockNowBtn">지금 잠그기</button>
            <button class="btn-secondary" id="sec-changeBtn">비밀번호 변경</button>
            <button class="btn-secondary" id="sec-disableBtn" style="color:var(--danger);">잠금 끄기</button>
          </div>
        </div>
        <p style="font-size:11px;color:var(--text-faint);margin:8px 0 0;">단축키 ${escapeHtml(lockShortcutHint)}로 어디서든 바로 잠글 수 있어요.</p>
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

  // ================= 잠긴 메모 목록 표시 방식 =================
  async function initMemoLockPanel() {
    const mode = (await window.itda.settings.get('memo_lock_list_mode')) === 'title' ? 'title' : 'hidden';
    $('memlock-hidden').checked = mode === 'hidden';
    $('memlock-title').checked = mode === 'title';
    root.querySelectorAll('input[name="memo-lock-mode"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        try {
          await window.itda.settings.set({ key: 'memo_lock_list_mode', value: radio.value });
        } catch (e) {
          errorToast(e, '표시 방식을 저장하지 못했어요');
        }
      });
    });
  }

  // ================= 편의 기능 (윈도우 자동실행 / 관련 항목 자동추천) =================
  // 업데이트 자동 확인 여부는 설정 > 업데이트의 자동/수동 모드 하나로 합쳤다(중복 스위치 제거).
  async function initConveniencePanel() {
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

    const eventEnabledToggle = $('notif-eventEnabledToggle');
    eventEnabledToggle.checked = (await window.itda.settings.get('notif_event_enabled')) !== '0';
    eventEnabledToggle.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'notif_event_enabled', value: eventEnabledToggle.checked ? '1' : '0' });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        eventEnabledToggle.checked = !eventEnabledToggle.checked;
      }
    });

    const leadSelect = $('notif-leadSelect');
    leadSelect.value = (await window.itda.settings.get('notif_event_lead_minutes')) || '10';
    leadSelect.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'notif_event_lead_minutes', value: leadSelect.value });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
      }
    });

    const snoozeSelect = $('notif-snoozeSelect');
    snoozeSelect.value = (await window.itda.settings.get('notif_snooze_minutes')) || '10';
    snoozeSelect.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'notif_snooze_minutes', value: snoozeSelect.value });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
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
        <p style="font-size:12.5px;color:var(--text-soft);margin:0 0 10px;">
          연동 파일이 아직 없어요. Google Cloud Console에서 "데스크톱 앱" 타입으로 OAuth
          클라이언트를 만들고 다운로드한 JSON 파일을 아래 버튼으로 선택해주세요.
        </p>
        <button class="btn-secondary" id="gcal-importBtn">인증 파일 선택…</button>
      `;
      $('gcal-importBtn').addEventListener('click', async () => {
        $('gcal-importBtn').disabled = true;
        try {
          const result = await window.itda.googleCalendar.importCredentialsFile();
          if (result.imported) {
            toast('인증 파일을 가져왔어요');
            await loadGcalPanel();
          }
        } catch (e) {
          errorToast(e, '가져오지 못했어요');
        } finally {
          const btn = $('gcal-importBtn');
          if (btn) btn.disabled = false;
        }
      });
      return;
    }

    if (status.connected) {
      panel.innerHTML = `
        <div class="update-row">
          <div>
            <div class="settings-row-title">연결됨</div>
            <div class="settings-row-desc">
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
          <label style="font-size:12px;color:var(--text-faint);display:flex;flex-direction:column;gap:4px;flex:1;">
            자동 동기화 주기
            <select id="gcal-intervalSelect" class="select">
              <option value="15">15분마다</option>
              <option value="30">30분마다 (기본)</option>
              <option value="60">1시간마다</option>
              <option value="180">3시간마다</option>
              <option value="360">6시간마다</option>
              <option value="0">끔 (수동으로만)</option>
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

      const intervalSelect = $('gcal-intervalSelect');
      intervalSelect.value = (await window.itda.settings.get('google_calendar_sync_interval_min')) ?? '30';
      intervalSelect.addEventListener('change', async () => {
        try {
          await window.itda.settings.set({ key: 'google_calendar_sync_interval_min', value: intervalSelect.value });
          toast(intervalSelect.value === '0' ? '자동 동기화를 껐어요' : `${intervalSelect.options[intervalSelect.selectedIndex].text}로 설정했어요`);
        } catch (e) {
          errorToast(e, '저장하지 못했어요');
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
    'google-calendar-mini': { label: '구글 캘린더', desc: '이번 달 미니 달력 (읽기 전용)' },
    inbox: { label: '받은 업무 (Inbox)', desc: '아직 처리 안 한 Inbox 항목' },
    dday: { label: 'D-DAY', desc: '가까운 마감일 순으로' },
  };

  async function initWidgetAppearancePanel() {
    const range = $('widget-opacityRange');
    const valueLabel = $('widget-opacityValue');
    const savedOpacity = await window.itda.settings.get('widget_opacity');
    const percent = savedOpacity ? Math.round(Number(savedOpacity) * 100) : 100;
    range.value = percent;
    valueLabel.textContent = `${percent}%`;

    const scheduleOpacitySave = wrapAutosave(async () => {
      try {
        await window.itda.settings.set({ key: 'widget_opacity', value: String(Number(range.value) / 100) });
        await window.itda.widgets.applyAppearance();
      } catch (e) {
        errorToast(e, '투명도를 저장하지 못했어요');
      }
    }, 200);
    range.addEventListener('input', () => {
      valueLabel.textContent = `${range.value}%`;
      scheduleOpacitySave();
    });

    const alwaysOnTopToggle = $('widget-alwaysOnTopToggle');
    // 값이 아예 없던 적(신규 설치 직후)엔 켜진 것으로 취급 — 지금까지의 기본 동작(항상 위)과 맞춤
    alwaysOnTopToggle.checked = (await window.itda.settings.get('widget_always_on_top')) !== '0';
    alwaysOnTopToggle.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'widget_always_on_top', value: alwaysOnTopToggle.checked ? '1' : '0' });
        await window.itda.widgets.applyAppearance();
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        alwaysOnTopToggle.checked = !alwaysOnTopToggle.checked;
      }
    });
  }

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

  // ================= 대시보드 구성 =================
  async function initDashboardCardsPanel() {
    const listEl = $('dashboard-cardList');
    const defaults = Object.fromEntries(DASHBOARD_CARDS.map((c) => [c.id, c.default]));
    let config = defaults;
    try {
      const raw = await window.itda.settings.get('dashboard_cards');
      if (raw) config = { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      /* 깨진 값이면 기본값으로 */
    }

    listEl.innerHTML = DASHBOARD_CARDS.map(
      (c) => `
        <div class="data-action-row">
          <div><b>${escapeHtml(c.label)}</b></div>
          <label class="switch">
            <input type="checkbox" data-id="${c.id}" ${config[c.id] ? 'checked' : ''} />
            <span class="switch-track"><span class="switch-thumb"></span></span>
          </label>
        </div>`
    ).join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        config[toggle.dataset.id] = toggle.checked;
        try {
          await window.itda.settings.set({ key: 'dashboard_cards', value: JSON.stringify(config) });
        } catch (e) {
          errorToast(e, '저장하지 못했어요');
          toggle.checked = !toggle.checked;
          config[toggle.dataset.id] = toggle.checked;
        }
      });
    });

    $('dashboard-resetLayoutBtn').addEventListener('click', async () => {
      try {
        // 카드 순서/크기(dashboard_layout)와 사이드 패널 폭(dashboard_side_width) 둘 다 초기화 —
        // "기본 배치"는 둘을 합친 전체 모양을 뜻하므로 하나만 지우면 반쪽짜리 초기화가 됨.
        await Promise.all([
          window.itda.settings.set({ key: 'dashboard_layout', value: '' }),
          window.itda.settings.set({ key: 'dashboard_side_width', value: '' }),
        ]);
        toast('대시보드를 기본 배치로 되돌렸어요. 대시보드로 이동하면 반영돼요.');
      } catch (e) {
        errorToast(e, '되돌리지 못했어요');
      }
    });

    const visibleCardIds = WIDGET_CARD_IDS.filter((id) => config[id]);
    await initPresetSection(visibleCardIds);
  }

  // ================= 배치 프리셋: 목록 렌더링(기본 제공 + 내가 저장한 것) + 미리보기 + 저장/삭제 =================
  const PREVIEW_W = 200;
  const PREVIEW_H = 120;

  async function loadCustomPresets() {
    try {
      const raw = await window.itda.settings.get('dashboard_custom_presets');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function buildPreviewHtml(positions) {
    const labelById = Object.fromEntries(DASHBOARD_CARDS.map((c) => [c.id, c.label]));
    const scaled = scaleForPreview(positions, PREVIEW_W - 8, PREVIEW_H - 8);
    const boxes = Object.entries(scaled)
      .map(([id, p]) => `<div class="preset-preview-box" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;" title="${escapeHtml(labelById[id] || id)}"></div>`)
      .join('');
    return `<div class="preset-preview-canvas" style="width:${PREVIEW_W}px;height:${PREVIEW_H}px;">${boxes}</div>`;
  }

  // 프리셋 버튼에 커서를 올리면(파워포인트 레이아웃 갤러리처럼) 예시 구조를 작은 팝오버로 보여준다.
  function attachPreviewHover(btn, getPositions) {
    let popEl = null;
    btn.addEventListener('mouseenter', () => {
      const positions = getPositions();
      if (!positions || !Object.keys(positions).length) return;
      popEl = document.createElement('div');
      popEl.className = 'preset-preview-pop';
      popEl.innerHTML = buildPreviewHtml(positions);
      document.body.appendChild(popEl);
      const rect = btn.getBoundingClientRect();
      const popRect = popEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      popEl.style.left = `${Math.max(8, Math.min(rect.left, vw - popRect.width - 8))}px`;
      popEl.style.top = `${Math.min(rect.bottom + 6, vh - popRect.height - 8)}px`;
    });
    btn.addEventListener('mouseleave', () => {
      popEl?.remove();
      popEl = null;
    });
  }

  async function initPresetSection(visibleCardIds) {
    const listEl = $('dashboard-presetList');

    async function render() {
      const customPresets = await loadCustomPresets();
      listEl.innerHTML =
        LAYOUT_PRESETS.map((p) => `<button class="btn-secondary" data-preset="${p.id}">${escapeHtml(p.label)}</button>`).join('') +
        customPresets
          .map(
            (p) => `
          <span class="preset-custom-chip">
            <button class="btn-secondary" data-preset="${p.id}" data-custom="1">${escapeHtml(p.label)}</button>
            <button class="btn-icon" data-delete-preset="${p.id}" title="이 프리셋 삭제">${TRASH_MINI_ICON}</button>
          </span>`
          )
          .join('');

      // 기본 제공 프리셋: 지금 대시보드에 켜둔 카드들 기준으로 예시 구조를 계산해서 미리보기
      listEl.querySelectorAll('[data-preset]:not([data-custom])').forEach((btn) => {
        attachPreviewHover(btn, () => getPreset(btn.dataset.preset).compute(visibleCardIds, 960));
        btn.addEventListener('click', async () => {
          try {
            await window.itda.settings.set({ key: 'dashboard_layout', value: JSON.stringify({ preset: btn.dataset.preset, widgets: {} }) });
            toast('대시보드에 반영하려면 대시보드로 이동하세요.');
          } catch (e) {
            errorToast(e, '프리셋을 적용하지 못했어요');
          }
        });
      });

      // 내가 저장한 프리셋: 저장해둔 실제 좌표 그대로 미리보기 + 적용 + 삭제
      listEl.querySelectorAll('[data-preset][data-custom]').forEach((btn) => {
        const preset = customPresets.find((p) => p.id === btn.dataset.preset);
        attachPreviewHover(btn, () => preset?.widgets);
        btn.addEventListener('click', async () => {
          try {
            await window.itda.settings.set({ key: 'dashboard_layout', value: JSON.stringify({ preset: 'flow', widgets: preset.widgets }) });
            toast('대시보드에 반영하려면 대시보드로 이동하세요.');
          } catch (e) {
            errorToast(e, '프리셋을 적용하지 못했어요');
          }
        });
      });
      listEl.querySelectorAll('[data-delete-preset]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const remaining = customPresets.filter((p) => p.id !== btn.dataset.deletePreset);
          try {
            await window.itda.settings.set({ key: 'dashboard_custom_presets', value: JSON.stringify(remaining) });
            await render();
          } catch (e) {
            errorToast(e, '삭제하지 못했어요');
          }
        });
      });
    }
    await render();

    $('dashboard-savePresetBtn').addEventListener('click', async () => {
      const name = await promptText($('dashboard-savePresetBtn'), { title: '프리셋 이름', placeholder: '예: 회의 준비용' });
      if (!name) return;
      let widgets = {};
      try {
        const raw = await window.itda.settings.get('dashboard_layout');
        widgets = raw ? JSON.parse(raw).widgets || {} : {};
      } catch (e) {
        /* 깨졌으면 빈 배치로 취급 */
      }
      if (!Object.keys(widgets).length) {
        toast('저장할 배치가 없어요. 대시보드에서 카드를 한 번 옮기거나 크기를 바꿔보세요.');
        return;
      }
      const customPresets = await loadCustomPresets();
      customPresets.push({ id: `custom-${Date.now()}`, label: name, widgets });
      try {
        await window.itda.settings.set({ key: 'dashboard_custom_presets', value: JSON.stringify(customPresets) });
        toast('프리셋으로 저장했어요');
        await render();
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
      }
    });
  }

  // ================= 자동 백업 =================
  async function initAutoBackupPanel() {
    const toggle = $('backup-autoToggle');
    // 값이 아예 없던 적(신규 설치 직후)엔 켜진 것으로 취급 — 다른 토글들과 동일한 관례
    toggle.checked = (await window.itda.settings.get('backup_auto_enabled')) !== '0';
    toggle.addEventListener('change', async () => {
      try {
        await window.itda.settings.set({ key: 'backup_auto_enabled', value: toggle.checked ? '1' : '0' });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
        toggle.checked = !toggle.checked;
      }
    });

    async function saveSetting(key, value) {
      try {
        await window.itda.settings.set({ key, value: String(value) });
      } catch (e) {
        errorToast(e, '저장하지 못했어요');
      }
    }

    const weekdaySelect = $('backup-weekdaySelect');
    const monthdaySelect = $('backup-monthdaySelect');
    monthdaySelect.innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}일</option>`).join('');

    function updatePeriodFieldsVisibility() {
      weekdaySelect.style.display = periodSelect.value === 'weekly' ? '' : 'none';
      monthdaySelect.style.display = periodSelect.value === 'monthly' ? '' : 'none';
    }

    const periodSelect = $('backup-periodSelect');
    periodSelect.value = (await window.itda.settings.get('backup_auto_period')) || 'daily';
    periodSelect.addEventListener('change', () => {
      updatePeriodFieldsVisibility();
      saveSetting('backup_auto_period', periodSelect.value);
    });

    weekdaySelect.value = (await window.itda.settings.get('backup_auto_weekday')) || '0';
    weekdaySelect.addEventListener('change', () => saveSetting('backup_auto_weekday', weekdaySelect.value));

    monthdaySelect.value = (await window.itda.settings.get('backup_auto_monthday')) || '1';
    monthdaySelect.addEventListener('change', () => saveSetting('backup_auto_monthday', monthdaySelect.value));

    updatePeriodFieldsVisibility();

    const timeInput = $('backup-timeInput');
    timeInput.value = (await window.itda.settings.get('backup_auto_time')) || '03:00';
    timeInput.addEventListener('change', () => saveSetting('backup_auto_time', timeInput.value || '03:00'));

    const lastAt = await window.itda.settings.get('backup_last_at');
    $('backup-lastAt').textContent = `마지막 자동 백업: ${lastAt ? new Date(lastAt).toLocaleString('ko-KR') : '아직 없음'}`;

    try {
      $('backup-dirPath').textContent = await window.itda.data.getBackupsDir();
    } catch (e) {
      $('backup-dirPath').textContent = '위치를 불러오지 못했어요';
    }
    $('backup-openDirBtn').addEventListener('click', async () => {
      try {
        await window.itda.data.openBackupsFolder();
      } catch (e) {
        errorToast(e, '폴더를 열지 못했어요');
      }
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
  // 확인이 시작되면(수동 클릭이든 자동 주기든) 다운로드까지는 항상 자동으로 진행된다 — 자동/수동
  // 모드가 가르는 건 "확인이 언제 시작되는가"(자동 주기적 vs 수동 클릭)와 "다운로드 완료 후
  // 설치가 조용히 되는가, 재시작 확인을 받는가"뿐. 다운로드 진행 화면과 재시작 확인 팝업은
  // 화면과 무관하게 전역으로 뜨므로(renderer/shared/update-overlay.js) 여기서는 상태 텍스트와
  // "지금 확인"/"업데이트 로그" 버튼, 다운로드 완료 후의 대체 재시작 버튼 정도만 다룬다.
  let currentUpdateMode = 'manual';

  function renderUpdateActions(html) {
    $('upd-actions').innerHTML = html;
  }

  function updateModeRadioUi() {
    $('upd-modeAuto').checked = currentUpdateMode === 'auto';
    $('upd-modeManual').checked = currentUpdateMode === 'manual';
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
        renderUpdateActions(`<button class="btn-secondary" id="upd-checkBtn">지금 확인</button>`);
        bindCheckBtn();
        break;
      case 'available':
        statusEl.textContent = `새 버전 ${data.version}이(가) 있어요. 받는 중…`;
        renderUpdateActions('');
        if (data.releaseNotes) {
          notesEl.textContent = data.releaseNotes;
          notesEl.style.display = 'block';
        }
        break;
      case 'downloading':
        // 진행 상황은 전역 오버레이(수동 모드) 또는 조용히(자동 모드) — 여기는 짧은 텍스트만.
        statusEl.textContent = `다운로드하는 중… ${data.percent ?? 0}%`;
        renderUpdateActions('');
        break;
      case 'downloaded':
        statusEl.textContent =
          currentUpdateMode === 'manual'
            ? `버전 ${data.version} 다운로드 완료.`
            // main/updater/index.js가 창을 닫는(트레이로 내려가는) 시점을 감지해서 조용히
            // 설치+재시작한다(자동 모드에서만) — 굳이 지금 누르지 않아도 창만 닫으면 알아서 적용된다.
            : `버전 ${data.version} 다운로드 완료. 창을 닫으면 자동으로 설치되고 다시 켜져요.`;
        // 수동 모드는 전역 재시작 확인 팝업이 이미 떴을 텐데, "나중에"를 눌렀을 수도 있으니
        // 여기서도 다시 시도할 수 있는 버튼을 남겨둔다.
        renderUpdateActions(`<button class="btn" id="upd-installBtn">업데이트하고 재시작</button>`);
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
    currentUpdateMode = (await window.itda.settings.get('update_mode')) === 'auto' ? 'auto' : 'manual';
    updateModeRadioUi();
    root.querySelectorAll('input[name="upd-mode"]').forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (!radio.checked) return;
        currentUpdateMode = radio.value;
        try {
          await window.itda.settings.set({ key: 'update_mode', value: currentUpdateMode });
          // main/updater/index.js는 시작 5초 후 1회 + 이후 3시간마다만 자동으로 확인하므로,
          // "자동"으로 막 바꾼 시점에는 아무 것도 안 하면 최대 3시간 동안 전혀 반응이 없는
          // 것처럼 보였다("선택해도 자동으로 업데이트 안 됨"). 켜는 순간 바로 한 번 확인해서
          // 자동 모드가 실제로 살아있다는 걸 즉시 체감할 수 있게 한다.
          if (currentUpdateMode === 'auto') {
            await window.itda.updater.checkNow();
          }
        } catch (e) {
          errorToast(e, '업데이트 모드를 저장하지 못했어요');
        }
      });
    });

    try {
      const version = await window.itda.updater.getVersion();
      $('upd-version').textContent = `v${version}`;
    } catch (e) {
      $('upd-version').textContent = '확인 못 함';
    }
    try {
      const repo = await window.itda.updater.getReleasesRepo();
      $('upd-source').textContent = `https://github.com/${repo}`;
    } catch (e) {
      $('upd-source').textContent = '확인하지 못했어요';
    }

    renderUpdateActions(`<button class="btn-secondary" id="upd-checkBtn">지금 확인</button>`);
    bindCheckBtn();

    $('upd-logBtn').addEventListener('click', openUpdateLog);
    $('upd-logClose').addEventListener('click', closeUpdateLog);
    $('upd-logOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'upd-logOverlay') closeUpdateLog();
    });
  }

  // ---------- 업데이트 로그 (GitHub Releases 목록) ----------
  function closeUpdateLog() {
    $('upd-logOverlay').classList.remove('open');
  }

  function renderReleaseLogHtml(releases) {
    if (!releases.length) return emptyStateBlock({ title: '업데이트 로그가 없어요' });
    return releases
      .map(
        (r) => `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
          <b>${escapeHtml(r.version)}</b>
          <span class="settings-row-desc">${escapeHtml((r.publishedAt || '').slice(0, 10))}</span>
        </div>
        <div class="update-release-notes" style="margin-top:4px;">${escapeHtml(r.notes || '(내용 없음)')}</div>
      </div>`
      )
      .join('');
  }

  async function openUpdateLog() {
    $('upd-logOverlay').classList.add('open');
    $('upd-logList').innerHTML = `<div class="empty">불러오는 중…</div>`;
    try {
      const releases = await window.itda.updater.getReleaseLog();
      // 응답이 오기 전에 다른 화면으로 이동했을 수 있다 — 그러면 root의 내용이 이미 바뀌어서
      // #upd-logList가 더 이상 없으므로(null), 조용히 무시한다(에러 아님).
      const listEl = $('upd-logList');
      if (listEl) listEl.innerHTML = renderReleaseLogHtml(releases);
    } catch (e) {
      errorToast(e, '업데이트 로그를 불러오지 못했어요');
      const listEl = $('upd-logList');
      if (listEl) listEl.innerHTML = emptyStateBlock({ title: '업데이트 로그를 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
    }
  }

  const unsubscribeUpdater = window.itda.updater.onStatus(applyUpdateStatus);
  const unsubscribeUpdateLogEsc = registerEscClose(() => $('upd-logOverlay').classList.contains('open'), closeUpdateLog);

  await initUserPanel();
  await initDisplayPanel();
  await initDashboardCardsPanel();
  const unmountTagsPanel = await mountTagsPanel($('tags-panelRoot'));
  await initWidgetAppearancePanel();
  await loadWidgetsPanel();
  await initShortcutsPanel();
  await loadSecurityPanel();
  await initMemoLockPanel();
  await initConveniencePanel();
  await initAutoBackupPanel();
  initDataPanel();
  await initUpdatePanel();
  await loadGcalPanel();

  return () => {
    if (typeof unsubscribeUpdater === 'function') unsubscribeUpdater();
    unsubscribeUpdateLogEsc();
    if (typeof unmountTagsPanel === 'function') unmountTagsPanel();
  };
}
