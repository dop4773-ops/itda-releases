/**
 * main/widget-restore/index.js
 *
 * 자동 업데이트로 재시작될 때, 재시작 직전에 열려있던 위젯들(보드형 위젯 + 포스트잇 +
 * 낱개 항목 위젯)을 다음 시작 시 그대로 다시 켜기 위한 스냅샷/복원.
 *
 *   - main/updater/index.js가 quitAndInstall 직전에 snapshotOpenWidgets()로 "지금 뭐가
 *     열려있었는지"를 설정에 남긴다.
 *   - main.js가 다음 시작(=업데이트로 인한 재시작) 시 restoreOpenWidgets()를 한 번 호출한다.
 *
 * "위젯은 사용자가 직접 켜기 전엔 자동으로 안 열린다"는 main/ipc/widgets.ipc.js의 원칙과
 * 상충하지 않는다 — 그건 "평소 앱을 새로 켤 때" 얘기고, 이건 "업데이트 때문에 끊긴 세션을
 * 이어붙이는" 것이라 한 번 복원하고 나면 설정 값을 바로 지운다. 그다음부터의 진짜 앱
 * 시작(트레이에서 다시 켜기, 재부팅 후 자동 실행 등)은 원래 규칙대로 위젯이 안 열린다.
 */
const boardWidgetManager = require('../widgets/window-manager');
const postitWidgetManager = require('../postit-widget/window-manager');
const itemWidgetManager = require('../item-widget/window-manager');

const SETTINGS_KEY = 'pending_widget_restore';

/** quitAndInstall 직전에 호출 — 지금 열려있는 위젯들을 설정에 남긴다(하나도 없으면 아무것도 안 남김). */
function snapshotOpenWidgets(settings) {
  const snapshot = {
    boardWidgets: boardWidgetManager.getOpenTypes(),
    postits: postitWidgetManager.getOpenIds(),
    items: itemWidgetManager.getOpenItems(),
  };
  const hasAny = snapshot.boardWidgets.length > 0 || snapshot.postits.length > 0 || snapshot.items.length > 0;
  settings.set(SETTINGS_KEY, hasAny ? JSON.stringify(snapshot) : '');
}

/**
 * 앱 시작 시 한 번 호출 — 남겨진 스냅샷이 있으면 위젯들을 다시 열고 스냅샷을 지운다.
 * @param {{ settings: object, openBoardWidgetByType: (type: string) => void, openPostitById: (id: number) => void }} deps
 */
function restoreOpenWidgets({ settings, openBoardWidgetByType, openPostitById }) {
  const raw = settings.get(SETTINGS_KEY);
  if (!raw) return;
  settings.set(SETTINGS_KEY, ''); // 한 번 쓰면 바로 비움 — 다음 "진짜" 시작부턴 원래 규칙대로

  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch (e) {
    return; // 깨진 값이면 조용히 포기(치명적이지 않음)
  }

  (snapshot.boardWidgets || []).forEach((type) => {
    try {
      openBoardWidgetByType(type);
    } catch (e) {
      console.error('[itda] 위젯 복원 실패(보드 위젯):', type, e.message);
    }
  });
  (snapshot.postits || []).forEach((id) => {
    try {
      openPostitById(id);
    } catch (e) {
      console.error('[itda] 위젯 복원 실패(포스트잇):', id, e.message); // 그 사이 삭제됐을 수 있음 — 무시하고 계속
    }
  });
  (snapshot.items || []).forEach((item) => {
    try {
      itemWidgetManager.openWidget(item); // 항목 위젯은 자기 렌더러가 "삭제된 항목이에요"를 알아서 보여줌
    } catch (e) {
      console.error('[itda] 위젯 복원 실패(항목):', item, e.message);
    }
  });
}

module.exports = { snapshotOpenWidgets, restoreOpenWidgets };
