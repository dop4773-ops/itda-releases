const { dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { copyIntoAttachments, fullPathFor, deleteStoredFile } = require('../memo-attachments/storage');
const { assertNonEmpty } = require('./_shared');

// 확장자 기반 mime-type 약식 추정 — 새 의존성(mime-types 등) 추가 없이 흔한 형식만 커버.
// 모르는 확장자는 application/octet-stream으로 폴백(첨부파일 아이콘은 일반 파일 아이콘으로 표시됨).
const EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.hwp': 'application/x-hwp', // 병원 문서에서 흔히 쓰는 한글 파일
};
function guessMime(fileName) {
  return EXT_MIME[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB — 로컬 SQLite/디스크 앱이라 넉넉히 잡되, 실수로 초대용량 파일을 첨부하는 것만 방지

module.exports = function registerMemoAttachmentsIpc(ipcMain, repos) {
  const { memoAttachments, memos } = repos;

  function getWin() {
    return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
  }

  ipcMain.handle('memoAttachments:list', (event, memoId) => {
    assertNonEmpty(memoId, 'memoId가 필요합니다.');
    return memoAttachments.listForMemo(memoId);
  });

  // 파일 선택 다이얼로그(add)와 드래그앤드롭(addFromPaths)이 공유하는 실제 복사+기록 로직.
  // 여러 개를 한 번에 넘겨도 되고, 하나라도 너무 크면 그 파일만 건너뛰고 나머지는 정상 처리한다.
  function processFiles(memoId, filePaths) {
    const added = [];
    const skipped = [];
    for (const sourcePath of filePaths) {
      const originalName = path.basename(sourcePath);
      try {
        const stat = fs.statSync(sourcePath);
        if (stat.isDirectory()) {
          skipped.push({ fileName: originalName, reason: '폴더는 첨부할 수 없어요' });
          continue;
        }
        if (stat.size > MAX_ATTACHMENT_BYTES) {
          skipped.push({ fileName: originalName, reason: '25MB를 초과해요' });
          continue;
        }
        const { storedName, size } = copyIntoAttachments(sourcePath, originalName);
        const record = memoAttachments.insert({
          memoId,
          fileName: originalName,
          storedName,
          mimeType: guessMime(originalName),
          size,
        });
        added.push(record);
      } catch (e) {
        skipped.push({ fileName: originalName, reason: '파일을 복사하지 못했어요' });
      }
    }
    return { added, skipped };
  }

  // 파일 선택 다이얼로그를 열고, 고른 파일들을 첨부한다.
  ipcMain.handle('memoAttachments:add', async (event, memoId) => {
    assertNonEmpty(memoId, 'memoId가 필요합니다.');
    const memo = memos.getById(memoId);
    if (!memo) throw new Error('메모를 찾을 수 없습니다.');

    const { canceled, filePaths } = await dialog.showOpenDialog(getWin(), {
      title: '첨부할 파일 선택',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: '문서', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'txt'] },
        { name: '모든 파일', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths?.length) return { cancelled: true, added: [] };

    return { cancelled: false, ...processFiles(memoId, filePaths) };
  });

  // 메모 화면에 파일을 드래그앤드롭했을 때 — 렌더러가 dataTransfer의 File.path들을 모아서 넘긴다.
  ipcMain.handle('memoAttachments:addFromPaths', (event, { memoId, filePaths }) => {
    assertNonEmpty(memoId, 'memoId가 필요합니다.');
    const memo = memos.getById(memoId);
    if (!memo) throw new Error('메모를 찾을 수 없습니다.');
    if (!Array.isArray(filePaths) || !filePaths.length) return { added: [], skipped: [] };
    return processFiles(memoId, filePaths);
  });

  // 이미지 파일을 렌더러에서 <img>로 보여주기 위해 base64로 인코딩해서 넘긴다.
  // (샌드박스 렌더러는 file:// 경로에 직접 접근할 수 없으므로 IPC로 바이트를 전달)
  ipcMain.handle('memoAttachments:getImageData', (event, id) => {
    const record = memoAttachments.getById(id);
    if (!record) throw new Error('첨부파일을 찾을 수 없습니다.');
    if (!record.mime_type?.startsWith('image/')) return null;
    const fullPath = fullPathFor(record.stored_name);
    if (!fs.existsSync(fullPath)) return null;
    const base64 = fs.readFileSync(fullPath).toString('base64');
    return `data:${record.mime_type};base64,${base64}`;
  });

  // 이미지가 아닌 파일(문서 등)은 OS 기본 프로그램으로 열어준다.
  ipcMain.handle('memoAttachments:open', (event, id) => {
    const record = memoAttachments.getById(id);
    if (!record) throw new Error('첨부파일을 찾을 수 없습니다.');
    const fullPath = fullPathFor(record.stored_name);
    if (!fs.existsSync(fullPath)) throw new Error('파일을 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
    shell.openPath(fullPath);
    return { opened: true };
  });

  ipcMain.handle('memoAttachments:delete', (event, id) => {
    const record = memoAttachments.getById(id);
    if (!record) return { id };
    deleteStoredFile(record.stored_name);
    memoAttachments.delete(id);
    return { id };
  });
};
