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
const createMemoFoldersRepository = require('./memoFolders.repository');

// db(better-sqlite3 인스턴스) 하나로부터 도메인별 repository 묶음을 만든다.
// ipc/index.js에서 한 번 호출해서 각 ipc 등록 함수에 나눠준다.
function createRepositories(db) {
  const search = createSearchRepository(db); // links가 참조하므로 먼저 만든다
  return {
    // 여러 repository에 걸친 쓰기를 원자적으로 묶을 때 — better-sqlite3 db.transaction 그대로.
    // fn을 감싼 함수를 돌려주므로 repos.transaction(fn)() 로 호출한다. 중첩되면 savepoint로 처리됨.
    transaction: (fn) => db.transaction(fn),

    categories: createCategoriesRepository(db),
    todos: createTodosRepository(db),
    events: createEventsRepository(db),
    memos: createMemosRepository(db),
    postits: createPostitsRepository(db),
    inbox: createInboxRepository(db),
    trash: createTrashRepository(db),
    search: search,
    links: createLinksRepository(db, search), // "@검색"/관련항목 추천이 통합검색과 같은 매칭을 쓰게
    settings: createSettingsRepository(db),
    googleCalendar: createGoogleCalendarRepository(db),
    memoAttachments: createMemoAttachmentsRepository(db),
    memoFolders: createMemoFoldersRepository(db),
  };
}

module.exports = createRepositories;
