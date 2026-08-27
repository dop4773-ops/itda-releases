/**
 * renderer/shared/create-todo-modal.js
 *
 * 일정 등록 팝업(create-event-modal.js)의 Todo 버전. 다른 항목(주로 일정)을 Todo로
 * 전환할 때 내용을 확인/수정한 뒤 등록할 수 있게 한다. 폼 필드는 todo.js 상단의
 * 빠른 추가 행과 동일한 구성(제목/카테고리/마감일/우선순위) + 메모.
 */
import { escapeHtml, toast, errorToast } from './ui-utils.js';
import { attachDateQuickChips } from './date-quick-chips.js';
import { registerEscClose } from './esc-close.js';

let modalEl = null;
let activeCancel = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-card">
      <h3>Todo로 만들기</h3>
      <div class="form-row"><input type="text" id="ctm-title" class="input" style="flex:1;" placeholder="할 일 제목" /></div>
      <div class="form-row">
        <select id="ctm-category" class="select" style="flex:1;"></select>
        <input type="date" id="ctm-due" class="input" />
        <select id="ctm-priority" class="select">
          <option value="1">높음</option>
          <option value="2" selected>보통</option>
          <option value="3">낮음</option>
        </select>
      </div>
      <div class="form-row"><textarea id="ctm-memo" class="input" rows="3" style="flex:1;resize:vertical;" placeholder="설명 (선택)"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="ctm-cancel">취소</button>
        <button class="btn" id="ctm-submit">Todo 등록</button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  const $ = (id) => modalEl.querySelector('#' + id);
  attachDateQuickChips($('ctm-due'));
  // 배경(오버레이) 클릭으로는 안 닫는다 — 입력하다가 실수로 바깥을 눌러서 날아가는 걸 막기 위해
  // Esc 키와 "취소" 버튼으로만 닫히게 의도적으로 제한한다.
  registerEscClose(() => modalEl.classList.contains('open'), () => activeCancel?.());

  return modalEl;
}

/**
 * @param {{title?: string, memo?: string, dueDate?: string}} prefill
 * @returns {Promise<object|null>} 등록된 할 일(todos:add 결과), 취소하면 null
 */
export function openCreateTodoModal({ title = '', memo = '', dueDate = null } = {}) {
  const el = ensureModal();
  const $ = (id) => el.querySelector('#' + id);

  return new Promise((resolve) => {
    let busy = false;

    function cleanup() {
      $('ctm-cancel').removeEventListener('click', onCancel);
      $('ctm-submit').removeEventListener('click', onSubmit);
      activeCancel = null;
    }
    function finish(result) {
      el.classList.remove('open');
      cleanup();
      resolve(result);
    }
    function onCancel() {
      finish(null);
    }
    async function onSubmit() {
      if (busy) return;
      const titleVal = $('ctm-title').value.trim();
      if (!titleVal) {
        toast('할 일 제목을 입력해주세요.');
        return;
      }
      busy = true;
      $('ctm-submit').disabled = true;
      try {
        const categoryId = $('ctm-category').value ? Number($('ctm-category').value) : null;
        const dueDateVal = $('ctm-due').value || null;
        const priority = Number($('ctm-priority').value);
        const memoVal = $('ctm-memo').value.trim() || null;
        const newTodo = await window.itda.todos.add({ title: titleVal, categoryId, dueDate: dueDateVal, priority, memo: memoVal });
        toast('Todo로 등록했어요');
        finish(newTodo);
      } catch (e) {
        errorToast(e, 'Todo를 등록하지 못했어요');
      } finally {
        busy = false;
        $('ctm-submit').disabled = false;
      }
    }

    activeCancel = onCancel;
    $('ctm-cancel').addEventListener('click', onCancel);
    $('ctm-submit').addEventListener('click', onSubmit);

    (async () => {
      try {
        const categories = await window.itda.categories.list();
        $('ctm-category').innerHTML =
          `<option value="">카테고리 없음</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      } catch (e) {
        $('ctm-category').innerHTML = `<option value="">카테고리 없음</option>`;
      }

      $('ctm-title').value = title;
      $('ctm-memo').value = memo;
      $('ctm-due').value = dueDate || '';
      $('ctm-priority').value = '2';

      el.classList.add('open');
      $('ctm-title').focus();
    })();
  });
}
