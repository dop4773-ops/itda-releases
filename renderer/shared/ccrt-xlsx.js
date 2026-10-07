/**
 * "CCRT명단" 엑셀 시트 → 월별 평가일 목록. 외부 라이브러리 없이 xlsx(zip+XML)를 직접 읽는다(브라우저/Node 공용).
 * 시트 모양: 헤더 행에 '환자이름'·'병실'·'RM'과 '1월'~'12월', 아래로 환자별 한 줄, 월 칸의 값이 그 달 평가일(엑셀 날짜 숫자).
 */
const dec = new TextDecoder();
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// zip → { 경로: () => Promise<문자열> }  (중앙 디렉터리를 읽어 필요한 파일만 푼다)
function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('엑셀(.xlsx) 파일이 아니에요');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = async () => {
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + csize);
      return dec.decode(method === 0 ? raw : await inflateRaw(raw));
    };
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

const colNum = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);

// 시트 → rows[행번호][열번호] = 문자열 | 숫자
function parseSheet(xml, shared) {
  const rows = {};
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+)(\d+)"/.exec(m[1]);
    const body = m[2] || '';
    const type = (/\bt="(\w+)"/.exec(m[1]) || [])[1];
    const raw = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
    let val;
    if (type === 'inlineStr') val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
    else if (raw === undefined) continue;
    else if (type === 's') val = shared[+raw];
    else if (type === 'str') val = unxml(raw);
    else if (type === 'b' || type === 'e') continue;
    else val = Number(raw);
    if (val === '' || val === undefined || Number.isNaN(val)) continue;
    (rows[+ref[2]] ||= {})[colNum(ref[1])] = val;
  }
  return rows;
}

// 가운데 글자를 ○로 가린다(main/messenger/format.js의 maskName과 같은 규칙). 엑셀의 동명이인 구분 글자("김순자E")는 그대로 둔다.
const maskName = (n) => {
  const [, base, tail = ''] = /^(.*?)([A-Za-z0-9]*)$/.exec(String(n).trim());
  const c = [...base];
  return (c.length <= 1 ? c.join('') : c.length === 2 ? `${c[0]}○` : `${c[0]}${'○'.repeat(c.length - 2)}${c[c.length - 1]}`) + tail;
};

/**
 * @returns {{ ok:false, reason } | { ok:true, year, sheet, patients:[{name, room, rm, dates:{1..12: 'YYYY-MM-DD'}, notes:{월: 원문}}] }}
 */
export async function readCcrtSheet(buf) {
  const zip = await readZip(buf);
  if (!zip['xl/workbook.xml']) return { ok: false, reason: '엑셀(.xlsx) 파일이 아니에요.' };
  const wb = await zip['xl/workbook.xml']();
  const rels = await zip['xl/_rels/workbook.xml.rels']();
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: unxml((/\bname="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid: (/\br:id="([^"]*)"/.exec(m[0]) || [])[1] }));
  const sheet = sheets.find((s) => /CCRT/i.test(s.name));
  if (!sheet) return { ok: false, reason: `"CCRT명단" 시트를 찾지 못했어요. (시트: ${sheets.map((s) => s.name).join(', ') || '없음'})` };
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => new RegExp(`\\bId="${sheet.rid}"`).test(t));
  const target = rel && /\bTarget="([^"]*)"/.exec(rel)[1];
  const path = target && (target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!path || !zip[path]) return { ok: false, reason: '시트 내용을 찾지 못했어요.' };

  let shared = [];
  if (zip['xl/sharedStrings.xml']) {
    const ss = await zip['xl/sharedStrings.xml']();
    shared = [...ss.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => unxml([...(m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  }
  const rows = parseSheet(await zip[path](), shared);

  // 헤더 행: "n월" 칸이 6개 이상 있는 행
  const headRow = Object.keys(rows).map(Number).sort((a, b) => a - b).find((r) => Object.values(rows[r]).filter((v) => /^\d{1,2}월$/.test(String(v).trim())).length >= 6);
  if (!headRow) return { ok: false, reason: '"1월~12월" 머리글이 있는 줄을 찾지 못했어요.' };
  const head = rows[headRow];
  const colOf = (re) => Number(Object.keys(head).find((c) => re.test(String(head[c]).trim())));
  const monthCol = {};
  Object.keys(head).forEach((c) => {
    const m = /^(\d{1,2})월$/.exec(String(head[c]).trim());
    if (m) monthCol[+m[1]] = +c;
  });
  const nameC = colOf(/이름/);
  const roomC = colOf(/병실/);
  const rmC = colOf(/^RM/i);
  if (!nameC) return { ok: false, reason: '"환자이름" 칸을 찾지 못했어요.' };
  const year = Number((/(\d{4})\s*년/.exec(Object.values(rows[1] || {}).join(' ')) || [])[1]) || new Date().getFullYear();

  const patients = [];
  Object.keys(rows).map(Number).filter((r) => r > headRow).sort((a, b) => a - b).forEach((r) => {
    const row = rows[r];
    const name = String(row[nameC] ?? '').trim();
    if (!name) return;
    const p = { name, room: roomC ? String(row[roomC] ?? '').trim() : '', rm: rmC ? String(row[rmC] ?? '').trim() : '', dates: {}, notes: {} };
    for (const [m, c] of Object.entries(monthCol)) {
      const v = row[c];
      if (v === undefined) continue;
      if (typeof v === 'number' && v > 30000 && v < 80000) p.dates[m] = serialToDate(v);
      else p.notes[m] = String(v).trim();
    }
    patients.push(p);
  });
  return { ok: true, year, sheet: sheet.name, patients };
}

/**
 * 그 달에 평가일이 있는 환자 → 날짜별 일정 후보 [{date, title, count}] (날짜순).
 * 같은 날 여러 명이면 한 일정으로 묶어 제목은 "김기범,홍길동 COSAS"(엑셀 줄 순서). nameMode: 'full' | 'mask' | 'hide'(→ "COSAS 2명")
 */
export function ccrtRowsForMonth(parsed, year, month, nameMode = 'full') {
  const byDate = {};
  const skipped = [];
  for (const p of parsed.patients) {
    const date = p.dates[month];
    if (!date) {
      if (p.notes[month]) skipped.push(`${p.name}: ${p.notes[month]}`);
      continue;
    }
    if (!date.startsWith(`${year}-${String(month).padStart(2, '0')}-`)) {
      skipped.push(`${p.name}: ${date}(선택한 달이 아님)`);
      continue;
    }
    (byDate[date] ||= []).push(nameMode === 'mask' ? maskName(p.name) : p.name);
  }
  const rows = Object.keys(byDate)
    .sort()
    .map((date) => ({ date, count: byDate[date].length, title: nameMode === 'hide' ? `COSAS ${byDate[date].length}명` : `${byDate[date].join(',')} COSAS` }));
  return { rows, skipped };
}
