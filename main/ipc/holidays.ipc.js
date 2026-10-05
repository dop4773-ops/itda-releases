const { fetchKoreanHolidays } = require('../holidays/fetch');

const assertYear = (year) => {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('연도가 올바르지 않아요.');
  return y;
};

module.exports = function registerHolidaysIpc(ipcMain, repos) {
  const { holidays, settings } = repos;

  const isAuto = () => settings.get('holiday_auto') !== '0'; // 값이 없으면(신규) 켜짐
  const doneYears = () => {
    try {
      return JSON.parse(settings.get('holiday_auto_years') || '[]');
    } catch {
      return [];
    }
  };

  // 시작할 때 올해(11월부터는 내년도) 공휴일을 받아 "없는 날짜만" 추가. 한 번 받은 연도는
  // holiday_auto_years에 기록해서 다시 받지 않는다 → 사용자가 지우거나 고친 공휴일이 되살아나지 않음.
  // 네트워크가 안 되면(병원 PC 등) 조용히 넘어가고 다음 실행 때 다시 시도.
  async function autoFetchHolidays() {
    if (!isAuto()) return;
    const now = new Date();
    const years = [now.getFullYear(), ...(now.getMonth() >= 10 ? [now.getFullYear() + 1] : [])];
    for (const year of years.filter((y) => !doneYears().includes(y))) {
      try {
        const list = await fetchKoreanHolidays(year);
        const added = holidays.addMissing(list, 'auto');
        settings.set('holiday_auto_years', JSON.stringify([...doneYears(), year]));
        console.log(`[itda] ${year}년 공휴일 자동 불러오기: ${added}건 추가`);
      } catch (err) {
        console.error(`[itda] ${year}년 공휴일 자동 불러오기 실패(다음 실행 때 다시 시도):`, err.message);
      }
    }
  }

  ipcMain.handle('holidays:range', (event, { fromDate, toDate }) => holidays.range(fromDate, toDate));
  ipcMain.handle('holidays:listYear', (event, year) => holidays.listYear(assertYear(year)));
  // 미리보기용 — DB에는 저장하지 않고 인터넷에서 받아온 목록만 돌려준다
  ipcMain.handle('holidays:fetchYear', (event, year) => fetchKoreanHolidays(assertYear(year)));
  ipcMain.handle('holidays:saveMany', (event, list) => ({ added: holidays.addMissing(Array.isArray(list) ? list : [], 'auto') }));
  ipcMain.handle('holidays:add', (event, { date, name }) => holidays.add(date, name));
  ipcMain.handle('holidays:rename', (event, { date, name }) => holidays.rename(date, name));
  ipcMain.handle('holidays:remove', (event, date) => holidays.remove(date));
  ipcMain.handle('holidays:getAuto', () => isAuto());
  ipcMain.handle('holidays:setAuto', (event, on) => {
    settings.set('holiday_auto', on ? '1' : '0');
    return isAuto();
  });

  return { autoFetchHolidays };
};
