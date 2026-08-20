import { renderBoardWidgetShell, fitWidgetToContent } from '../../shared/widget-ui.js';
import { escapeHtml } from '../../shared/ui-utils.js';
import { stripHtmlToPlainText } from '../../shared/rich-text.js';
import { STICKY_COLORS } from '../../shared/theme.js';

function getIdFromQuery() {
  return Number(new URLSearchParams(location.search).get('id'));
}

async function mount() {
  const root = document.getElementById('widget-root');
  const id = getIdFromQuery();

  if (!id) {
    root.innerHTML = `<div class="widget-error">잘못된 항목이에요</div>`;
    return;
  }

  let memo;
  try {
    memo = await window.itda.memos.get(id);
  } catch (e) {
    root.innerHTML = `<div class="widget-error">불러오지 못했어요</div>`;
    return;
  }
  if (!memo) {
    root.innerHTML = `<div class="widget-error">삭제된 메모예요</div>`;
    return;
  }

  if (memo.is_locked) {
    renderBoardWidgetShell(root, {
      title: '메모',
      bodyHtml: `<div style="font-size:12px;color:var(--bw-soft);text-align:center;padding:12px 0;">🔒 잠긴 메모예요<br/>메모 화면에서 열어주세요</div>`,
      footerLabel: '메모에서 열기',
      footerRoute: '#/memo',
    });
    fitWidgetToContent(root);
    return;
  }

  const plain = stripHtmlToPlainText(memo.content || '');
  const title = (memo.title && memo.title.trim()) || plain.split('\n')[0].trim() || '새로운 메모';
  const bodyText = memo.title && memo.title.trim() ? plain : plain.split('\n').slice(1).join(' ');

  // 첨부된 첫 번째 사진 — 메모 목록의 썸네일과 같은 원칙(첫 사진만, 지연 로드)으로 위젯에도 보여준다.
  let attachments = [];
  try {
    attachments = await window.itda.memoAttachments.list(id);
  } catch (e) {
    attachments = [];
  }
  const firstImage = attachments.find((a) => a.mime_type?.startsWith('image/'));

  // 포스트잇과 같은 개인화 팔레트(STICKY_COLORS)를 위젯 배경색으로도 고를 수 있게 —
  // memos.color_hex 컬럼은 이미 있었지만 지금까지 메모 화면/위젯 어디에도 UI가 없었다.
  const colorRowHtml = `
    <div class="mi-color-row">
      ${STICKY_COLORS.map(
        (c) => `<span class="mi-color-swatch ${c === memo.color_hex ? 'selected' : ''}" data-color="${c}" style="background:${c};"></span>`
      ).join('')}
    </div>
  `;

  const bodyHtml = `
    ${colorRowHtml}
    ${firstImage ? `<div class="mi-photo" id="mi-photo"></div>` : ''}
    <div style="font-size:12px;font-weight:600;color:var(--bw-text);margin-bottom:4px;">${escapeHtml(title)}</div>
    <div style="font-size:11.5px;line-height:1.5;color:var(--bw-soft);white-space:pre-wrap;word-break:break-word;">${escapeHtml(bodyText) || '<span style="color:var(--bw-faint);">내용 없음</span>'}</div>
  `;

  renderBoardWidgetShell(root, {
    title: '메모',
    bodyHtml,
    footerLabel: '메모에서 열기',
    footerRoute: '#/memo',
  });

  const shell = root.querySelector('.board-widget');
  if (shell) shell.style.setProperty('--bw-bg', memo.color_hex || '#FBE28A');

  root.querySelectorAll('.mi-color-swatch').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const colorHex = sw.dataset.color;
      try {
        await window.itda.memos.update({ id, colorHex });
        if (shell) shell.style.setProperty('--bw-bg', colorHex);
        root.querySelectorAll('.mi-color-swatch').forEach((s) => s.classList.toggle('selected', s === sw));
      } catch (e) {
        /* 위젯은 별도 토스트 UI가 없으므로 실패해도 조용히 무시 — 다음에 다시 시도 가능 */
      }
    });
  });

  fitWidgetToContent(root);

  if (firstImage) {
    try {
      const dataUrl = await window.itda.memoAttachments.getImageData(firstImage.id);
      const photoEl = root.querySelector('#mi-photo');
      if (dataUrl && photoEl) {
        photoEl.innerHTML = `<img src="${dataUrl}" alt="" />`;
        fitWidgetToContent(root); // 사진이 로드되면서 높이가 늘어났으니 다시 맞춘다
      }
    } catch (e) {
      /* 사진 하나 실패해도 나머지 위젯 표시에는 영향 없게 조용히 무시 */
    }
  }
}

mount();

window.itda.onDataChanged(({ entity, id: changedId }) => {
  if (entity === 'memo' && changedId === getIdFromQuery()) mount();
});
