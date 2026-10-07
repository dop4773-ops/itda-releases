const MINIMIZE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg>`;
const CLOSE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

/**
 * 보드형 위젯들(오늘일정/오늘할일/포스트잇/빠른메모/구글캘린더/Inbox/D-DAY)이 전부 같은
 * "흰 카드 + 헤더 + 본문 + 전체보기 링크" 틀을 쓰기 때문에 여기서 한 번만 만든다.
 * 최소화/닫기 버튼은 평소엔 숨겨져 있다가 카드에 마우스를 올리면 나타난다(hover-reveal).
 */
// 포스트잇 위젯의 항상 위 버튼과 같은 아이콘 — 켜짐=채움, 꺼짐=윤곽선
export const PIN_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;
export const PIN_OUTLINE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l1.5 5.5L19 9l-4.5 3.5L16 18l-4-3-4 3 1.5-5.5L5 9l5.5-1.5z"/></svg>`;

// 낱개 항목 위젯(할 일/일정/메모)의 "항상 앞으로" 버튼 연결 — 상태는 메인이 창 단위로 저장한다(기본 켜짐)
export async function bindPinButton(btn) {
  if (!btn) return;
  const paint = (on) => {
    btn.innerHTML = on ? PIN_ICON : PIN_OUTLINE_ICON;
    btn.classList.toggle('active', !!on);
    btn.title = on ? '항상 앞으로 (켜짐)' : '항상 앞으로 (꺼짐)';
  };
  paint(await window.itda.widgetControls.getPin().catch(() => true));
  btn.addEventListener('click', async () => {
    const next = !btn.classList.contains('active');
    try {
      paint(await window.itda.widgetControls.setPin(next));
    } catch (e) {
      /* 상태가 안 바뀌었으면 버튼도 그대로 */
    }
  });
}

export function renderBoardWidgetShell(root, { title, headerRight = '', bodyHtml, footerLabel, footerRoute, pin = false }) {
  root.innerHTML = `
    <div class="board-widget">
      <div class="board-widget-titlebar" id="bw-titlebar">
        <div class="board-widget-header">
          <b>${title}</b>
          <div class="board-widget-header-right">${headerRight}</div>
          <div class="board-widget-controls">
            ${pin ? '<button class="bw-control-btn" id="bw-pin" title="항상 앞으로"></button>' : ''}
            <button class="bw-control-btn" id="bw-minimize" title="최소화">${MINIMIZE_ICON}</button>
            <button class="bw-control-btn" id="bw-close" title="닫기">${CLOSE_ICON}</button>
          </div>
        </div>
      </div>
      <div class="board-widget-body">${bodyHtml}</div>
      ${footerLabel ? `<div class="board-widget-footer" id="bw-footer">${footerLabel} →</div>` : ''}
    </div>
  `;

  if (footerLabel && footerRoute) {
    root.querySelector('#bw-footer').addEventListener('click', () => {
      window.itda.widgets.openMainApp(footerRoute);
    });
  }

  if (pin) bindPinButton(root.querySelector('#bw-pin'));
  root.querySelector('#bw-minimize').addEventListener('click', () => {
    window.itda.widgetControls.minimize();
  });
  root.querySelector('#bw-close').addEventListener('click', () => {
    window.itda.widgetControls.close();
  });

  // 위젯 창은 열려있는 창 자체가 곧 닫을 대상이므로 Esc=닫기를 조건 없이 적용
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.itda.widgetControls.close();
  });
}

/**
 * 단일 항목 위젯(일정/할일/메모)이 열릴 때 스크롤 없이 내용이 다 보이도록,
 * 실제 렌더링된 내용 높이를 측정해서 창 자신을 리사이즈한다.
 * renderBoardWidgetShell()로 내용을 다 그린 직후에 호출한다.
 */
export function fitWidgetToContent(root) {
  requestAnimationFrame(() => {
    const shell = root.querySelector('.board-widget');
    if (!shell) return;
    const header = shell.querySelector('.board-widget-header');
    const body = shell.querySelector('.board-widget-body');
    const footer = shell.querySelector('.board-widget-footer');
    const headerH = header?.offsetHeight || 0;
    const bodyH = body?.scrollHeight || 0;
    const footerH = footer?.offsetHeight || 0;
    const totalH = headerH + bodyH + footerH + 6; // 살짝 여유
    window.itda.widgetWindow?.fitToContent?.({ height: totalH }).catch(() => {});
  });
}
