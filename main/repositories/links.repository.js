// item_links 조회 시 각 타입별로 "미리보기"에 쓸 제목/부가정보를 가져오는 쿼리.
// deleted_at까지 같이 가져와서, 연결된 쪽이 휴지통에 가 있으면 상위 레이어에서 걸러낼 수 있게 한다.
const PREVIEW_QUERIES = {
  todo: `SELECT id, title AS label, due_date, due_time, is_done, deleted_at FROM todos WHERE id = ?`,
  event: `SELECT id, title AS label, start_at, deleted_at FROM events WHERE id = ?`,
  // memo/postit은 content가 HTML(볼드/글씨크기 서식)일 수 있어서, 태그를 감안해 넉넉히 잘라
  // 렌더러 쪽에서 stripHtmlToPlainText로 순수텍스트로 바꾼 뒤 다시 짧게 자른다.
  // (여기서 짧게 자르면 "<span style=...>" 같은 태그만 남고 실제 글자가 하나도 안 남을 수 있음)
  memo: `SELECT id, coalesce(title, substr(content,1,300)) AS label, deleted_at FROM memos WHERE id = ?`,
  postit: `SELECT id, coalesce(title, substr(content,1,300)) AS label, deleted_at FROM postits WHERE id = ?`,
  // inbox_items엔 소프트 삭제(deleted_at)가 없어서 항상 NULL로 맞춰 반환 — 다른 타입과 동일한 모양 유지
  inbox: `SELECT id, substr(content,1,300) AS label, NULL AS deleted_at FROM inbox_items WHERE id = ?`,
};

// item_links의 타입 → 실제 테이블. 고아 연결(상대 항목이 완전삭제됨) 판별에 쓴다.
const LINK_TABLES = { todo: 'todos', event: 'events', memo: 'memos', postit: 'postits', inbox: 'inbox_items' };

// 관련 항목 후보로 볼 타입 (inbox 제외 — 정리 전 임시 수집함이라 "관련" 개념이 약함)
const DISCOVER_TYPES = ['todo', 'event', 'memo', 'postit'];

// 관련 항목 점수/근거를 계산할 때 후보 항목에서 뽑아오는 필드.
// refDate = "이 항목의 대표 날짜"(todo=마감일, event=시작일, memo/postit=만든 날) — "같은 날짜" 근거용.
const DISCOVER_SELECT = {
  todo: `SELECT id, title, coalesce(memo,'') AS content, category_id, created_at, due_date AS refDate FROM todos`,
  event: `SELECT id, title, coalesce(memo,'') AS content, category_id, created_at, substr(start_at,1,10) AS refDate FROM events`,
  memo: `SELECT id, coalesce(title,'') AS title, content, category_id, created_at, substr(created_at,1,10) AS refDate FROM memos`,
  postit: `SELECT id, coalesce(title,'') AS title, content, category_id, created_at, substr(created_at,1,10) AS refDate FROM postits`,
};

const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const keywordsOf = (title, content) =>
  [...new Set(`${plain(title)} ${plain(content)}`.split(' ').filter((t) => t.length >= 2))].slice(0, 10);
const daysBetween = (a, b) => Math.abs((new Date(a + 'T00:00') - new Date(b + 'T00:00')) / 86400000);
const minutesBetween = (a, b) =>
  Math.abs((new Date(String(a).replace(' ', 'T')) - new Date(String(b).replace(' ', 'T'))) / 60000);

// search: search.repository — "@검색"과 "비슷한 내용" 추천이 통합검색과 같은 매칭을 쓰게 한다.
module.exports = function createLinksRepository(db, search) {
  return {
    // link는 { a_type, a_id, b_type, b_id } 형태로, 이미 정규화되어 들어온다고 가정 (정규화는 ipc 레이어 책임)
    insertIgnore(link) {
      db.prepare(`INSERT OR IGNORE INTO item_links (a_type, a_id, b_type, b_id) VALUES (?, ?, ?, ?)`).run(
        link.a_type,
        link.a_id,
        link.b_type,
        link.b_id
      );
    },

    find(link) {
      return db
        .prepare(`SELECT * FROM item_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`)
        .get(link.a_type, link.a_id, link.b_type, link.b_id);
    },

    remove(link) {
      db.prepare(`DELETE FROM item_links WHERE a_type = ? AND a_id = ? AND b_type = ? AND b_id = ?`).run(
        link.a_type,
        link.a_id,
        link.b_type,
        link.b_id
      );
    },

    listRawFor(type, id) {
      return db
        .prepare(
          `SELECT a_type, a_id, b_type, b_id FROM item_links
           WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`
        )
        .all(type, id, type, id);
    },

    getPreview(type, id) {
      const query = PREVIEW_QUERIES[type];
      if (!query) return null;
      return db.prepare(query).get(id);
    },

    // (type,id)에 연결된 "상대방" 목록을 미리보기와 함께. links:listFor IPC와 검색 "관련 항목"이 공유.
    // opts.includeTrashed=false(기본)면 소프트삭제(휴지통)된 상대는 제외. 완전삭제(고아)는 항상 제외.
    listForWithPreview(type, id, { includeTrashed = false } = {}) {
      return this.listRawFor(type, id)
        .map((r) => {
          const isA = r.a_type === type && r.a_id === id;
          const otherType = isA ? r.b_type : r.a_type;
          const otherId = isA ? r.b_id : r.a_id;
          const preview = this.getPreview(otherType, otherId);
          if (!preview) return null; // 완전삭제된 상대 — 고아 연결
          if (!includeTrashed && preview.deleted_at) return null; // 휴지통에 있는 상대
          return { type: otherType, ...preview };
        })
        .filter(Boolean);
    },

    // 목록 화면에서 "이 항목에 연결이 있나 / 어떤 종류가 연결됐나"만 알고 싶을 때 —
    // 항목마다 listFor(+getPreview) N번 도는 대신, 한 방에 { id: Set(연결된 종류) } 를 만든다.
    // 상대 항목이 완전삭제된 고아 연결은 제외한다(예: 완전삭제된 Todo에만 걸려있던 포스트잇에
    // "Todo 연결됨" 배지가 계속 뜨던 것). listFor와 동일하게 소프트삭제(휴지통)는 남긴다.
    kindsForMany(type, ids) {
      const out = {};
      if (!Array.isArray(ids) || ids.length === 0) return out;
      const placeholders = ids.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT a_type, a_id, b_type, b_id FROM item_links
           WHERE (a_type = ? AND a_id IN (${placeholders}))
              OR (b_type = ? AND b_id IN (${placeholders}))`
        )
        .all(type, ...ids, type, ...ids);

      // 상대편(type,id) 후보를 종류별로 모아 존재 여부를 종류당 한 번의 쿼리로 확인
      const wantByType = {};
      const pairs = rows.map((r) => {
        const isA = r.a_type === type && ids.includes(r.a_id);
        const selfId = isA ? r.a_id : r.b_id;
        const otherType = isA ? r.b_type : r.a_type;
        const otherId = isA ? r.b_id : r.a_id;
        (wantByType[otherType] = wantByType[otherType] || new Set()).add(otherId);
        return { selfId, otherType, otherId };
      });
      const existsByType = {};
      for (const [ot, idSet] of Object.entries(wantByType)) {
        const table = LINK_TABLES[ot];
        if (!table) continue;
        const list = [...idSet];
        const ph = list.map(() => '?').join(',');
        existsByType[ot] = new Set(
          db.prepare(`SELECT id FROM ${table} WHERE id IN (${ph})`).all(...list).map((x) => x.id)
        );
      }

      for (const p of pairs) {
        if (!existsByType[p.otherType] || !existsByType[p.otherType].has(p.otherId)) continue; // 고아 연결
        (out[p.selfId] = out[p.selfId] || new Set()).add(p.otherType);
      }
      return out;
    },

    deleteAllFor(type, id) {
      db.prepare(`DELETE FROM item_links WHERE (a_type = ? AND a_id = ?) OR (b_type = ? AND b_id = ?)`).run(type, id, type, id);
    },

    // "@검색" 빠른 연결용 — 통합검색과 동일한 매칭(search.candidates). inbox는 연결 대상 아님.
    searchCandidates(keyword, excludeType, excludeId) {
      return search.candidates(keyword, excludeType, excludeId);
    },

    // 관련 항목 발견 — 직접 연결하지 않아도 "관련 있어 보이는" 항목을 근거와 함께 점수순으로 추천.
    // 근거: 같은 태그(+3) / 같은 날짜 ±1일(+2) / 공유 키워드(개당 +1, 최대 3) / 같이 만든 항목 ±15분(+2).
    // 점수 2점 미만은 노이즈로 보고 버린다(키워드 1개만 겹치는 정도는 안 보임). 최대 6개.
    // 반환: { related: [{ type, id, label, score, reasons: [{kind,...}] }] }  (직접 연결/자기 자신 제외)
    discoverRelated(type, id) {
      const self = db.prepare(`${DISCOVER_SELECT[type] || DISCOVER_SELECT.memo} WHERE id = ?`).get(id);
      if (!self) return { related: [] };

      const excluded = new Set([`${type}:${id}`]);
      this.listRawFor(type, id).forEach((r) => {
        const isA = r.a_type === type && r.a_id === id;
        excluded.add(isA ? `${r.b_type}:${r.b_id}` : `${r.a_type}:${r.a_id}`);
      });

      const selfKw = keywordsOf(self.title, self.content);
      const category = self.category_id
        ? db.prepare('SELECT id, name, color_hex FROM categories WHERE id = ?').get(self.category_id)
        : null;

      // 후보 풀 — 같은 카테고리(전체 기간) + 비슷한 시각(±20분) 생성 + 키워드 매칭
      const pool = new Map();
      const add = (c) => {
        const key = `${c.type}:${c.id}`;
        if (!excluded.has(key) && !pool.has(key)) pool.set(key, c);
      };
      for (const t of DISCOVER_TYPES) {
        const stmt = db.prepare(
          `${DISCOVER_SELECT[t]} WHERE deleted_at IS NULL
           AND (category_id = @cat OR created_at BETWEEN datetime(@ts,'-10 minutes') AND datetime(@ts,'+10 minutes'))
           LIMIT 60`
        );
        stmt.all({ cat: category ? category.id : -1, ts: self.created_at || '9999-01-01' }).forEach((r) => add({ type: t, ...r }));
      }
      search.similarTo(selfKw, excluded).forEach((r) => {
        if (pool.has(`${r.type}:${r.id}`)) return;
        const full = db.prepare(`${DISCOVER_SELECT[r.type]} WHERE id = ?`).get(r.id);
        if (full) add({ type: r.type, ...full });
      });

      const scored = [];
      for (const c of pool.values()) {
        let score = 0;
        const reasons = [];
        if (category && c.category_id === category.id) {
          score += 3;
          reasons.push({ kind: 'tag', tagName: category.name, tagColor: category.color_hex });
        }
        if (self.refDate && c.refDate && daysBetween(self.refDate, c.refDate) <= 1) {
          score += 2;
          reasons.push({ kind: 'date', date: c.refDate });
        }
        const cKw = keywordsOf(c.title, c.content);
        const shared = selfKw.filter((w) => cKw.includes(w));
        if (shared.length) {
          score += Math.min(shared.length, 3);
          reasons.push({ kind: 'keyword', words: shared.slice(0, 3) });
        }
        if (self.created_at && c.created_at && minutesBetween(self.created_at, c.created_at) <= 10) {
          score += 2;
          reasons.push({ kind: 'coCreated' });
        }
        if (score >= 2) {
          scored.push({
            type: c.type,
            id: c.id,
            label: plain(c.title) || plain(c.content).slice(0, 60) || '(제목 없음)',
            score,
            reasons,
          });
        }
      }
      scored.sort((a, b) => b.score - a.score || String(a.label).length - String(b.label).length);
      return { related: scored.slice(0, 6) };
    },
  };
};
