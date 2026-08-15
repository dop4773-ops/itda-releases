/**
 * renderer/shared/date-quick-chips.js
 *
 * <input type="date">(또는 datetime-local) 옆에 "오늘/내일/이번 주/다음 주/날짜 선택" 칩을
 * 붙여서, 매번 네이티브 달력을 열지 않고도 흔한 날짜를 한 번의 클릭으로 지정할 수 있게 한다.
 * Todo 상세 패널·일정 등록 모달에서 재사용(중복 구현 안 함).
 */
import { todayStr, dateKey, addDays, startOfWeek } from './date-utils.js';

function quickDateOptions() {
  const today = new Date();
  const sunday = startOfWeek(today); // 이번 주 일요일(달력 위젯과 동일한 주 시작 기준)
  let friday = addDays(sunday, 5);
  if (dateKey(friday) <= todayStr()) friday = addDays(friday, 7); // 이미 지난 금요일이면 다음 주로
  const nextMonday = addDays(sunday, 8);
  return [
    { label: '오늘', value: todayStr() },
    { label: '내일', value: dateKey(addDays(today, 1)) },
    { label: '이번 주', value: dateKey(friday) },
    { label: '다음 주', value: dateKey(nextMonday) },
  ];
}

/**
 * @param {HTMLInputElement} inputEl - type="date" 또는 "datetime-local" 인풋
 * @returns {HTMLElement} 삽입된 칩 컨테이너(필요하면 나중에 remove() 가능)
 */
export function attachDateQuickChips(inputEl) {
  const wrap = document.createElement('div');
  wrap.className = 'date-quick-chips';
  wrap.innerHTML =
    quickDateOptions()
      .map((o) => `<button type="button" class="date-quick-chip" data-value="${o.value}">${o.label}</button>`)
      .join('') + `<button type="button" class="date-quick-chip" data-action="pick">날짜 선택</button>`;
  inputEl.insertAdjacentElement('afterend', wrap);

  wrap.querySelectorAll('[data-value]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // datetime-local이면 시간 부분(있으면 유지, 없으면 09:00 기본)을 살리고 날짜만 바꾼다
      const time = inputEl.type === 'datetime-local' ? inputEl.value.slice(11) || '09:00' : '';
      inputEl.value = inputEl.type === 'datetime-local' ? `${btn.dataset.value}T${time}` : btn.dataset.value;
      // 이 input에 이미 걸려있는 change/input 리스너(저장, 미리보기 등)가 평소처럼 반응하도록 그대로 흘려보냄
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  wrap.querySelector('[data-action="pick"]').addEventListener('click', () => {
    if (inputEl.showPicker) inputEl.showPicker();
    else inputEl.focus();
  });
  return wrap;
}
