import { escapeHtml, toast, errorToast } from './ui-utils.js';
import { mountLinksWidget } from './links-ui.js';
import { registerEscClose } from './esc-close.js';

const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const SMALL_TRASH_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>`;

/**
 * 캘린더 화면(calendar.js)의 "일정 상세/수정 모달"과 동일한 기능을 다른 화면(대시보드 등)에서도
 * 캘린더로 이동하지 않고 그 자리에서 바로 쓸 수 있게 만든 독립 컴포넌트.
 * root에 모달 마크업을 주입하고, 열기/닫기와 CRUD를 전부 이 안에서 처리한다.
 *
 * @param {HTMLElement} root - 모달 마크업을 추가로 삽입할 컨테이너(기존 내용은 지우지 않고 append)
 * @param {{ onChange?: () => void }} handlers - 추가/수정/삭제가 성공했을 때 호출 — 호출한 쪽(대시보드 등)이
 *   자기 목록을 다시 불러오도록 하기 위함
 */
export function mountEventDetailModal(root, { onChange } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-overlay" id="ed-formOverlay">
      <div class="modal-card">
        <h3 id="ed-formTitle">새 일정</h3>
        <input type="hidden" id="ed-editId" />
        <div class="form-row"><input type="text" id="ed-title" class="input" style="flex:1;" placeholder="일정 제목" /></div>
        <div class="form-row">
          <select id="ed-category" class="select" style="flex:1;"></select>
          <input type="text" id="ed-location" class="input" placeholder="장소" style="flex:1;" />
        </div>
        <div class="form-row">
          <label class="checkbox-row"><input type="checkbox" id="ed-allDay" /> 하루종일</label>
        </div>
        <div class="form-row">
          <input type="datetime-local" id="ed-start" class="input" style="flex:1;" />
          <input type="datetime-local" id="ed-end" class="input" style="flex:1;" placeholder="종료 시각 (선택)" />
        </div>
        <div class="form-row">
          <textarea id="ed-memo" class="input" rows="3" style="flex:1;resize:vertical;" placeholder="내용 (선택)"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="ed-cancelForm">취소</button>
          <button class="btn" id="ed-submitForm">저장</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="ed-detailOverlay">
      <div class="modal-card">
        <div class="panel-head">
          <span class="panel-eyebrow">일정 상세</span>
          <button class="btn-icon" id="ed-detailClose" title="닫기">${CLOSE_ICON}</button>
        </div>
        <h3 id="ed-detailTitle" style="display:flex;align-items:center;gap:8px;"></h3>
        <input type="hidden" id="ed-detailId" />
        <div class="cd-meta-row" id="ed-detailTime"></div>
        <div class="cd-meta-row" id="ed-detailLocation"></div>
        <div class="cd-meta-row" id="ed-detailMemo" style="white-space:pre-wrap;"></div>

        <label class="panel-section-label">🔗 연결된 항목</label>
        <div id="ed-detailLinks"></div>

        <div class="modal-actions">
          <button class="btn-secondary panel-delete-btn" id="ed-detailDelete">${SMALL_TRASH_ICON} 삭제</button>
          <button class="btn" id="ed-detailEdit">수정</button>
        </div>
      </div>
    </div>
  `;
  root.appendChild(wrap);

  const $ = (id) => wrap.querySelector('#' + id);

  let categories = [];
  let categoriesLoaded = false;
  let lastOpenedEvent = null; // "수정" 버튼 클릭 시 상세에서 보고 있던 이벤트 데이터를 그대로 편집 폼에 넘기기 위함
  async function ensureCategories() {
    if (categoriesLoaded) return;
    try {
      categories = await window.itda.categories.list();
    } catch (e) {
      categories = [];
    }
    $('ed-category').innerHTML = `<option value="">카테고리 없음</option>` + categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    categoriesLoaded = true;
  }

  // ---------- 상세 보기 ----------
  function openDetail(evt) {
    ensureCategories().then(() => {
      const cat = categories.find((c) => c.id === evt.category_id);
      $('ed-detailTitle').innerHTML = `${cat ? `<span class="dot" style="width:9px;height:9px;border-radius:50%;background:${cat.color_hex};display:inline-block;"></span>` : ''}${escapeHtml(evt.title)}`;
    });
    const start = (evt.start_at || '').replace(' ', ' ');
    const end = (evt.end_at || '').slice(11, 16);
    $('ed-detailTime').textContent = evt.all_day ? `${start.slice(0, 10)} · 하루종일` : `${start.slice(0, 16)} ~ ${end}`;
    $('ed-detailLocation').textContent = evt.location ? `📍 ${evt.location}` : '';
    $('ed-detailMemo').textContent = evt.memo ? evt.memo : '';
    $('ed-detailId').value = evt.id;
    $('ed-detailEdit').style.display = evt.source === 'google' ? 'none' : ''; // 구글 일정은 읽기전용
    $('ed-detailDelete').style.display = evt.source === 'google' ? 'none' : '';
    $('ed-detailOverlay').classList.add('open');
    mountLinksWidget($('ed-detailLinks'), { type: 'event', id: evt.id });
  }
  function closeDetail() {
    $('ed-detailOverlay').classList.remove('open');
    $('ed-detailLinks').innerHTML = '';
  }
  $('ed-detailClose').addEventListener('click', closeDetail);
  $('ed-detailOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'ed-detailOverlay') closeDetail();
  });
  $('ed-detailDelete').addEventListener('click', async () => {
    const id = Number($('ed-detailId').value);
    try {
      await window.itda.events.delete(id);
      toast('휴지통으로 이동했어요');
      closeDetail();
      onChange?.();
    } catch (e) {
      errorToast(e, '삭제하지 못했어요');
    }
  });

  // ---------- 추가/수정 폼 (같은 폼을 재사용) ----------
  function openForm(evt) {
    ensureCategories().then(() => {
      const isEdit = !!evt;
      $('ed-formTitle').textContent = isEdit ? '일정 수정' : '새 일정';
      $('ed-submitForm').textContent = isEdit ? '저장' : '추가';
      $('ed-editId').value = isEdit ? evt.id : '';

      $('ed-title').value = isEdit ? evt.title || '' : '';
      $('ed-category').value = isEdit && evt.category_id ? String(evt.category_id) : '';
      $('ed-location').value = isEdit ? evt.location || '' : '';
      $('ed-memo').value = isEdit ? evt.memo || '' : '';

      const isAllDay = isEdit ? !!evt.all_day : false;
      $('ed-allDay').checked = isAllDay;
      $('ed-start').type = isAllDay ? 'date' : 'datetime-local';
      $('ed-start').value = isEdit ? (isAllDay ? (evt.start_at || '').slice(0, 10) : (evt.start_at || '').slice(0, 16).replace(' ', 'T')) : '';
      $('ed-end').style.display = isAllDay ? 'none' : '';
      $('ed-end').value = isEdit && !isAllDay ? (evt.end_at || '').slice(0, 16).replace(' ', 'T') : '';

      $('ed-formOverlay').classList.add('open');
      $('ed-title').focus();
    });
  }
  function closeForm() {
    $('ed-formOverlay').classList.remove('open');
    $('ed-formTitle').textContent = '새 일정';
    $('ed-submitForm').textContent = '추가';
    $('ed-editId').value = '';
    $('ed-title').value = '';
    $('ed-location').value = '';
    $('ed-memo').value = '';
    $('ed-allDay').checked = false;
    $('ed-start').type = 'datetime-local';
    $('ed-start').value = '';
    $('ed-end').value = '';
    $('ed-end').style.display = '';
  }

  $('ed-allDay').addEventListener('change', (e) => {
    const isAllDay = e.target.checked;
    $('ed-start').type = isAllDay ? 'date' : 'datetime-local';
    $('ed-start').value = '';
    $('ed-end').style.display = isAllDay ? 'none' : '';
    $('ed-end').value = '';
  });

  $('ed-detailEdit').addEventListener('click', () => {
    const id = Number($('ed-detailId').value);
    const evt = lastOpenedEvent && lastOpenedEvent.id === id ? lastOpenedEvent : null;
    closeDetail();
    if (evt) openForm(evt);
  });
  $('ed-cancelForm').addEventListener('click', closeForm);
  $('ed-formOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'ed-formOverlay') closeForm();
  });

  let busy = false;
  $('ed-submitForm').addEventListener('click', async () => {
    if (busy) return;
    const editId = $('ed-editId').value ? Number($('ed-editId').value) : null;
    const title = $('ed-title').value.trim();
    const isAllDay = $('ed-allDay').checked;
    const startRaw = $('ed-start').value;
    const endRaw = $('ed-end').value;

    if (!title || !startRaw) {
      toast(isAllDay ? '제목과 날짜를 입력해주세요.' : '제목과 시작 시각을 입력해주세요.');
      return;
    }
    if (!isAllDay && endRaw && startRaw >= endRaw) {
      toast('종료 시각이 시작 시각보다 늦어야 해요.');
      return;
    }

    busy = true;
    $('ed-submitForm').disabled = true;
    try {
      const categoryId = $('ed-category').value ? Number($('ed-category').value) : null;
      const location = $('ed-location').value.trim() || null;
      const memo = $('ed-memo').value.trim() || null;
      const startAt = isAllDay ? `${startRaw} 00:00:00` : startRaw.replace('T', ' ');
      const endAt = !isAllDay && endRaw ? endRaw.replace('T', ' ') : null;
      if (editId) {
        await window.itda.events.update({
          id: editId,
          title,
          categoryId,
          location,
          startAt,
          endAt: endAt ?? (isAllDay ? `${startRaw} 23:59:59` : undefined),
          allDay: isAllDay,
          memo,
        });
        toast('일정을 수정했어요');
      } else {
        await window.itda.events.add({ title, categoryId, location, startAt, endAt, allDay: isAllDay, memo });
      }
      closeForm();
      onChange?.();
    } catch (e) {
      errorToast(e, editId ? '일정을 수정하지 못했어요' : '일정을 추가하지 못했어요');
    } finally {
      busy = false;
      $('ed-submitForm').disabled = false;
    }
  });

  const originalOpenDetail = openDetail;
  function openDetailTracked(evt) {
    lastOpenedEvent = evt;
    originalOpenDetail(evt);
  }

  const unsubscribeEsc = registerEscClose(
    () => $('ed-detailOverlay').classList.contains('open') || $('ed-formOverlay').classList.contains('open'),
    () => {
      if ($('ed-detailOverlay').classList.contains('open')) closeDetail();
      else closeForm();
    }
  );

  return {
    openDetail: openDetailTracked,
    openAdd: () => openForm(null),
    destroy: () => {
      unsubscribeEsc();
      wrap.remove();
    },
  };
}
