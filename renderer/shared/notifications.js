import { formatRelative } from './ui-utils.js';

// 알림은 별도 저장 테이블 없이 기존 todos/events/postits 데이터를 그때그때 계산해서 만든다.
// (읽음/안읽음 상태 같은 건 없음 — MVP 범위에서 "지금 확인해볼 만한 것들"을 보여주는 용도)
const COMPLETED_WINDOW_HOURS = 48; // 완료한 지 이 시간 이내인 할 일만 알림에 노출
const POSTIT_WINDOW_HOURS = 48; // 만든 지 이 시간 이내인 포스트잇만 알림에 노출
const MAX_ITEMS = 8;

function hoursAgo(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr.replace(' ', 'T'));
  const diff = (Date.now() - then.getTime()) / 3600000;
  return Number.isNaN(diff) ? Infinity : diff;
}

export const NOTIF_ICON = {
  due: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
  event: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  done: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
  postit: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v6l3-2 3 2V3"/></svg>`,
};

// 반환 항목: { type, title, subtitle, href, urgent, sortKey }
export async function computeNotifications() {
  const [todosResult, eventsResult, postitsResult] = await Promise.allSettled([
    window.itda.todos.list({}),
    window.itda.events.today(),
    window.itda.postits.list(),
  ]);

  const items = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  if (todosResult.status === 'fulfilled') {
    todosResult.value.forEach((t) => {
      // 마감임박/마감지남 — 완료 안 된 할 일 중 오늘까지(또는 이미 지난) 마감인 것
      if (!t.is_done && t.due_date && t.due_date <= todayStr) {
        const overdue = t.due_date < todayStr;
        items.push({
          type: 'due',
          title: `"${t.title}" 마감 임박`,
          subtitle: overdue ? `${t.due_date} 지남` : t.due_time ? `오늘 ${t.due_time}까지입니다` : '오늘 마감입니다',
          href: '#/todo',
          urgent: overdue,
          sortKey: `${t.due_date} ${t.due_time || '00:00'}`,
        });
      }
      // 할일완료 — 최근에 완료된 것
      if (t.is_done && t.completed_at && hoursAgo(t.completed_at) <= COMPLETED_WINDOW_HOURS) {
        items.push({
          type: 'done',
          title: `"${t.title}" 할 일을 완료했어요`,
          subtitle: formatRelative(t.completed_at),
          href: '#/todo',
          urgent: false,
          sortKey: t.completed_at,
        });
      }
    });
  }

  if (eventsResult.status === 'fulfilled') {
    eventsResult.value.forEach((e) => {
      items.push({
        type: 'event',
        title: `"${e.title}" 일정이 있어요`,
        subtitle: `오늘 ${(e.start_at || '').slice(11, 16)}${e.location ? ' · ' + e.location : ''}`,
        href: '#/calendar',
        urgent: false,
        sortKey: e.start_at || `${todayStr} 00:00`,
      });
    });
  }

  if (postitsResult.status === 'fulfilled') {
    postitsResult.value
      .filter((p) => hoursAgo(p.created_at) <= POSTIT_WINDOW_HOURS)
      .forEach((p) => {
        items.push({
          type: 'postit',
          title: '새 포스트잇이 추가됐어요',
          subtitle: formatRelative(p.created_at),
          href: '#/postit',
          urgent: false,
          sortKey: p.created_at,
        });
      });
  }

  // 마감 지난 것(urgent) 먼저, 그 다음 최신순
  items.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return (b.sortKey || '').localeCompare(a.sortKey || '');
  });

  return items.slice(0, MAX_ITEMS);
}
