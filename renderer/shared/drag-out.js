/**
 * 리스트의 "드래그 핸들" 아이콘에 붙이는 헬퍼.
 * 실제 HTML5 Drag API 대신 mousedown → mousemove → mouseup을 직접 추적하는 이유:
 * Electron 창 밖(=바탕화면)으로 나가면 HTML5 drop 이벤트가 아예 발생하지 않기 때문에,
 * "버튼을 누른 채 메인 윈도우 경계 밖에서 뗐는지"를 화면 절대좌표(screenX/Y)로 직접 판정한다.
 * 짧게 클릭만 한 경우(threshold 이내로 움직임)는 아무 동작 없이 끝나서 기존 클릭 동작과 충돌하지 않는다.
 *
 * ⚠️ 알려진 한계: 표준 웹 마우스 이벤트(mousemove/mouseup)는 커서가 실제로 창 경계를
 * 완전히 벗어나면 그 창(렌더러)으로 더 이상 전달되지 않는다(OS/브라우저 공통 동작,
 * 네이티브 전역 마우스 후킹 없이는 못 바꿈). 즉 "창 밖으로 드래그해서 거기서 마우스를 뗀" 경우
 * 진짜 mouseup 이벤트가 안 올 수 있다. 이를 완화하기 위해 커서가 document를 벗어나는
 * 순간(mouseleave)을 "여기서 놓은 것으로 간주"하는 근사 처리를 추가했다 — 창 경계에 딱 붙어서
 * 놓는 일반적인 드래그 동작은 커버되지만, 100% 확실한 해결책은 아니다. 잘 안 먹으면
 * 우클릭 → "위젯으로 보기"가 항상 동작하는 대안이다.
 *
 * @param {HTMLElement} handleEl - 드래그 시작점이 되는 작은 손잡이 아이콘(행 전체가 아니라 손잡이에만 붙여야
 *   행의 기존 클릭 핸들러와 충돌하지 않음)
 * @param {() => {type:'todo'|'memo'|'event'|'postit', id:number}} getItem - 드래그 시점 최신 항목 정보를 돌려주는 함수
 *   (리스트가 재렌더링돼도 항상 최신 id를 참조하도록 값이 아니라 함수로 받는다)
 */
const THRESHOLD_PX = 8;

export function attachDragOut(handleEl, getItem) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  async function finish(screenX, screenY) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mouseout', onDocMouseOut);
    handleEl.classList.remove('drag-handle-active');
    if (!dragging) return;
    dragging = false;

    try {
      const bounds = await window.itda.app.getMainWindowBounds();
      if (!bounds) return;
      const outside = screenX < bounds.x || screenX > bounds.x + bounds.width || screenY < bounds.y || screenY > bounds.y + bounds.height;
      if (!outside) return; // 창 안에서 뗐으면 아무 일도 안 일어남(취소한 드래그로 취급)

      const item = getItem();
      if (!item) return;
      const x = Math.round(screenX - 30);
      const y = Math.round(screenY - 20);
      if (item.type === 'postit') {
        await window.itda.postitWidget.open({ id: item.id, x, y });
      } else {
        await window.itda.itemWidget.open({ type: item.type, id: item.id, x, y });
      }
    } catch (err) {
      // 위젯 열기가 실패해도 리스트 화면 자체는 멀쩡해야 하므로 조용히 무시
      console.error('[drag-out] 위젯을 열지 못했어요', err);
    }
  }

  function onMouseMove(e) {
    lastX = e.screenX;
    lastY = e.screenY;
    if (!dragging) {
      const dx = e.screenX - startX;
      const dy = e.screenY - startY;
      if (Math.hypot(dx, dy) > THRESHOLD_PX) {
        dragging = true;
        handleEl.classList.add('drag-handle-active');
      }
    }
  }

  function onMouseUp(e) {
    finish(e.screenX, e.screenY);
  }

  // 커서가 document(창) 밖으로 완전히 나가는 순간 — 진짜 mouseup을 못 받을 가능성이 높으니
  // 이 시점의 마지막 좌표를 "여기서 놓았다"로 간주해서 처리한다.
  // (document의 mouseleave보다, mouseout에서 relatedTarget이 null인지 보는 쪽이
  //  "커서가 창 자체를 벗어났다"를 더 안정적으로 감지한다 — 표준적으로 쓰이는 방식)
  function onDocMouseOut(e) {
    if (dragging && !e.relatedTarget) finish(lastX, lastY);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation(); // 손잡이 클릭이 상위 행의 선택/열기 동작으로 번지지 않게
    startX = e.screenX;
    startY = e.screenY;
    lastX = e.screenX;
    lastY = e.screenY;
    dragging = false;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mouseout', onDocMouseOut);
  }

  handleEl.addEventListener('mousedown', onMouseDown);
  // 드래그 없이 손잡이만 짧게 클릭했을 때도 상위 행 클릭으로 번지지 않게 막는다
  handleEl.addEventListener('click', (e) => e.stopPropagation());

  return () => {
    handleEl.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mouseout', onDocMouseOut);
  };
}

export const DRAG_HANDLE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>`;
