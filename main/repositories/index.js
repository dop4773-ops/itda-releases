const createCategoriesRepository = require('./categories.repository');
const createTodosRepository = require('./todos.repository');
const createEventsRepository = require('./events.repository');
const createMemosRepository = require('./memos.repository');
const createPostitsRepository = require('./postits.repository');
const createInboxRepository = require('./inbox.repository');
const createTrashRepository = require('./trash.repository');
const createLinksRepository = require('./links.repository');
const createSearchRepository = require('./search.repository');
const createSettingsRepository = require('./settings.repository');
const createGoogleCalendarRepository = require('./googleCalendar.repository');
const createMemoAttachmentsRepository = require('./memoAttachments.repository');

// db(better-sqlite3 인스턴스) 하나로부터 도메인별 repository 묶음을 만든다.
// ipc/index.js에서 한 번 호출해서 각 ipc 등록 함수에 나눠준다.
function createRepositories(db) {
  return {
    categories: createCategoriesRepository(db),
    todos: createTodosRepository(db),
    events: createEventsRepository(db),
    memos: createMemosRepository(db),
    postits: createPostitsRepository(db),
    inbox: createInboxRepository(db),
    trash: createTrashRepository(db),
    links: createLinksRepository(db),
    search: createSearchRepository(db),
    settings: createSettingsRepository(db),
    googleCalendar: createGoogleCalendarRepository(db),
    memoAttachments: createMemoAttachmentsRepository(db),
  };
}

module.exports = createRepositories;
