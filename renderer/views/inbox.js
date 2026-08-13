import { escapeHtml, toast, errorToast, formatRelative, emptyStateBlock, isUserTyping, debounce } from '../shared/ui-utils.js';
import { widgetLaunchButtonHtml, bindWidgetLaunchButton } from '../shared/widget-launch-button.js';

const INBOX_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>`;
const CHECK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`;
const TRASH_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

const PROCESSED_TYPE_LABEL = { todo: 'Todo로 전환됨', event: '일정으로 전환됨', memo: '메모로 전환됨' };

export async function mount(root) {
  root.innerHTML = `
    <div class="page-head">
      <div class="page-head-title">
        <div class="page-head-icon">${INBOX_ICON}</div>
        <div>
          <h1>Inbox</h1>
          <p>생각나는 대로 적어두세요. 자동 분류는 하지 않아요 — 정리는 나중에 직접.</p>
        </div>
      </div>
      ${widgetLaunchButtonHtml('i-widgetBtn', 'Inbox 위젯 열기')}
    </div>

    <div class="form-row">
      <input type="text" id="i-input" class="input" style="flex:1;min-width:260px;" placeholder="예: 김OO 재평가, 교육자료 수정…" />
      <button class="btn" id="i-addBtn">추가</button>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="unprocessed">미처리</button>
      <button class="tab" data-tab="processed">처리됨</button>
    </div>

    <div id="i-list"><div class="empty">불러오는 중…</div></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  let currentTab = 'unprocessed';
  let allItems = [];
  let busy = false;

  async function load() {
    try {
      allItems = await window.itda.inbox.list({ onlyUnprocessed: false });
      render();
    } catch (e) {
      errorToast(e, 'Inbox를 불러오지 못했어요');
      $('i-list').innerHTML = emptyStateBlock({ title: '목록을 불러오지 못했어요', subtitle: '잠시 후 다시 시도해주세요' });
    }
  }

  function render() {
    const items = allItems.filter((i) => (currentTab === 'unprocessed' ? !i.is_processed : i.is_processed));
    const listEl = $('i-list');

    if (items.length === 0) {
      listEl.innerHTML = emptyStateBlock(
        currentTab === 'unprocessed'
          ? { title: 'Inbox가 비어있어요', subtitle: '생각나는 걸 바로 적어두세요' }
          : { icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6L9 17l-5-5"/></svg>`, title: '아직 처리된 항목이 없어요', subtitle: '미처리 탭에서 Todo로 전환해보세요' }
      );
      return;
    }

    listEl.innerHTML = items
      .map((i) =>
        currentTab === 'unprocessed'
          ? `
        <div class="list-row">
          <div class="row-icon">${INBOX_ICON}</div>
          <div class="main">
            <b>${escapeHtml(i.content)}</b>
            <div class="meta">${formatRelative(i.created_at)}</div>
          </div>
          <div class="actions">
            <button class="btn-secondary" data-action="to-todo" data-id="${i.id}" data-content="${escapeHtml(i.content)}">Todo로 전환</button>
            <button class="btn-icon" data-action="delete" data-id="${i.id}" title="삭제">${TRASH_ICON}</button>
          </div>
        </div>`
          : `
        <div class="list-row">
          <div class="row-icon processed">${CHECK_ICON}</div>
          <div class="main">
            <b>${escapeHtml(i.content)}</b>
            <div class="meta">${PROCESSED_TYPE_LABEL[i.processed_type] || '처리됨'} · ${formatRelative(i.processed_at)}</div>
          </div>
          <div class="actions">
            <button class="btn-icon" data-action="delete" data-id="${i.id}" title="Inbox 기록 삭제">${TRASH_ICON}</button>
          </div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('[data-action="to-todo"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const id = Number(btn.dataset.id);
        const content = btn.dataset.content;
        try {
          const newTodo = await window.itda.todos.add({ title: content, sourceInboxId: id });
          await window.itda.inbox.markProcessed({ id, type: 'todo', refId: newTodo.id });
          toast('Todo로 전환했어요');
          load();
        } catch (e) {
          errorToast(e, '전환하지 못했어요');
          btn.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await window.itda.inbox.delete(Number(btn.dataset.id));
          load();
        } catch (e) {
          errorToast(e, '삭제하지 못했어요');
        }
      });
    });
  }

  async function handleAdd() {
    if (busy) return;
    const input = $('i-input');
    const content = input.value.trim();
    if (!content) {
      input.focus();
      return;
    }
    busy = true;
    $('i-addBtn').disabled = true;
    try {
      await window.itda.inbox.add(content);
      input.value = '';
      await load();
    } catch (e) {
      errorToast(e, '저장하지 못했어요');
    } finally {
      busy = false;
      $('i-addBtn').disabled = false;
    }
  }

  $('i-addBtn').addEventListener('click', handleAdd);
  $('i-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdd();
  });

  root.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      render();
    });
  });

  bindWidgetLaunchButton(root, 'i-widgetBtn', 'inbox');

  await load();

  const debouncedLoad = debounce(load, 200); // 이 화면 자신의 액션이 만든 브로드캐스트 메아리로 인한 이중 새로고침 방지
  const offDataChanged = window.itda.onDataChanged(({ entity }) => {
    if (entity !== 'inbox') return;
    if (isUserTyping()) return;
    debouncedLoad();
  });

  return () => offDataChanged?.();
}
