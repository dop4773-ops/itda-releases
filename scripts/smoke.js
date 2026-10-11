// `npm run smoke` — 앱을 진짜로 띄워서 모든 화면을 한 바퀴 돈다.
// 단위 테스트(npm test)는 계산 로직만 보기 때문에, 변수 선언 한 줄이 빠져 화면이 통째로 오류를 내는 식의
// 사고는 못 잡는다. 여기서는 임시 프로필로 앱을 띄우고(실제 데이터와 무관) 가짜 데이터를 넣은 뒤,
// 각 화면/설정 탭/달력 보기/미니 모드를 열어 보면서 아래 중 하나라도 있으면 실패로 처리한다.
//   - 화면이 "불러오는 중 오류"를 표시
//   - 렌더러의 처리되지 않은 예외 / console.error / 리소스 로드 실패
//   - 앱(메인 프로세스)이 중간에 종료
// 외부 의존성 없이 Electron의 원격 디버깅(CDP) + Node 22 내장 WebSocket만 쓴다.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.join(__dirname, '..');
const electron = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

async function main() {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'itda-smoke-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 테스트 러너가 켜 둔 값이 있으면 앱이 아니라 Node로 떠 버린다
  const child = spawn(electron, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let appLog = '';
  child.stdout.on('data', (d) => (appLog += d));
  child.stderr.on('data', (d) => (appLog += d));
  let exited = null;
  child.on('exit', (code, sig) => (exited = `code=${code} signal=${sig}`));

  const cleanup = () => {
    try {
      child.kill();
    } catch (e) {
      /* 이미 종료 */
    }
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }), 1500);
  };

  try {
    // 1) 메인 창(index.html)의 디버깅 주소가 열릴 때까지 대기
    let target = null;
    for (let i = 0; i < 120 && !target; i += 1) {
      if (exited) throw new Error(`앱이 시작 중 종료됐어요 (${exited})\n${appLog.slice(-1500)}`);
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
      } catch (e) {
        /* 아직 안 열림 */
      }
      if (!target) await sleep(500);
    }
    if (!target) throw new Error(`메인 창을 찾지 못했어요\n${appLog.slice(-1500)}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('디버깅 연결 실패'));
    });
    let nextId = 1;
    const pending = new Map();
    const problems = []; // { at, text }
    let currentStep = '시작';
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        problems.push({ at: currentStep, text: `예외: ${d.exception?.description || d.text}` });
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        problems.push({ at: currentStep, text: `console.error: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}` });
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        problems.push({ at: currentStep, text: `로그 오류: ${m.params.entry.text} ${m.params.entry.url || ''}`.slice(0, 300) });
      }
    };
    const send = (method, params = {}) =>
      new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(`평가 실패: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
      return r.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Log.enable');

    // 2) 앱이 준비될 때까지 (preload의 window.itda + 화면 뼈대)
    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      ready = await evaluate(`!!(window.itda && document.getElementById('view-root'))`).catch(() => false);
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error(`앱 화면이 준비되지 않았어요\n${appLog.slice(-1500)}`);
    await sleep(800);
    problems.length = 0; // 시작 단계의 잡음은 무시하고, 이후 단계부터 본다

    // 3) 가짜 데이터 — 비어 있는 화면만 보면 데이터가 있을 때만 나는 오류를 놓친다
    currentStep = '가짜 데이터 넣기';
    await evaluate(`(async () => {
      const pad = (n) => String(n).padStart(2, '0');
      const key = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
      const cat = await window.itda.categories.add({ name: '스모크', colorHex: '#6C8EF5' }).catch(() => null);
      const categoryId = cat && (cat.id ?? cat.lastInsertRowid);
      const ev = (title, d, h, extra = {}) => window.itda.events.add({ title, startAt: day(d) + ' ' + pad(h) + ':00:00', endAt: day(d) + ' ' + pad(h) + ':50:00', allDay: false, categoryId, ...extra });
      const range = (title, a, b) => window.itda.events.add({ title, startAt: day(a) + ' 00:00:00', endAt: day(b) + ' 23:59:59', allDay: true });
      // 이번 주(일~토) 안에서 항상 엇갈리게: 2일 휴가(월~화) + 3일 휴가(화~목). 수·목요일에는 첫 줄이 비어 있어도
      // 3일 휴가가 같은 줄에 있어야 한다 — 오늘 요일과 상관없이 이번 주 줄은 달력에 항상 보인다.
      const sun = -new Date().getDay();
      await range('2일 휴가', sun + 1, sun + 2);
      await range('3일 휴가', sun + 2, sun + 4);
      for (let i = 0; i < 7; i += 1) await ev('같은 날 일정 ' + (i + 1), 0, 8 + i);
      await ev('지금 회의', 0, Math.max(0, new Date().getHours() - 1), { location: '회의실', memo: '첫 줄\\n둘째 줄' });
      await ev('오늘 오후', 0, 23);
      await window.itda.todos.add({ title: '오늘 마감', dueDate: day(0), priority: 1 });
      await window.itda.todos.add({ title: '시간 마감', dueDate: day(0), dueTime: '23:30' });
      await window.itda.todos.add({ title: '지난 할 일', dueDate: day(-3) });
      await window.itda.todos.add({ title: '날짜 없는 할 일' });
      await window.itda.memos.add({ title: '스모크 메모', content: '내용 #태그 본문', categoryId });
      await window.itda.postits.add({ content: '포스트잇 내용', colorHex: '#FFE98A' });
      await window.itda.inbox.add('인박스 메모 한 줄');
      return true;
    })()`);
    await sleep(500);

    // 한 단계를 실행하고, 그 사이 새로 생긴 문제와 화면 오류 문구를 함께 점검한다
    const results = [];
    const step = async (name, fn, settleMs = 700) => {
      currentStep = name;
      const before = problems.length;
      let failure = null;
      try {
        await fn();
        await sleep(settleMs);
        const bad = await evaluate(`(() => { const t = document.getElementById('view-root')?.innerText || ''; return /화면을 불러오는 중 오류/.test(t) ? t.slice(0, 200) : ''; })()`);
        if (bad) failure = `화면 오류 문구: ${bad.replace(/\s+/g, ' ')}`;
      } catch (e) {
        failure = e.message;
      }
      const fresh = problems.slice(before).filter((p) => p.at === name);
      if (fresh.length) failure = [failure, ...fresh.map((p) => p.text)].filter(Boolean).join(' | ');
      if (exited) failure = `앱이 종료됐어요 (${exited})`;
      results.push({ name, failure });
      console.log(`${failure ? '✗' : '✓'} ${name}${failure ? `\n    ${failure}` : ''}`);
    };
    const go = (hash) => () => evaluate(`(async () => { location.hash = ${JSON.stringify(hash)}; return true; })()`);
    const click = (selector) => () => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('요소 없음: ' + ${JSON.stringify(selector)}); e.click(); return true; })()`);

    // 4) 모든 화면
    for (const [hash, label] of [
      ['#/dashboard', '대시보드'],
      ['#/today', '오늘'],
      ['#/inbox', 'Inbox'],
      ['#/todo', 'Todo'],
      ['#/calendar', '일정'],
      ['#/memo', '메모'],
      ['#/postit', '포스트잇'],
      ['#/search', '검색'],
      ['#/trash', '휴지통'],
    ]) {
      await step(`화면: ${label}`, go(hash), 1000);
    }

    // 5) 일정: 월/주/일 + 이전/다음 + 구글 토글(연결 안 돼도 화면은 그려져야 함)
    await step('일정 화면 열기', go('#/calendar'), 900);
    for (const view of ['week', 'day', 'month']) await step(`일정 보기: ${view}`, click(`.tab[data-view="${view}"]`), 700);
    await step('일정: 다음 달', click('#c-next'));
    await step('일정: 이전 달', click('#c-prev'));
    await step('일정: 오늘', click('#c-today'));
    // 달력 막대 정렬 — 여러 날 일정은 연속된 칸에서 같은 줄(top)에 있어야 한다
    await step('일정: 월간 막대 정렬', async () => {
      const bad = await evaluate(`(() => {
        const cells = [...document.querySelectorAll('.month-cell[data-date]')];
        const byEvent = new Map();
        cells.forEach((c) => c.querySelectorAll('.month-event-pill.is-span').forEach((p) => {
          if (p.classList.contains('is-spacer')) return;
          const k = p.dataset.id; const top = Math.round(p.getBoundingClientRect().top);
          const week = Math.round(c.getBoundingClientRect().top);
          const key = k + '@' + week;
          if (!byEvent.has(key)) byEvent.set(key, new Set());
          byEvent.get(key).add(top);
        }));
        return [...byEvent.entries()].filter(([, s]) => s.size > 1).map(([k]) => k).join(',');
      })()`);
      const spans = await evaluate(`document.querySelectorAll('.month-event-pill.is-span:not(.is-spacer)').length`);
      if (!spans) throw new Error('여러 날 일정 막대가 하나도 안 보여요(가짜 데이터가 안 들어갔거나 그려지지 않음)');
      if (bad) throw new Error(`이어지는 일정 막대가 칸마다 다른 높이에 있어요: ${bad}`);
      const scroll = await evaluate(`(() => { const g = document.getElementById('c-gridArea'); return g ? g.scrollHeight - g.clientHeight : 0; })()`);
      if (scroll > 1) throw new Error(`월간 달력에 스크롤이 생겼어요 (${scroll}px)`);
    });

    // 6) 설정의 모든 탭
    await step('화면: 설정', go('#/settings'), 900);
    const tabs = await evaluate(`[...document.querySelectorAll('.settings-tab[data-tab]')].map((b) => b.dataset.tab)`);
    for (const t of tabs) await step(`설정 탭: ${t}`, click(`.settings-tab[data-tab="${t}"]`), 500);

    // 7) 오늘 화면 조작: 전날/다음 날/오늘 + 상단 카드 팝업
    await step('오늘 화면 열기', go('#/today'), 900);
    await step('오늘: 전날', click('#td-prevDay'));
    await step('오늘: 다음 날', click('#td-nextDay'));
    await step('오늘: 팝업(일정 카드)', click('.td-stat[data-pop="events"]'));
    await evaluate(`document.getElementById('tdp-close')?.click()`);

    // 8) 미니 모드 켜고 끄기
    await step('미니 모드 켜기', click('#miniBtn'), 1800);
    await step('미니 모드: 오늘 화면', async () => {
      const mini = await evaluate(`document.body.classList.contains('mini-mode')`);
      if (!mini) throw new Error('미니 모드가 켜지지 않았어요');
    });
    await step('미니 모드 끄기', click('#mini-expand'), 1800);

    console.log(`\n${results.filter((r) => !r.failure).length}/${results.length} 단계 통과`);
    const failed = results.filter((r) => r.failure);
    // 단계에 묶이지 않은 늦은 오류도 함께 보고
    const stray = problems.filter((p) => !results.some((r) => r.name === p.at));
    stray.forEach((p) => console.log(`  (단계 밖) ${p.at}: ${p.text}`));
    ws.close();
    cleanup();
    process.exit(failed.length || stray.length ? 1 : 0);
  } catch (e) {
    console.error(`스모크 테스트 중단: ${e.message}`);
    cleanup();
    process.exit(1);
  }
}

main();
