const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function createHolidaysRepository(db) {
  return {
    // 달력이 보여주는 기간(YYYY-MM-DD 양끝 포함)의 공휴일
    range(fromDate, toDate) {
      return db.prepare('SELECT date, name, source FROM holidays WHERE date >= ? AND date <= ? ORDER BY date').all(fromDate, toDate);
    },

    listYear(year) {
      return db.prepare('SELECT date, name, source FROM holidays WHERE date LIKE ? ORDER BY date').all(`${year}-%`);
    },

    // 이미 있는 날짜는 건드리지 않고(사용자가 고친 이름 유지) 없는 날짜만 추가. 추가된 개수 반환.
    addMissing(list, source) {
      const stmt = db.prepare('INSERT OR IGNORE INTO holidays (date, name, source) VALUES (?, ?, ?)');
      let added = 0;
      db.transaction(() => {
        for (const h of list) {
          if (DATE_RE.test(h.date) && String(h.name || '').trim()) added += stmt.run(h.date, String(h.name).trim(), source).changes;
        }
      })();
      return added;
    },

    add(date, name, source = 'manual') {
      if (!DATE_RE.test(date)) throw new Error('날짜 형식이 올바르지 않아요.');
      if (!String(name || '').trim()) throw new Error('공휴일 이름을 입력해주세요.');
      const info = db.prepare('INSERT OR IGNORE INTO holidays (date, name, source) VALUES (?, ?, ?)').run(date, String(name).trim(), source);
      if (!info.changes) throw new Error('이미 등록된 날짜예요. 목록에서 이름을 고쳐주세요.');
    },

    rename(date, name) {
      if (!String(name || '').trim()) throw new Error('공휴일 이름을 입력해주세요.');
      db.prepare('UPDATE holidays SET name = ? WHERE date = ?').run(String(name).trim(), date);
    },

    remove(date) {
      db.prepare('DELETE FROM holidays WHERE date = ?').run(date);
    },
  };
};
