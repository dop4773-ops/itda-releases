/**
 * main/auto-backup/index.js
 *
 * 자동 백업 — 다른 기능과 결합하지 않는 독립 모듈(trash-cleanup/updater와 동일 원칙).
 * main.js는 initAutoBackup() 한 줄만 호출한다.
 *
 * 설정(app_settings, settings 레포지토리 통해 읽고 씀):
 *   backup_auto_enabled:  '1'|'0' — 값이 없으면(신규 설치) 켜진 것으로 취급 (다른 토글들과 동일한 관례)
 *   backup_auto_period:   'daily'|'weekly'|'monthly' — 기본 'daily'
 *   backup_auto_time:     'HH:MM' 예정 시각 — 기본 '03:00'
 *   backup_auto_weekday:  0(일)~6(토) — period가 weekly일 때만 사용, 기본 0
 *   backup_auto_monthday: 1~31 — period가 monthly일 때만 사용, 기본 1 (그 달에 없는 날짜면 말일로 보정)
 *   backup_last_at:       마지막 자동 백업 시각 (ISO 문자열) — 설정 화면 표시용
 *   backup_auto_dir:      자동 백업 저장 폴더 — 비어있으면 userData/backups (설정 화면에서 변경)
 *
 * CHECK_INTERVAL_MS 주기로 재점검해서, 예정 시각(+요일/날짜)이 지났고 아직 이번 주기에
 * 백업한 적 없으면 userData/backups 폴더에 타임스탬프 파일로 백업하고 최근 KEEP개만 남긴다
 * (수동 백업/복원처럼 파일 선택 대화상자는 띄우지 않음).
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const PERIOD_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000 };
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // ponytail: 10분 단위 정밀도가 상한선. 더 정확한 시각이 필요하면 이 값을 줄이면 됨
// 보관 정책: 최근 RECENT_KEEP개는 전부 + 그보다 오래된 건 주마다 하나씩 최근 WEEKLY_KEEP주치 — 매일 백업이면 약 5주 전까지 돌아갈 수 있다.
const RECENT_KEEP = 7;
const WEEKLY_KEEP = 4;
const PREMIGRATE_KEEP = 3; // DB 구조를 바꾸는 업데이트 직전 백업은 따로 최근 3개만

function defaultBackupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

// settings를 넘기면 사용자가 지정한 폴더(backup_auto_dir)를 쓰고, 없거나 만들 수 없으면 기본 위치로 폴백.
function backupsDir(settings) {
  const custom = settings?.get?.('backup_auto_dir');
  const dir = custom && custom.trim() ? custom.trim() : defaultBackupsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (err) {
    const fallback = defaultBackupsDir();
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

// 오늘 예정 시각(+주간이면 요일, 월간이면 날짜)이 이미 지났는지 판단.
// 31일처럼 그 달에 없는 날짜는 말일로 보정한다(예: 2월엔 28/29일에 실행).
function isDueNow(period, timeStr, weekday, monthday, now) {
  const [h, m] = (timeStr || '03:00').split(':').map(Number);
  const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (now < scheduledToday) return false;
  if (period === 'weekly') return now.getDay() === weekday;
  if (period === 'monthly') {
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return now.getDate() === Math.min(monthday, lastDayOfMonth);
  }
  return true;
}

// 파일명 itda-auto-2026-10-07T03-00-00-000Z.db → 그 주 월요일 날짜('2026-10-05'). 읽을 수 없으면 null.
function weekKeyOf(name) {
  const m = /^itda-auto-(\d{4})-(\d{2})-(\d{2})T/.exec(name);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000);
  return monday.toISOString().slice(0, 10);
}

// 지울 파일 이름들을 돌려준다(순수 함수). 이름을 해석 못 하는 파일은 건드리지 않는다.
function selectBackupsToDelete(names) {
  const sorted = [...names].sort();
  const older = sorted.slice(0, Math.max(0, sorted.length - RECENT_KEEP));
  const newestOfWeek = new Map();
  older.forEach((n) => weekKeyOf(n) && newestOfWeek.set(weekKeyOf(n), n)); // 오름차순이라 같은 주에선 뒤(최신)가 이긴다
  const keepWeekly = new Set([...newestOfWeek.entries()].sort().slice(-WEEKLY_KEEP).map(([, n]) => n));
  return older.filter((n) => weekKeyOf(n) && !keepWeekly.has(n));
}

function pruneOldBackups(dir) {
  const names = fs.readdirSync(dir).filter((f) => f.startsWith('itda-auto-') && f.endsWith('.db'));
  selectBackupsToDelete(names).forEach((n) => fs.unlinkSync(path.join(dir, n)));
}

// DB 구조(user_version)를 올리는 마이그레이션 직전에 db.js가 부른다. VACUUM INTO는 동기식이고
// WAL에 남은 최신 데이터까지 일관되게 담는다. 실패해도 앱 시작은 막지 않는다(로그만).
function backupBeforeMigration(db, fromVersion, dir = defaultBackupsDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    db.prepare('VACUUM INTO ?').run(path.join(dir, `itda-premigrate-v${fromVersion}-${stamp}.db`));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('itda-premigrate-') && f.endsWith('.db')).sort();
    files.slice(0, Math.max(0, files.length - PREMIGRATE_KEEP)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    console.log('[itda] 마이그레이션 전 백업 완료 (v' + fromVersion + ')');
  } catch (err) {
    console.error('[itda] 마이그레이션 전 백업 실패(계속 진행):', err.message);
  }
}

async function runBackup(db, settings) {
  const dir = backupsDir(settings);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await db.backup(path.join(dir, `itda-auto-${stamp}.db`));
  settings.set('backup_last_at', new Date().toISOString());
  pruneOldBackups(dir);
}

function initAutoBackup(db, settings) {
  async function tick() {
    if (settings.get('backup_auto_enabled') === '0') return;
    const period = PERIOD_MS[settings.get('backup_auto_period')] ? settings.get('backup_auto_period') : 'daily';
    const last = settings.get('backup_last_at');
    // 이번 주기 안에 이미 백업했으면(재점검 간격만큼 여유를 둠) 다시 하지 않음
    if (last && Date.now() - new Date(last).getTime() < PERIOD_MS[period] - CHECK_INTERVAL_MS) return;

    const time = settings.get('backup_auto_time') || '03:00';
    const weekday = Number(settings.get('backup_auto_weekday') ?? 0);
    const monthday = Number(settings.get('backup_auto_monthday') ?? 1);
    if (!isDueNow(period, time, weekday, monthday, new Date())) return;

    try {
      await runBackup(db, settings);
      console.log('[itda] 자동 백업 완료');
    } catch (err) {
      console.error('[itda] 자동 백업 실패:', err);
    }
  }

  tick(); // 시작 시 1회 점검
  setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { initAutoBackup, backupsDir, selectBackupsToDelete, backupBeforeMigration };
