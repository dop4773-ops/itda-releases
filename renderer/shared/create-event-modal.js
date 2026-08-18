/**
 * renderer/shared/create-event-modal.js
 *
 * Inbox/Todo 내용을 일정으로 등록하는 공용 팝업. 내용에서 날짜·시각을 추측해 미리 채워주고,
 * 사용자가 확인/수정한 뒤 등록하면 새 일정을 반환한다(취소 시 null). 실제 events:add 호출과
 * 폼 자체는 calendar.js의 일정 등록 모달과 동일한 필드 구성을 재사용한다.
 */
import { escapeHtml, toast, errorToast } from './ui-utils.js';
import { attachDateQuickChips } from './date-quick-chips.js';
import { guessDateTimeFromText } from './parse-date-from-text.js';
import { registerEscClose } from './esc-close.js';

let modalEl = null;
let activeCancel = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal-card">
      <h3>일정으로 등록</h3>
      <div class="form-row"><input type="text" id="cem-title" class="input" style="flex:1;" placeholder="일정 제목" /></div>
      <div class="form-row">
        <select id="cem-category" class="select" style="flex:1;"></select>
        <input type="text" id="cem-location" class="input" placeholder="장소" style="flex:1;" />
      </div>
      <div class="form-row"><label class="checkbox-row"><input type="checkbox" id="cem-allDay" /> 하루종일</label></div>
      <div class="form-row">
        <input type="datetime-local" id="cem-start" class="input" style="flex:1;" />
        <input type="datetime-local" id="cem-end" class="input" style="flex:1;" placeholder="종료 시각 (선택)" />
      </div>
      <div class="form-row"><textarea id="cem-memo" class="input" rows="3" style="flex:1;resize:vertical;" placeholder="내용 (선택)"></textarea></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cem-cancel">취소</button>
        <button class="btn" id="cem-submit">일정 등록</button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  const $ = (id) => modalEl.querySelector('#' + id);
  attachDateQuickChips($('cem-start'));
  $('cem-allDay').addEventListener('change', (e) => {
    $('cem-start').type = e.target.checked ? 'date' : 'datetime-local';
    $('cem-end').style.display = e.target.checked ? 'none' : '';
  });
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) activeCancel?.();
  });
  registerEscClose(() => modalEl.classList.contains('open'), () => activeCancel?.());

  return modalEl;
}

/**
 * @param {{title?: string, memo?: string, dueDate?: string}} prefill - dueDate는 본문에서 날짜를 못 찾았을 때의 대체값
 * @returns {Promise<object|null>} 등록된 일정(events:add 결과), 취소하면 null
 */
export function openCreateEventModal({ title = '', memo = '', dueDate = null } = {}) {
  const el = ensureModal();
  const $ = (id) => el.querySelector('#' + id);

  return new Promise((resolve) => {
    let busy = false;

    function cleanup() {
      $('cem-cancel').removeEventListener('click', onCancel);
      $('cem-submit').removeEventListener('click', onSubmit);
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
      const titleVal = $('cem-title').value.trim();
      const isAllDay = $('cem-allDay').checked;
      const startRaw = $('cem-start').value;
      const endRaw = $('cem-end').value;
      if (!titleVal || !startRaw) {
        toast(isAllDay ? '제목과 날짜를 입력해주세요.' : '제목과 시작 시각을 입력해주세요.');
        return;
      }
      if (!isAllDay && endRaw && startRaw >= endRaw) {
        toast('종료 시각이 시작 시각보다 늦어야 해요.');
        return;
      }
      busy = true;
      $('cem-submit').disabled = true;
      try {
        const categoryId = $('cem-category').value ? Number($('cem-category').value) : null;
        const location = $('cem-location').value.trim() || null;
        const memoVal = $('cem-memo').value.trim() || null;
        const startAt = isAllDay ? `${startRaw} 00:00:00` : startRaw.replace('T', ' ');
        const endAt = !isAllDay && endRaw ? endRaw.replace('T', ' ') : null;
        const newEvent = await window.itda.events.add({
          title: titleVal,
          categoryId,
          location,
          startAt,
          endAt,
          allDay: isAllDay,
          memo: memoVal,
        });
        toast('일정으로 등록했어요');
        finish(newEvent);
      } catch (e) {
        errorToast(e, '일정을 등록하지 못했어요');
      } finally {
        busy = false;
        $('cem-submit').disabled = false;
      }
    }

    activeCancel = onCancel;
    $('cem-cancel').addEventListener('click', onCancel);
    $('cem-submit').addEventListener('click', onSubmit);

    (async () => {
      try {
        const categories = await window.itda.categories.list();
        $('cem-category').innerHTML =
          `<option value="">카테고리 없음</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      } catch (e) {
        $('cem-category').innerHTML = `<option value="">카테고리 없음</option>`;
      }

      const guess = guessDateTimeFromText(`${title} ${memo}`);
      const date = guess.date || dueDate || null;
      const isAllDay = !!date && !guess.time;

      $('cem-title').value = title;
      $('cem-memo').value = memo;
      $('cem-location').value = '';
      $('cem-allDay').checked = isAllDay;
      $('cem-start').type = isAllDay ? 'date' : 'datetime-local';
      $('cem-start').value = date ? (isAllDay ? date : `${date}T${guess.time}`) : '';
      $('cem-end').style.display = isAllDay ? 'none' : '';
      $('cem-end').value = '';

      el.classList.add('open');
      $('cem-title').focus();
    })();
  });
}
