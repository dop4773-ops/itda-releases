// 전달용 문구 형식 — 설정 화면의 "체크박스 + 모양 고르기"를 메인이 쓰는 템플릿으로 바꾼다(순수 함수, 테스트용 분리).
// 사용자는 템플릿 문법을 몰라도 되고, 여기서 만든 템플릿만 main으로 간다.
export const FIELD_LABELS = [
  ['name', '이름'],
  ['rm', 'RM'],
  ['ward', '병동'],
  ['room', '호실'],
  ['time', '시간'],
  ['sup', '보충 정보 (성별·나이·진단·이동수단)'],
  ['note', '비고'],
];

const ALL = { name: true, rm: true, ward: false, room: true, time: true, sup: true, note: true };

// 모양 3가지 — 고른 뒤에 항목 체크박스를 더 바꿔도 된다
export const PRESETS = {
  basic: { label: '기본 (여러 줄)', state: { title: true, date: true, fields: { ...ALL }, layout: 'multi', gap: 'blank' } },
  oneline: { label: '한 줄씩', state: { title: true, date: true, fields: { ...ALL }, layout: 'single', gap: 'line' } },
  simple: { label: '간단히 (호실·이름만)', state: { title: true, date: false, fields: { ...ALL, rm: false, time: false, sup: false, note: false }, layout: 'single', gap: 'line' } },
};
export const DEFAULT_STATE = PRESETS.basic.state;

export function normalizeState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const f = r.fields && typeof r.fields === 'object' ? r.fields : {};
  const fields = {};
  FIELD_LABELS.forEach(([k]) => (fields[k] = typeof f[k] === 'boolean' ? f[k] : DEFAULT_STATE.fields[k]));
  return {
    title: typeof r.title === 'boolean' ? r.title : true,
    date: typeof r.date === 'boolean' ? r.date : true,
    fields,
    layout: r.layout === 'single' ? 'single' : 'multi',
    gap: r.gap === 'line' ? 'line' : 'blank',
  };
}

export function stateToFormat(state) {
  const s = normalizeState(state);
  const f = s.fields;
  const head = [f.rm && '{rm}', f.ward && '{ward}', f.room && '{room}', f.name && '{name}님'].filter(Boolean).join(' ');
  const rest = [f.time && '{time}', f.sup && '{sup}', f.note && '{note}'].filter(Boolean);
  // 여러 줄: 사람 줄 → 보충 정보 → 비고 → 시간(예전 형식 그대로) / 한 줄: 사람 · 시간 · 보충 정보 · 비고
  const person =
    s.layout === 'single'
      ? [head, ...rest].filter(Boolean).join(' · ')
      : [head, f.sup && '{sup}', f.note && '{note}', f.time && '{time}'].filter(Boolean).join('\n');
  return { header: [s.title && '{title}', s.date && '{date}'].filter(Boolean).join('\n'), person, gap: s.gap };
}

// 지금 상태가 어느 모양과 같은지(같으면 그 모양 버튼을 강조)
export function matchPreset(state) {
  const s = JSON.stringify(normalizeState(state));
  return Object.keys(PRESETS).find((k) => JSON.stringify(normalizeState(PRESETS[k].state)) === s) || null;
}
