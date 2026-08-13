import { errorToast } from './ui-utils.js';

export const WIDGET_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`;

/**
 * 화면 헤더(page-head)에 "이 화면 관련 위젯 열기" 버튼을 붙일 때 쓰는 HTML.
 * 설정 화면의 위젯 탭은 "허용 목록"(켜져 있는지 여부)이고, 실제로 위젯을 여는 주 동작은
 * 각 화면의 이 버튼에서 하도록 역할을 나눴다.
 */
export function widgetLaunchButtonHtml(id, title) {
  return `<button class="btn-icon widget-launch-btn" id="${id}" title="${title}">${WIDGET_ICON}</button>`;
}

export function bindWidgetLaunchButton(root, id, widgetType) {
  const btn = root.querySelector('#' + id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await window.itda.widgets.open(widgetType);
    } catch (e) {
      errorToast(e, '위젯을 열지 못했어요');
    }
  });
}
