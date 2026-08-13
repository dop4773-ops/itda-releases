#!/bin/bash
# 잇다(Itda) 실행기 — Finder에서 이 파일을 더블클릭하면 됩니다.
#
# 첫 실행 시 "확인되지 않은 개발자" 경고가 뜨면: 이 파일 우클릭 → 열기 → 열기 를 한 번만 해주세요.
# 그 다음부터는 그냥 더블클릭하면 바로 실행됩니다.
#
# 더블클릭으로 열린 터미널은 ~/.zshrc를 읽지 않아서 nvm으로 설치한 Node를 못 찾을 수 있다.
# 이 스크립트는 그 문제를 두 가지 방법으로 우회한다:
#   1. nvm이 있으면 직접 불러와서 올바른 Node 버전을 사용하도록 시도
#   2. 그래도 안 되는 경우를 대비해, 이 프로젝트의 node_modules/.bin을 PATH 맨 앞에
#      직접 추가한다 — 이렇게 하면 npm이 무엇이든 상관없이 electron 실행파일을 찾는다.

cd "$(dirname "$0")"

# 1) nvm 로드 시도 (Homebrew 설치 경로 + 기본 설치 경로 둘 다 확인)
export NVM_DIR="$HOME/.nvm"
if [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
  \. "/opt/homebrew/opt/nvm/nvm.sh"
elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
  \. "/usr/local/opt/nvm/nvm.sh"
elif [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
fi
if command -v nvm > /dev/null 2>&1; then
  nvm use 22 > /dev/null 2>&1 || nvm use default > /dev/null 2>&1 || true
fi

# 2) 안전망: 이 프로젝트의 node_modules/.bin을 PATH 맨 앞에 직접 추가
#    (nvm 로드가 안 됐거나 다른 npm이 잡혀도, electron 실행파일 자체는 여기서 찾게 된다)
export PATH="$PWD/node_modules/.bin:$PATH"

echo "잇다를 실행합니다..."
echo "(창이 뜰 때까지 몇 초 걸릴 수 있어요. 이 터미널 창은 잇다 실행 중엔 열려있어야 합니다.)"
echo

if ! command -v npm > /dev/null 2>&1; then
  echo "[오류] npm을 찾을 수 없습니다. Node.js가 설치되어 있는지 확인해주세요."
  echo "터미널에서 'node -v'를 입력해 버전이 나오는지 확인해보세요."
  echo
  echo "아무 키나 누르면 이 창이 닫힙니다."
  read -n 1 -s
  exit 1
fi

if [ ! -x "node_modules/.bin/electron" ]; then
  echo "[오류] node_modules/.bin/electron이 없습니다. 아직 npm install을 안 하셨을 수 있어요."
  echo "터미널에서 이 폴더로 이동해 'npm install'을 먼저 한 번 실행해주세요:"
  echo "  cd \"$PWD\""
  echo "  npm install"
  echo
  echo "아무 키나 누르면 이 창이 닫힙니다."
  read -n 1 -s
  exit 1
fi

npm start

echo
echo "잇다가 종료되었습니다. 아무 키나 누르면 이 창이 닫힙니다."
read -n 1 -s
