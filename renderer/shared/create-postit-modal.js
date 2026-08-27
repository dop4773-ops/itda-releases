/**
 * renderer/shared/create-postit-modal.js
 *
 * 다른 항목(Todo/일정/메모/Inbox)을 포스트잇으로 전환할 때 쓰는 등록 팝업.
 * create-memo-modal.js와 거의 동일하지만, 포스트잇은 content가 비어있으면 안 되므로
 * (postits:add가 서버에서 강제) 내용이 비어있으면 제목으로 채운다.
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
      <h3>포스트잇으로 만들기</h3>
      <div class="form-row"><input type="text" id="cpm-title" class="input" style="flex:1;" placeholder="제목 (선택)" /></div>
      <div class="form-row"><select id="cpm-category" class="select" style="flex:1;"></select></div>
      <div class="form-row"><textarea id="cpm-content" class="input" rows="5" style="flex:1;resize:vertical;" placeholder="내용"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cpm-cancel">취소</button>
        <button class="btn" id="cpm-submit">포스트잇 등록</button>
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
 * @returns {Promise<object|null>} 등록된 포스트잇(postits:add 결과), 취소하면 null
 */
export function openCreatePostitModal({ title = '', memo = '' } = {}) {
  const el = ensureModal();
  const $ = (id) => el.querySelector('#' + id);

  return new Promise((resolve) => {
    let busy = false;

    function cleanup() {
      $('cpm-cancel').removeEventListener('click', onCancel);
      $('cpm-submit').removeEventListener('click', onSubmit);
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
      const titleVal = $('cpm-title').value.trim();
      const contentVal = $('cpm-content').value.trim();
      if (!titleVal && !contentVal) {
        toast('제목이나 내용을 입력해주세요.');
        return;
      }
      busy = true;
      $('cpm-submit').disabled = true;
      try {
        const categoryId = $('cpm-category').value ? Number($('cpm-category').value) : null;
        const newPostit = await window.itda.postits.add({
          title: titleVal || null,
          content: plainTextToHtml(contentVal || titleVal),
          categoryId,
        });
        toast('포스트잇으로 등록했어요');
        finish(newPostit);
      } catch (e) {
        errorToast(e, '포스트잇을 등록하지 못했어요');
      } finally {
        busy = false;
        $('cpm-submit').disabled = false;
      }
    }

    activeCancel = onCancel;
    $('cpm-cancel').addEventListener('click', onCancel);
    $('cpm-submit').addEventListener('click', onSubmit);

    (async () => {
      try {
        const categories = await window.itda.categories.list();
        $('cpm-category').innerHTML =
          `<option value="">카테고리 없음</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      } catch (e) {
        $('cpm-category').innerHTML = `<option value="">카테고리 없음</option>`;
      }

      $('cpm-title').value = title;
      $('cpm-content').value = memo;

      el.classList.add('open');
      $('cpm-title').focus();
    })();
  });
}
