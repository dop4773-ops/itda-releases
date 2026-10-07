// 저장해 둔 위젯 위치가 지금 화면 밖이면(모니터를 뺐거나 해상도·배율을 바꿨을 때) 창을 보이는 곳으로 되돌린다.
// 화면 안에 "조금이라도 걸쳐" 있으면 그대로 두고(사용자가 일부러 가장자리에 둔 것일 수 있음), 완전히 벗어났을 때만 옮긴다.
const MIN_VISIBLE_W = 80;
const MIN_VISIBLE_H = 40;

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * @param {{x?:number,y?:number,width?:number,height?:number}} b  x/y가 없으면 OS가 알아서 놓으므로 그대로 둔다
 * @param {{x:number,y:number,width:number,height:number}[]} workAreas  연결된 모든 화면의 작업 영역
 * @param {{x:number,y:number,width:number,height:number}} primary  기본 화면의 작업 영역(되돌릴 곳)
 */
function fitBoundsToScreens(b, workAreas, primary) {
  if (b.x == null || b.y == null) return b;
  const w = b.width || 300;
  const h = b.height || 300;
  const visible = workAreas.some((a) => overlap(b.x, b.x + w, a.x, a.x + a.width) >= Math.min(MIN_VISIBLE_W, w) && overlap(b.y, b.y + h, a.y, a.y + a.height) >= Math.min(MIN_VISIBLE_H, h));
  if (visible) return b;
  const width = Math.min(w, primary.width);
  const height = Math.min(h, primary.height);
  return { ...b, width, height, x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2) };
}

// electron screen을 읽는 얇은 래퍼(테스트는 위 순수 함수만 쓴다)
function fitToScreens(b) {
  const { screen } = require('electron');
  return fitBoundsToScreens(b, screen.getAllDisplays().map((d) => d.workArea), screen.getPrimaryDisplay().workArea);
}

module.exports = { fitBoundsToScreens, fitToScreens };
