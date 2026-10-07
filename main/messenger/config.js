/**
 * 메신저 연동 설정 — app_settings의 'messenger_config' 한 키에 JSON으로 저장.
 * 알 수 없는 값/범위 밖 값은 기본값으로 되돌려서(sanitize) 설정 파일이 깨져도 연동이 이상 동작하지 않게 한다.
 */
const KEY = 'messenger_config';

const GROUPS = ['admission', 'discharge', 'outing', 'transfer']; // 설정에서 켜고 끄고 카테고리를 정하는 단위

const DEFAULTS = {
  enabled: false,
  dbPath: '',
  kinds: {
    admission: { on: true, categoryId: null },
    discharge: { on: true, categoryId: null },
    outing: { on: true, categoryId: null }, // 외출 + 외박
    transfer: { on: false, categoryId: null },
  },
  wards: [], // 비우면 전체 병동
  rms: [], // 비우면 전체 RM
  pastDays: 3,
  futureDays: 30,
  nameMode: 'mask', // full | mask | hide
  schedule: { mode: 'manual', everyMin: 30, dailyAt: '08:00' }, // manual | start | interval | daily
};

const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const list = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(/[,\n]/))
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 50);

function sanitize(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kinds = {};
  for (const g of GROUPS) {
    const k = (r.kinds && r.kinds[g]) || {};
    const d = DEFAULTS.kinds[g];
    kinds[g] = {
      on: typeof k.on === 'boolean' ? k.on : d.on,
      categoryId: Number.isInteger(k.categoryId) && k.categoryId > 0 ? k.categoryId : null,
    };
  }
  const s = r.schedule || {};
  return {
    enabled: r.enabled === true,
    dbPath: typeof r.dbPath === 'string' ? r.dbPath.trim() : '',
    kinds,
    wards: list(r.wards),
    rms: list(r.rms).map((x) => x.toUpperCase()),
    pastDays: int(r.pastDays, 0, 365, DEFAULTS.pastDays),
    futureDays: int(r.futureDays, 0, 365, DEFAULTS.futureDays),
    nameMode: ['full', 'mask', 'hide'].includes(r.nameMode) ? r.nameMode : DEFAULTS.nameMode,
    schedule: {
      mode: ['manual', 'start', 'interval', 'daily'].includes(s.mode) ? s.mode : DEFAULTS.schedule.mode,
      everyMin: int(s.everyMin, 5, 1440, DEFAULTS.schedule.everyMin),
      dailyAt: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyAt) ? s.dailyAt : DEFAULTS.schedule.dailyAt,
    },
  };
}

function load(settings) {
  try {
    return sanitize(JSON.parse(settings.get(KEY) || '{}'));
  } catch (e) {
    return sanitize({});
  }
}

// patch를 현재 값에 얹어(kinds/schedule은 한 단계 안쪽까지) 저장하고 최종값을 돌려준다.
function save(settings, patch) {
  const cur = load(settings);
  const next = sanitize({
    ...cur,
    ...patch,
    kinds: Object.fromEntries(GROUPS.map((g) => [g, { ...cur.kinds[g], ...((patch.kinds || {})[g] || {}) }])),
    schedule: { ...cur.schedule, ...(patch.schedule || {}) },
  });
  settings.set(KEY, JSON.stringify(next));
  return next;
}

module.exports = { DEFAULTS, GROUPS, sanitize, load, save };
