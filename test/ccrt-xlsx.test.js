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

// ---- 현황(회복기) 시트 → 비회복기 전환 일정 ----
const STR2 = ['순번', '구분', '진료과', '병실', '성명', '입원일', '회복기 기간\n(180일)', '입원', '특이사항', '뇌손상', 'MSK 60', '일반', 'RM7', '가나다', '라마바', '사아자', '차카타', '입원', '퇴원', '재입원', '-'];
const t2 = (x) => STR2.indexOf(x);
const c2 = (ref, x) => `<c r="${ref}" t="s"><v>${t2(x)}</v></c>`;
function statusBook(sheetName = '현황(회복기)') {
  const row = (r, kind, name, admit, end, st) =>
    `<row r="${r}">${cn(`B${r}`, r - 2)}${c2(`C${r}`, kind)}${c2(`D${r}`, 'RM7')}${cn(`E${r}`, 701)}${c2(`F${r}`, name)}${cn(`G${r}`, serial(admit))}${end ? cn(`H${r}`, serial(end)) : c2(`H${r}`, '-')}${c2(`I${r}`, st)}</row>`;
  const sheet = `<worksheet><sheetData>
    <row r="1">${c2('B1', '뇌손상')}</row>
    <row r="2">${['순번', '구분', '진료과', '병실', '성명', '입원일', '회복기 기간\n(180일)', '입원', '특이사항'].map((h, i) => c2(`${'BCDEFGHIJ'[i]}2`, h)).join('')}</row>
    ${row(3, '뇌손상', '가나다', '2026-04-23', '2026-10-20', '입원')}
    ${row(4, 'MSK 60', '라마바', '2026-08-21', '2026-10-20', '재입원')}
    ${row(5, '뇌손상', '사아자', '2026-04-10', '2026-10-07', '퇴원')}
    ${row(6, '일반', '차카타', '2026-09-01', null, '입원')}
    ${row(7, '뇌손상', '가나다', '2026-05-10', '2026-11-06', '입원')}
  </sheetData></worksheet>`;
  return zip({
    'xl/workbook.xml': `<workbook><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${STR2.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': sheet,
  });
}

test('현황 시트: 머리글 → 환자별 구분·상태·회복기 종료일(없는 일반 환자는 빈 값)', async () => {
  const { readStatusSheet } = await load();
  const r = await readStatusSheet(statusBook());
  assert.equal(r.ok, true);
  assert.equal(r.patients.length, 5);
  assert.deepEqual(
    r.patients.map((p) => [p.kind, p.status, p.end]),
    [['뇌손상', '입원', '2026-10-20'], ['MSK 60', '재입원', '2026-10-20'], ['뇌손상', '퇴원', '2026-10-07'], ['일반', '입원', ''], ['뇌손상', '입원', '2026-11-06']]
  );
});

test('비회복기 전환: 그 달 종료일의 입원·재입원 환자만, 날짜별 "비회복기 전환(N명)", 이름은 메모', async () => {
  const { readStatusSheet, statusRowsForMonth } = await load();
  const r = await readStatusSheet(statusBook());
  const full = statusRowsForMonth(r, 2026, 10);
  assert.deepEqual(full.rows, [{ date: '2026-10-20', count: 2, title: '비회복기 전환(2명)', memo: '가나다(뇌손상), 라마바(MSK 60)' }]);
  assert.equal(full.notAdmitted, 1); // 10/7 종료인데 이미 퇴원
  const mask = statusRowsForMonth(r, 2026, 10, 'mask');
  assert.equal(mask.rows[0].memo, '가○다(뇌손상), 라○바(MSK 60)');
  assert.equal(statusRowsForMonth(r, 2026, 10, 'hide').rows[0].memo, '');
  assert.equal(statusRowsForMonth(r, 2026, 10, 'hide').rows[0].title, '비회복기 전환(2명)');
  assert.deepEqual(statusRowsForMonth(r, 2026, 11).rows.map((x) => x.title), ['비회복기 전환(1명)']);
  assert.equal(statusRowsForMonth(r, 2026, 9).rows.length, 0);
});

test('현황 시트가 없으면 이유를 돌려주고, CCRT 파일과 서로 영향 없음', async () => {
  const { readStatusSheet, readCcrtSheet } = await load();
  const no = await readStatusSheet(statusBook('다른시트'));
  assert.equal(no.ok, false);
  assert.match(no.reason, /현황/);
  assert.equal((await readCcrtSheet(statusBook())).ok, false); // 현황 파일은 CCRT로는 안 읽힘(각자 시트를 찾는다)
  assert.equal((await readStatusSheet(book())).ok, false);
});
