// 테스트용 in-memory DB 준비. 실제 앱과 동일하게 chosung() SQL 함수 등록 + search_index 재구축까지.
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { registerSqlFunctions, rebuildSearchIndex, SCHEMA_VERSION } = require('../main/db.js');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema', 'itda_schema_v1.sql'), 'utf-8');

// 최신 상태의 새 DB (신규 설치와 동일 경로)
function freshDb() {
  const db = new Database(':memory:');
  registerSqlFunctions(db);
  db.exec(SCHEMA);
  rebuildSearchIndex(db); // search_index는 schema.sql이 아니라 여기서 (앱 initDb와 동일)
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

module.exports = { freshDb, SCHEMA, Database, registerSqlFunctions, rebuildSearchIndex };
