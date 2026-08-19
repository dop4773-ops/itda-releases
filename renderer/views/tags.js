import { escapeHtml, toast, errorToast, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { TYPE_ROUTE, LINK_TYPE_LABEL } from '../shared/links-ui.js';
import { registerEscClose } from '../shared/esc-close.js';

export const TAG_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.2L3.2 9.59A2 2 0 003.83 11l9.58 9.59a2 2 0 002.82 0l4.36-4.36a2 2 0 000-2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>`;
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;
const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
const LIST_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const BOARD_VIEW_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="6" height="16" rx="1"/><rect x="11" y="4" width="6" height="9" rx="1"/><rect x="19" y="4" width="2" height="5" rx="1"/></svg>`;

// 탐색 모달에 쓸 타입별 순서/라벨 — Todo → 일정 → 메모 → 포스트잇 순으로 고정 노출
const BROWSE_TYPE_ORDER = ['todo', 'event', 'memo', 'postit'];
const BROWSE_TYPE_EMOJI = { todo: '☑', event: '📅', memo: '📝', postit: '📌' };

// 설정 화면(renderer/views/settings.js) 안의 "태그" 탭에 마운트된다 — 예전엔 독립된
// #/tags 화면이었지만, 자주 안 쓰는 관리 화면이라 설정 하위로 옮겨달라는 요청 반영.
// root는 settings.js가 이미 만들어둔 .settings-panel[data-panel="tags"] 엘리먼트라
// 여기선 page-head 없이 panel-head 컨벤션만 맞추면 된다.
export async function mountTagsPanel(root) {
  root.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>태그 관리</h3>
        <div class="view-toggle" id="tag-viewToggle">
          <button class="view-toggle-btn" data-view="list" title="목록">${LIST_VIEW_ICON}</button>
          <button class="view-toggle-btn active" data-view="board" title="보드">${BOARD_VIEW_ICON}</button>
        </div>
      </div>
      <p style="font-size:11.5px;color:var(--text-faint);margin:0 0 10px;">
        기본 4개(회의·업무 / 상담 / 교육 / 외래)는 삭제만 안 될 뿐, 이름과 색은 자유롭게 바꿀 수 있어요. 태그 이름을 누르면 이 태그가 붙은 항목을 전부 볼 수 있어요.
      </p>
      <div class="form-row" style="margin-bottom:8px;align-items:center;">
        <span style="font-size:11.5px;color:var(--text-faint);">캘린더 글자색 한번에 바꾸기</span>
        <button class="btn-secondary" id="tag-bulkBlack">전체 검정으로</button>
        <button class="btn-secondary" id="tag-bulkWhite">전체 흰색으로</button>
      </div>
      <div id="tag-list" class="compact-list"></div>
      <div class="form-row" style="margin-top:10px;border-top:1px solid var(--divider);padding-top:10px;">
        <input type="text" id="tag-newName" class="input" placeholder="새 카테고리 이름" style="flex:1;min-width:160px;" />
        <input type="color" id="tag-newColor" value="#6B7280" style="width:34px;height:30px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:2px;cursor:pointer;" />
        <button class="btn" id="tag-addBtn">추가</button>
      </div>
    </div>

    <div class="modal-overlay" id="tag-browseOverlay">
      <div class="modal-card">
        <h3 id="tag-browseTitle">#태그</h3>
        <div id="tag-browseBody" style="max-height:52vh;overflow-y:auto;"></div>
        <div class="modal-actions">
          <button class="btn-secondary" id="tag-browseClose">닫기</button>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let currentView = 'board'; // 기본값을 보드형으로 (요청에 따름)
  $('tag-list').classList.add('board-view');

  root.querySelectorAll('#tag-viewToggle .view-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('#tag-viewToggle .view-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      $('tag-list').classList.toggle('board-view', currentView === 'board');
    });
  });

  async function openBrowse(category) {
    $('tag-browseTitle').textContent = `# ${category.name}`;
    $('tag-browseBody').innerHTML = `<div class="links-empty">불러오는 중…</div>`;
    $('tag-browseOverlay').classList.add('open');
    try {
      const items = await window.itda.categories.itemsFor(category.id);
      const groups = BROWSE_TYPE_ORDER.map((type) => ({ type, rows: items[type] || [] })).filter((g) => g.rows.length);
      $('tag-browseBody').innerHTML = groups.length
        ? groups
            .map(
              (g) => `
          <div class="links-discover-group" style="margin-bottom:10px;">
            <div class="links-discover-group-label">${BROWSE_TYPE_EMOJI[g.type]} ${LINK_TYPE_LABEL[g.type]} (${g.rows.length})</div>
            ${g.rows
              .map(
                (r) => `
              <a class="link-item-main" href="${TYPE_ROUTE[g.type]}" style="margin-bottom:4px;">
                <span class="link-item-label">${escapeHtml(r.label)}</span>
              </a>`
              )
              .join('')}
          </div>`
            )
            .join('')
        : emptyStateBlock({ icon: SEARCH_ICON, title: '이 태그가 붙은 항목이 없어요', subtitle: 'Todo·일정·메모·포스트잇에서 이 카테고리를 지정해보세요' });
    } catch (e) {
      errorToast(e, '항목을 불러오지 못했어요');
      $('tag-browseBody').innerHTML = `<div class="links-empty">불러오지 못했어요</div>`;
    }
  }
  function closeBrowse() {
    $('tag-browseOverlay').classList.remove('open');
  }
  $('tag-browseClose').addEventListener('click', closeBrowse);
  $('tag-browseOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'tag-browseOverlay') closeBrowse();
  });
  const unsubscribeEsc = registerEscClose(() => $('tag-browseOverlay').classList.contains('open'), closeBrowse);

  async function load() {
    let categories;
    try {
      categories = await window.itda.categories.list();
    } catch (e) {
      errorToast(e, '카테고리를 불러오지 못했어요');
      return;
    }
    const listEl = $('tag-list');
    listEl.innerHTML = categories
      .map(
        (c) => `
        <div class="list-row" data-id="${c.id}">
          <input type="color" data-action="color" value="${c.color_hex}" style="width:22px;height:22px;border:1px solid var(--border);border-radius:6px;padding:1px;cursor:pointer;flex-shrink:0;" />
          <div class="main">
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="color:${c.color_hex};font-weight:700;font-size:13px;">#</span>
              <input type="text" data-action="name" class="card-title" style="font-weight:600;font-size:13px;color:var(--text);border:none;background:transparent;outline:none;width:100%;" value="${escapeHtml(c.name)}" />
            </div>
          </div>
          <span class="badge badge-neutral" title="이 태그가 붙은 항목 수" style="background:${c.color_hex}22;color:${c.color_hex};border:none;flex-shrink:0;">${c.item_count}개</span>
          <div class="text-color-toggle" data-action="textColorToggle" title="캘린더 글자색">
            <button type="button" data-value="#000000" class="${(c.text_color || '#000000') === '#000000' ? 'is-active' : ''}">검정</button>
            <button type="button" data-value="#ffffff" class="${(c.text_color || '#000000') === '#ffffff' ? 'is-active' : ''}">흰색</button>
          </div>
          <div class="actions">
            <button class="btn-icon" data-action="browse" title="이 태그의 항목 보기">${SEARCH_ICON}</button>
            ${c.is_system ? `<span class="badge badge-neutral">기본</span>` : `<button class="btn-icon" data-action="delete" title="삭제">${TRASH_ICON}</button>`}
          </div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('.list-row').forEach((row) => {
      const id = Number(row.dataset.id);
      const category = categories.find((c) => c.id === id);
      const nameInput = row.querySelector('[data-action="name"]');
      const colorInput = row.querySelector('[data-action="color"]');
      const textColorToggle = row.querySelector('[data-action="textColorToggle"]');
      let currentTextColor = textColorToggle.querySelector('.is-active')?.dataset.value || '#000000';

      let saveTimer = null;
      const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
          try {
            await window.itda.categories.update({
              id,
              name: nameInput.value.trim(),
              colorHex: colorInput.value,
              textColor: currentTextColor,
            });
            toast('카테고리를 저장했어요');
          } catch (e) {
            errorToast(e, '저장하지 못했어요');
          }
        }, 500);
      };
      nameInput.addEventListener('input', scheduleSave);
      colorInput.addEventListener('input', scheduleSave);

      textColorToggle.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentTextColor = btn.dataset.value;
          textColorToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
          scheduleSave();
        });
      });

      row.querySelector('[data-action="browse"]').addEventListener('click', () => openBrowse(category));

      const deleteBtn = row.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          try {
            await window.itda.categories.delete(id);
            toast('카테고리를 삭제했어요');
            load();
          } catch (e) {
            errorToast(e);
          }
        });
      }
    });
  }

  $('tag-addBtn').addEventListener('click', async () => {
    const name = $('tag-newName').value.trim();
    if (!name) {
      toast('카테고리 이름을 입력해주세요.');
      return;
    }
    const colorHex = $('tag-newColor').value;
    try {
      await window.itda.categories.add({ name, colorHex, textColor: '#000000' });
      $('tag-newName').value = '';
      load();
    } catch (e) {
      errorToast(e, '카테고리를 추가하지 못했어요');
    }
  });
  $('tag-newName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('tag-addBtn').click();
  });

  async function bulkSetTextColor(textColor) {
    let categories;
    try {
      categories = await window.itda.categories.list();
    } catch (e) {
      errorToast(e, '카테고리를 불러오지 못했어요');
      return;
    }
    try {
      await Promise.all(
        categories.map((c) =>
          window.itda.categories.update({ id: c.id, name: c.name, colorHex: c.color_hex, textColor })
        )
      );
      toast(`전체 카테고리 글자색을 ${textColor === '#000000' ? '검정' : '흰색'}으로 바꿨어요`);
      load();
    } catch (e) {
      errorToast(e, '일괄 변경하지 못했어요');
    }
  }
  $('tag-bulkBlack').addEventListener('click', () => bulkSetTextColor('#000000'));
  $('tag-bulkWhite').addEventListener('click', () => bulkSetTextColor('#ffffff'));

  await load();

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'category') return;
    if (isUserTyping()) return; // 이름 입력창 타이핑 중이면 미룸
    debouncedLoad();
  });

  return () => {
    offDataChanged?.();
    unsubscribeEsc();
  };
}
