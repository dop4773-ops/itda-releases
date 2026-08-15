/**
 * renderer/shared/hashtag.js
 *
 * 메모/포스트잇 본문에서 "#교육"처럼 입력하면 그 단어를 이 항목의 카테고리(태그)로
 * 자동 지정한다(카테고리가 없으면 새로 만듦). 항목당 카테고리는 하나뿐인 구조라
 * (다중 태그 아님) 두 번째 해시태그를 입력하면 카테고리가 그걸로 바뀐다 — 텍스트
 * 자체는 지우지 않고 그대로 둔다("#교육"이라는 글자는 본문에 남고, 그 이름의 카테고리가
 * 이 항목에 지정되는 부수효과만 발생).
 *
 * @검색(mention.js)과 달리 후보 팝업이 필요 없어서 훨씬 단순 — 해시태그가 공백/줄바꿈으로
 * "완성"되는 순간 바로 처리한다.
 */
import { toast, errorToast } from './ui-utils.js';

const HASHTAG_PATTERN = /#([^\s#]{1,20})$/;
// 새로 만들 태그에 쓸 색 — 사용자가 직접 고르는 게 아니라 자동 생성이라, 카테고리
// 화면에서 쓰는 파스텔 톤 중 하나를 순환해서 대충이라도 서로 구분되게 한다.
const AUTO_TAG_COLORS = ['#6C8CF5', '#4FB897', '#E8A34D', '#A78BE0', '#D6336C', '#0CA678', '#F76707', '#4C6EF5'];

function pickAutoColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AUTO_TAG_COLORS.length;
  return AUTO_TAG_COLORS[hash];
}

// requireTrailingSpace=true: 방금 막 입력된 공백을 하나 떼어내고 그 앞이 "#단어"인지 검사(스페이스바 트리거)
// requireTrailingSpace=false: 캐럿 바로 앞이 "#단어"인지 그대로 검사(Enter 트리거 — 줄바꿈 자체는 문자가 아니므로)
function detectFinishedHashtag(editableEl, requireTrailingSpace) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !editableEl.contains(node)) return null;
  let textBefore = node.textContent.slice(0, sel.anchorOffset);
  if (requireTrailingSpace) {
    if (!/[\s ]$/.test(textBefore)) return null;
    textBefore = textBefore.slice(0, -1);
  }
  const m = textBefore.match(HASHTAG_PATTERN);
  return m ? m[1] : null;
}

/**
 * @param {HTMLElement} editableEl - contenteditable="true" 요소(메모/포스트잇 본문)
 * @param {(categoryId: number) => void} onCategoryAssigned - 태그가 지정/생성되면 호출(저장은 호출부 책임)
 */
export function bindHashtagAutoTag(editableEl, onCategoryAssigned) {
  async function assignTag(name) {
    let categories;
    try {
      categories = await window.itda.categories.list();
    } catch (e) {
      return;
    }
    let category = categories.find((c) => c.name === name);
    if (!category) {
      try {
        const result = await window.itda.categories.add({ name, colorHex: pickAutoColor(name), textColor: '#000000' });
        category = { id: result.id };
        toast(`#${name} 태그를 새로 만들어서 지정했어요`);
      } catch (e) {
        errorToast(e, '태그를 만들지 못했어요');
        return;
      }
    } else {
      toast(`#${name} 태그로 지정했어요`);
    }
    onCategoryAssigned(category.id);
  }

  editableEl.addEventListener('input', () => {
    const name = detectFinishedHashtag(editableEl, true);
    if (name) assignTag(name);
  });
  editableEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const name = detectFinishedHashtag(editableEl, false);
    if (name) assignTag(name);
  });
}
