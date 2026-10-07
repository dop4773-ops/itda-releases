/**
 * 메신저 → 잇다 동기화 엔진. 메신저 DB는 read()로 "읽기만" 하고(reader.js), 이 파일은 잇다 쪽 저장소와 일정만 건드린다.
 *
 * 흐름
 *  1) read() 결과를 항목으로 정리 → 조건(켠 종류/병동/RM)에 맞으면 messenger_items에 저장·갱신, 삭제·취소·조건 밖이면 gone 처리.
 *     메신저 표에서 아예 사라진 항목은 자동 삭제하지 않고 "확인 필요(vanished)"로만 돌려준다(DB 복원·정리 사고 방지).
 *  2) 저장된 활성 항목으로 "있어야 할 일정"을 계산(입원/퇴원은 날짜별 1개, 외출·외박·병동이동은 항목별 1개).
 *  3) 연결(messenger_links)과 비교해 만들기/고치기/지우기. 사용자가 일정을 지웠으면 되살리지 않고(dismissed),
 *     사용자가 제목·시간·자동 영역을 고쳤으면 덮어쓰지 않고 충돌로만 센다. 지우기는 휴지통(30일 복구).
 *     한 번에 5건 이상(또는 30% 이상) 지워야 하면 적용하지 않고 확인 필요(pending.deletes)로 돌려준다.
 */
const { maskName, buildDaySummary, buildItemEvent, composeMemo, splitMemo, linkKeyDay, linkKeyItem } = require('./format');

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const GUARD_COUNT = 5;
const GUARD_RATIO = 0.3;

function windowOf(now, config) {
  return { fromDate: dayKey(addDays(now, -config.pastDays)), toDate: dayKey(addDays(now, config.futureDays)) };
}

const groupOf = (kind) => (kind === 'overnight' ? 'outing' : kind);
const wardKey = (w) => String(w || '').replace(/병동|층|\s/g, '').toLowerCase();

// reader.readAll 결과 → 같은 모양의 항목 목록(삭제·취소 표시 포함)
function normalize({ admissions = [], outings = [], transfers = [] }) {
  const out = [];
  for (const a of admissions)
    out.push({ source: 'admission', ext_id: a.id, kind: a.kind, date: a.date, end_date: null, patient: a.patient, rm: a.rm, ward: a.ward, room: a.room, to_ward: '', to_room: '', time_text: a.timeText, time_text2: '', note: a.note, reason: '', revision: a.revision, gone: a.deleted || a.cancelled });
  for (const o of outings)
    out.push({ source: 'outing', ext_id: o.id, kind: /외박/.test(o.category) ? 'overnight' : 'outing', date: o.date, end_date: o.endDate && o.endDate !== o.date ? o.endDate : null, patient: o.patient, rm: o.rm, ward: o.ward, room: o.room, to_ward: '', to_room: '', time_text: o.departureText, time_text2: o.returnText, note: '', reason: o.reason, revision: o.revision, gone: o.deleted || o.cancelled });
  for (const t of transfers)
    out.push({ source: 'transfer', ext_id: t.id, kind: 'transfer', date: t.date, end_date: null, patient: t.patient, rm: '', ward: t.fromWard, room: t.fromRoom, to_ward: t.toWard, to_room: t.toRoom, time_text: t.timeText, time_text2: '', note: t.note, reason: '', revision: t.revision, gone: t.deleted || t.cancelled });
  return out;
}

// 설정(켠 종류 / 병동 / RM)에 맞는 항목인가
function inScope(rec, config) {
  if (!config.kinds[groupOf(rec.kind)] || !config.kinds[groupOf(rec.kind)].on) return false;
  if (config.wards.length) {
    const want = new Set(config.wards.map(wardKey));
    if (!want.has(wardKey(rec.ward)) && !(rec.to_ward && want.has(wardKey(rec.to_ward)))) return false;
  }
  if (config.rms.length && !config.rms.includes(String(rec.rm || '').toUpperCase())) return false;
  return true;
}

const toStored = (rec, nameMode) => {
  const { gone: _gone, ...r } = rec;
  return { ...r, patient: maskName(r.patient, nameMode) }; // 이름은 표시 설정대로만 저장
};

// 저장된 활성 항목 → 있어야 할 일정들 { key → {title, auto, allDay, startAt, endAt, categoryId} }
function desiredEvents(items, config) {
  const want = new Map();
  const days = new Map();
  for (const it of items) {
    const g = groupOf(it.kind);
    if (!config.kinds[g] || !config.kinds[g].on) continue;
    const categoryId = config.kinds[g].categoryId;
    if (it.kind === 'admission' || it.kind === 'discharge') {
      const k = linkKeyDay(it.kind, it.date);
      if (!days.has(k)) days.set(k, { kind: it.kind, date: it.date, categoryId, items: [] });
      days.get(k).items.push(it);
    } else {
      const e = buildItemEvent(it, { nameMode: config.nameMode });
      want.set(linkKeyItem(it.source, it.ext_id), { ...e, auto: e.auto.replace(/\s+$/, ''), categoryId });
    }
  }
  for (const [k, d] of days) {
    const e = buildDaySummary(d.kind, d.date, d.items, { nameMode: config.nameMode });
    want.set(k, { ...e, auto: e.auto.replace(/\s+$/, ''), categoryId: d.categoryId });
  }
  return want;
}

/**
 * @param {object} ctx
 *  - itdaDb: 잇다 DB(better-sqlite3), repos: createRepositories(itdaDb), config: 정리된 설정
 *  - read(window): 메신저 읽기 결과(reader.readAll) — skipRead면 부르지 않는다(저장된 항목으로 일정만 다시 만들 때)
 *  - confirm: { deletes: true } 큰 삭제 허용, { vanished: true } 사라진 항목 삭제 허용
 */
function runSync({ itdaDb, repos, config, read, now = new Date(), trigger = 'manual', confirm = {}, skipRead = false }) {
  const { messenger, events } = repos;
  const win = windowOf(now, config);
  const data = skipRead ? null : read(win);
  const stats = { added: 0, updated: 0, removed: 0, conflicts: 0, dismissed: 0, itemsNew: 0, itemsChanged: 0, itemsGone: 0 };
  const pending = { deletes: [], vanished: [] };

  const readColors = itdaDb.prepare('SELECT color_hex, text_color FROM events WHERE id = ?');

  repos.transaction(() => {
    // 1) 항목 갱신
    if (data) {
      const raw = normalize(data);
      const seen = new Set(raw.map((r) => `${r.source}:${r.ext_id}`));
      for (const r of raw) {
        if (!r.gone && inScope(r, config)) {
          const res = messenger.upsertItem(toStored(r, config.nameMode));
          if (res === 'inserted') stats.itemsNew++;
          else if (res === 'updated') stats.itemsChanged++;
        } else if (messenger.markGone(r.source, r.ext_id)) stats.itemsGone++;
      }
      for (const it of messenger.activeInWindow(win.fromDate, win.toDate)) {
        if (seen.has(`${it.source}:${it.ext_id}`)) continue;
        if (confirm.vanished) {
          messenger.markGone(it.source, it.ext_id);
          stats.itemsGone++;
        } else pending.vanished.push({ source: it.source, ext_id: it.ext_id, date: it.date, kind: it.kind });
      }
    }

    // 2) 있어야 할 일정과 연결 비교
    const want = desiredEvents(messenger.activeItems(), config);
    const links = new Map(messenger.listLinks().map((l) => [l.link_key, l]));
    const deletes = [];

    for (const [key, d] of want) {
      const link = links.get(key);
      if (!link) {
        const id = events.insert({ title: d.title, categoryId: d.categoryId, location: null, startAt: d.startAt, endAt: d.endAt, allDay: d.allDay, memo: composeMemo(d.auto, '') }).id;
        messenger.saveLink({ link_key: key, event_id: id, last_title: d.title, last_auto: d.auto, last_start: d.startAt, last_end: d.endAt, last_category: d.categoryId });
        stats.added++;
        continue;
      }
      if (link.dismissed) continue; // 사용자가 지운 일정 — 되살리지 않는다
      const ev = events.getById(link.event_id);
      if (!ev || ev.deleted_at) {
        messenger.saveLink({ ...link, dismissed: 1 });
        stats.dismissed++;
        continue;
      }
      const sp = splitMemo(ev.memo);
      const untouched = ev.title === link.last_title && ev.start_at === link.last_start && ev.end_at === link.last_end && !!sp && sp.auto === link.last_auto;
      const same = d.title === link.last_title && d.auto === link.last_auto && d.startAt === link.last_start && d.endAt === link.last_end;
      // 카테고리: 사용자가 바꾸지 않았고(마지막으로 우리가 정한 값 그대로) 설정이 바뀌었으면 따라간다
      const catFollows = (ev.category_id ?? null) === (link.last_category ?? null) && d.categoryId !== (link.last_category ?? null);
      if (same && untouched && !catFollows) continue;
      if (!untouched && !same) {
        stats.conflicts++; // 사용자가 고친 일정은 덮어쓰지 않는다
        if (!catFollows) continue;
      }
      const c = readColors.get(ev.id) || {};
      const contentChanged = untouched && !same;
      events.update({
        id: ev.id,
        title: contentChanged ? d.title : ev.title,
        categoryId: catFollows ? d.categoryId : ev.category_id ?? null,
        location: ev.location,
        startAt: contentChanged ? d.startAt : ev.start_at,
        endAt: contentChanged ? d.endAt : ev.end_at,
        allDay: contentChanged ? (d.allDay ? 1 : 0) : ev.all_day,
        memo: contentChanged ? composeMemo(d.auto, sp.user) : ev.memo,
        colorHex: c.color_hex ?? null,
        textColor: c.text_color ?? null,
        remindDay: ev.remind_day, // 사용자가 켠 당일 알림은 그대로 둔다
      });
      messenger.saveLink({
        ...link,
        last_title: contentChanged ? d.title : link.last_title,
        last_auto: contentChanged ? d.auto : link.last_auto,
        last_start: contentChanged ? d.startAt : link.last_start,
        last_end: contentChanged ? d.endAt : link.last_end,
        last_category: catFollows ? d.categoryId : link.last_category,
      });
      stats.updated++;
    }

    // 3) 더는 필요 없는 일정 정리
    for (const [key, link] of links) {
      if (want.has(key)) continue;
      if (link.dismissed) {
        messenger.deleteLink(key);
        continue;
      }
      const ev = events.getById(link.event_id);
      if (ev && !ev.deleted_at) deletes.push({ key, ev });
      else messenger.deleteLink(key);
    }
    const live = [...links.values()].filter((l) => !l.dismissed).length;
    const big = deletes.length >= GUARD_COUNT || (live >= 3 && deletes.length / live >= GUARD_RATIO);
    if (deletes.length && big && !confirm.deletes) {
      pending.deletes = deletes.map((d) => ({ key: d.key, title: d.ev.title, date: d.ev.start_at.slice(0, 10) }));
    } else {
      for (const d of deletes) {
        events.softDelete(d.ev.id);
        messenger.deleteLink(d.key);
        stats.removed++;
      }
    }
  })();

  const summary = {
    at: now.toISOString(),
    trigger,
    window: win,
    stats,
    pending,
    unknownAdmissionTypes: data ? data.unknownAdmissionTypes || [] : [],
    skippedRead: skipRead,
  };
  messenger.purgeSupplements?.(); // 오래된 보충 입력(환자 정보)은 같이 정리
  messenger.addLog(trigger, summary);
  return summary;
}

module.exports = { runSync, normalize, inScope, desiredEvents, windowOf, GUARD_COUNT, GUARD_RATIO };
