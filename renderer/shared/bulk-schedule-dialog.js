/**
 * 일정 일괄 등록 창 — 월간 근무표 캡처(주) 또는 글 붙여넣기(보조)로 종일 일정을 한 번에 등록한다.
 * 사진에선 글자를 읽지 않고(schedule-image.js) 하늘색 칸의 위치로 날짜를 채운 뒤, 잘라낸 칸 이미지를
 * 보면서 RM 번호/층만 고르면 제목이 만들어진다. 목록은 등록 전에 얼마든지 고칠 수 있다.
 */
import { escapeHtml, toast, errorToast } from './ui-utils.js';
import { registerEscClose } from './esc-close.js';
import {
  detectScheduleCells,
  cellDate,
  parseScheduleText,
  parseLabel,
  formatLabel,
  RM_NUMBERS,
  FLOOR_OPTIONS,
  cellVector,
  buildModel,
  classify,
  vecToB64,
  b64ToVec,
  addLearned,
} from './schedule-image.js';
import { SEED_TEMPLATES } from './schedule-seeds.js';

const pad = (n) => String(n).padStart(2, '0');
const attr = (v) => escapeHtml(v).replace(/"/g, '&quot;');

export function openBulkScheduleDialog({ categories = [], onRegistered } = {}) {
  const now = new Date();
  // 근무표는 보통 월말에 다음 달 것이 나오므로, 20일 이후엔 다음 달을 기본값으로
  const base = now.getDate() >= 20 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
  let rows = []; // { id, date, title, include, cell?, thumb? } — cell/thumb이 있으면 사진에서 온 행
  let nextId = 1;
  let srcCanvas = null;
  let learned = []; // 사용자가 확인해서 등록했던 칸 모양 [{label, v(base64)}] — 설정(schedule_templates)에 저장
  let model = null;
  const UNSURE_RATIO = 0.55; // 1등/2등 거리 비율이 이 이상이면 "확인 필요" 표시

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal-card bulk-card">
      <div class="panel-head">
        <h3 style="margin:0;">일정 일괄 등록</h3>
        <button class="btn-icon" data-act="close" title="닫기">✕</button>
      </div>
      <p class="settings-panel-desc">
        월간 표를 캡처한 사진에서 <b>하늘색 글씨 칸</b>(평일만)을 찾아 날짜를 채워요. 글자는 읽지 않으니, 칸 이미지를 보면서 RM 번호와 층만 골라주세요.
      </p>
      <div class="form-row">
        <label style="font-size:12px;color:var(--text-faint);display:flex;align-items:center;gap:8px;">
          대상 달
          <input type="month" id="bulk-month" class="input" value="${base.getFullYear()}-${pad(base.getMonth() + 1)}" />
        </label>
        <label style="font-size:12px;color:var(--text-faint);display:flex;align-items:center;gap:8px;">
          카테고리
          <select id="bulk-cat" class="select">
            <option value="">없음</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>
        <span class="bulk-note">하루종일 일정으로 등록돼요</span>
      </div>
      <div class="bulk-drop" id="bulk-drop" tabindex="0">
        <span>표 캡처를 여기에 <b>붙여넣기(Ctrl+V)</b>하거나 끌어다 놓으세요</span>
        <button class="btn-secondary" id="bulk-pick">사진 파일 선택…</button>
        <input type="file" id="bulk-file" accept="image/*" hidden />
      </div>
      <div class="bulk-status" id="bulk-status"></div>
      <details class="bulk-text">
        <summary>사진 없이 글로 붙여넣어 등록</summary>
        <textarea id="bulk-text" class="input" placeholder="한 줄에 하나씩 — 월/일 제목&#10;10/7 RM7(8,9층)&#10;10/8 RM6(5,7층)"></textarea>
        <button class="btn-secondary" id="bulk-parse">목록으로 만들기</button>
      </details>
      <div id="bulk-list"></div>
      <div class="form-row bulk-foot">
        <button class="btn-secondary" id="bulk-add">+ 행 추가</button>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" data-act="close">취소</button>
        <button class="btn" id="bulk-submit">등록</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);

  // "그랜드라운딩" 같은 이름의 카테고리가 있으면 기본 선택
  const guess = categories.find((c) => /라운딩/.test(c.name));
  if (guess) $('#bulk-cat').value = String(guess.id);

  const ym = () => {
    const [y, m] = $('#bulk-month').value.split('-').map(Number);
    return { year: y || base.getFullYear(), month: m || base.getMonth() + 1 };
  };

  function rebuildModel() {
    model = buildModel([...SEED_TEMPLATES, ...learned].map((t) => ({ label: t.label, v: b64ToVec(t.v) })));
  }
  rebuildModel();
  window.itda.settings
    .get('schedule_templates')
    .then((raw) => {
      try {
        learned = JSON.parse(raw || '[]');
      } catch (e) {
        learned = [];
      }
      rebuildModel();
    })
    .catch(() => {});

  function close() {
    off();
    document.removeEventListener('paste', onPaste);
    overlay.remove();
  }
  const off = registerEscClose(() => overlay.isConnected, close);

  // ---------- 목록 ----------
  function rowHtml(r) {
    const p = parseLabel(r.title);
    const floors = [...new Set([...FLOOR_OPTIONS, p && p.floors].filter(Boolean))];
    return `
      <div class="bulk-row" data-id="${r.id}">
        <input type="checkbox" class="bulk-inc" ${r.include ? 'checked' : ''} />
        <input type="date" class="input bulk-date" value="${attr(r.date)}" />
        ${r.thumb ? `<img class="bulk-thumb" src="${r.thumb}" alt="" />` : '<span class="bulk-thumb-empty"></span>'}
        <input type="text" class="input bulk-title" value="${attr(r.title)}" placeholder="오른쪽에서 RM·층 고르기" />
        ${r.guess ? `<span class="bulk-flag ${r.unsure ? 'warn' : ''}" title="사진 모양으로 추측한 값이에요">${r.unsure ? '확인' : '자동'}</span>` : ''}
        <select class="select bulk-rm"><option value="">RM</option>${RM_NUMBERS.map((n) => `<option value="${n}" ${p && p.rm === n ? 'selected' : ''}>RM${n}</option>`).join('')}</select>
        <select class="select bulk-floor"><option value="">층</option>${floors.map((f) => `<option value="${f}" ${p && p.floors === f ? 'selected' : ''}>${f}층</option>`).join('')}</select>
        <button class="btn-icon bulk-del" title="이 행 빼기">✕</button>
      </div>`;
  }
  function updateSubmit() {
    const n = rows.filter((r) => r.include).length;
    $('#bulk-submit').textContent = n ? `${n}건 등록` : '등록';
    $('#bulk-submit').disabled = !n;
  }
  function renderRows() {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    $('#bulk-list').innerHTML = rows.length ? rows.map(rowHtml).join('') : '';
    updateSubmit();
  }
  const rowOf = (el) => rows.find((r) => r.id === Number(el.closest('.bulk-row').dataset.id));

  function clearGuess(r, rowEl) {
    r.guess = false;
    rowEl.querySelector('.bulk-flag')?.remove();
  }

  $('#bulk-list').addEventListener('input', (e) => {
    const r = rowOf(e.target);
    const rowEl = e.target.closest('.bulk-row');
    if (e.target.classList.contains('bulk-title')) {
      r.title = e.target.value;
      clearGuess(r, rowEl);
      const p = parseLabel(r.title);
      rowEl.querySelector('.bulk-rm').value = p ? String(p.rm) : '';
      rowEl.querySelector('.bulk-floor').value = p ? p.floors : '';
    } else if (e.target.classList.contains('bulk-date')) {
      r.date = e.target.value;
    }
  });
  $('#bulk-list').addEventListener('change', (e) => {
    const r = rowOf(e.target);
    const rowEl = e.target.closest('.bulk-row');
    if (e.target.classList.contains('bulk-inc')) {
      r.include = e.target.checked;
      updateSubmit();
    } else if (e.target.matches('.bulk-rm, .bulk-floor')) {
      const rm = rowEl.querySelector('.bulk-rm').value;
      const fl = rowEl.querySelector('.bulk-floor').value;
      if (rm && fl) {
        r.title = formatLabel(rm, fl);
        rowEl.querySelector('.bulk-title').value = r.title;
        rowEl.classList.remove('is-bad');
        clearGuess(r, rowEl);
      }
    }
  });
  $('#bulk-list').addEventListener('click', (e) => {
    if (!e.target.closest('.bulk-del')) return;
    rows = rows.filter((r) => r !== rowOf(e.target));
    renderRows();
  });

  $('#bulk-add').addEventListener('click', () => {
    const { year, month } = ym();
    const last = rows[rows.length - 1];
    rows.push({ id: nextId++, date: last ? last.date : `${year}-${pad(month)}-01`, title: '', include: true });
    renderRows();
    overlay.querySelector('.bulk-row:last-child .bulk-title')?.focus();
  });

  // ---------- 사진 ----------
  function cropThumb(box) {
    const mx = 2; // 가로 여백은 작게 — 크게 잡으면 옆 칸의 굵은 경계선이 같이 잘려 들어온다
    const my = 5;
    const sx = Math.max(0, box.x0 - mx);
    const sy = Math.max(0, box.y0 - my);
    const sw = Math.min(srcCanvas.width - sx, box.x1 - box.x0 + 1 + mx * 2);
    const sh = Math.min(srcCanvas.height - sy, box.y1 - box.y0 + 1 + my * 2);
    const scale = Math.max(1.5, Math.min(3, 240 / sw));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d');
    ctx.filter = 'contrast(1.8) saturate(1.4) brightness(.8)'; // 가는 하늘색 글씨를 눈으로 읽기 쉽게
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function analyze() {
    const { year, month } = ym();
    const img = srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const result = detectScheduleCells(img, { year, month });
    rows = rows.filter((r) => !r.cell); // 직접 넣은 행은 유지, 사진에서 온 행만 다시 만든다
    if (!result.ok) {
      $('#bulk-status').textContent = `${result.reason} 아래 "행 추가"나 글 붙여넣기로 등록할 수 있어요.`;
    } else if (!result.cells.length) {
      $('#bulk-status').textContent = '하늘색 글씨 칸을 찾지 못했어요. 표 전체가 보이게 캡처했는지 확인해주세요.';
    } else {
      result.cells.forEach((c) => {
        const vec = cellVector(img, c.box);
        const g = classify(vec, model);
        rows.push({
          id: nextId++,
          date: c.date,
          title: g ? g.label : '',
          guess: !!g,
          unsure: !g || g.ratio >= UNSURE_RATIO,
          vec,
          include: true,
          cell: c,
          thumb: cropThumb(c.box),
        });
      });
      const unsure = rows.filter((r) => r.guess && r.unsure).length;
      $('#bulk-status').textContent = `${result.cells.length}칸을 찾았어요 — 날짜와 RM·층을 사진 모양으로 추측해서 채웠어요. 칸 이미지와 맞는지 확인하고 틀린 건 고쳐주세요.${unsure ? ` (노란 "확인" ${unsure}건은 특히 한 번 더 봐주세요)` : ''}`;
    }
    renderRows();
  }

  async function loadImage(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      srcCanvas = document.createElement('canvas');
      srcCanvas.width = bmp.width;
      srcCanvas.height = bmp.height;
      srcCanvas.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    } catch (e) {
      errorToast(e, '이미지를 열 수 없어요');
      return;
    }
    analyze();
  }

  $('#bulk-month').addEventListener('change', () => {
    const { year, month } = ym();
    // 달만 바꾸면 사진을 다시 분석하지 않고, 사진에서 온 행의 날짜만 새 달 기준으로 다시 계산(고친 제목은 유지)
    rows.filter((r) => r.cell).forEach((r) => (r.date = cellDate(year, month, r.cell.week, r.cell.col)));
    renderRows();
  });

  $('#bulk-pick').addEventListener('click', () => $('#bulk-file').click());
  $('#bulk-file').addEventListener('change', (e) => e.target.files[0] && loadImage(e.target.files[0]));
  const drop = $('#bulk-drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) loadImage(f);
  });
  function onPaste(e) {
    if (e.target && e.target.id === 'bulk-text') return; // 글 붙여넣기 칸에선 평소대로
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadImage(item.getAsFile());
  }
  document.addEventListener('paste', onPaste);

  // ---------- 글 붙여넣기 (보조) ----------
  $('#bulk-parse').addEventListener('click', () => {
    const { rows: parsed, skipped } = parseScheduleText($('#bulk-text').value, ym().year);
    parsed.forEach((p) => rows.push({ id: nextId++, date: p.date, title: p.title, include: true }));
    $('#bulk-status').textContent = parsed.length
      ? `${parsed.length}줄을 목록에 넣었어요.${skipped.length ? ` (읽지 못한 ${skipped.length}줄: ${skipped.slice(0, 2).join(' / ')}…)` : ''}`
      : '읽을 수 있는 줄이 없어요. "10/7 RM7(8,9층)"처럼 월/일 다음에 제목을 적어주세요.';
    if (parsed.length) $('#bulk-text').value = '';
    renderRows();
  });

  // 확인해서 등록한 칸의 모양을 기억해 다음 달부터 더 잘 맞히게 한다(틀린 걸 고친 칸이 특히 도움이 됨).
  function learnFrom(picked) {
    const add = picked.filter((r) => r.vec && parseLabel(r.title)).map((r) => ({ label: formatLabel(parseLabel(r.title).rm, parseLabel(r.title).floors), v: vecToB64(r.vec) }));
    if (!add.length) return;
    window.itda.settings.set({ key: 'schedule_templates', value: JSON.stringify(addLearned(learned, add)) }).catch(() => {});
  }

  // ---------- 등록 ----------
  async function submit() {
    const picked = rows.filter((r) => r.include);
    let bad = false;
    overlay.querySelectorAll('.bulk-row').forEach((el) => {
      const r = rows.find((x) => x.id === Number(el.dataset.id));
      const invalid = r.include && (!r.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.date));
      el.classList.toggle('is-bad', invalid);
      if (invalid) bad = true;
    });
    if (bad) {
      toast('빨간 칸의 제목(RM 번호·층)과 날짜를 정해주세요');
      return;
    }
    $('#bulk-submit').disabled = true;
    try {
      const catId = $('#bulk-cat').value;
      const { added } = await window.itda.events.addMany({
        items: picked.map((r) => ({ title: r.title.trim(), date: r.date })),
        categoryId: catId ? Number(catId) : null,
      });
      toast(`일정 ${added}건을 등록했어요`);
      learnFrom(picked);
      close();
      onRegistered?.();
    } catch (e) {
      errorToast(e, '등록하지 못했어요');
      updateSubmit();
    }
  }
  $('#bulk-submit').addEventListener('click', submit);
  overlay.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));

  renderRows();
  drop.focus();
}
