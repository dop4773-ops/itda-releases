// CCRT명단 엑셀 읽기 — 합성 xlsx(deflate 압축 zip)로 시트 찾기·월별 평가일·이름 가림 검증. 이름은 모두 가상.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

let loaded;
const load = () =>
  (loaded ||= import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../renderer/shared/ccrt-xlsx.js')).toString('base64')));

// 최소 zip 작성기(CRC는 읽기 쪽이 보지 않아 0) — files: { 경로: 문자열 }
function zip(files) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = Buffer.from(name);
    const data = zlib.deflateRawSync(Buffer.from(text));
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, data);
    central.push(ch, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  const all = Buffer.concat([...parts, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

const serial = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 864e5);
// 공유 문자열 0..: 머리글/이름 등
const STR = ['2026년', '병실', '환자이름', 'RM', '1월', '2월', '3월', '4월', '5월', '6월', '10월', '홍길동', '김순자E', '미실시', '가나', '둘'];
const s = (t) => STR.indexOf(t);
const cs = (ref, t) => `<c r="${ref}" t="s"><v>${s(t)}</v></c>`;
const cn = (ref, v) => `<c r="${ref}"><v>${v}</v></c>`;
function book(sheetName = 'CCRT명단') {
  const sheet = `<worksheet><sheetData>
    <row r="1">${cs('B1', '2026년')}</row>
    <row r="2">${cs('B2', '병실')}${cs('C2', '환자이름')}${cs('D2', 'RM')}${['4월', '5월', '6월', '10월'].map((m, i) => cs(`${'EFGH'[i]}2`, m)).join('')}${['1월', '2월', '3월'].map((m, i) => cs(`${'IJK'[i]}2`, m)).join('')}</row>
    <row r="3">${cn('B3', 908)}${cs('C3', '홍길동')}${cn('D3', 6)}${cn('H3', serial('2026-10-02'))}${cs('K3', '미실시')}</row>
    <row r="4">${cn('B4', 903)}${cs('C4', '김순자E')}${cs('D4', 'RM')}${cn('H4', serial('2026-10-20'))}${cn('G4', serial('2026-06-09'))}</row>
    <row r="5">${cs('C5', '가나')}${cn('H5', serial('2026-10-07'))}</row>
    <row r="6">${cs('B6', '가나')}${cn('H6', serial('2026-10-14'))}</row>
    <row r="7">${cn('B7', 801)}${cs('C7', '둘')}${cn('H7', serial('2026-11-03'))}</row>
  </sheetData></worksheet>`;
  const strings = `<sst>${STR.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`;
  return zip({
    'xl/workbook.xml': `<workbook><sheets><sheet name="평가일정" sheetId="1" r:id="rId1"/><sheet name="${sheetName}" sheetId="6" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/sharedStrings.xml': strings,
    'xl/worksheets/sheet3.xml': sheet,
  });
}

test('시트 찾기·머리글 → 환자별 월 평가일(엑셀 날짜 숫자 → YYYY-MM-DD), 텍스트 칸은 메모로', async () => {
  const { readCcrtSheet } = await load();
  const r = await readCcrtSheet(book());
  assert.equal(r.ok, true);
  assert.equal(r.year, 2026);
  assert.equal(r.sheet, 'CCRT명단');
  assert.equal(r.patients.length, 4); // 이름 없는 줄(6행)은 제외
  const p = r.patients[0];
  assert.deepEqual([p.name, p.room, p.rm, p.dates[10], p.notes[3]], ['홍길동', '908', '6', '2026-10-02', '미실시']);
});

test('같은 날은 한 일정으로 묶어 "이름,이름 COSAS", 날짜순, 이름 표시 3단계, 다른 달 날짜는 건너뜀', async () => {
  const { readCcrtSheet, ccrtRowsForMonth } = await load();
  const r = await readCcrtSheet(book());
  // 10/7에 가나·(이름없는 줄 제외)…: 한 명만 있는 날도 그대로. 날짜를 겹치게 한 환자는 별도 케이스로 아래에서 확인
  const full = ccrtRowsForMonth(r, 2026, 10);
  assert.deepEqual(full.rows.map((x) => `${x.date} ${x.title}`), ['2026-10-02 홍길동 COSAS', '2026-10-07 가나 COSAS', '2026-10-20 김순자E COSAS']);
  assert.deepEqual(full.skipped, ['둘: 2026-11-03(선택한 달이 아님)']);
  assert.equal(ccrtRowsForMonth(r, 2026, 10, 'mask').rows[0].title, '홍○동 COSAS');
  assert.equal(ccrtRowsForMonth(r, 2026, 10, 'mask').rows[2].title, '김○자E COSAS');
  assert.equal(ccrtRowsForMonth(r, 2026, 10, 'hide').rows[0].title, 'COSAS 1명');
  const mar = ccrtRowsForMonth(r, 2026, 3);
  assert.equal(mar.rows.length, 0);
  assert.deepEqual(mar.skipped, ['홍길동: 미실시']);

  // 같은 날 2명 → "홍길동,김순자E COSAS" (엑셀 줄 순서)
  const same = { patients: [{ name: '홍길동', dates: { 10: '2026-10-20' }, notes: {} }, { name: '김순자E', dates: { 10: '2026-10-20' }, notes: {} }] };
  const g = ccrtRowsForMonth(same, 2026, 10);
  assert.deepEqual(g.rows, [{ date: '2026-10-20', count: 2, title: '홍길동,김순자E COSAS' }]);
  assert.equal(ccrtRowsForMonth(same, 2026, 10, 'hide').rows[0].title, 'COSAS 2명');
});

test('CCRT 시트가 없거나 엑셀이 아니면 이유를 돌려준다', async () => {
  const { readCcrtSheet } = await load();
  const no = await readCcrtSheet(book('다른시트'));
  assert.equal(no.ok, false);
  assert.match(no.reason, /CCRT명단/);
  await assert.rejects(readCcrtSheet(new TextEncoder().encode('not a zip file at all, just text'.repeat(3)).buffer), /엑셀/);
});
