const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');

const pad = (n) => String(n).padStart(2, '0');

// 종료 시각을 사람이 직접 입력하지 않아도 되도록(선택사항화) 서버에서 기본값을 계산한다.
// - 하루종일 이벤트: 시작 날짜의 23:59:59로 채움
// - 일반 이벤트: 종료 시각을 안 주면 시작 시각의 1시간 뒤로 채움
// 렌더러(calendar.js)도 같은 규칙으로 UI를 만들지만, 이 함수가 있어야
// IPC를 직접 호출하는 다른 경로(향후 위젯 등)에서도 항상 종료 시각이 보장된다.
function resolveEndAt(startAt, endAt, isAllDay) {
  if (endAt) return endAt;

  const datePart = startAt.slice(0, 10);
  if (isAllDay) return `${datePart} 23:59:59`;

  const start = new Date(startAt.replace(' ', 'T'));
  start.setHours(start.getHours() + 1);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}:00`;
}

// events는 soft delete(deleted_at) 대상. google_calendar_events는 물리적으로 분리된
// 별도 테이블이며, 여기서는 "쓰기" 핸들러를 만들지 않는다(읽기전용 제약을 구조로 강제).
module.exports = function registerEventsIpc(ipcMain, repos) {
  const { events } = repos;

  ipcMain.handle('events:today', () => {
    return events.today();
  });

  // 캘린더 화면(주/월 뷰)에서 사용할 기간 조회
  ipcMain.handle('events:range', (event, { fromDate, toDate }) => {
    assertNonEmpty(fromDate, 'fromDate가 필요합니다.');
    assertNonEmpty(toDate, 'toDate가 필요합니다.');
    return events.range(fromDate, toDate);
  });

  ipcMain.handle('events:get', (event, id) => {
    return events.getById(id);
  });

  ipcMain.handle(
    'events:add',
    (event, { title, categoryId, location, startAt, endAt, allDay, recurrenceRule, memo }) => {
      assertNonEmpty(title, '일정 제목을 입력해주세요.');
      assertNonEmpty(startAt, '시작 시각이 필요합니다.');

      const isAllDay = !!allDay;
      const finalEndAt = resolveEndAt(startAt, endAt, isAllDay);

      const result = events.insert({
        title: title.trim(),
        categoryId,
        location,
        startAt,
        endAt: finalEndAt,
        allDay: isAllDay,
        recurrenceRule,
        memo,
      });
      broadcastDataChanged('event', result.id);
      return result;
    }
  );

  ipcMain.handle(
    'events:update',
    (event, { id, title, categoryId, location, startAt, endAt, allDay, memo }) => {
      const ev = events.getById(id);
      if (!ev) throw new Error('일정을 찾을 수 없습니다.');
      events.update({
        id,
        title: title?.trim() ?? ev.title,
        categoryId: categoryId ?? ev.category_id,
        location: location ?? ev.location,
        startAt: startAt ?? ev.start_at,
        endAt: endAt ?? ev.end_at,
        allDay: allDay != null ? (allDay ? 1 : 0) : ev.all_day,
        memo: memo ?? ev.memo,
      });
      broadcastDataChanged('event', id);
      return { id };
    }
  );

  ipcMain.handle('events:delete', (event, id) => {
    events.softDelete(id);
    broadcastDataChanged('event', id);
    return { id };
  });
};
