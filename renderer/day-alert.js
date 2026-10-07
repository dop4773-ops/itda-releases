// 당일 알림 팝업 — main/day-alert 가 항상 위의 작은 창(frameless)에 이 페이지를 띄운다.
// 내용은 main이 정해 두고(dayAlert:get), 여기서는 그리기 + 할 일 완료 체크 + 확인/나중에만 한다.
import { escapeHtml } from './shared/ui-utils.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const root = document.getElementById('da-root');
const kind = new URLSearchParams(location.search).get('kind') === 'b' ? 'b' : 'a'; // a 가운데 팝업(전체 목록) · b 구석 카드(요약)

// 이 작은 창에는 다크모드·테마 팔레트만 맞춘다(spotlight.js와 같은 방식)
async function applyMinimalTheme() {
  try {
    const s = await window.itda.settings.getMany(['theme', 'ui_theme', 'app_theme']);
    if (s.theme === 'dark') document.documentElement.dataset.theme = 'dark';
    if (['soft', 'paper', 'studio', 'midnight'].includes(s.ui_theme)) document.documentElement.dataset.uitheme = s.ui_theme;
    if (s.app_theme) document.documentElement.dataset.apptheme = s.app_theme;
  } catch (e) {
    /* 기본(라이트) */
  }
}

const dateLabel = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 ${WEEK[new Date(y, m - 1, d).getDay()]}요일`;
};

async function render() {
  const data = await window.itda.dayAlert.get();
  if (!data) return;
  const n = data.events.length + data.todos.length;
  const evRow = (e) =>
    `<div class="da-it"><span class="da-dot" style="${e.color ? `background:${escapeHtml(e.color)}` : ''}"></span><span class="da-t" data-go="#/calendar">${escapeHtml(e.title)}</span><span class="da-s">${e.allDay ? '종일' : escapeHtml(e.time)}</span></div>`;
  const tdRow = (t) =>
    `<div class="da-it" data-todo="${t.id}"><input type="checkbox" title="완료" /><span class="da-t" data-go="#/todo">${escapeHtml(t.title)}</span>${t.high ? '<span class="da-hi">중요</span>' : ''}<span class="da-s">${escapeHtml(t.time)}</span></div>`;
  const head = `
      <div class="da-head">
        <span class="da-ico">🔔</span>
        <div><h3>오늘 챙길 것 ${n}건</h3><small>${dateLabel(data.date)}${data.preview ? ' · 미리보기' : ''}</small></div>
        <button class="da-x" id="da-x" title="나중에 (다음에 켤 때 다시 알려줘요)">✕</button>
      </div>`;
  if (kind === 'b') {
    // 구석 카드: 앞의 3건만 간단히, 나머지는 "외 N건"과 "모두 보기"
    const rows = [...data.events.map(evRow), ...data.todos.map(tdRow)];
    root.innerHTML = `
    <div class="da-card">${head}
      <div class="da-list">${rows.slice(0, 3).join('')}${rows.length > 3 ? `<div class="da-note" style="padding-top:6px;">외 ${rows.length - 3}건</div>` : ''}</div>
      <div class="da-foot">
        <button class="btn-secondary" id="da-full">모두 보기</button>
        <button class="btn" id="da-ok">확인</button>
      </div>
    </div>`;
    document.getElementById('da-full').onclick = () => window.itda.dayAlert.openFull();
  } else {
    root.innerHTML = `
    <div class="da-card">${head}
      <div class="da-list">
        ${data.events.length ? `<div class="da-sec">일정</div>${data.events.map(evRow).join('')}` : ''}
        ${data.todos.length ? `<div class="da-sec">할 일</div>${data.todos.map(tdRow).join('')}` : ''}
        ${data.sample ? '<div class="da-note">알림을 켠 일정·할 일이 아직 없어 예시로 보여드려요.</div>' : ''}
      </div>
      <div class="da-foot">
        <button class="btn-secondary" id="da-later">나중에</button>
        <button class="btn" id="da-ok">확인</button>
      </div>
    </div>`;
    document.getElementById('da-later').onclick = () => window.itda.dayAlert.close();
  }
  document.getElementById('da-x').onclick = () => window.itda.dayAlert.close();
  document.getElementById('da-ok').onclick = () => window.itda.dayAlert.ack();
}

root.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) window.itda.widgets.openMainApp(go.dataset.go);
});
root.addEventListener('change', async (e) => {
  if (e.target.type !== 'checkbox') return;
  const row = e.target.closest('[data-todo]');
  const id = Number(row.dataset.todo);
  if (id) {
    try {
      await window.itda.todos.toggle(id);
    } catch (err) {
      e.target.checked = !e.target.checked;
      return;
    }
  }
  row.classList.toggle('done', e.target.checked);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.itda.dayAlert.close();
});
window.itda.dayAlert.onUpdate(render);

applyMinimalTheme().then(render);
