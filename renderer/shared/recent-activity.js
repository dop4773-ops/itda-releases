import { formatRelative } from './ui-utils.js';
import { stripHtmlToPlainText } from './rich-text.js';

// notifications.js와 같은 패턴: 활동 로그 테이블을 따로 안 만들고, 기존 데이터의
// created_at/completed_at을 모아서 "최근에 뭘 했는지"를 매번 계산한다.
const WINDOW_DAYS = 14;
const MAX_ITEMS = 5;

function hoursAgo(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr.replace(' ', 'T'));
  const diff = (Date.now() - then.getTime()) / 3600000;
  return Number.isNaN(diff) ? Infinity : diff;
}

function memoTitle(m) {
  if (m.title && m.title.trim()) return m.title.trim();
  const firstLine = stripHtmlToPlainText(m.content || '').split('\n')[0].trim();
  return firstLine || '제목 없는 메모';
}

export async function computeRecentActivity() {
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [todosResult, memosResult, eventsResult] = await Promise.allSettled([
    window.itda.todos.list({}),
    window.itda.memos.list({}),
    window.itda.events.range({ fromDate: windowStart, toDate: today }),
  ]);

  const items = [];

  if (todosResult.status === 'fulfilled') {
    todosResult.value
      .filter((t) => t.is_done && t.completed_at && hoursAgo(t.completed_at) <= WINDOW_DAYS * 24)
      .forEach((t) => {
        items.push({
          type: 'todo-done',
          text: `"${t.title}" 할 일을 완료했습니다.`,
          time: t.completed_at,
        });
      });
  }

  if (memosResult.status === 'fulfilled') {
    memosResult.value
      .filter((m) => m.created_at && hoursAgo(m.created_at) <= WINDOW_DAYS * 24)
      .forEach((m) => {
        items.push({
          type: 'memo-created',
          text: `"${memoTitle(m)}" 관련 메모를 작성했습니다.`,
          time: m.created_at,
        });
      });
  }

  if (eventsResult.status === 'fulfilled') {
    eventsResult.value
      .filter((e) => e.created_at && hoursAgo(e.created_at) <= WINDOW_DAYS * 24)
      .forEach((e) => {
        items.push({
          type: 'event-created',
          text: `"${e.title}" 일정을 추가했습니다.`,
          time: e.created_at,
        });
      });
  }

  items.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return items.slice(0, MAX_ITEMS).map((i) => ({ ...i, relative: formatRelative(i.time) }));
}
