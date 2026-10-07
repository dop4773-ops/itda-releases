/**
 * 입퇴원 현황 위젯 — 메신저에서 불러온 항목(messenger_items)을 5가지 모양으로 보여준다.
 *   summary 요약 카드 / timeline 시간대별 / ward 병동별 / week 주간+선택한 날 / text 전달용 문구(복사)
 * 대시보드 카드(dashboard.js)와 떠 있는 위젯 창(widgets/admission.js)이 같이 쓴다. 계산(시간대 분류·이름 가림·전달 문구)은
 * 전부 메인 프로세스가 하고(messenger:items / messenger:copyText), 여기서는 그리기만 한다.
 * 이름은 설정의 "이름 표시"가 기준이고, 눈 아이콘은 그보다 더 가리는 쪽으로만 바꿀 수 있다.
 */
import { escapeHtml } from './ui-utils.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dateText = (k) => {
  const d = parseKey(k);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`;
};

export const LAYOUTS = [
  { id: 'summary', label: '요약 카드' },
  { id: 'timeline', label: '시간대별' },
  { id: 'ward', label: '병동별' },
  { id: 'week', label: '주간 보기' },
  { id: 'text', label: '전달용 문구' },
];

const KIND = {
  admission: { label: '입원', cls: 'in' },
  discharge: { label: '퇴원', cls: 'out' },
  outing: { label: '외출', cls: 'go' },
  overnight: { label: '외박', cls: 'go' },
  transfer: { label: '병동이동', cls: 'tr' },
};
const MODE_LABEL = { full: '전체 표시', mask: '가운데 가림', hide: '숨김' };
const ORDER = ['full', 'mask', 'hide'];

const EYE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.9 10.9 0 0112 19c-7 0-11-7-11-7a19.8 19.8 0 015.1-5.9M9.9 4.2A10.7 10.7 0 0112 4c7 0 11 7 11 7a19.9 19.9 0 01-3.2 4.2M1 1l22 22"/></svg>`;

const kindPill = (kind, text) => `<span class="adm-pill ${KIND[kind]?.cls || 'tr'}">${escapeHtml(text ?? KIND[kind]?.label ?? '')}</span>`;

// 목록 한 줄: [시간/구분] 사람 줄 + 비고 한 줄
function rowHtml(it, { showKind = false } = {}) {
  const left = showKind ? kindPill(it.kind) : kindPill(it.kind, it.time || '시간미정');
  const where = it.kind === 'transfer' ? ` · ${escapeHtml(it.ward)} ${escapeHtml(it.room)}→${escapeHtml(it.toWard)} ${escapeHtml(it.toRoom)}` : '';
  const sub = [showKind && it.time ? it.time : '', it.kind === 'outing' || it.kind === 'overnight' ? [it.reason && `사유 ${it.reason}`, it.returnTime && `복귀 ${it.returnTime}`].filter(Boolean).join(' · ') : '', it.note].filter(Boolean).join(' · ');
  const editable = it.kind === 'admission' || it.kind === 'discharge'; // 보충 입력(성별·나이·진단·이동수단)은 입원·퇴원만
  const supBtn = editable ? `<button class="adm-sup-btn" data-act="sup" data-id="${escapeHtml(it.id)}" title="${it.supText ? '보충 정보 고치기' : '보충 정보 입력 (성별·나이·진단·이동수단)'}" aria-label="보충 정보">${it.supText ? '✎' : '＋'}</button>` : '';
  return `<div class="adm-row" data-id="${escapeHtml(it.id)}">${left}<div class="adm-main"><span class="adm-person">${escapeHtml(it.kind === 'transfer' ? [it.name && `${it.name}님`].filter(Boolean).join('') || '병동이동' : it.person)}${where}</span>${it.supText ? `<span class="adm-sup">${escapeHtml(it.supText)}</span>` : ''}${sub ? `<span class="adm-note">${escapeHtml(sub)}</span>` : ''}</div>${supBtn}</div>`;
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export function createAdmissionWidget(container, { openRoute = () => {} } = {}) {
  const s = { layout: 'summary', date: toKey(new Date()), followToday: true, viewMode: null, data: null, texts: {}, error: '', editing: null };
  try {
    s.viewMode = localStorage.getItem('itda_admission_view') || null;
  } catch (e) {
    /* 저장된 보기 없이 시작 */
  }
  container.classList.add('adm-widget');

  const dayItems = () => (s.data ? s.data.items.filter((i) => i.date === s.date || (i.endDate && i.date <= s.date && i.endDate >= s.date)) : []);
  const of = (items, ...kinds) => items.filter((i) => kinds.includes(i.kind));

  // ---------- 모양별 ----------
  function viewSummary(items) {
    const kinds = s.data.kinds;
    const tiles = [
      ['admission', '입원', of(items, 'admission').length, kinds.admission],
      ['discharge', '퇴원', of(items, 'discharge').length, kinds.discharge],
      ['outing', '외출·외박', of(items, 'outing', 'overnight').length, kinds.outing],
    ].filter((t) => t[3]);
    const lists = [
      ['admission', of(items, 'admission')],
      ['discharge', of(items, 'discharge')],
    ].filter(([k, l]) => l.length && kinds[k]);
    const extra = [...of(items, 'outing', 'overnight'), ...of(items, 'transfer')];
    return `
      <div class="adm-tiles">${tiles.map(([k, label, n]) => `<div class="adm-tile ${KIND[k].cls}"><span>${label}</span><b>${n}</b></div>`).join('')}</div>
      ${lists.map(([k, l]) => `<div class="adm-sec"><span>${KIND[k].label} ${l.length}명</span></div>${l.map((i) => rowHtml(i)).join('')}`).join('')}
      ${extra.length ? `<div class="adm-sec"><span>외출·외박·이동 ${extra.length}건</span></div>${extra.map((i) => rowHtml(i, { showKind: true })).join('')}` : ''}`;
  }

  function viewTimeline(items) {
    const groups = new Map();
    items.forEach((i) => (groups.has(i.bucket) ? groups.get(i.bucket).push(i) : groups.set(i.bucket, [i])));
    const ordered = [...groups].sort((a, b) => Math.min(...a[1].map((i) => i.timeKey)) - Math.min(...b[1].map((i) => i.timeKey)));
    return ordered
      .map(
        ([bucket, list]) => `
      <div class="adm-slot"><span class="adm-slot-time">${escapeHtml(bucket)}</span><div class="adm-slot-body">${list.map((i) => rowHtml(i, { showKind: true })).join('')}</div></div>`
      )
      .join('');
  }

  function viewWard(items) {
    const groups = new Map();
    items.forEach((i) => (groups.has(i.ward || '병동 미정') ? groups.get(i.ward || '병동 미정').push(i) : groups.set(i.ward || '병동 미정', [i])));
    return [...groups]
      .sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }))
      .map(([ward, list]) => {
        const c = (k) => of(list, k).length;
        const pills = [c('admission') && kindPill('admission', `입원 ${c('admission')}`), c('discharge') && kindPill('discharge', `퇴원 ${c('discharge')}`), (c('outing') + c('overnight')) && kindPill('outing', `외출·외박 ${c('outing') + c('overnight')}`), c('transfer') && kindPill('transfer', `이동 ${c('transfer')}`)].filter(Boolean);
        return `<div class="adm-ward"><b>${escapeHtml(ward)}</b><span>${pills.join(' ')}</span></div>${list.map((i) => rowHtml(i, { showKind: true })).join('')}`;
      })
      .join('');
  }

  function viewWeek(items) {
    const start = addDays(parseKey(s.date), -parseKey(s.date).getDay());
    const days = Array.from({ length: 7 }, (_, i) => toKey(addDays(start, i)));
    const today = toKey(new Date());
    const strip = days
      .map((k) => {
        const n = (kind) => s.data.items.filter((i) => i.date === k && i.kind === kind).length;
        const a = n('admission');
        const d = n('discharge');
        return `<button class="adm-day ${k === s.date ? 'sel' : ''} ${k === today ? 'today' : ''}" data-act="day" data-date="${k}">
          <span>${WEEK[parseKey(k).getDay()]}</span><b>${parseKey(k).getDate()}</b>
          <i>${a ? `<em class="adm-pill in">${a}</em>` : ''}${d ? `<em class="adm-pill out">${d}</em>` : ''}</i></button>`;
      })
      .join('');
    return `<div class="adm-strip">${strip}</div>${items.length ? items.map((i) => rowHtml(i, { showKind: true })).join('') : ''}`;
  }

  function viewText() {
    const blocks = ['admission', 'discharge']
      .filter((k) => s.data.kinds[k])
      .map((k) => {
        const t = s.texts[k];
        return t
          ? `<div class="adm-sec"><span>${KIND[k].label} 전달 문구</span><button class="adm-copy" data-act="copy" data-kind="${k}">복사</button></div><pre class="adm-pre">${escapeHtml(t)}</pre>`
          : `<div class="adm-sec"><span>${KIND[k].label} 전달 문구</span></div><div class="adm-empty">복사할 ${KIND[k].label}이 없어요</div>`;
      });
    return blocks.join('');
  }

  // ---------- 보충 입력 편집기: 눌린 행 바로 아래에 펼친다(그리기 후에 끼워 넣음) ----------
  const TRANSPORTS = ['도보', '휠체어', '침대', '구급차', '자가용'];
  function mountEditor() {
    if (!s.editing || !s.data) return;
    const it = s.data.items.find((i) => i.id === s.editing);
    const row = it && [...container.querySelectorAll('.adm-row')].find((r) => r.dataset.id === s.editing);
    if (!row) {
      s.editing = null;
      return;
    }
    const sup = it.sup || {};
    const box = document.createElement('div');
    box.className = 'adm-sup-edit';
    box.dataset.id = it.id;
    box.innerHTML = `
      <div class="adm-sup-grid">
        <label>성별<select data-f="gender"><option value="">-</option><option value="남" ${sup.gender === '남' ? 'selected' : ''}>남</option><option value="여" ${sup.gender === '여' ? 'selected' : ''}>여</option></select></label>
        <label>나이<input data-f="age" type="number" min="0" max="120" inputmode="numeric" value="${sup.age ?? ''}" /></label>
        <label class="wide">진단<input data-f="diagnosis" maxlength="60" value="${escapeHtml(sup.diagnosis || '')}" /></label>
        <label class="wide">이동수단<input data-f="transport" maxlength="20" list="adm-transports" value="${escapeHtml(sup.transport || '')}" /></label>
      </div>
      <datalist id="adm-transports">${TRANSPORTS.map((t) => `<option value="${t}"></option>`).join('')}</datalist>
      <div class="adm-sup-foot"><small>이 PC의 잇다에만 저장돼요 (캘린더·구글에는 안 나가요)</small><span><button class="adm-copy" data-act="sup-cancel">취소</button> <button class="adm-copy adm-save" data-act="sup-save">저장</button></span></div>`;
    row.after(box);
    box.querySelector('[data-f="diagnosis"]').focus();
  }

  // ---------- 그리기 ----------
  function render() {
    const d = s.data;
    const eyeDisabled = !d || !d.enabled || d.storedMode === 'hide';
    const top = `
      <div class="adm-top">
        <div class="adm-nav">
          <button data-act="prev" aria-label="이전 날">‹</button><b>${dateText(s.date)}</b><button data-act="next" aria-label="다음 날">›</button>
          ${s.date !== toKey(new Date()) ? '<button data-act="today" class="adm-today">오늘</button>' : ''}
        </div>
        <div class="adm-tools">
          <select data-act="layout" aria-label="보기 방식">${LAYOUTS.map((l) => `<option value="${l.id}" ${l.id === s.layout ? 'selected' : ''}>${l.label}</option>`).join('')}</select>
          <button data-act="eye" class="adm-eye" ${eyeDisabled ? 'disabled' : ''} title="${d && d.enabled ? `환자 이름: ${MODE_LABEL[d.mode]} (눌러서 바꾸기)` : ''}">${d && d.mode === 'hide' ? EYE_OFF : EYE}</button>
        </div>
      </div>`;
    let body;
    if (s.error) body = `<div class="adm-empty">${escapeHtml(s.error)}</div>`;
    else if (!d) body = '<div class="adm-empty">불러오는 중…</div>';
    else if (!d.enabled)
      body = `<div class="adm-empty">메신저 연동을 켜면 입퇴원이 여기에 보여요.<br><button class="btn-secondary" data-act="settings" style="margin-top:8px;">연동 설정 열기</button></div>`;
    else {
      const items = dayItems();
      if (s.layout === 'text') body = viewText();
      else if (!items.length && s.layout !== 'summary') body = `<div class="adm-empty">${dateText(s.date)}에는 불러온 입퇴원이 없어요</div>`;
      else if (s.layout === 'summary') body = items.length ? viewSummary(items) : `${viewSummary(items)}<div class="adm-empty">${dateText(s.date)}에는 불러온 입퇴원이 없어요</div>`;
      else if (s.layout === 'timeline') body = viewTimeline(items);
      else if (s.layout === 'ward') body = viewWard(items);
      else body = viewWeek(items);
    }
    container.innerHTML = `${top}<div class="adm-body">${body}</div>`;
    mountEditor();
  }

  async function refresh() {
    if (s.followToday) s.date = toKey(new Date());
    const start = addDays(parseKey(s.date), -parseKey(s.date).getDay());
    try {
      s.data = await window.itda.messenger.items({ fromDate: toKey(start), toDate: toKey(addDays(start, 6)), viewMode: s.viewMode || undefined });
      s.error = '';
      s.texts = {};
      if (s.data.enabled && s.layout === 'text') {
        for (const kind of ['admission', 'discharge']) s.texts[kind] = (await window.itda.messenger.copyText({ date: s.date, kind, viewMode: s.viewMode || undefined })).text;
      }
    } catch (e) {
      s.error = '입퇴원을 불러오지 못했어요';
    }
    render();
  }

  function shiftDay(n) {
    s.date = toKey(addDays(parseKey(s.date), n));
    s.followToday = s.date === toKey(new Date());
    return refresh();
  }

  container.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT') return;
    const act = el.dataset.act;
    if (act === 'prev') shiftDay(-1);
    else if (act === 'next') shiftDay(1);
    else if (act === 'today') {
      s.followToday = true;
      refresh();
    } else if (act === 'day') {
      s.date = el.dataset.date;
      s.followToday = s.date === toKey(new Date());
      refresh();
    } else if (act === 'eye' && s.data && s.data.enabled) {
      const allowed = ORDER.filter((m) => ORDER.indexOf(m) >= ORDER.indexOf(s.data.storedMode));
      s.viewMode = allowed[(allowed.indexOf(s.data.mode) + 1) % allowed.length];
      try {
        localStorage.setItem('itda_admission_view', s.viewMode);
      } catch (err) {
        /* 이번 화면에서만 적용 */
      }
      refresh();
    } else if (act === 'copy') {
      await copyToClipboard(s.texts[el.dataset.kind] || '');
      el.textContent = '복사됨';
      setTimeout(() => el.isConnected && (el.textContent = '복사'), 1500);
    } else if (act === 'settings') openRoute('#/settings/messenger');
    else if (act === 'sup') {
      s.editing = s.editing === el.dataset.id ? null : el.dataset.id;
      render();
    } else if (act === 'sup-cancel') {
      s.editing = null;
      render();
    } else if (act === 'sup-save') {
      const box = el.closest('.adm-sup-edit');
      const v = (f) => box.querySelector(`[data-f="${f}"]`).value;
      try {
        await window.itda.messenger.setSupplement({ id: box.dataset.id, gender: v('gender'), age: v('age'), diagnosis: v('diagnosis'), transport: v('transport') });
        s.editing = null;
        refresh();
      } catch (err) {
        el.textContent = '저장 실패';
        el.title = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      }
    }
  });
  container.addEventListener('keydown', (e) => {
    const box = e.target.closest?.('.adm-sup-edit');
    if (!box) return;
    if (e.key === 'Enter') box.querySelector('[data-act="sup-save"]').click();
    else if (e.key === 'Escape') {
      e.stopPropagation();
      s.editing = null;
      render();
    }
  });
  container.addEventListener('change', (e) => {
    if (!e.target.matches('select[data-act="layout"]')) return;
    s.layout = e.target.value;
    window.itda.settings.set({ key: 'admission_widget_layout', value: s.layout }).catch(() => {});
    refresh();
  });

  window.itda.settings
    .get('admission_widget_layout')
    .then((v) => {
      if (LAYOUTS.some((l) => l.id === v)) s.layout = v;
    })
    .catch(() => {})
    .finally(refresh);

  return { refresh };
}
