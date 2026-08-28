/**
 * renderer/shared/dashboard-blocks.js
 *
 * 대시보드 "꾸미기 블록" — 기존 업무 카드(todo/event/memo…)와 똑같이 12칸 그리드에 놓이고
 * 편집 모드에서 드래그·리사이즈되는 새로운 위젯 타입들. 업무 카드와 다른 점은 딱 둘:
 *   1. 인스턴스를 여러 개 만들 수 있다(사진 3장, 텍스트 여러 개 …) — id로 구분.
 *   2. 타입별 설정(config)을 사용자가 편집한다(시계 스타일, 사진, 문구, 링크 목록 …).
 *
 * 저장 구조:
 *   - app_settings.dashboard_blocks = [{ id, type, config }]           (블록 목록 + 설정)
 *   - app_settings.dashboard_layout.widgets[id] = { x, y, w, h }        (위치/크기 — 업무 카드와 공용)
 *
 * dashboard.js가 이 모듈의 BLOCK_TYPES/renderBlockElement/tickBlock/openBlockConfig를 쓴다.
 */
import { escapeHtml } from './ui-utils.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

// ────────────────────────────── 타입 레지스트리 ──────────────────────────────
export const BLOCK_TYPES = {
  clock: {
    label: '시계',
    category: 'deco',
    icon: '🕰',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { style: 'flip', showSeconds: false },
  },
  dateCard: {
    label: '오늘 날짜 카드',
    category: 'deco',
    icon: '📅',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: {},
  },
  flipCalendar: {
    label: '넘김 달력',
    category: 'deco',
    icon: '📆',
    defaultSize: { w: 2, h: 2 },
    defaultConfig: {},
  },
  text: {
    label: '텍스트',
    category: 'deco',
    icon: 'T',
    defaultSize: { w: 4, h: 1 },
    defaultConfig: { content: '오늘의 목표', fontSize: 'lg', align: 'left', color: '' },
  },
  link: {
    label: '링크 / 바로가기',
    category: 'deco',
    icon: '🔗',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { title: '바로가기', items: [{ label: '예시 링크', url: 'https://', icon: '🔗' }] },
  },
  image: {
    label: '사진',
    category: 'deco',
    icon: '🖼',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { dataUrl: '', fit: 'cover', radius: 12, shadow: true, caption: '' },
  },
};

export function makeBlockId() {
  return 'blk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ────────────────────────────── 렌더링 ──────────────────────────────
const GRIP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>`;
const GEAR = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>`;
const DUP = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
const DEL = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>`;

/** 블록 하나의 DOM 엘리먼트를 만든다(그리드에 append하면 됨). 위치/크기는 dashboard.js가 grid-column/row로 건다. */
export function renderBlockElement(block) {
  const el = document.createElement('div');
  el.className = 'panel dash-widget dash-block';
  el.dataset.card = block.id; // initWidgetGrid가 위치를 이 키로 관리(업무 카드와 동일)
  el.dataset.block = block.type;
  el.innerHTML = `
    <span class="dash-widget-grip" title="드래그해서 위치 바꾸기">${GRIP}</span>
    <div class="dash-block-tools">
      <button class="dash-block-tool" data-act="config" title="설정">${GEAR}</button>
      <button class="dash-block-tool" data-act="duplicate" title="복제">${DUP}</button>
      <button class="dash-block-tool" data-act="delete" title="삭제">${DEL}</button>
    </div>
    <div class="dash-block-body"></div>`;
  paintBlock(el, block);
  return el;
}

/** config가 바뀌었을 때 body만 다시 그린다. */
export function paintBlock(el, block) {
  const body = el.querySelector('.dash-block-body');
  const cfg = block.config || {};
  el.dataset.blockStyle = cfg.style || '';
  const painter = PAINTERS[block.type];
  body.innerHTML = painter ? painter(cfg) : `<div class="dash-block-empty">알 수 없는 블록</div>`;
  // 시계/날짜류는 만들자마자 현재 시각으로 한 번 채운다
  tickBlock(el, block);
}

const PAINTERS = {
  clock(cfg) {
    if (cfg.style === 'analog') {
      return `<div class="clk clk-analog"><svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" class="clk-face"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = 50 + Math.sin(a) * 41;
          const y1 = 50 - Math.cos(a) * 41;
          const x2 = 50 + Math.sin(a) * 46;
          const y2 = 50 - Math.cos(a) * 46;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="clk-tick"/>`;
        }).join('')}
        <line class="clk-hand clk-hour" x1="50" y1="50" x2="50" y2="28"/>
        <line class="clk-hand clk-min" x1="50" y1="50" x2="50" y2="18"/>
        <line class="clk-hand clk-sec" x1="50" y1="55" x2="50" y2="14"/>
        <circle cx="50" cy="50" r="2.5" class="clk-pin"/>
      </svg></div>`;
    }
    if (cfg.style === 'digital') {
      return `<div class="clk clk-digital"><span class="clk-dig-time">00:00</span></div>`;
    }
    // flip (기본) — 레트로 플립 시계
    const digit = () => `<span class="fc-digit"><span class="fc-val">0</span></span>`;
    return `<div class="clk clk-flip">
      <span class="fc-group">${digit()}${digit()}</span><span class="fc-colon">:</span>
      <span class="fc-group">${digit()}${digit()}</span>
      ${cfg.showSeconds ? `<span class="fc-colon">:</span><span class="fc-group fc-sec">${digit()}${digit()}</span>` : ''}
    </div>`;
  },
  dateCard() {
    return `<div class="datecard">
      <span class="datecard-year"></span>
      <span class="datecard-day"></span>
      <span class="datecard-wd"></span>
    </div>`;
  },
  flipCalendar() {
    return `<div class="flipcal">
      <span class="flipcal-mon"></span>
      <span class="flipcal-day"></span>
    </div>`;
  },
  text(cfg) {
    const sizeClass = { sm: 'ts-sm', md: 'ts-md', lg: 'ts-lg', xl: 'ts-xl' }[cfg.fontSize] || 'ts-lg';
    const style = cfg.color ? ` style="color:${escapeHtml(cfg.color)}"` : '';
    return `<div class="text-block ${sizeClass}" data-align="${cfg.align || 'left'}"${style}>${escapeHtml(cfg.content || '').replace(/\n/g, '<br>') || '텍스트'}</div>`;
  },
  link(cfg) {
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const rows = items
      .map(
        (it) => `<a class="link-block-row" href="${escapeHtml(it.url || '#')}" target="_blank" rel="noopener">
          <span class="link-block-icon">${escapeHtml(it.icon || '🔗')}</span>
          <span class="link-block-label">${escapeHtml(it.label || it.url || '링크')}</span>
        </a>`
      )
      .join('');
    return `<div class="link-block">
      ${cfg.title ? `<div class="link-block-title">${escapeHtml(cfg.title)}</div>` : ''}
      <div class="link-block-list">${rows || '<div class="dash-block-empty">설정에서 링크를 추가하세요</div>'}</div>
    </div>`;
  },
  image(cfg) {
    if (!cfg.dataUrl) {
      return `<div class="image-block image-block-empty">설정(⚙)에서 사진을 선택하세요</div>`;
    }
    const st = `object-fit:${cfg.fit === 'contain' ? 'contain' : 'cover'};border-radius:${Number(cfg.radius) || 0}px;${cfg.shadow ? 'box-shadow:0 6px 18px rgba(16,24,40,.22);' : ''}`;
    return `<figure class="image-block">
      <img src="${cfg.dataUrl}" alt="" style="${st}" />
      ${cfg.caption ? `<figcaption>${escapeHtml(cfg.caption)}</figcaption>` : ''}
    </figure>`;
  },
};

// ────────────────────────────── tick (시계/날짜 갱신) ──────────────────────────────
export function tickBlock(el, block) {
  const cfg = block.config || {};
  const now = new Date();
  if (block.type === 'clock') {
    if (cfg.style === 'analog') {
      const s = now.getSeconds();
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;
      const set = (sel, deg) => {
        const ln = el.querySelector(sel);
        if (ln) ln.setAttribute('transform', `rotate(${deg} 50 50)`);
      };
      set('.clk-hour', h * 30);
      set('.clk-min', m * 6);
      set('.clk-sec', s * 6);
      return;
    }
    if (cfg.style === 'digital') {
      const t = el.querySelector('.clk-dig-time');
      if (t) t.textContent = cfg.showSeconds ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      return;
    }
    // flip
    const digits = cfg.showSeconds
      ? `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      : `${pad(now.getHours())}${pad(now.getMinutes())}`;
    el.querySelectorAll('.fc-digit').forEach((d, i) => {
      const nv = digits[i];
      const cur = d.querySelector('.fc-val');
      if (cur && cur.textContent !== nv) {
        cur.textContent = nv;
        d.classList.remove('is-flipping');
        void d.offsetWidth; // 리플로우 강제 → 애니메이션 재시작
        d.classList.add('is-flipping');
      }
    });
    return;
  }
  if (block.type === 'dateCard') {
    const y = el.querySelector('.datecard-year');
    const dd = el.querySelector('.datecard-day');
    const wd = el.querySelector('.datecard-wd');
    if (y) y.textContent = now.getFullYear();
    if (dd) dd.textContent = now.getDate();
    if (wd) wd.textContent = `${now.getMonth() + 1}월 ${WD[now.getDay()]}요일`;
    return;
  }
  if (block.type === 'flipCalendar') {
    const mo = el.querySelector('.flipcal-mon');
    const dy = el.querySelector('.flipcal-day');
    if (mo) mo.textContent = MON_EN[now.getMonth()];
    if (dy) dy.textContent = now.getDate();
  }
}

/** 1초마다 호출되는 시계 블록만 실제 갱신이 필요한지 — dashboard.js가 interval 주기를 정할 때 참고 */
export function needsTicking(blocks) {
  return blocks.some((b) => b.type === 'clock' || b.type === 'dateCard' || b.type === 'flipCalendar');
}

// ────────────────────────────── 설정 팝오버 ──────────────────────────────
let cfgPopEl = null;
export function closeBlockConfig() {
  cfgPopEl?.remove();
  cfgPopEl = null;
  document.removeEventListener('mousedown', onCfgOutside, true);
}
function onCfgOutside(e) {
  if (cfgPopEl && !cfgPopEl.contains(e.target)) closeBlockConfig();
}

/**
 * @param {HTMLElement} anchorEl 블록 엘리먼트
 * @param {{type,config}} block
 * @param {(config)=>void} onChange config가 바뀔 때마다 호출(즉시 저장·재렌더는 호출자 책임)
 */
export function openBlockConfig(anchorEl, block, onChange) {
  closeBlockConfig();
  const cfg = { ...block.config };
  const pop = document.createElement('div');
  pop.className = 'dash-block-config';
  pop.innerHTML = FIELDS[block.type] ? FIELDS[block.type](cfg) : '<p>설정 없음</p>';
  document.body.appendChild(pop);
  cfgPopEl = pop;

  const r = anchorEl.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
  setTimeout(() => document.addEventListener('mousedown', onCfgOutside, true), 0);

  const emit = () => onChange({ ...cfg });
  const bind = (sel, ev, fn) => pop.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn));

  bind('[data-cfg]', 'input', (e) => {
    const k = e.target.dataset.cfg;
    cfg[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    emit();
  });
  bind('[data-cfg]', 'change', (e) => {
    const k = e.target.dataset.cfg;
    cfg[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    emit();
  });

  // 사진 블록: 파일 선택 → 캔버스로 축소 → JPEG dataURL
  const fileInput = pop.querySelector('input[type="file"]');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        cfg.dataUrl = await readImageDownscaled(f, 1280);
        emit();
      } catch (err) {
        console.error('[itda] 이미지 로드 실패:', err);
      }
    });
  }

  // 링크 블록: 항목 추가/삭제
  if (block.type === 'link') {
    const renderItems = () => {
      const list = pop.querySelector('.cfg-link-items');
      list.innerHTML = (cfg.items || [])
        .map(
          (it, i) => `<div class="cfg-link-row">
            <input class="input" data-li="${i}" data-f="icon" value="${escapeHtml(it.icon || '')}" placeholder="🔗" style="width:44px;text-align:center;" />
            <input class="input" data-li="${i}" data-f="label" value="${escapeHtml(it.label || '')}" placeholder="이름" />
            <input class="input" data-li="${i}" data-f="url" value="${escapeHtml(it.url || '')}" placeholder="https://" />
            <button class="btn-icon" data-rm="${i}" title="삭제">✕</button>
          </div>`
        )
        .join('');
      list.querySelectorAll('input[data-li]').forEach((n) =>
        n.addEventListener('input', (e) => {
          const i = Number(e.target.dataset.li);
          cfg.items[i][e.target.dataset.f] = e.target.value;
          emit();
        })
      );
      list.querySelectorAll('[data-rm]').forEach((n) =>
        n.addEventListener('click', () => {
          cfg.items.splice(Number(n.dataset.rm), 1);
          emit();
          renderItems();
        })
      );
    };
    renderItems();
    pop.querySelector('[data-add-link]').addEventListener('click', () => {
      cfg.items = cfg.items || [];
      cfg.items.push({ label: '', url: 'https://', icon: '🔗' });
      emit();
      renderItems();
    });
  }
}

const FIELDS = {
  clock: (c) => `
    <label class="cfg-row">스타일
      <select class="select" data-cfg="style">
        <option value="flip" ${c.style === 'flip' ? 'selected' : ''}>레트로 플립</option>
        <option value="analog" ${c.style === 'analog' ? 'selected' : ''}>아날로그</option>
        <option value="digital" ${c.style === 'digital' ? 'selected' : ''}>디지털</option>
      </select>
    </label>
    <label class="cfg-row"><input type="checkbox" data-cfg="showSeconds" ${c.showSeconds ? 'checked' : ''}/> 초 표시</label>`,
  dateCard: () => `<p class="cfg-note">오늘 날짜를 자동으로 보여줍니다.</p>`,
  flipCalendar: () => `<p class="cfg-note">한 장씩 넘기는 형태의 오늘 날짜 달력입니다.</p>`,
  text: (c) => `
    <label class="cfg-row">내용<textarea class="input" data-cfg="content" rows="3">${escapeHtml(c.content || '')}</textarea></label>
    <label class="cfg-row">크기
      <select class="select" data-cfg="fontSize">
        ${['sm', 'md', 'lg', 'xl'].map((s) => `<option value="${s}" ${c.fontSize === s ? 'selected' : ''}>${{ sm: '작게', md: '보통', lg: '크게', xl: '아주 크게' }[s]}</option>`).join('')}
      </select>
    </label>
    <label class="cfg-row">정렬
      <select class="select" data-cfg="align">
        ${['left', 'center', 'right'].map((a) => `<option value="${a}" ${c.align === a ? 'selected' : ''}>${{ left: '왼쪽', center: '가운데', right: '오른쪽' }[a]}</option>`).join('')}
      </select>
    </label>
    <label class="cfg-row">색상<input type="color" data-cfg="color" value="${c.color || '#333333'}" /></label>`,
  link: (c) => `
    <label class="cfg-row">제목<input class="input" data-cfg="title" value="${escapeHtml(c.title || '')}" placeholder="바로가기" /></label>
    <div class="cfg-link-items"></div>
    <button class="btn-secondary" data-add-link style="margin-top:6px;">+ 링크 추가</button>
    <p class="cfg-note">http/https 주소나 윈도우 폴더 경로(C:\\… 또는 \\\\서버\\공유)를 넣을 수 있어요.</p>`,
  image: (c) => `
    <label class="cfg-row">사진<input type="file" accept="image/*" /></label>
    <label class="cfg-row">채우기
      <select class="select" data-cfg="fit">
        <option value="cover" ${c.fit === 'cover' ? 'selected' : ''}>꽉 채우기(잘림)</option>
        <option value="contain" ${c.fit === 'contain' ? 'selected' : ''}>비율 유지(여백)</option>
      </select>
    </label>
    <label class="cfg-row">모서리 둥글기<input type="number" data-cfg="radius" min="0" max="40" value="${Number(c.radius) || 0}" /></label>
    <label class="cfg-row"><input type="checkbox" data-cfg="shadow" ${c.shadow ? 'checked' : ''}/> 그림자</label>
    <label class="cfg-row">캡션<input class="input" data-cfg="caption" value="${escapeHtml(c.caption || '')}" placeholder="사진 아래 문구(선택)" /></label>`,
};

// 파일 → maxPx 안에 들어오게 축소한 JPEG dataURL. 설정 JSON에 통째로 저장되므로 원본은 안 넣는다.
// ponytail: 설정 행에 base64로 저장(수십~수백 KB). 사진을 많이/크게 붙이면 dashboard-images/ 폴더 저장으로 옮길 것.
function readImageDownscaled(file, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 읽지 못했어요'));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
