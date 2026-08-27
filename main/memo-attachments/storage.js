const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// 모든 메모 첨부파일이 모이는 단일 폴더. memo_id별 하위 폴더로 안 나눈 이유:
// 메모가 삭제/복원되어도 파일 자체는 그대로 두고(소프트삭제 원칙과 동일), DB 행만 정리하면
// 되게 하기 위함 — 폴더 구조가 memo_id에 종속되면 메모 이동/복원 로직이 파일 이동까지 책임져야 해서 복잡해진다.
function attachmentsDir() {
  const dir = path.join(app.getPath('userData'), 'attachments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 원본 파일명이 겹쳐도 충돌하지 않도록 저장용 파일명은 항상 랜덤(UUID)로 새로 만들고,
// 확장자만 원본에서 유지한다(더블클릭으로 열었을 때 OS가 올바른 앱으로 열 수 있도록).
function generateStoredName(originalName) {
  const ext = path.extname(originalName || '');
  return `${crypto.randomUUID()}${ext}`;
}

function copyIntoAttachments(sourcePath, originalName) {
  const storedName = generateStoredName(originalName);
  const destPath = path.join(attachmentsDir(), storedName);
  fs.copyFileSync(sourcePath, destPath);
  const { size } = fs.statSync(destPath);
  return { storedName, size };
}

// 클립보드 붙여넣기처럼 파일 경로가 없는 메모리상의 데이터를 저장할 때 쓴다(copyIntoAttachments와
// 로직은 같되 원본이 디스크 경로가 아니라 버퍼라는 점만 다름).
function copyBufferIntoAttachments(buffer, originalName) {
  const storedName = generateStoredName(originalName);
  const destPath = path.join(attachmentsDir(), storedName);
  fs.writeFileSync(destPath, buffer);
  const { size } = fs.statSync(destPath);
  return { storedName, size };
}

function fullPathFor(storedName) {
  return path.join(attachmentsDir(), storedName);
}

function deleteStoredFile(storedName) {
  const p = fullPathFor(storedName);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    // 파일이 이미 없거나 권한 문제로 못 지워도, DB 행 정리는 계속 진행되어야 하므로 조용히 무시
    console.error('[itda] 첨부파일 삭제 실패(무시하고 계속):', e.message);
  }
}

module.exports = { attachmentsDir, copyIntoAttachments, copyBufferIntoAttachments, fullPathFor, deleteStoredFile };
