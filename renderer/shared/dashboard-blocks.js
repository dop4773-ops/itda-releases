/**
 * renderer/shared/dashboard-blocks.js
 *
 * 대시보드 "꾸미기 블록" — 기존 업무 카드와 똑같이 12칸 그리드에 놓이고 편집 모드에서
 * 드래그·리사이즈되는 위젯 타입. 인스턴스를 여러 개 만들 수 있고(id로 구분), 타입별
 * 설정(config)을 사용자가 편집한다. 각 블록은 config.theme/variant/frame 등으로 겉모습을 바꾼다.
 *
 * 저장:
 *   - app_settings.dashboard_blocks = [{ id, type, config }]
 *   - app_settings.dashboard_layout.widgets[id] = { x, y, w, h }   (업무 카드와 공용)
 */
import { escapeHtml } from './ui-utils.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n) => String(n).padStart(2, '0');

// ────────────────────────────── 타입 레지스트리 ──────────────────────────────
export const BLOCK_TYPES = {
  clock: {
    label: '시계',
    icon: '🕰',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { style: 'flip', showSeconds: false, theme: 'wood' },
  },
  dateCard: {
    label: '오늘 날짜 카드',
    icon: '📅',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { theme: 'paper' },
  },
  flipCalendar: {
    label: '넘김 달력',
    icon: '📆',
    defaultSize: { w: 2, h: 3 },
    defaultConfig: { theme: 'classic' },
  },
  text: {
    label: '텍스트',
    icon: 'T',
    defaultSize: { w: 4, h: 1 },
    defaultConfig: { content: '오늘의 목표', fontSize: 'lg', align: 'left', color: '', variant: 'plain' },
  },
  link: {
    label: '링크 / 바로가기',
    icon: '🔗',
    defaultSize: { w: 3, h: 3 },
    defaultConfig: { title: '바로가기', layout: 'list', items: [{ label: '예시 링크', url: 'https://', icon: '🔗' }] },
  },
  image: {
    label: '사진',
    icon: '🖼',
    defaultSize: { w: 3, h: 3 },
    defaultConfig: { dataUrl: '', fit: 'cover', frame: 'polaroid', caption: '' },
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

export function renderBlockElement(block) {
  const el = document.createElement('div');
  el.className = 'panel dash-widget dash-block';
  el.dataset.card = block.id;
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

export function paintBlock(el, block) {
  const body = el.querySelector('.dash-block-body');
  const cfg = block.config || {};
  const painter = PAINTERS[block.type];
  body.innerHTML = painter ? painter(cfg) : `<div class="dash-block-empty">알 수 없는 블록</div>`;
  el.dataset.bare = block.type === 'clock' || block.type === 'image' || block.type === 'text' ? '1' : '';
  tickBlock(el, block);
}

const digitCard = () => `<span class="flip-card"><span class="fc-top"><b>0</b></span><span class="fc-bot"><b>0</b></span></span>`;

const PAINTERS = {
  clock(c) {
    const theme = c.theme || 'wood';
    if (c.style === 'analog') {
      const minuteTicks = Array.from({ length: 60 }, (_, i) => {
        const a = (i * 6 * Math.PI) / 180;
        const r1 = i % 5 === 0 ? 38 : 41;
        const x1 = 50 + Math.sin(a) * r1;
        const y1 = 50 - Math.cos(a) * r1;
        const x2 = 50 + Math.sin(a) * 44;
        const y2 = 50 - Math.cos(a) * 44;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="an-tick ${i % 5 === 0 ? 'an-tick-h' : ''}"/>`;
      }).join('');
      return `<div class="clk clk-analog" data-theme="${theme}"><div class="analog-bezel"><svg viewBox="0 0 100 100" class="analog-svg">
        <circle cx="50" cy="50" r="45" class="an-face"/>
        ${minuteTicks}
        <text x="50" y="20" class="an-num">12</text>
        <text x="83" y="53.5" class="an-num">3</text>
        <text x="50" y="86" class="an-num">6</text>
        <text x="17" y="53.5" class="an-num">9</text>
        <text x="50" y="64" class="an-brand">ITDA</text>
        <line class="an-hand an-hour" x1="50" y1="50" x2="50" y2="32"/>
        <line class="an-hand an-min" x1="50" y1="50" x2="50" y2="22"/>
        <line class="an-hand an-sec" x1="50" y1="56" x2="50" y2="18"/>
        <circle cx="50" cy="50" r="2.4" class="an-cap"/>
      </svg></div></div>`;
    }
    if (c.style === 'digital') {
      return `<div class="clk clk-digital" data-theme="${theme}"><span class="clk-dig-time">00:00</span></div>`;
    }
    // flip (split-flap)
    return `<div class="clk clk-flip" data-theme="${theme}"><div class="flip-frame">
      <span class="flip-ampm">AM</span>
      <div class="flip-row">
        ${digitCard()}${digitCard()}<span class="flip-sep">:</span>${digitCard()}${digitCard()}
        ${c.showSeconds ? `<span class="flip-sep">:</span>${digitCard()}${digitCard()}` : ''}
      </div>
    </div></div>`;
  },
  dateCard(c) {
    return `<div class="datecard" data-theme="${c.theme || 'paper'}">
      <span class="dc-rings"><i></i><i></i></span>
      <span class="dc-year"></span>
      <span class="dc-day"></span>
      <span class="dc-sub"></span>
    </div>`;
  },
  flipCalendar(c) {
    return `<div class="flipcal" data-theme="${c.theme || 'classic'}">
      <span class="fcal-rings"><i></i><i></i></span>
      <span class="fcal-mon"></span>
      <span class="fcal-day"></span>
      <span class="fcal-wd"></span>
    </div>`;
  },
  text(c) {
    const sizeClass = { sm: 'ts-sm', md: 'ts-md', lg: 'ts-lg', xl: 'ts-xl' }[c.fontSize] || 'ts-lg';
    const style = c.color ? ` style="--tb-color:${escapeHtml(c.color)}"` : '';
    const html = escapeHtml(c.content || '').replace(/\n/g, '<br>') || '텍스트';
    return `<div class="text-block tb-${escapeHtml(c.variant || 'plain')} ${sizeClass}" data-align="${escapeHtml(c.align || 'left')}"${style}>
      <div class="tb-content">${html}</div>
    </div>`;
  },
  link(c) {
    const layout = c.layout === 'grid' ? 'grid' : 'list';
    const items = Array.isArray(c.items) ? c.items : [];
    const rows = items
      .map((it) => {
        const href = escapeHtml(it.url || '#');
        const icon = escapeHtml(it.icon || '🔗');
        const label = escapeHtml(it.label || it.url || '링크');
        return layout === 'grid'
          ? `<a class="link-tile" href="${href}" target="_blank" rel="noopener"><span class="lt-icon">${icon}</span><span class="lt-label">${label}</span></a>`
          : `<a class="link-block-row" href="${href}" target="_blank" rel="noopener"><span class="link-block-icon">${icon}</span><span class="link-block-label">${label}</span></a>`;
      })
      .join('');
    return `<div class="link-block lb-${layout}">
      ${c.title ? `<div class="link-block-title">${escapeHtml(c.title)}</div>` : ''}
      <div class="link-block-${layout}">${rows || '<div class="dash-block-empty">설정(⚙)에서 링크를 추가하세요</div>'}</div>
    </div>`;
  },
  image(c) {
    const frame = escapeHtml(c.frame || 'polaroid');
    if (!c.dataUrl) {
      return `<figure class="image-block ib-${frame}"><div class="ib-photo image-block-empty">설정(⚙)에서 사진을 선택하세요</div></figure>`;
    }
    return `<figure class="image-block ib-${frame}">
      <div class="ib-photo"><img src="${c.dataUrl}" alt="" style="object-fit:${c.fit === 'contain' ? 'contain' : 'cover'}" /></div>
      ${c.caption ? `<figcaption>${escapeHtml(c.caption)}</figcaption>` : ''}
    </figure>`;
  },
};

// ────────────────────────────── tick ──────────────────────────────
export function tickBlock(el, block) {
  const cfg = block.config || {};
  const now = new Date();

  if (block.type === 'clock') {
    if (cfg.style === 'analog') {
      const s = now.getSeconds();
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;
      // 회전 대신 끝점 좌표를 직접 계산 — transform-origin 이슈로 침이 어긋나던 문제 방지.
      const hand = (sel, len, deg, tail) => {
        const ln = el.querySelector(sel);
        if (!ln) return;
        const rad = ((deg - 90) * Math.PI) / 180;
        ln.setAttribute('x1', (50 - Math.cos(rad) * (tail || 0)).toFixed(2));
        ln.setAttribute('y1', (50 - Math.sin(rad) * (tail || 0)).toFixed(2));
        ln.setAttribute('x2', (50 + Math.cos(rad) * len).toFixed(2));
        ln.setAttribute('y2', (50 + Math.sin(rad) * len).toFixed(2));
      };
      hand('.an-hour', 22, h * 30, 5);
      hand('.an-min', 31, m * 6, 6);
      hand('.an-sec', 33, s * 6, 8);
      return;
    }
    if (cfg.style === 'digital') {
      const t = el.querySelector('.clk-dig-time');
      if (t) {
        t.textContent = cfg.showSeconds
          ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
          : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
      return;
    }
    // flip
    const ampm = el.querySelector('.flip-ampm');
    if (ampm) ampm.textContent = now.getHours() < 12 ? 'AM' : 'PM';
    const digits = cfg.showSeconds
      ? `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      : `${pad(now.getHours())}${pad(now.getMinutes())}`;
    el.querySelectorAll('.flip-card').forEach((card, i) => {
      const nv = digits[i];
      const top = card.querySelector('.fc-top b');
      if (top && top.textContent !== nv) {
        card.querySelectorAll('b').forEach((b) => (b.textContent = nv));
        card.classList.remove('is-flipping');
        void card.offsetWidth;
        card.classList.add('is-flipping');
      }
    });
    return;
  }

  if (block.type === 'dateCard') {
    const set = (sel, v) => {
      const n = el.querySelector(sel);
      if (n) n.textContent = v;
    };
    set('.dc-year', now.getFullYear());
    set('.dc-day', now.getDate());
    set('.dc-sub', `${now.getMonth() + 1}월 · ${WD[now.getDay()]}요일`);
    return;
  }

  if (block.type === 'flipCalendar') {
    const set = (sel, v) => {
      const n = el.querySelector(sel);
      if (n) n.textContent = v;
    };
    set('.fcal-mon', MON_EN[now.getMonth()]);
    set('.fcal-day', now.getDate());
    set('.fcal-wd', `${WD[now.getDay()]}요일`);
  }
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
  const readVal = (t) => (t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value);
  pop.querySelectorAll('[data-cfg]').forEach((n) => {
    const ev = n.tagName === 'SELECT' || n.type === 'checkbox' || n.type === 'color' ? 'change' : 'input';
    n.addEventListener(ev, (e) => {
      cfg[e.target.dataset.cfg] = readVal(e.target);
      emit();
    });
  });

  const fileInput = pop.querySelector('input[type="file"]');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        cfg.dataUrl = await readImageDownscaled(f, 1400);
        emit();
      } catch (err) {
        console.error('[itda] 이미지 로드 실패:', err);
      }
    });
  }

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
          cfg.items[Number(e.target.dataset.li)][e.target.dataset.f] = e.target.value;
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

const sel = (label, key, opts, cur) => `
  <label class="cfg-row">${label}
    <select class="select" data-cfg="${key}">
      ${opts.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}
    </select>
  </label>`;

const FIELDS = {
  clock: (c) => `
    ${sel('스타일', 'style', [['flip', '레트로 플립'], ['analog', '아날로그'], ['digital', '디지털']], c.style || 'flip')}
    ${sel('테마', 'theme', [['wood', '우드'], ['classic', '클래식'], ['brass', '브라스'], ['dark', '다크'], ['minimal', '미니멀']], c.theme || 'wood')}
    <label class="cfg-row"><input type="checkbox" data-cfg="showSeconds" ${c.showSeconds ? 'checked' : ''}/> 초 표시</label>`,
  dateCard: (c) => sel('테마', 'theme', [['paper', '페이퍼'], ['bold', '볼드'], ['minimal', '미니멀']], c.theme || 'paper'),
  flipCalendar: (c) => sel('테마', 'theme', [['classic', '클래식(빨강)'], ['ink', '잉크'], ['minimal', '미니멀']], c.theme || 'classic'),
  text: (c) => `
    <label class="cfg-row">내용<textarea class="input" data-cfg="content" rows="3">${escapeHtml(c.content || '')}</textarea></label>
    ${sel('스타일', 'variant', [['plain', '기본'], ['heading', '제목'], ['note', '메모지'], ['quote', '인용문']], c.variant || 'plain')}
    ${sel('크기', 'fontSize', [['sm', '작게'], ['md', '보통'], ['lg', '크게'], ['xl', '아주 크게']], c.fontSize || 'lg')}
    ${sel('정렬', 'align', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], c.align || 'left')}
    <label class="cfg-row">색상<input type="color" data-cfg="color" value="${c.color || '#333333'}" /></label>`,
  link: (c) => `
    <label class="cfg-row">제목<input class="input" data-cfg="title" value="${escapeHtml(c.title || '')}" placeholder="바로가기" /></label>
    ${sel('모양', 'layout', [['list', '목록'], ['grid', '아이콘 격자']], c.layout || 'list')}
    <div class="cfg-link-items"></div>
    <button class="btn-secondary" data-add-link style="margin-top:6px;">+ 링크 추가</button>
    <p class="cfg-note">http/https 주소나 윈도우 폴더 경로(C:\\… / \\\\서버\\공유)를 넣을 수 있어요.</p>`,
  image: (c) => `
    <label class="cfg-row">사진<input type="file" accept="image/*" /></label>
    ${sel('액자', 'frame', [['polaroid', '폴라로이드'], ['tape', '테이프'], ['rounded', '둥근 모서리'], ['plain', '없음']], c.frame || 'polaroid')}
    ${sel('채우기', 'fit', [['cover', '꽉 채우기(잘림)'], ['contain', '비율 유지(여백)']], c.fit || 'cover')}
    <label class="cfg-row">캡션<input class="input" data-cfg="caption" value="${escapeHtml(c.caption || '')}" placeholder="사진 아래 문구(선택)" /></label>`,
};

// 파일 → maxPx 이하 JPEG dataURL. config/설정에 통째로 저장.
// ponytail: 설정 행에 base64(수십~수백 KB). 사진을 많이/크게 붙이면 dashboard-images/ 폴더 저장으로 옮길 것.
export function readImageDownscaled(file, maxPx) {
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
