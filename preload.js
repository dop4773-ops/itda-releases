const { contextBridge, ipcRenderer } = require('electron');

// renderer(HTML/JS)에서는 window.itda.* 로만 DB에 접근 가능
// ipcRenderer, fs, require 등은 절대 노출하지 않는다
contextBridge.exposeInMainWorld('itda', {
  inbox: {
    add: (content) => ipcRenderer.invoke('inbox:add', content),
    list: (opts) => ipcRenderer.invoke('inbox:list', opts),
    markProcessed: (payload) => ipcRenderer.invoke('inbox:markProcessed', payload),
    delete: (id) => ipcRenderer.invoke('inbox:delete', id),
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    add: (payload) => ipcRenderer.invoke('categories:add', payload),
    update: (payload) => ipcRenderer.invoke('categories:update', payload),
    delete: (id) => ipcRenderer.invoke('categories:delete', id),
    itemsFor: (id) => ipcRenderer.invoke('categories:itemsFor', id),
  },
  todos: {
    today: () => ipcRenderer.invoke('todos:today'),
    list: (filter) => ipcRenderer.invoke('todos:list', filter),
    get: (id) => ipcRenderer.invoke('todos:get', id),
    add: (payload) => ipcRenderer.invoke('todos:add', payload),
    update: (payload) => ipcRenderer.invoke('todos:update', payload),
    toggle: (id) => ipcRenderer.invoke('todos:toggle', id),
    setStatus: (payload) => ipcRenderer.invoke('todos:setStatus', payload),
    toggleFavorite: (id) => ipcRenderer.invoke('todos:toggleFavorite', id),
    delete: (id) => ipcRenderer.invoke('todos:delete', id),
    setRecurrence: (payload) => ipcRenderer.invoke('todos:setRecurrence', payload),
    deleteSeries: (payload) => ipcRenderer.invoke('todos:deleteSeries', payload),
  },
  todoSubtasks: {
    list: (todoId) => ipcRenderer.invoke('todoSubtasks:list', todoId),
    add: (payload) => ipcRenderer.invoke('todoSubtasks:add', payload),
    toggle: (id) => ipcRenderer.invoke('todoSubtasks:toggle', id),
    delete: (id) => ipcRenderer.invoke('todoSubtasks:delete', id),
  },
  events: {
    today: () => ipcRenderer.invoke('events:today'),
    range: (payload) => ipcRenderer.invoke('events:range', payload),
    get: (id) => ipcRenderer.invoke('events:get', id),
    add: (payload) => ipcRenderer.invoke('events:add', payload),
    update: (payload) => ipcRenderer.invoke('events:update', payload),
    delete: (id) => ipcRenderer.invoke('events:delete', id),
    deleteSeries: (payload) => ipcRenderer.invoke('events:deleteSeries', payload),
  },
  memos: {
    recent: (limit) => ipcRenderer.invoke('memos:recent', limit),
    list: (filter) => ipcRenderer.invoke('memos:list', filter),
    get: (id) => ipcRenderer.invoke('memos:get', id),
    add: (payload) => ipcRenderer.invoke('memos:add', payload),
    update: (payload) => ipcRenderer.invoke('memos:update', payload),
    togglePin: (id) => ipcRenderer.invoke('memos:togglePin', id),
    toggleLock: (id) => ipcRenderer.invoke('memos:toggleLock', id),
    delete: (id) => ipcRenderer.invoke('memos:delete', id),
  },
  memoAttachments: {
    list: (memoId) => ipcRenderer.invoke('memoAttachments:list', memoId),
    add: (memoId) => ipcRenderer.invoke('memoAttachments:add', memoId),
    addFromPaths: (payload) => ipcRenderer.invoke('memoAttachments:addFromPaths', payload),
    addFromDataUrl: (payload) => ipcRenderer.invoke('memoAttachments:addFromDataUrl', payload),
    getImageData: (id) => ipcRenderer.invoke('memoAttachments:getImageData', id),
    open: (id) => ipcRenderer.invoke('memoAttachments:open', id),
    delete: (id) => ipcRenderer.invoke('memoAttachments:delete', id),
  },
  memoFolders: {
    list: () => ipcRenderer.invoke('memoFolders:list'),
    add: (payload) => ipcRenderer.invoke('memoFolders:add', payload),
    rename: (payload) => ipcRenderer.invoke('memoFolders:rename', payload),
    reorder: (ids) => ipcRenderer.invoke('memoFolders:reorder', ids),
    delete: (id) => ipcRenderer.invoke('memoFolders:delete', id),
  },
  postits: {
    list: () => ipcRenderer.invoke('postits:list'),
    get: (id) => ipcRenderer.invoke('postits:get', id),
    add: (payload) => ipcRenderer.invoke('postits:add', payload),
    update: (payload) => ipcRenderer.invoke('postits:update', payload),
    togglePin: (id) => ipcRenderer.invoke('postits:togglePin', id),
    toggleAlwaysOnTop: (id) => ipcRenderer.invoke('postits:toggleAlwaysOnTop', id),
    delete: (id) => ipcRenderer.invoke('postits:delete', id),
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (payload) => ipcRenderer.invoke('trash:restore', payload),
    permanentlyDelete: (payload) => ipcRenderer.invoke('trash:permanentlyDelete', payload),
  },
  search: {
    query: (keyword) => ipcRenderer.invoke('search:query', keyword),
  },
  links: {
    add: (payload) => ipcRenderer.invoke('links:add', payload),
    remove: (payload) => ipcRenderer.invoke('links:remove', payload),
    listFor: (payload) => ipcRenderer.invoke('links:listFor', payload),
    search: (payload) => ipcRenderer.invoke('links:search', payload),
    discover: (payload) => ipcRenderer.invoke('links:discover', payload),
  },
  googleCalendar: {
    status: () => ipcRenderer.invoke('googleCalendar:status'),
    connect: () => ipcRenderer.invoke('googleCalendar:connect'),
    disconnect: () => ipcRenderer.invoke('googleCalendar:disconnect'),
    syncNow: () => ipcRenderer.invoke('googleCalendar:syncNow'),
    range: (payload) => ipcRenderer.invoke('googleCalendar:range', payload),
    listCalendars: () => ipcRenderer.invoke('googleCalendar:listCalendars'),
    selectCalendar: (payload) => ipcRenderer.invoke('googleCalendar:selectCalendar', payload),
    importCredentialsFile: () => ipcRenderer.invoke('googleCalendar:importCredentialsFile'),
  },
  data: {
    backup: () => ipcRenderer.invoke('data:backup'),
    getBackupsDir: () => ipcRenderer.invoke('data:getBackupsDir'),
    openBackupsFolder: () => ipcRenderer.invoke('data:openBackupsFolder'),
    openLogsFolder: () => ipcRenderer.invoke('data:openLogsFolder'),
    chooseBackupsDir: () => ipcRenderer.invoke('data:chooseBackupsDir'),
    resetBackupsDir: () => ipcRenderer.invoke('data:resetBackupsDir'),
    restore: () => ipcRenderer.invoke('data:restore'),
    exportJson: () => ipcRenderer.invoke('data:exportJson'),
    importJson: () => ipcRenderer.invoke('data:importJson'),
    deleteAll: () => ipcRenderer.invoke('data:deleteAll'),
  },
  postitWidget: {
    open: (idOrOpts) => ipcRenderer.invoke('postitWidget:open', idOrOpts), // 숫자 id 또는 {id,x,y}(드래그드롭용)
    isOpen: (id) => ipcRenderer.invoke('postitWidget:isOpen', id),
    toggleAlwaysOnTop: (id) => ipcRenderer.invoke('postitWidget:toggleAlwaysOnTop', id),
  },
  widgetControls: {
    minimize: () => ipcRenderer.invoke('widgetControls:minimize'),
    close: () => ipcRenderer.invoke('widgetControls:close'),
  },
  widgets: {
    open: (type) => ipcRenderer.invoke('widgets:open', type),
    close: (type) => ipcRenderer.invoke('widgets:close', type),
    isOpen: (type) => ipcRenderer.invoke('widgets:isOpen', type),
    listStatus: () => ipcRenderer.invoke('widgets:listStatus'),
    applyAppearance: () => ipcRenderer.invoke('widgets:applyAppearance'),
    openMainApp: (route) => ipcRenderer.invoke('widgets:openMainApp', route),
  },
  itemWidget: {
    open: (payload) => ipcRenderer.invoke('itemWidget:open', payload), // { type: 'todo'|'memo'|'event', id, x, y }
    isOpen: (type, id) => ipcRenderer.invoke('itemWidget:isOpen', { type, id }),
  },
  app: {
    getMainWindowBounds: () => ipcRenderer.invoke('app:getMainWindowBounds'),
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),
    openPath: (path) => ipcRenderer.invoke('app:openPath', path), // 메모/포스트잇 본문의 로컬 경로 링크 클릭 시
  },
  widgetWindow: {
    fitToContent: (payload) => ipcRenderer.invoke('widgetWindow:fitToContent', payload),
  },
  // 위젯 창에서 "전체 OO 보기"를 누르면 메인 창이 이 이벤트를 받아 해당 화면으로 이동한다
  onNavigate: (callback) => {
    const listener = (event, route) => callback(route);
    ipcRenderer.on('itda:navigate', listener);
    return () => ipcRenderer.removeListener('itda:navigate', listener);
  },
  // OS 전역 단축키(main/global-shortcut)로 빠른입력을 열 때 메인 창이 이 이벤트를 받는다
  onOpenQuickCapture: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('itda:openQuickCapture', listener);
    return () => ipcRenderer.removeListener('itda:openQuickCapture', listener);
  },
  // OS 전역 단축키(Ctrl/Cmd+Alt+L)로 "지금 잠그기"를 실행할 때 메인 창이 이 이벤트를 받는다
  onLockNow: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('itda:lockNow', listener);
    return () => ipcRenderer.removeListener('itda:lockNow', listener);
  },
  // 위젯(포스트잇/낱개항목 등)과 메인 창은 서로 다른 렌더러 프로세스라 자동으로 동기화되지 않는다.
  // 어느 창에서든 데이터가 바뀌면(추가/수정/삭제) 이 이벤트가 모든 창에 브로드캐스트된다.
  // callback({ entity: 'todo'|'event'|'memo'|'postit'|'inbox'|'category'|'link', id })
  onDataChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('itda:data-changed', listener);
    return () => ipcRenderer.removeListener('itda:data-changed', listener);
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (payload) => ipcRenderer.invoke('settings:set', payload),
  },
  dashboardImages: {
    save: (payload) => ipcRenderer.invoke('dashboardImages:save', payload),
    get: (name) => ipcRenderer.invoke('dashboardImages:get', name),
    delete: (name) => ipcRenderer.invoke('dashboardImages:delete', name),
  },
  shortcuts: {
    reregisterGlobal: () => ipcRenderer.invoke('shortcuts:reregisterGlobal'),
    getGlobalStatus: () => ipcRenderer.invoke('shortcuts:getGlobalStatus'),
  },
  auth: {
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    verify: (password) => ipcRenderer.invoke('auth:verify', password),
    setPassword: (payload) => ipcRenderer.invoke('auth:setPassword', payload),
    disable: (payload) => ipcRenderer.invoke('auth:disable', payload),
  },
  updater: {
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    getReleaseLog: () => ipcRenderer.invoke('updater:getReleaseLog'),
    getReleasesRepo: () => ipcRenderer.invoke('updater:getReleasesRepo'),
    checkNow: () => ipcRenderer.invoke('updater:checkNow'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    // renderer는 ipcRenderer를 직접 다루면 안 되므로, 콜백만 넘겨받아 내부에서 연결해준다.
    // (ipcRenderer.removeListener까지 캡슐화 — renderer 쪽에서 이벤트 이름/객체를 몰라도 됨)
    onStatus: (callback) => {
      const listener = (event, data) => callback(data);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },
});

// 예상 못한 렌더러 에러를 main의 로그 파일(userData/logs/error.log)로 보낸다.
// contextIsolation 때문에 preload(격리 월드)에서는 메인 월드의 window error 이벤트를 못 잡는다 —
// 그래서 전송 함수만 노출하고, 실제 window.onerror 등록은 메인 월드의 shared/error-report.js가 한다.
contextBridge.exposeInMainWorld('__itdaReportError', (payload) => {
  try {
    ipcRenderer.send('itda:log-error', payload);
  } catch (e) {
    /* 채널이 닫혔거나 main이 없으면 무시 */
  }
});
