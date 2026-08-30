/**
 * 연결된 항목 내용 동기화  (설정 키: link_content_sync = 'ask' | 'auto' | 'off', 기본 'ask')
 *
 * todo/event/memo/postit 중 하나의 "내용"(제목 + 본문 텍스트)이 수정되면, item_links로 연결된
 * 반대쪽 항목의 같은 필드도 맞춰준다. 4개 update IPC 핸들러(todos/events/memos/postits:update)가
 * DB 쓰기 직후 scheduleContentSync를 부른다.
 *
 * - memo ↔ postit 끼리는 저장된 서식 HTML을 그대로 전파한다(체크박스·볼드·글자색·사진까지 보존).
 * - Todo/일정이 낀 연결은 memo 칸이 평문이라 순수 텍스트만 오간다. 이때 서식 있는 memo/postit를
 *   평문으로 덮어쓰게 되면 auto 모드라도 확인창을 띄운다(wouldLoseFormatting).
 * - 제목은 소스에 제목이 실제로 있을 때만 전파(포스트잇은 제목 필드가 없어 늘 본문만 나간다).
 * - 날짜·완료 여부처럼 타입 고유 필드는 손대지 않는다.
 * - 무한 루프 없음: 여기서는 repository.update를 직접 호출하므로 update IPC 핸들러를 다시 타지 않는다.
 * - 타이핑 자동저장(500ms)마다 확인창이 뜨지 않게 항목별로 1.2초 디바운스한 뒤 처리한다.
 */
const { dialog, BrowserWindow } = require('electron');
const { broadcastDataChanged } = require('./broadcast');

const SYNC_TYPES = ['todo', 'event', 'memo', 'postit'];
const TYPE_LABEL = { todo: 'Todo', event: '일정', memo: '메모', postit: '포스트잇' };

function htmlToPlain(html) {
  // renderer의 stripHtmlToPlainText와 같은 규칙 — 블록 요소 시작 위치에 줄바꿈을 넣고 태그를 벗긴다.
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*(div|p|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function plainToHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split('\n')
    .join('<br>');
}

// 현재 행에서 { title, body(순수텍스트), html } 를 뽑는다. 행이 없으면 null.
// html: memo/postit은 저장된 서식 HTML(이미 renderer가 sanitize한 값), todo/event는 null(평문 memo칸).
function readContent(repos, type, id) {
  if (type === 'todo') {
    const r = repos.todos.getById(id);
    return r ? { title: r.title || '', body: r.memo || '', html: null } : null;
  }
  if (type === 'event') {
    const r = repos.events.getById(id);
    return r ? { title: r.title || '', body: r.memo || '', html: null } : null;
  }
  if (type === 'memo') {
    const r = repos.memos.getById(id);
    return r ? { title: r.title || '', body: htmlToPlain(r.content), html: String(r.content || '') } : null;
  }
  if (type === 'postit') {
    const r = repos.postits.getById(id);
    return r ? { title: r.title || '', body: htmlToPlain(r.content), html: String(r.content || '') } : null;
  }
  return null;
}

// target에 대해 "이번에 실제로 바꿀 게 있는가" — 제목(소스에 있을 때, postit 제외) / 본문 텍스트 /
// (memo↔postit처럼 양쪽 다 서식 타입이면) 서식 HTML.
function needsUpdate(src, cur, targetType) {
  const srcTitle = (src.title || '').trim();
  const titleDiff = srcTitle && targetType !== 'postit' && srcTitle !== (cur.title || '').trim();
  const bodyDiff = cur.body !== src.body;
  const richDiff = src.html != null && cur.html != null && src.html !== cur.html;
  return titleDiff || bodyDiff || richDiff;
}

// memo/postit 본문에 "평문으로 덮어쓰면 사라질" 서식 — 체크박스/사진/볼드·기울임·밑줄/글자색·크기 span/정렬.
const RICH_MARKERS = /<input\b|<img\b|<\/?(?:b|strong|i|em|u)\b|<span[^>]*\b(?:style|class)\s*=|text-align\s*:/i;

// auto 모드라도 확인창을 띄워야 하는 경우: 대상 memo/postit에 서식이 있는데 그게 평문으로 덮어써질 때.
// 소스도 memo/postit(src.html!=null)이면 서식 HTML을 그대로 전파하므로 손실 없음 → 확인창 불필요.
function wouldLoseFormatting(repos, partner, src) {
  if (partner.type !== 'memo' && partner.type !== 'postit') return false; // todo/event memo는 원래 평문칸
  if (src.html != null) return false; // memo↔postit: 서식 보존 전파
  const r = (partner.type === 'memo' ? repos.memos : repos.postits).getById(partner.id);
  if (!r || !RICH_MARKERS.test(String(r.content || ''))) return false;
  return htmlToPlain(r.content) !== src.body; // 본문 텍스트가 실제로 바뀔 때만 content를 다시 씀
}

// 소스 내용(src)을 target 행에 반영. 다른 필드는 현재 값 그대로 통과시킨다(repo.update는 전체 컬럼을 받음).
function applyContent(repos, type, id, src) {
  const srcTitle = (src.title || '').trim();

  if (type === 'todo' || type === 'event') {
    const repo = type === 'todo' ? repos.todos : repos.events;
    const r = repo.getById(id);
    if (!r) return false;
    const nextTitle = srcTitle && srcTitle !== (r.title || '').trim() ? srcTitle : r.title;
    const nextMemo = (r.memo || '') !== src.body ? src.body || null : r.memo;
    if (nextTitle === r.title && nextMemo === r.memo) return false;
    if (type === 'todo') {
      repo.update({ id, title: nextTitle, memo: nextMemo, categoryId: r.category_id, dueDate: r.due_date, dueTime: r.due_time, priority: r.priority });
    } else {
      repo.update({ id, title: nextTitle, categoryId: r.category_id, location: r.location, startAt: r.start_at, endAt: r.end_at, allDay: r.all_day, memo: nextMemo });
    }
    return true;
  }

  // memo / postit
  const repo = type === 'memo' ? repos.memos : repos.postits;
  const r = repo.getById(id);
  if (!r) return false;
  // 소스도 memo/postit(src.html!=null)이면 저장된 서식 HTML을 그대로 복사(서식 보존).
  //   그 HTML은 renderer가 저장 시 이미 sanitizeRichHtml을 거친 값이고, 불러올 때 renderer가 또 정화하므로 안전.
  // 소스가 todo/event(평문)면 종전대로 줄바꿈만 <br>로 살린 평문 HTML.
  const preserveRich = src.html != null;
  const nextContent = preserveRich ? src.html : plainToHtml(src.body);
  const contentChanged = preserveRich
    ? String(r.content || '') !== nextContent // 서식까지 정확히 같아질 때까지
    : htmlToPlain(r.content) !== src.body; // 평면 텍스트가 바뀔 때만
  const titleChanged = type === 'memo' && srcTitle && srcTitle !== (r.title || '').trim();
  if (!contentChanged && !titleChanged) return false;
  const finalContent = contentChanged ? nextContent : r.content;
  if (type === 'memo') {
    repo.update({ id, title: titleChanged ? srcTitle : r.title, content: finalContent, categoryId: r.category_id, colorHex: r.color_hex, folderId: r.folder_id });
  } else {
    repo.update({ id, title: r.title, content: finalContent, colorHex: r.color_hex, categoryId: r.category_id, posX: r.pos_x, posY: r.pos_y, width: r.width, height: r.height, opacity: r.opacity });
  }
  return true;
}

// type/id에 연결된, 동기화 가능한 타입의 상대 항목 목록(중복 제거).
function linkedPartners(repos, type, id) {
  const seen = new Set([`${type}:${id}`]);
  const out = [];
  for (const l of repos.links.listRawFor(type, id)) {
    const isA = l.a_type === type && l.a_id === id;
    const t = isA ? l.b_type : l.a_type;
    const pid = isA ? l.b_id : l.a_id;
    const key = `${t}:${pid}`;
    if (seen.has(key) || !SYNC_TYPES.includes(t)) continue;
    seen.add(key);
    out.push({ type: t, id: pid });
  }
  return out;
}

const timers = new Map(); // `${type}:${id}` -> Timeout

function scheduleContentSync(repos, type, id) {
  if (!SYNC_TYPES.includes(type)) return;
  if ((repos.settings.get('link_content_sync') || 'ask') === 'off') return;
  const key = `${type}:${id}`;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      Promise.resolve()
        .then(() => runContentSync(repos, type, id))
        .catch((e) => console.error('[link-sync]', e));
    }, 1200)
  );
}

async function runContentSync(repos, type, id) {
  const mode = repos.settings.get('link_content_sync') || 'ask';
  if (mode === 'off') return;

  const src = readContent(repos, type, id);
  if (!src) return;

  let partners = linkedPartners(repos, type, id).filter((p) => {
    const cur = readContent(repos, p.type, p.id);
    return cur && needsUpdate(src, cur, p.type);
  });
  if (!partners.length) return;

  // ask 모드는 항상 확인. auto 모드는 평소엔 조용히 반영하되, 서식(체크박스/사진/볼드/색 등)이
  // 평문으로 덮어써져 사라지는 경우엔 auto라도 한 번 확인한다(조용한 데이터 손실 방지).
  const formatLoss = mode === 'auto' && partners.some((p) => wouldLoseFormatting(repos, p, src));

  if (mode === 'ask' || formatLoss) {
    const kinds = [...new Set(partners.map((p) => TYPE_LABEL[p.type]))].join(', ');
    const opts = {
      type: 'question',
      buttons: ['예', '아니오, 이번만'],
      defaultId: formatLoss ? 1 : 0, // 서식 손실 경고는 실수 방지를 위해 기본 선택을 "아니오"로
      cancelId: 1,
      noLink: true,
      message: formatLoss
        ? `연결된 ${kinds}에 체크박스·서식이 있어요. 내용을 맞추면 그 서식이 사라집니다. 그래도 바꿀까요?`
        : `연결된 ${kinds}의 내용도 함께 변경할까요?`,
      detail: formatLoss
        ? '메모↔포스트잇끼리는 서식이 보존되지만, Todo·일정의 내용 칸은 텍스트만 담겨서 그쪽에 맞추면 서식이 빠집니다.'
        : '제목·본문을 맞춰요(메모↔포스트잇은 서식도 함께). 날짜·완료 여부 등 타입 고유 값은 그대로예요.',
      // "다시 묻지 않기"는 ask 모드 전용 — auto의 서식 손실 경고는 매번 뜬다(영구 무시 불가).
      ...(formatLoss ? {} : { checkboxLabel: '다시 묻지 않기', checkboxChecked: false }),
    };
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    const { response, checkboxChecked } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    const yes = response === 0;
    if (!formatLoss && checkboxChecked) repos.settings.set('link_content_sync', yes ? 'auto' : 'off');
    if (!yes) return;

    // 다이얼로그를 띄운 사이 사용자가 더 고쳤을 수 있으니 최신값으로 다시 읽고 대상도 다시 추린다.
    const fresh = readContent(repos, type, id);
    if (!fresh) return;
    Object.assign(src, fresh);
    partners = partners.filter((p) => {
      const cur = readContent(repos, p.type, p.id);
      return cur && needsUpdate(src, cur, p.type);
    });
    if (!partners.length) return;
  }

  const changedTypes = new Set();
  for (const p of partners) {
    try {
      if (applyContent(repos, p.type, p.id, src)) changedTypes.add(p.type);
    } catch (e) {
      console.error('[link-sync] 반영 실패', p, e);
    }
  }
  changedTypes.forEach((t) => broadcastDataChanged(t));
}

module.exports = { scheduleContentSync };

// 빠른 자체 점검:  node main/link-sync.js
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(htmlToPlain('줄1<div>줄2</div><div>줄3</div>'), '줄1\n줄2\n줄3');
  assert.strictEqual(htmlToPlain('a<br>b'), 'a\nb');
  assert.strictEqual(htmlToPlain('<b>굵게</b> &amp; &lt;tag&gt;'), '굵게 & <tag>');
  assert.strictEqual(plainToHtml('a\nb & <c>'), 'a<br>b &amp; &lt;c&gt;');
  // plain→HTML→plain 왕복 안정성(무한 프롬프트 방지의 핵심)
  assert.strictEqual(htmlToPlain(plainToHtml('한\n두 & 셋')), '한\n두 & 셋');
  // needsUpdate: 포스트잇은 제목 전파 안 함, 본문 다르면 true
  assert.strictEqual(needsUpdate({ title: 'T', body: 'x', html: null }, { title: '', body: 'x', html: null }, 'postit'), false);
  assert.strictEqual(needsUpdate({ title: 'T', body: 'x', html: null }, { title: '', body: 'x', html: null }, 'todo'), true);
  assert.strictEqual(needsUpdate({ title: '', body: 'x', html: null }, { title: 'Z', body: 'x', html: null }, 'todo'), false);
  assert.strictEqual(needsUpdate({ title: 'T', body: 'x', html: null }, { title: 'T', body: 'y', html: null }, 'todo'), true);
  // memo↔postit: 텍스트 같아도 서식 HTML이 다르면 동기화 대상, 둘 다 같으면 아님
  assert.strictEqual(needsUpdate({ title: '', body: 'x', html: '<b>x</b>' }, { title: '', body: 'x', html: 'x' }, 'postit'), true);
  assert.strictEqual(needsUpdate({ title: '', body: 'x', html: '<b>x</b>' }, { title: '', body: 'x', html: '<b>x</b>' }, 'postit'), false);
  // 한쪽이 평문 타입(html:null)이면 richDiff 무시(텍스트만 비교)
  assert.strictEqual(needsUpdate({ title: '', body: 'x', html: null }, { title: '', body: 'x', html: '<b>x</b>' }, 'postit'), false);
  // RICH_MARKERS: 서식/체크박스/사진은 잡고, 평문+<div>/<br> 구조는 안 잡는다
  assert.ok(RICH_MARKERS.test('<input type="checkbox">할 일'));
  assert.ok(RICH_MARKERS.test('<b>굵게</b>'));
  assert.ok(RICH_MARKERS.test('<span style="color:#ff0000">빨강</span>'));
  assert.ok(RICH_MARKERS.test('<img data-attachment-id="3">'));
  assert.ok(RICH_MARKERS.test('<span class="item-mention" data-type="todo">칩</span>'));
  assert.ok(!RICH_MARKERS.test('그냥 평문<div>다음 줄</div>'));
  assert.ok(!RICH_MARKERS.test('한 줄<br>두 줄'));
  console.log('link-sync self-check OK');
}
