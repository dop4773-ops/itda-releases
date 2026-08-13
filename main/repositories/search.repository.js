module.exports = function createSearchRepository(db) {
  return {
    query(keyword) {
      return db.prepare(`SELECT * FROM search_index WHERE search_index MATCH ? LIMIT 30`).all(keyword);
    },
  };
};
