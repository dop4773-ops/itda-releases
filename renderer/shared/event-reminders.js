// 일정 시작 전 알림 + Snooze — 설정 > 편의 기능에서 켜고 끄고 몇 분 전/다시 알림 간격을 정한다.
// OS 알림은 렌더러 표준 Notification 웹 API로 띄운다(Electron이 네이티브 알림으로 매핑 —
// 별도 IPC나 main 프로세스 코드 없이 동작). 상태(스누즈/알림완료 여부)는 이 세션 메모리에만
// 있고 재시작하면 초기화된다 — 알림 자체가 "지금 확인해볼 것"이라 굳이 영속화할 필요 없음.
const CHECK_INTERVAL_MS = 30 * 1000;
const PAST_GRACE_MINUTES = 5; // 시작 후 이 시간까지는 그래도 알림을 띄움(막 지난 일정)
const DROP_AFTER_MINUTES = 20; // 시작 후 이만큼 지나면 벨 드롭다운에서도 완전히 내림

const alerted = new Set(); // 이번 세션에서 이미 OS 알림을 띄운 eventId (중복 알림 방지)
const snoozedUntil = new Map(); // eventId -> 다시 알릴 시각(ms)
const dismissed = new Set(); // 사용자가 닫은 eventId (오늘 하루 다시 안 뜸)
let activeReminders = []; // 벨 드롭다운이 읽어가는 현재 상태

function minutesUntilStart(nowMs, startAt) {
  const t = new Date((startAt || '').replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? null : (t - nowMs) / 60000;
}

function fireNotification(e, minutesUntil) {
  if (typeof Notification === 'undefined') return;
  const body = minutesUntil <= 0 ? '지금 시작해요' : `${Math.round(minutesUntil)}분 후 시작해요${e.location ? ' · ' + e.location : ''}`;
  const n = new Notification(`"${e.title}" 일정`, { body });
  n.onclick = () => {
    window.focus();
    location.hash = '#/calendar';
  };
}

async function tick() {
  if ((await window.itda.settings.get('notif_event_enabled')) === '0') {
    activeReminders = [];
    return;
  }
  const leadMinutes = Number((await window.itda.settings.get('notif_event_lead_minutes')) || 10);
  let events;
  try {
    events = await window.itda.events.today();
  } catch (e) {
    return;
  }
  const now = Date.now();
  const next = [];

  events.forEach((e) => {
    if (dismissed.has(e.id)) return;
    const minutesUntil = minutesUntilStart(now, e.start_at);
    if (minutesUntil === null || minutesUntil > leadMinutes || minutesUntil < -DROP_AFTER_MINUTES) return;

    const snoozeAt = snoozedUntil.get(e.id);
    const isSnoozed = snoozeAt && now < snoozeAt;
    if (isSnoozed) return;

    if (!alerted.has(e.id) && minutesUntil >= -PAST_GRACE_MINUTES) {
      fireNotification(e, minutesUntil);
      alerted.add(e.id);
    }
    next.push({ event: e, minutesUntil });
  });

  activeReminders = next;
}

export function getActiveReminders() {
  return activeReminders;
}

export async function snoozeReminder(eventId) {
  const minutes = Number((await window.itda.settings.get('notif_snooze_minutes')) || 10);
  snoozedUntil.set(eventId, Date.now() + minutes * 60000);
  alerted.delete(eventId); // 스누즈가 끝나면 다시 뜰 수 있게
}

export function dismissReminder(eventId) {
  dismissed.add(eventId);
}

// onChange: 매 체크마다 호출 — 벨 드롭다운이 열려있지 않아도 빨간 점 상태를 최신으로 유지하기 위함
export function initEventReminders(onChange) {
  async function run() {
    await tick();
    onChange?.();
  }
  run();
  setInterval(run, CHECK_INTERVAL_MS);
}
