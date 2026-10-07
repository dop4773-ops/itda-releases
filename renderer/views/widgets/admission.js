import { renderBoardWidgetShell } from '../../shared/widget-ui.js';
import { createAdmissionWidget } from '../../shared/admission-widget.js';

const root = document.getElementById('widget-root');
renderBoardWidgetShell(root, {
  title: '입퇴원 현황',
  bodyHtml: '<div id="adm-root"></div>',
  footerLabel: '메신저 연동 설정',
  footerRoute: '#/settings/messenger',
});
const widget = createAdmissionWidget(root.querySelector('#adm-root'), { openRoute: (route) => window.itda.widgets.openMainApp(route) });

// 메신저에서 불러오기가 끝나면(일정 변경 브로드캐스트) 다시 그린다
window.itda.onDataChanged(({ entity }) => {
  if (entity === 'event') widget.refresh();
});
