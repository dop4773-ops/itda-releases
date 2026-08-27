/**
 * renderer/shared/create-memo-modal.js
 *
 * 다른 항목(Todo/일정/포스트잇/Inbox)을 메모로 전환할 때 쓰는 등록 팝업.
 * create-event-modal.js / create-todo-modal.js와 동일한 패턴.
 */
import { escapeHtml, toast, errorToast } from './ui-utils.js';
import { registerEscClose } from './esc-close.js';
import { plainTextToHtml } from './rich-text.js';

let modalEl = null;
let activeCancel = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-card">
      <h3>메모로 만들기</h3>
      <div class="form-row"><input type="text" id="cmm-title" class="input" style="flex:1;" placeholder="제목 (선택)" /></div>
      <div class="form-row"><select id="cmm-category" class="select" style="flex:1;"></select></div>
      <div class="form-row"><textarea id="cmm-content" class="input" rows="5" style="flex:1;resize:vertical;" placeholder="내용"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cmm-cancel">취소</button>
        <button class="btn" id="cmm-submit">메모 등록</button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  // 배경(오버레이) 클릭으로는 안 닫는다 — 입력하다가 실수로 바깥을 눌러서 날아가는 걸 막기 위해
  // Esc 키와 "취소" 버튼으로만 닫히게 의도적으로 제한한다.
  registerEscClose(() => modalEl.classList.contains('open'), () => activeCancel?.());

  return modalEl;
}

/**
 * @param {{title?: string, memo?: string}} prefill
 * @returns {Promise<object|null>} 등록된 메모(memos:add 결과), 취소하면 null
 */
export function openCreateMemoModal({ title = '', memo = '' } = {}) {
  const el = ensureModal();
  const $ = (id) => el.querySelector('#' + id);

  return new Promise((resolve) => {
    let busy = false;

    function cleanup() {
      $('cmm-cancel').removeEventListener('click', onCancel);
      $('cmm-submit').removeEventListener('click', onSubmit);
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
      const titleVal = $('cmm-title').value.trim();
      const contentVal = $('cmm-content').value.trim();
      if (!titleVal && !contentVal) {
        toast('제목이나 내용을 입력해주세요.');
        return;
      }
      busy = true;
      $('cmm-submit').disabled = true;
      try {
        const categoryId = $('cmm-category').value ? Number($('cmm-category').value) : null;
        const newMemo = await window.itda.memos.add({ title: titleVal || null, content: plainTextToHtml(contentVal), categoryId });
        toast('메모로 등록했어요');
        finish(newMemo);
      } catch (e) {
        errorToast(e, '메모를 등록하지 못했어요');
      } finally {
        busy = false;
        $('cmm-submit').disabled = false;
      }
    }

    activeCancel = onCancel;
    $('cmm-cancel').addEventListener('click', onCancel);
    $('cmm-submit').addEventListener('click', onSubmit);

    (async () => {
      try {
        const categories = await window.itda.categories.list();
        $('cmm-category').innerHTML =
          `<option value="">카테고리 없음</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      } catch (e) {
        $('cmm-category').innerHTML = `<option value="">카테고리 없음</option>`;
      }

      $('cmm-title').value = title;
      $('cmm-content').value = memo;

      el.classList.add('open');
      $('cmm-title').focus();
    })();
  });
}
