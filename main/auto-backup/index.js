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
const KEEP = 5; // ponytail: 최근 5개만 보관하는 고정 정책. 세대별 보관(일간 7개+주간 4개 등)이 필요해지면 그때 추가

function backupsDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

function pruneOldBackups(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('itda-auto-') && f.endsWith('.db'))
    .sort();
  while (files.length > KEEP) {
    fs.unlinkSync(path.join(dir, files.shift()));
  }
}

async function runBackup(db, settings) {
  const dir = backupsDir();
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

module.exports = { initAutoBackup, backupsDir };
