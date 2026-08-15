const { assertNonEmpty } = require('./_shared');
const { broadcastDataChanged } = require('../broadcast');
const { generateOccurrenceDates } = require('../shared/recurrence');

// todos는 soft delete(deleted_at) 대상 → 삭제는 실제로는 UPDATE
module.exports = function registerTodosIpc(ipcMain, repos) {
  const { todos } = repos;

  ipcMain.handle('todos:today', () => {
    return todos.listToday();
  });

  ipcMain.handle('todos:list', (event, filter = {}) => {
    return todos.list(filter);
  });

  ipcMain.handle('todos:get', (event, id) => {
    const todo = todos.getById(id);
    if (!todo) return null;
    todo.subtasks = todos.listSubtasks(id);
    return todo;
  });

  ipcMain.handle('todos:add', (event, { title, memo, categoryId, dueDate, dueTime, priority, sourceInboxId, recurrenceRule }) => {
    assertNonEmpty(title, '할 일 제목을 입력해주세요.');
    if (recurrenceRule) assertNonEmpty(dueDate, '반복하려면 마감일이 필요해요.');
    const result = todos.insert({ title: title.trim(), memo, categoryId, dueDate, dueTime, priority, sourceInboxId, recurrenceRule });
    if (recurrenceRule) {
      const occurrences = generateOccurrenceDates(dueDate, recurrenceRule);
      if (occurrences.length) todos.insertSeries(todos.getById(result.id), occurrences);
    }
    broadcastDataChanged('todo', result.id);
    return result;
  });

  // 이미 만들어진(반복 없는) Todo에 나중에 반복을 거는 용도 — 상세 패널에서 "반복" 선택 시 호출.
  // 이미 시리즈의 일부인 항목엔 다시 걸 수 없게 막는다(중첩 반복 방지, 간단한 반복 기능의 한계로 감안).
  ipcMain.handle('todos:setRecurrence', (event, { id, rule }) => {
    const todo = todos.getById(id);
    if (!todo) throw new Error('할 일을 찾을 수 없습니다.');
    if (todo.recurrence_parent_id) throw new Error('이미 반복 시리즈에 속한 항목이라 다시 반복을 걸 수 없어요.');
    assertNonEmpty(todo.due_date, '반복하려면 먼저 마감일을 정해주세요.');
    todos.setRecurrenceRule(id, rule);
    const occurrences = generateOccurrenceDates(todo.due_date, rule);
    if (occurrences.length) todos.insertSeries(todos.getById(id), occurrences);
    broadcastDataChanged('todo', id);
    return { id };
  });

  ipcMain.handle('todos:update', (event, { id, title, memo, categoryId, dueDate, dueTime, priority }) => {
    const todo = todos.getById(id);
    if (!todo) throw new Error('할 일을 찾을 수 없습니다.');
    // undefined="이 필드는 안 건드림", null="명시적으로 값을 지움" — ??는 null도 걸러버려서 값 지우기가 안 되므로 직접 구분한다
    const pick = (val, fallback) => (val === undefined ? fallback : val);
    todos.update({
      id,
      title: title !== undefined ? title.trim() : todo.title,
      memo: pick(memo, todo.memo),
      categoryId: pick(categoryId, todo.category_id),
      dueDate: pick(dueDate, todo.due_date),
      dueTime: pick(dueTime, todo.due_time),
      priority: pick(priority, todo.priority),
    });
    broadcastDataChanged('todo', id);
    return { id };
  });

  // 체크박스 토글(목록 화면): 완료 ↔ 할 일. status도 함께 동기화한다.
  // (진행 중 상태는 이 토글로는 만들 수 없고, setStatus로만 지정 — 체크박스는 켜짐/꺼짐 2단만 다룸)
  ipcMain.handle('todos:toggle', (event, id) => {
    const todo = todos.getById(id);
    if (!todo) return null;
    const next = todo.is_done ? 0 : 1;
    todos.setDone(id, next);
    broadcastDataChanged('todo', id);
    return { id, is_done: next, status: next ? 'done' : 'todo' };
  });

  // 칸반 보드에서 카드를 다른 컬럼으로 옮길 때 사용. is_done도 함께 동기화한다.
  ipcMain.handle('todos:setStatus', (event, { id, status }) => {
    if (!['todo', 'doing', 'done'].includes(status)) throw new Error('알 수 없는 상태입니다.');
    todos.setStatus(id, status);
    broadcastDataChanged('todo', id);
    return { id, status, is_done: status === 'done' ? 1 : 0 };
  });

  ipcMain.handle('todos:toggleFavorite', (event, id) => {
    const todo = todos.getById(id);
    if (!todo) return null;
    const next = todo.is_favorite ? 0 : 1;
    todos.setFavorite(id, next);
    broadcastDataChanged('todo', id);
    return { id, is_favorite: next };
  });

  ipcMain.handle('todos:delete', (event, id) => {
    todos.softDelete(id);
    broadcastDataChanged('todo', id);
    return { id };
  });

  // 반복 Todo 삭제: scope='this'는 이 항목 하나만(todos:delete와 동일), 'following'은
  // 이 항목의 마감일부터 그 시리즈의 나머지 전부(자기 자신 포함)를 함께 소프트삭제한다.
  ipcMain.handle('todos:deleteSeries', (event, { id, scope }) => {
    const todo = todos.getById(id);
    if (!todo) throw new Error('할 일을 찾을 수 없습니다.');
    const targets = scope === 'following' ? todos.listSeriesFrom(id, todo.due_date) : [{ id }];
    targets.forEach((t) => todos.softDelete(t.id));
    broadcastDataChanged('todo');
    return { count: targets.length };
  });

  // ---------- 하위 할 일(체크리스트) ----------
  ipcMain.handle('todoSubtasks:list', (event, todoId) => {
    return todos.listSubtasks(todoId);
  });

  ipcMain.handle('todoSubtasks:add', (event, { todoId, title }) => {
    assertNonEmpty(title, '하위 할 일 제목을 입력해주세요.');
    const result = todos.insertSubtask({ todoId, title: title.trim() });
    broadcastDataChanged('todo', todoId); // 하위 할 일도 위젯에선 부모 Todo 표시의 일부라 부모 id로 알린다
    return result;
  });

  ipcMain.handle('todoSubtasks:toggle', (event, id) => {
    const sub = todos.getSubtaskDoneState(id);
    if (!sub) return null;
    const next = sub.is_done ? 0 : 1;
    todos.setSubtaskDone(id, next);
    broadcastDataChanged('todo', sub.todo_id);
    return { id, is_done: next };
  });

  ipcMain.handle('todoSubtasks:delete', (event, id) => {
    const sub = todos.getSubtaskDoneState(id);
    todos.removeSubtask(id);
    if (sub) broadcastDataChanged('todo', sub.todo_id);
    return { id };
  });
};
