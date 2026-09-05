import { escapeHtml, errorToast, toast, isUserTyping, debounce } from './ui-utils.js';
import { stripHtmlToPlainText } from './rich-text.js';

export const LINK_TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇', inbox: 'Inbox' };
export const TYPE_ROUTE = { todo: '#/todo', event: '#/calendar', memo: '#/memo', postit: '#/postit', inbox: '#/inbox' };
// 항목 종류를 한눈에 구분하려면 흑백 SVG보다 색이 있는 이모지가 낫다는 피드백.
// ✅ 초록 / 📅 파랑 / 📝 노랑 / 📌 빨강 / 📥 파랑 — 색만으로도 투두/메모/일정이 바로 구분된다.
export const TYPE_EMOJI = { todo: '✅', event: '📅', memo: '📝', postit: '📌', inbox: '📥' };
const SMALL_X_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const PLUS_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;

// links:listFor가 넘겨주는 label은 memo/postit의 경우 HTML(볼드·글씨크기 서식)일 수 있어서,
// 태그를 걷어내고 짧게 잘라야 "<span style=...>" 같은 게 그대로 노출되지 않는다.
export function plainLabel(label) {
  const text = stripHtmlToPlainText(label || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 40) : '(제목 없음)';
}

// 연결된 항목 미리보기에 붙일 부가 정보(마감일/시작시간 등). 타입별로 필드가 달라서 여기서 통일한다.
function subtitleFor(item) {
  if (item.type === 'todo') return item.due_date ? `마감 ${item.due_date}` : '';
  if (item.type === 'event') return item.start_at ? item.start_at.replace(' ', ' · ').slice(0, 16) : '';
  return '';
}

// 각 타입의 후보 목록을 가져온다 (연결 대상 선택용). 소프트 삭제된 항목은 각 list API가 이미 제외하고 반환한다.
async function fetchCandidates(type) {
  if (type === 'todo') return (await window.itda.todos.list({})).map((t) => ({ id: t.id, label: t.title }));
  if (type === 'event') {
    const today = new Date().toISOString().slice(0, 10);
    const from = { fromDate: '2000-01-01', toDate: '2100-01-01' }; // 연결 후보는 기간 제한 없이 전부 보여준다
    const events = await window.itda.events.range(from);
    return events.map((e) => ({ id: e.id, label: `${e.title} · ${(e.start_at || '').slice(0, 16)}` }));
  }
  if (type === 'memo') return (await window.itda.memos.list({})).map((m) => ({ id: m.id, label: plainLabel(m.title || m.content) }));
  if (type === 'postit') return (await window.itda.postits.list()).map((p) => ({ id: p.id, label: plainLabel(p.title || p.content) }));
  if (type === 'inbox') return (await window.itda.inbox.list({ onlyUnprocessed: false })).map((i) => ({ id: i.id, label: plainLabel(i.content) }));
  return [];
}

/**
 * 컨테이너 엘리먼트 안에 "🔗 연결된 항목" 위젯을 렌더링하고 이벤트까지 바인딩한다.
 * Todo/일정/메모/포스트잇 상세화면에서 동일하게 호출하면 된다.
 * @param {HTMLElement} container - 위젯을 그릴 빈 컨테이너
 * @param {{type: 'todo'|'event'|'memo'|'postit', id: number}} self - 현재 보고 있는 항목
 */
export async function mountLinksWidget(container, self) {
  let links = [];
  let discovered = { sameCategory: [], similar: [] };
  let pickerOpen = false;
  let pickerType = 'todo';

  async function load() {
    try {
      // 설정 → 편의 기능에서 끌 수 있음 — 꺼져있으면 아예 요청하지 않는다(불필요한 조회 생략)
      const autoSuggestOn = (await window.itda.settings.get('links_auto_suggest')) !== '0';
      const [linksResult, discoverResult] = await Promise.all([
        window.itda.links.listFor({ type: self.type, id: self.id }),
        autoSuggestOn
          ? window.itda.links.discover({ type: self.type, id: self.id }).catch(() => ({ sameCategory: [], similar: [] })) // 자동추천은 실패해도 직접연결 목록은 살아있어야 하니 별도로 방어
          : Promise.resolve({ sameCategory: [], similar: [] }),
      ]);
      links = linksResult;
      discovered = discoverResult || { sameCategory: [], similar: [] };
    } catch (e) {
      errorToast(e, '연결된 항목을 불러오지 못했어요');
      links = [];
    }
    render();
  }

  function renderDiscoverRow(d) {
    return `
      <div class="link-item link-item-suggested" data-type="${d.type}" data-id="${d.id}">
        <a class="link-item-main" href="${TYPE_ROUTE[d.type]}">
          <span class="link-type-icon">${TYPE_EMOJI[d.type]}</span>
          <span class="link-item-label">${escapeHtml(plainLabel(d.label))}</span>
        </a>
        <button class="btn-icon" data-action="confirm-discover" data-type="${d.type}" data-id="${d.id}" title="연결하기">${PLUS_ICON}</button>
      </div>`;
  }

  function render() {
    const linkableTypes = Object.keys(LINK_TYPE_LABEL).filter((t) => t !== self.type || true); // 같은 타입끼리도 연결 허용(예: Todo-Todo)
    const hasDiscovered = discovered.sameCategory.length > 0 || discovered.similar.length > 0;
    // 종류별로 묶어서 보여준다 — "이게 투두인지 메모인지" 한눈에 구분되게(피드백/디자인 시안 반영).
    const grouped = {};
    links.forEach((l) => {
      (grouped[l.type] = grouped[l.type] || []).push(l);
    });
    const linkRow = (l) => `
      <div class="link-item" data-type="${l.type}" data-id="${l.id}">
        <a class="link-item-main" href="${TYPE_ROUTE[l.type]}">
          <span class="link-item-label">${escapeHtml(plainLabel(l.label))}</span>
          ${subtitleFor(l) ? `<span class="link-item-sub">${escapeHtml(subtitleFor(l))}</span>` : ''}
        </a>
        <button class="btn-icon" data-action="unlink" data-type="${l.type}" data-id="${l.id}" title="연결 해제">${SMALL_X_ICON}</button>
      </div>`;
    const groupsHtml = Object.keys(LINK_TYPE_LABEL)
      .filter((t) => grouped[t] && grouped[t].length)
      .map(
        (t) => `
        <div class="link-group" data-type="${t}">
          <div class="link-group-head"><span class="link-type-icon">${TYPE_EMOJI[t]}</span>${LINK_TYPE_LABEL[t]} <span class="link-group-count">${grouped[t].length}</span></div>
          ${grouped[t].map(linkRow).join('')}
        </div>`
      )
      .join('');
    container.innerHTML = `
      <div class="links-widget">
        <div class="links-list" id="lw-list">
          ${links.length ? groupsHtml : `<div class="links-empty">연결된 항목이 없어요</div>`}
        </div>

        ${
          pickerOpen
            ? `
          <div class="link-picker" id="lw-picker">
            <select id="lw-typeSelect" class="select">
              ${linkableTypes.map((t) => `<option value="${t}" ${t === pickerType ? 'selected' : ''}>${LINK_TYPE_LABEL[t]}</option>`).join('')}
            </select>
            <select id="lw-targetSelect" class="select"><option value="">불러오는 중…</option></select>
            <button class="btn-icon" id="lw-confirm" title="연결">${PLUS_ICON}</button>
            <button class="btn-icon" id="lw-cancel" title="취소">${SMALL_X_ICON}</button>
          </div>`
            : `<button class="link-add-btn" id="lw-addBtn">${PLUS_ICON} 항목 연결</button>`
        }

        ${
          hasDiscovered
            ? `
          <div class="links-discover">
            <div class="links-discover-head">✨ 관련 항목 <span class="links-discover-hint">자동 추천 · 오탐일 수 있어요</span></div>
            ${
              discovered.sameCategory.length
                ? `
              <div class="links-discover-group">
                <div class="links-discover-group-label">🏷 같은 카테고리${discovered.sameCategory[0].tagName ? ` · ${escapeHtml(discovered.sameCategory[0].tagName)}` : ''}</div>
                ${discovered.sameCategory.map(renderDiscoverRow).join('')}
              </div>`
                : ''
            }
            ${
              discovered.similar.length
                ? `
              <div class="links-discover-group">
                <div class="links-discover-group-label">🔎 비슷한 내용</div>
                ${discovered.similar.map(renderDiscoverRow).join('')}
              </div>`
                : ''
            }
          </div>`
            : ''
        }
      </div>
    `;
    bind();
  }

  async function populateTargetSelect() {
    const select = container.querySelector('#lw-targetSelect');
    if (!select) return;
    select.innerHTML = `<option value="">불러오는 중…</option>`;
    let candidates = [];
    try {
      candidates = await fetchCandidates(pickerType);
    } catch (e) {
      errorToast(e, '목록을 불러오지 못했어요');
    }
    const linkedIds = new Set(links.filter((l) => l.type === pickerType).map((l) => String(l.id)));
    const filtered = candidates.filter((c) => !(pickerType === self.type && c.id === self.id) && !linkedIds.has(String(c.id)));
    select.innerHTML = filtered.length
      ? filtered.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('')
      : `<option value="">연결할 수 있는 항목이 없어요</option>`;
  }

  function bind() {
    container.querySelectorAll('[data-action="unlink"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await window.itda.links.remove({ aType: self.type, aId: self.id, bType: btn.dataset.type, bId: Number(btn.dataset.id) });
          await load();
        } catch (err) {
          errorToast(err, '연결을 해제하지 못했어요');
        }
      });
    });

    // 자동 추천 항목의 "+" — 클릭하면 추천을 진짜 직접 연결로 승격시킨다(item_links에 실제로 기록)
    container.querySelectorAll('[data-action="confirm-discover"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await window.itda.links.add({ aType: self.type, aId: self.id, bType: btn.dataset.type, bId: Number(btn.dataset.id) });
          toast('연결했어요');
          await load();
        } catch (err) {
          errorToast(err, '연결하지 못했어요');
        }
      });
    });

    const addBtn = container.querySelector('#lw-addBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        pickerOpen = true;
        pickerType = Object.keys(LINK_TYPE_LABEL)[0];
        render();
        populateTargetSelect();
      });
    }

    const cancelBtn = container.querySelector('#lw-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        pickerOpen = false;
        render();
      });
    }

    const typeSelect = container.querySelector('#lw-typeSelect');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        pickerType = e.target.value;
        populateTargetSelect();
      });
    }

    const confirmBtn = container.querySelector('#lw-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const targetSelect = container.querySelector('#lw-targetSelect');
        const targetId = targetSelect?.value;
        if (!targetId) {
          toast('연결할 항목을 선택해주세요.');
          return;
        }
        try {
          await window.itda.links.add({ aType: self.type, aId: self.id, bType: pickerType, bId: Number(targetId) });
          toast('연결했어요');
          pickerOpen = false;
          await load();
        } catch (err) {
          errorToast(err, '연결하지 못했어요');
        }
      });
    }
  }

  await load();

  // 다른 창(위젯 등)이나 이 화면의 다른 곳에서 연결이 추가/해제되거나, 연결된 항목 자체(제목 등)가
  // 바뀌면 이 위젯도 갱신한다. container가 DOM에서 떨어져 나갔으면(다른 항목 선택 등으로 통째로
  // 다시 그려진 경우) 리스너를 스스로 정리한다 — 호출부마다 별도 해제 로직을 안 만들어도 되게.
  // debounce를 쓰는 이유: "연결하기" 버튼 자신도 클릭 즉시 load()를 한 번 부르는데, 그 액션이 만든
  // 브로드캐스트가 같은 위젯에 돌아와서 또 load()를 부르는 이중 새로고침을 하나로 합치기 위함.
  const debouncedLoad = debounce(load, 200);
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (!container.isConnected) {
      offDataChanged?.();
      return;
    }
    if (!['link', 'todo', 'event', 'memo', 'postit', 'inbox'].includes(entity)) return;
    if (isUserTyping()) return;
    debouncedLoad();
  });
}
