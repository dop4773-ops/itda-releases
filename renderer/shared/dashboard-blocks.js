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
    defaultConfig: { imageFile: '', dataUrl: '', fit: 'cover', frame: 'polaroid', caption: '' },
  },
  sticker: {
    label: '스티커',
    icon: '🌟',
    defaultSize: { w: 2, h: 2 },
    defaultConfig: { emoji: '⭐', text: '', color: '#ffe08a', tilt: true },
  },
  quote: {
    label: '인용문',
    icon: '❝',
    defaultSize: { w: 4, h: 2 },
    defaultConfig: { text: '오늘의 최선을 다하면 내일의 내가 달라집니다.', author: '', theme: 'paper' },
  },
  weather: {
    label: '날씨',
    icon: '⛅',
    defaultSize: { w: 3, h: 2 },
    defaultConfig: { city: '서울' },
  },
  miniTool: {
    label: '미니 도구',
    icon: '🧮',
    defaultSize: { w: 3, h: 3 },
    defaultConfig: { tool: 'calc', notes: '' },
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

const BARE_TYPES = ['clock', 'image', 'text', 'sticker', 'quote'];

export function paintBlock(el, block) {
  const body = el.querySelector('.dash-block-body');
  const cfg = block.config || {};
  const painter = PAINTERS[block.type];
  body.innerHTML = painter ? painter(cfg) : `<div class="dash-block-empty">알 수 없는 블록</div>`;
  el.dataset.bare = BARE_TYPES.includes(block.type) ? '1' : '';
  if (block.type === 'weather') el._wxNext = 0; // 도시가 바뀌었을 수 있으니 다시 렌더될 땐 무조건 재조회
  hydrateBlock(el, block);
  tickBlock(el, block);
}

// 렌더 후 비동기로 채워야 하는 것들: 저장된 사진 파일 로드, 링크 favicon, 미니 도구 배선.
function hydrateBlock(el, block) {
  const cfg = block.config || {};

  if (block.type === 'image' && cfg.imageFile && !cfg.dataUrl && window.itda?.dashboardImages) {
    const img = el.querySelector('img[data-img-file]');
    if (img) {
      window.itda.dashboardImages
        .get(cfg.imageFile)
        .then((url) => {
          if (url) img.src = url;
        })
        .catch(() => {});
    }
  }

  if (block.type === 'link') {
    el.querySelectorAll('img[data-fav]').forEach((img) => {
      const fallback = img.previousElementSibling;
      img.addEventListener('load', () => {
        img.style.display = '';
        if (fallback) fallback.style.display = 'none';
      });
      img.addEventListener('error', () => img.remove());
      img.src = `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(img.dataset.fav)}`;
    });
  }

  if (block.type === 'weather') refreshWeather(el, block, false);

  if (block.type === 'miniTool') wireMiniTool(el, block);
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
    if (c.style === 'led') {
      return `<div class="clk clk-led"><span class="clk-led-ghost">88:88</span><span class="clk-led-time">00:00</span></div>`;
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
    const iconCell = (it) => {
      // 아이콘을 안 넣었고 http(s) 주소면 사이트 favicon 자동 표시(로드 실패하면 기본 아이콘).
      const isWeb = /^https?:\/\//i.test(it.url || '');
      if (!it.icon && isWeb) {
        try {
          const host = new URL(it.url).hostname;
          return `<span class="lb-ico">🔗</span><img class="lb-fav" data-fav="${escapeHtml(host)}" alt="" style="display:none" />`;
        } catch (e) {
          /* 잘못된 URL */
        }
      }
      return `<span class="lb-ico">${escapeHtml(it.icon || '🔗')}</span>`;
    };
    const rows = items
      .map((it) => {
        const href = escapeHtml(it.url || '#');
        const label = escapeHtml(it.label || it.url || '링크');
        return layout === 'grid'
          ? `<a class="link-tile" href="${href}" target="_blank" rel="noopener"><span class="lt-icon">${iconCell(it)}</span><span class="lt-label">${label}</span></a>`
          : `<a class="link-block-row" href="${href}" target="_blank" rel="noopener"><span class="link-block-icon">${iconCell(it)}</span><span class="link-block-label">${label}</span></a>`;
      })
      .join('');
    return `<div class="link-block lb-${layout}">
      ${c.title ? `<div class="link-block-title">${escapeHtml(c.title)}</div>` : ''}
      <div class="link-block-${layout}">${rows || '<div class="dash-block-empty">설정(⚙)에서 링크를 추가하세요</div>'}</div>
    </div>`;
  },
  image(c) {
    const frame = escapeHtml(c.frame || 'polaroid');
    const fitCss = c.fit === 'contain' ? 'contain' : 'cover';
    let photo;
    if (c.dataUrl) photo = `<img src="${c.dataUrl}" alt="" style="object-fit:${fitCss}" />`;
    else if (c.imageFile) photo = `<img data-img-file="${escapeHtml(c.imageFile)}" alt="" style="object-fit:${fitCss}" />`;
    else photo = `<div class="image-block-empty">설정(⚙)에서 사진을 선택하세요</div>`;
    return `<figure class="image-block ib-${frame}">
      <div class="ib-photo">${photo}</div>
      ${c.caption ? `<figcaption>${escapeHtml(c.caption)}</figcaption>` : ''}
    </figure>`;
  },
  sticker(c) {
    return `<div class="sticker-block ${c.tilt ? 'is-tilt' : ''}" style="--stk:${escapeHtml(c.color || '#ffe08a')}">
      <span class="stk-emoji">${escapeHtml(c.emoji || '⭐')}</span>
      ${c.text ? `<span class="stk-text">${escapeHtml(c.text)}</span>` : ''}
    </div>`;
  },
  quote(c) {
    return `<div class="quote-block" data-theme="${escapeHtml(c.theme || 'paper')}">
      <span class="qb-mark">&ldquo;</span>
      <p class="qb-text">${escapeHtml(c.text || '').replace(/\n/g, '<br>') || '문구를 입력하세요'}</p>
      ${c.author ? `<span class="qb-author">— ${escapeHtml(c.author)}</span>` : ''}
    </div>`;
  },
  weather(c) {
    return `<div class="weather-block">
      <div class="wx-loading">날씨 불러오는 중…</div>
      <div class="wx-main" style="display:none">
        <span class="wx-icon"></span>
        <div class="wx-info"><span class="wx-temp"></span><span class="wx-desc"></span><span class="wx-city">${escapeHtml(c.city || '')}</span></div>
      </div>
    </div>`;
  },
  miniTool(c) {
    if (c.tool === 'notepad') {
      return `<div class="minitool mt-notepad"><textarea class="mt-notes" placeholder="메모…">${escapeHtml(c.notes || '')}</textarea></div>`;
    }
    if (c.tool === 'timer') {
      return `<div class="minitool mt-timer">
        <span class="mt-time">00:00</span>
        <div class="mt-btns"><button data-t="start">시작</button><button data-t="stop">정지</button><button data-t="reset">리셋</button></div>
      </div>`;
    }
    // calc
    const keys = ['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '=', '+', 'C'];
    return `<div class="minitool mt-calc">
      <input class="mt-display" value="0" readonly />
      <div class="mt-pad">${keys.map((k) => `<button data-k="${k}" ${k === 'C' ? 'class="mt-wide"' : ''}>${k}</button>`).join('')}</div>
    </div>`;
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
    if (cfg.style === 'digital' || cfg.style === 'led') {
      const t = el.querySelector('.clk-dig-time, .clk-led-time');
      if (t) {
        t.textContent = cfg.showSeconds
          ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
          : `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
      const ghost = el.querySelector('.clk-led-ghost');
      if (ghost) ghost.textContent = cfg.showSeconds ? '88:88:88' : '88:88';
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
    return;
  }

  if (block.type === 'weather') {
    if (Date.now() >= (el._wxNext || 0)) refreshWeather(el, block, false);
    return;
  }

  if (block.type === 'miniTool' && cfg.tool === 'timer' && el._timer) {
    const t = el.querySelector('.mt-time');
    if (t) {
      const ms = el._timer.elapsed + (el._timer.running ? Date.now() - el._timer.start : 0);
      const s = Math.floor(ms / 1000);
      t.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    }
  }
}

// ────────────────────────────── 날씨 (open-meteo, 키 불필요) ──────────────────────────────
const WMO = {
  0: ['☀️', '맑음'], 1: ['🌤️', '대체로 맑음'], 2: ['⛅', '구름 조금'], 3: ['☁️', '흐림'],
  45: ['🌫️', '안개'], 48: ['🌫️', '안개'],
  51: ['🌦️', '이슬비'], 53: ['🌦️', '이슬비'], 55: ['🌧️', '강한 이슬비'],
  61: ['🌧️', '비'], 63: ['🌧️', '비'], 65: ['🌧️', '강한 비'],
  71: ['🌨️', '눈'], 73: ['🌨️', '눈'], 75: ['❄️', '강한 눈'], 77: ['🌨️', '싸락눈'],
  80: ['🌦️', '소나기'], 81: ['🌧️', '소나기'], 82: ['⛈️', '강한 소나기'],
  85: ['🌨️', '눈 소나기'], 86: ['❄️', '눈 소나기'],
  95: ['⛈️', '뇌우'], 96: ['⛈️', '뇌우·우박'], 99: ['⛈️', '강한 뇌우'],
};
// open-meteo 지오코딩은 한글 도시명("서울")을 못 찾는다 — 주요 국내 도시는 좌표를 직접 들고 있고,
// 그 외(영문 도시명 등)만 지오코딩 API로 넘긴다.
const KR_CITIES = {
  서울: [37.5665, 126.978, '서울'], 부산: [35.1796, 129.0756, '부산'], 대구: [35.8714, 128.6014, '대구'],
  인천: [37.4563, 126.7052, '인천'], 광주: [35.1595, 126.8526, '광주'], 대전: [36.3504, 127.3845, '대전'],
  울산: [35.5384, 129.3114, '울산'], 세종: [36.48, 127.289, '세종'], 수원: [37.2636, 127.0286, '수원'],
  용인: [37.2411, 127.1776, '용인'], 성남: [37.42, 127.1265, '성남'], 고양: [37.6584, 126.832, '고양'],
  제주: [33.4996, 126.5312, '제주'], 서귀포: [33.2542, 126.56, '서귀포'], 춘천: [37.8813, 127.73, '춘천'],
  강릉: [37.7519, 128.8761, '강릉'], 원주: [37.3422, 127.9202, '원주'], 전주: [35.8242, 127.148, '전주'],
  청주: [36.6424, 127.489, '청주'], 천안: [36.8151, 127.1139, '천안'], 창원: [35.228, 128.6811, '창원'],
  포항: [36.019, 129.3435, '포항'], 김해: [35.2285, 128.8894, '김해'], 목포: [34.8118, 126.3922, '목포'],
  여수: [34.7604, 127.6622, '여수'], 안동: [36.5684, 128.7294, '안동'], 평택: [36.9921, 127.1129, '평택'],
};
// 8초 안에 응답 없으면 끊고 에러 처리 — "불러오는 중"으로 무한정 안 걸리게.
const fetchJson = (url) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  return fetch(url, { signal: ac.signal })
    .then((r) => r.json())
    .finally(() => clearTimeout(t));
};
async function refreshWeather(el, block, force) {
  const now = Date.now();
  if (!force && now < (el._wxNext || 0)) return;
  el._wxNext = now + 30 * 60 * 1000;
  const city = (block.config?.city || '서울').trim();
  const loading = el.querySelector('.wx-loading');
  const main = el.querySelector('.wx-main');
  try {
    let place;
    const known = KR_CITIES[city.replace(/(특별시|광역시|시|도)$/, '')] || KR_CITIES[city];
    if (known) {
      place = { latitude: known[0], longitude: known[1], name: known[2] };
    } else {
      const geo = await fetchJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&format=json`
      );
      place = geo?.results?.[0];
    }
    if (!place) throw new Error('city not found');
    const wx = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code`
    );
    const cur = wx?.current;
    if (!cur) throw new Error('no data');
    const [icon, desc] = WMO[cur.weather_code] || ['🌡️', ''];
    if (el.querySelector('.wx-icon')) el.querySelector('.wx-icon').textContent = icon;
    if (el.querySelector('.wx-temp')) el.querySelector('.wx-temp').textContent = `${Math.round(cur.temperature_2m)}°`;
    if (el.querySelector('.wx-desc')) el.querySelector('.wx-desc').textContent = desc;
    if (el.querySelector('.wx-city')) el.querySelector('.wx-city').textContent = place.name || city;
    if (loading) loading.style.display = 'none';
    if (main) main.style.display = '';
  } catch (e) {
    if (loading) {
      loading.style.display = '';
      loading.textContent = /[가-힣]/.test(city) ? `'${city}' 날씨를 못 찾았어요 (영어 도시명으로 시도)` : '날씨를 불러올 수 없어요';
    }
    if (main) main.style.display = 'none';
    el._wxNext = now + 5 * 60 * 1000; // 실패 시 5분 뒤 재시도
  }
}

// ────────────────────────────── 미니 도구 배선 ──────────────────────────────
function wireMiniTool(el, block) {
  const tool = block.config?.tool || 'calc';

  if (tool === 'notepad') {
    const ta = el.querySelector('.mt-notes');
    if (!ta) return;
    let t = null;
    ta.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        block.config.notes = ta.value;
        el.dispatchEvent(new CustomEvent('block-config-change', { bubbles: true }));
      }, 400);
    });
    return;
  }

  if (tool === 'timer') {
    if (!el._timer) el._timer = { running: false, start: 0, elapsed: 0 };
    el.querySelectorAll('.mt-btns button').forEach((b) => {
      b.addEventListener('click', () => {
        const st = el._timer;
        if (b.dataset.t === 'start' && !st.running) {
          st.running = true;
          st.start = Date.now();
        } else if (b.dataset.t === 'stop' && st.running) {
          st.elapsed += Date.now() - st.start;
          st.running = false;
        } else if (b.dataset.t === 'reset') {
          st.running = false;
          st.elapsed = 0;
        }
        tickBlock(el, block);
      });
    });
    return;
  }

  // calc
  const disp = el.querySelector('.mt-display');
  if (!disp) return;
  let expr = '';
  el.querySelectorAll('.mt-pad button').forEach((b) => {
    b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'C') {
        expr = '';
        disp.value = '0';
        return;
      }
      if (k === '=') {
        try {
          const r = evalArith(expr);
          disp.value = String(r);
          expr = String(r);
        } catch (e) {
          disp.value = '오류';
          expr = '';
        }
        return;
      }
      expr += k;
      disp.value = expr;
    });
  });
}

// +,-,*,/,(),. 만 다루는 작은 재귀하강 파서 — eval/Function 안 씀(CSP unsafe-eval 불필요).
function evalArith(input) {
  const s = (input || '').replace(/\s/g, '');
  if (!s || !/^[0-9+\-*/.()]+$/.test(s)) throw new Error('bad');
  let i = 0;
  const peek = () => s[i];
  const num = () => {
    let n = '';
    while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++];
    if (!/^\d+\.?\d*$|^\.\d+$/.test(n)) throw new Error('bad');
    return parseFloat(n);
  };
  const factor = () => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error('bad');
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -factor();
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    return num();
  };
  const term = () => {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const result = expr();
  if (i !== s.length || !Number.isFinite(result)) throw new Error('bad');
  return Math.round(result * 1e10) / 1e10; // 부동소수 오차 정리
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
    const ev = n.dataset.cfgEv || (n.tagName === 'SELECT' || n.type === 'checkbox' || n.type === 'color' ? 'change' : 'input');
    n.addEventListener(ev, (e) => {
      cfg[e.target.dataset.cfg] = readVal(e.target);
      emit();
    });
    if (ev === 'change' && n.tagName === 'INPUT') {
      n.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        cfg[n.dataset.cfg] = readVal(n);
        emit();
        closeBlockConfig(); // 엔터 = 확정 + 팝오버 닫기
      });
    }
  });

  const fileInput = pop.querySelector('input[type="file"]');
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await readImageDownscaled(f, 1400);
        const oldFile = cfg.imageFile;
        if (window.itda?.dashboardImages?.save) {
          // 축소본을 userData/dashboard-images/ 파일로 저장하고 설정엔 파일명만 둔다(설정 JSON 비대화 방지).
          const res = await window.itda.dashboardImages.save({ dataUrl });
          cfg.imageFile = res?.name || '';
          cfg.dataUrl = '';
          if (oldFile && oldFile !== cfg.imageFile) window.itda.dashboardImages.delete(oldFile).catch(() => {});
        } else {
          cfg.dataUrl = dataUrl; // 구버전 폴백
        }
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
    ${sel('스타일', 'style', [['flip', '레트로 플립'], ['analog', '아날로그'], ['digital', '디지털'], ['led', 'LED']], c.style || 'flip')}
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
  sticker: (c) => `
    <label class="cfg-row">이모지<input class="input" data-cfg="emoji" value="${escapeHtml(c.emoji || '⭐')}" placeholder="⭐" /></label>
    <label class="cfg-row">문구<input class="input" data-cfg="text" value="${escapeHtml(c.text || '')}" placeholder="짧은 문구(선택)" /></label>
    <label class="cfg-row">색상<input type="color" data-cfg="color" value="${c.color || '#ffe08a'}" /></label>
    <label class="cfg-row"><input type="checkbox" data-cfg="tilt" ${c.tilt ? 'checked' : ''}/> 살짝 기울이기</label>`,
  quote: (c) => `
    <label class="cfg-row">문구<textarea class="input" data-cfg="text" rows="3">${escapeHtml(c.text || '')}</textarea></label>
    <label class="cfg-row">출처<input class="input" data-cfg="author" value="${escapeHtml(c.author || '')}" placeholder="예: 잇다 팀 (선택)" /></label>
    ${sel('테마', 'theme', [['paper', '페이퍼'], ['dark', '다크'], ['minimal', '미니멀']], c.theme || 'paper')}`,
  weather: (c) => `
    <label class="cfg-row">도시
      <input class="input" data-cfg="city" data-cfg-ev="change" list="wx-city-list" value="${escapeHtml(c.city || '서울')}" placeholder="목록에서 고르거나 직접 입력" autocomplete="off" />
      <datalist id="wx-city-list">${Object.keys(KR_CITIES).map((n) => `<option value="${n}">`).join('')}<option value="Tokyo"><option value="Osaka"><option value="New York"><option value="London"></datalist>
    </label>
    <p class="cfg-note">국내 도시는 목록에서 고르고, 해외는 영어 도시명을 직접 입력하세요. 30분마다 자동 갱신되며 인터넷이 필요합니다.</p>`,
  miniTool: (c) => sel('도구', 'tool', [['calc', '계산기'], ['notepad', '메모지'], ['timer', '스톱워치']], c.tool || 'calc'),
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
