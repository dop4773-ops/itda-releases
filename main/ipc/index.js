/**
 * IPC 핸들러 등록 (도메인별 분리 + repository 계층 버전)
 * 규칙:
 *  - renderer는 DB에 절대 직접 접근하지 않는다 (preload.js를 통해서만 호출)
 *  - ipc/*.js는 "입력 검증 + 어떤 repository 메서드를 부를지"만 담당하고,
 *    실제 SQL은 전부 main/repositories/*.js에 있다 (관심사 분리)
 *  - 새 기능 추가 시: repositories/해당도메인.repository.js에 메서드 추가 →
 *    ipc/해당도메인.ipc.js에 handle 추가 → preload.js에 대응 함수 추가
 *  - 새 도메인이 생기면 repositories/index.js와 이 파일에 각각 한 줄씩 추가한다
 *  - google_calendar_events 테이블은 여기서 "쓰기" 핸들러를 만들지 않는다
 *    (동기화 프로세스 전용, UI 쪽 IPC는 조회만 제공 예정)
 *  - todos/events/memos/postits는 전부 soft delete(deleted_at) → 삭제는
 *    실제로는 UPDATE이고, 완전 삭제는 trash:permanentlyDelete에서만 수행
 *  - inbox_items는 deleted_at 컬럼이 없음 → inbox:delete는 하드 삭제(설계상 의도)
 */

const createRepositories = require('../repositories');

const registerInboxIpc = require('./inbox.ipc');
const registerCategoriesIpc = require('./categories.ipc');
const registerTodosIpc = require('./todos.ipc');
const registerEventsIpc = require('./events.ipc');
const registerMemosIpc = require('./memos.ipc');
const registerPostitsIpc = require('./postits.ipc');
const registerTrashIpc = require('./trash.ipc');
const registerSearchIpc = require('./search.ipc');
const registerSettingsIpc = require('./settings.ipc');
const registerLinksIpc = require('./links.ipc');
const registerGoogleCalendarIpc = require('./googleCalendar.ipc');
const registerDataIpc = require('./data.ipc');
const registerPostitWidgetIpc = require('./postitWidget.ipc');
const registerWidgetsIpc = require('./widgets.ipc');
const registerWidgetControlsIpc = require('./widgetControls.ipc');
const registerItemWidgetIpc = require('./itemWidget.ipc');
const registerAppIpc = require('./app.ipc');
const registerMemoAttachmentsIpc = require('./memoAttachments.ipc');
const registerAuthIpc = require('./auth.ipc');

function registerIpcHandlers(ipcMain, db, getMainWindow) {
  const repos = createRepositories(db);
  const { closeWidgetIfOpen } = registerPostitWidgetIpc(ipcMain, repos);
  registerWidgetControlsIpc(ipcMain);
  const { closeItemWidgetIfOpen } = registerItemWidgetIpc(ipcMain, repos);
  registerAppIpc(ipcMain, getMainWindow);
  registerMemoAttachmentsIpc(ipcMain, repos);
  registerAuthIpc(ipcMain, repos);

  const { deleteLinksFor } = registerLinksIpc(ipcMain, repos);
  registerInboxIpc(ipcMain, repos, { deleteLinksFor }); // inbox는 하드 삭제라, 삭제 시 걸려있던 연결도 여기서 직접 정리
  registerCategoriesIpc(ipcMain, repos);
  registerTodosIpc(ipcMain, repos);
  registerEventsIpc(ipcMain, repos);
  registerMemosIpc(ipcMain, repos);
  registerPostitsIpc(ipcMain, repos, { closeWidgetIfOpen });
  registerSearchIpc(ipcMain, repos);
  registerSettingsIpc(ipcMain, repos);
  registerGoogleCalendarIpc(ipcMain, repos);
  registerDataIpc(ipcMain, repos, db); // 백업/복원은 repos가 아니라 db 원본이 필요해서 따로 넘김
  registerWidgetsIpc(ipcMain, repos, getMainWindow);
  registerTrashIpc(ipcMain, repos, { deleteLinksFor, closeWidgetIfOpen, closeItemWidgetIfOpen });
}

module.exports = registerIpcHandlers;
