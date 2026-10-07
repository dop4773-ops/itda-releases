/**
 * 일정 일괄 등록 창 — 월간 근무표 캡처(주), CCRT 평가일 엑셀, 글 붙여넣기(보조)로 종일 일정을 한 번에 등록한다.
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
import { readCcrtSheet, ccrtRowsForMonth } from './ccrt-xlsx.js';

const pad = (n) => String(n).padStart(2, '0');
const attr = (v) => escapeHtml(v).replace(/"/g, '&quot;');

export function openBulkScheduleDialog({ categories = [], onRegistered } = {}) {
  const now = new Date();
  // 근무표는 보통 월말에 다음 달 것이 나오므로, 20일 이후엔 다음 달을 기본값으로
  const base = now.getDate() >= 20 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
  let rows = []; // { id, date, title, include, cell?, thumb?, xl? } — cell/thumb이 있으면 사진, xl이면 CCRT 엑셀에서 온 행
  let ccrt = null; // 읽어 둔 CCRT명단 시트(달/이름 표시를 바꿀 때 다시 쓴다)
  let nextId = 1;
  let srcCanvas = null;
  let learned = []; // 사용자가 확인해서 등록했던 칸 모양 [{label, v(base64)}] — 설정(schedule_templates)에 저장
  let model = null;
  const UNSURE_RATIO = 0.55; // 1등/2등 거리 비율이 이 이상이면 "확인 필요" 표시

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay bulk-overlay open';
  overlay.innerHTML = `
    <div class="modal-card bulk-card">
      <div class="panel-head">
        <h3 style="margin:0;">일정 일괄 등록</h3>
        <button class="btn-icon" data-act="close" title="닫기">✕</button>
      </div>
      <div class="bulk-controls">
        <label>대상 달
          <input type="month" id="bulk-month" class="input" value="${base.getFullYear()}-${pad(base.getMonth() + 1)}" />
        </label>
        <label>카테고리
          <select id="bulk-cat" class="select">
            <option value="">없음</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </label>
        <label id="bulk-name-wrap" style="display:none">CCRT 이름
          <select id="bulk-name" class="select">
            <option value="full">전체</option>
            <option value="mask">가림 (김○수)</option>
            <option value="hide">숨김 (COSAS 2명)</option>
          </select>
        </label>
        <span class="bulk-note">하루종일 일정으로 등록돼요</span>
      </div>
      <p class="bulk-desc" id="bulk-desc">월간 표 캡처에서 하늘색 글씨 칸(평일)을 찾아 날짜와 RM·층을 채워요. "CCRT명단" 시트가 있는 엑셀 파일을 넣으면 그 달 평가일을 채워요. 맞는지 확인하고 틀린 건 고쳐주세요.</p>
      <div class="bulk-drop" id="bulk-drop" tabindex="0">
        <span id="bulk-drop-text">표 캡처를 <b>붙여넣기(Ctrl+V)</b>하거나 끌어다 놓으세요 · CCRT 엑셀은 파일로</span>
        <button class="btn-secondary" id="bulk-pick">사진·엑셀 파일 선택…</button>
        <input type="file" id="bulk-file" accept="image/*,.xlsx" hidden />
      </div>
      <div class="bulk-status" id="bulk-status"></div>
      <details class="bulk-text">
        <summary>사진 없이 글로 붙여넣어 등록</summary>
        <textarea id="bulk-text" class="input" placeholder="한 줄에 하나씩 — 월/일 제목&#10;10/7 RM7(8,9층)&#10;10/8 RM6(5,7층)"></textarea>
        <button class="btn-secondary" id="bulk-parse">목록으로 만들기</button>
      </details>
      <div id="bulk-list"></div>
      <div class="bulk-bar">
        <button class="btn-secondary" id="bulk-add">+ 행 추가</button>
        <div class="bulk-bar-right">
          <button class="btn-secondary" data-act="close">취소</button>
          <button class="btn" id="bulk-submit">등록</button>
        </div>
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
    if (r.xl) {
      return `
      <div class="bulk-row xl" data-id="${r.id}">
        <input type="checkbox" class="bulk-inc" ${r.include ? 'checked' : ''} />
        <input type="date" class="input bulk-date" value="${attr(r.date)}" />
        <input type="text" class="input bulk-title" value="${attr(r.title)}" />
        <button class="btn-icon bulk-del" title="이 행 빼기">✕</button>
      </div>`;
    }
    const p = parseLabel(r.title);
    const floors = [...new Set([...FLOOR_OPTIONS, p && p.floors].filter(Boolean))];
    return `
      <div class="bulk-row" data-id="${r.id}">
        <input type="checkbox" class="bulk-inc" ${r.include ? 'checked' : ''} />
        <input type="date" class="input bulk-date" value="${attr(r.date)}" />
        ${r.thumb ? `<img class="bulk-thumb" src="${r.thumb}" alt="" />` : '<span></span>'}
        <input type="text" class="input bulk-title" value="${attr(r.title)}" placeholder="RM·층 선택 또는 직접 입력" />
        <span class="bulk-flag-slot">${r.guess ? `<span class="bulk-flag ${r.unsure ? 'warn' : ''}" title="사진 모양으로 추측한 값이에요">${r.unsure ? '확인' : '자동'}</span>` : ''}</span>
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
    rowEl.querySelector('.bulk-flag-slot').textContent = '';
  }

  $('#bulk-list').addEventListener('input', (e) => {
    const r = rowOf(e.target);
    const rowEl = e.target.closest('.bulk-row');
    if (e.target.classList.contains('bulk-title')) {
      r.title = e.target.value;
      if (!r.xl) clearGuess(r, rowEl);
      if (r.xl) return;
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
  // 칸 이미지는 원본 픽셀 대신 "파란 글씨 세기"만 진한 청색으로 그려 — 회색 바탕·칸 경계선이 빠지고 읽기 쉽다.
  // 크기는 항상 THUMB_W x THUMB_H(2배 해상도)로 맞춰, 글씨 폭이 달라도 목록의 줄이 가지런하다.
  const THUMB_W = 176;
  const THUMB_H = 34;
  function cropThumb(box) {
    const mx = 3;
    const my = 4;
    const sx = Math.max(0, box.x0 - mx);
    const sy = Math.max(0, box.y0 - my);
    const sw = Math.min(srcCanvas.width - sx, box.x1 - box.x0 + 1 + mx * 2);
    const sh = Math.min(srcCanvas.height - sy, box.y1 - box.y0 + 1 + my * 2);
    const src = srcCanvas.getContext('2d').getImageData(sx, sy, sw, sh);
    const ink = document.createElement('canvas');
    ink.width = sw;
    ink.height = sh;
    const out = ink.getContext('2d').createImageData(sw, sh);
    for (let i = 0; i < src.data.length; i += 4) {
      // 약한 번짐(압축 잡음)은 지우고 진한 글씨는 더 진하게 — 대비를 키워 또렷하게 한다
      const a = Math.max(0, Math.min(1, ((src.data[i + 2] - src.data[i]) / 160 - 0.18) / 0.5));
      out.data[i] = 255 - a * 255;
      out.data[i + 1] = 255 - a * 185;
      out.data[i + 2] = 255 - a * 145;
      out.data[i + 3] = 255;
    }
    ink.getContext('2d').putImageData(out, 0, 0);
    const c = document.createElement('canvas');
    c.width = THUMB_W * 2;
    c.height = THUMB_H * 2;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / sw, c.height / sh);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ink, 0, 0, sw, sh, (c.width - sw * k) / 2, (c.height - sh * k) / 2, sw * k, sh * k);
    return c.toDataURL('image/png');
  }

  function analyze() {
    const { year, month } = ym();
    const img = srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const result = detectScheduleCells(img, { year, month });
    rows = rows.filter((r) => !r.cell); // 직접 넣은 행은 유지, 사진에서 온 행만 다시 만든다
    if (!result.ok) {
      $('#bulk-status').textContent = `${result.reason} "행 추가"나 글 붙여넣기로 등록할 수 있어요.`;
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
      $('#bulk-status').textContent = `${result.cells.length}칸을 찾았어요${unsure ? ` · 노란 "확인" ${unsure}건은 특히 다시 봐주세요` : ''}`;
    }
    $('#bulk-desc').style.display = 'none'; // 사진을 넣은 뒤엔 안내 문구를 접어 목록 자리를 넓힌다
    $('#bulk-drop').classList.add('compact');
    $('#bulk-drop-text').innerHTML = '다른 사진은 <b>붙여넣기(Ctrl+V)</b>하거나 끌어다 놓으세요';
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

  // ---------- CCRT 엑셀 ----------
  function applyCcrt() {
    const { year, month } = ym();
    const { rows: found, skipped } = ccrtRowsForMonth(ccrt, year, month, $('#bulk-name').value);
    rows = rows.filter((r) => !r.xl);
    found.forEach((f) => rows.push({ id: nextId++, date: f.date, title: f.title, include: true, xl: true }));
    $('#bulk-status').textContent = found.length
      ? `CCRT명단에서 ${year}년 ${month}월 평가일 ${found.length}일(${found.reduce((n, f) => n + f.count, 0)}명)을 찾았어요${skipped.length ? ` · 건너뜀: ${skipped.join(', ')}` : ''}`
      : `CCRT명단에 ${year}년 ${month}월 평가일이 없어요.${skipped.length ? ` (${skipped.join(', ')})` : ''}`;
    renderRows();
  }

  async function loadXlsx(file) {
    try {
      const r = await readCcrtSheet(await file.arrayBuffer());
      if (!r.ok) {
        $('#bulk-status').textContent = r.reason;
        return;
      }
      ccrt = r;
    } catch (e) {
      errorToast(e, '엑셀 파일을 읽을 수 없어요');
      return;
    }
    $('#bulk-name-wrap').style.display = '';
    // 엑셀 행만 있다면 라운딩 카테고리 기본값을 그대로 쓰면 어색하므로 CCRT/인지 카테고리가 있으면 바꿔 준다
    const c = categories.find((x) => /CCRT|인지/i.test(x.name));
    if (c && !rows.some((r) => r.cell)) $('#bulk-cat').value = String(c.id);
    $('#bulk-desc').style.display = 'none';
    $('#bulk-drop').classList.add('compact');
    applyCcrt();
  }
  $('#bulk-name').addEventListener('change', () => ccrt && applyCcrt());
  const loadFile = (f) => (/\.xlsx$/i.test(f.name) ? loadXlsx(f) : loadImage(f));

  $('#bulk-month').addEventListener('change', () => {
    const { year, month } = ym();
    // 달만 바꾸면 사진을 다시 분석하지 않고, 사진에서 온 행의 날짜만 새 달 기준으로 다시 계산(고친 제목은 유지)
    rows.filter((r) => r.cell).forEach((r) => (r.date = cellDate(year, month, r.cell.week, r.cell.col)));
    if (ccrt) applyCcrt(); // 엑셀은 달마다 평가일이 다르므로 그 달 것으로 다시 만든다
    else renderRows();
  });

  $('#bulk-pick').addEventListener('click', () => $('#bulk-file').click());
  $('#bulk-file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = ''; // 같은 파일을 다시 골라도 반응하게
  });
  const drop = $('#bulk-drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/') || /\.xlsx$/i.test(x.name));
    if (f) loadFile(f);
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
      ? `${parsed.length}줄을 넣었어요${skipped.length ? ` · 읽지 못한 ${skipped.length}줄: ${skipped[0].slice(0, 20)}` : ''}`
      : '읽을 수 있는 줄이 없어요. "10/7 RM7(8,9층)"처럼 월/일 다음에 제목을 적어주세요.';
    if (parsed.length) $('#bulk-desc').style.display = 'none';
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
