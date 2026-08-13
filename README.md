# 잇다 (Itda) — 개인 업무 관리 데스크톱 Workspace

AI 없는, 가볍고 빠른 SQLite 기반 로컬 업무 관리 도구.
Electron(메인) + better-sqlite3(로컬 DB) + 순수 HTML/CSS/JS(렌더러) 구조.

## 폴더 구조

```
itda/
├─ main/
│  ├─ main.js      # 앱 생명주기, 창 생성
│  ├─ db.js         # SQLite 연결/초기화
│  └─ ipc.js         # renderer 요청을 받아 DB 쿼리 실행
├─ preload.js        # renderer에 안전한 window.itda.* API만 노출
├─ renderer/
│  ├─ dashboard.html
│  └─ shared/
│     ├─ styles.css
│     └─ app.js
├─ schema/
│  └─ itda_schema_v1.sql   # 최초 실행 시 자동 적용
└─ package.json
```

## Windows 실기 검증 (병원 PC)

**처음 셋업하는 경우, 이 순서대로 하면 됩니다:**

```
scripts\check_windows_env.ps1     (환경 사전 점검)
npm install                        (better-sqlite3 → Electron용으로 자동 재빌드까지 됨)
npm start
```

`npm start`에서 `Electron failed to install correctly` 에러가 나면
(Node.js 24.16.0+/26.1.0+ 알려진 버그, 아래 항목 참고):

```
scripts\fix_electron_windows.bat
npm start
```

이 두 스크립트로 지금까지 실기 검증에서 겪었던 문제 3가지
(better-sqlite3 Node24 미지원 / Electron 압축해제 버그 / better-sqlite3·Electron
ABI 불일치)가 전부 자동으로 처리됩니다 — `postinstall`에 Electron용 재빌드가
이미 등록되어 있어서 `npm run rebuild`를 따로 실행할 필요도 없습니다.

## 로컬 개발 (Mac)

```bash
npm install
npm start
```

첫 실행 시 OS의 사용자 데이터 폴더(`app.getPath('userData')`)에
`assistant.db`가 자동 생성되고 스키마가 적용됩니다.

- Mac: `~/Library/Application Support/잇다/assistant.db`
- Windows: `%APPDATA%\잇다\assistant.db`

**참고**: 프로젝트 폴더는 `~/Downloads`, `~/Desktop` 같은 macOS 보호 폴더
바깥(예: `~/dev/itda`)에 두는 걸 권장합니다. 보호 폴더 안에 있으면 Terminal
앱에 파일 접근 권한이 없어서 `rm`/`mv` 같은 명령이 `Operation not permitted`로
막히는 경우가 있습니다.

**터미널 없이 실행하기**: `npm install`을 최초 한 번만 터미널로 실행해두면,
그 다음부터는 Finder에서 `잇다_실행.command` 파일을 더블클릭하는 것만으로
실행할 수 있습니다. 처음 더블클릭할 때 "확인되지 않은 개발자" 경고가 뜨면
그 파일을 우클릭 → 열기 → 열기 를 한 번만 해주면 되고, 이후에는 그냥
더블클릭하면 됩니다.

## ⚠️ Windows 배포 시 반드시 확인할 것 (중요)

`better-sqlite3`는 **네이티브 모듈**입니다. Mac에서 `npm install`하면
Mac용 바이너리가 설치되는데, 이 상태로 Windows용 설치파일을 만들면
병원 PC에서 실행 시 100% 오류가 납니다 (기존 프로젝트에서 겪었던
Windows 호환성 이슈와 같은 종류의 문제입니다).

**해결 방법 (택 1):**

1. **가장 안전한 방법** — Windows PC(또는 Windows 가상머신)에서
   직접 `npm install` → `npm run build:win` 실행
2. **CI 사용** — GitHub Actions의 `windows-latest` 러너에서 빌드
   (Mac에서 코드만 푸시하면 Windows용 .exe가 자동 생성되도록 워크플로 구성 가능)
3. Mac에서 강행할 경우 `electron-builder`가 대상 플랫폼용 prebuilt
   바이너리를 내려받으려 시도하지만, better-sqlite3 버전에 따라
   실패할 수 있어 권장하지 않음

병원 Windows PC에서 최종 실행 전, 반드시 `scripts\check_windows_env.ps1`로
Node/Visual C++ 런타임 등을 먼저 확인하세요.

### Node.js 버전과 better-sqlite3 호환성 (실제로 겪은 문제)

`better-sqlite3`는 N-API가 아닌 네이티브 V8 바인딩이라 **Node.js 메이저
버전마다 별도의 사전 컴파일 바이너리가 필요**합니다. 유지보수 주기상
최신 Node에 대한 바이너리가 늦게 나올 수 있어요.

- 실제로 Node.js 24에서 `better-sqlite3` 11.x로 설치하면
  **사전 빌드 바이너리가 없어서 소스 컴파일을 시도**하고, 컴파일에는
  Visual Studio C++ 빌드 도구가 필요해 병원 PC 같은 환경에서 실패합니다.
- **해결**: `package.json`의 `better-sqlite3`를 **`^12.2.0` 이상**으로
  고정해두었습니다 (12.x부터 Node 24 사전 빌드 바이너리 제공). 만약
  나중에 최신 Node 버전에서 또 이런 에러(`Could not find any Visual
  Studio installation`, `No prebuilt binaries found`)가 나면, 그건
  `better-sqlite3`가 아직 그 Node 버전을 지원 안 하는 것이니
  1) `better-sqlite3` 버전을 더 올려보거나
  2) Node.js를 LTS 버전(짝수 메이저, 예: 20/22)으로 맞추는 걸 우선 시도하세요.
- 버전을 바꾼 뒤에는 `node_modules` 폴더와 `package-lock.json`을 지우고
  `npm install`을 다시 실행해야 반영됩니다.

### Electron 바이너리 다운로드 실패 ("Electron failed to install correctly")

**참고**: v0.2부터는 `npm install` 마지막 단계(`postinstall`)에서
`scripts/postinstall-electron-fix.js`가 자동으로 이 문제를 감지하고 스스로
복구를 시도합니다 — 아래 내용은 그래도 안 될 때의 수동 대응법입니다.
이 스크립트가 자동으로 처리하는 것:
- `electron` 패키지 자신의 설치 스크립트가 `allow-scripts` 같은 정책 때문에
  실행되지 않은 경우 → 직접 재실행 시도
- 위 방법도 안 되면 캐시된 zip을 찾아 수동으로 압축 해제
- macOS에서는 Gatekeeper가 서명되지 않은 개발용 Electron.app을 "악성 코드"로
  차단하지 않도록 `xattr -cr` + 애드혹 코드사이닝까지 자동 처리
- 무엇을 시도했는지는 `npm install` 로그에 `[itda:postinstall]` 접두사로 남습니다
- 이 스크립트는 절대 `npm install` 자체를 실패시키지 않습니다(복구에 실패해도
  경고만 남기고 종료 코드 0)

`npm install`이 성공한 것처럼 보여도, Electron 실행파일 자체는 GitHub
Releases에서 **별도로** 다운로드됩니다. 병원 네트워크가 npm 레지스트리는
허용해도 GitHub는 막아뒀다면 이 다운로드만 조용히 실패하고, `npm start` 시
`Error: Electron failed to install correctly, please delete node_modules/electron
and try installing again` 에러가 납니다.

**해결**: 이 프로젝트의 `.npmrc`에 `electron_mirror`를 npmmirror로 미리
설정해뒀습니다. 이미 `npm install`을 한 번 실행해서 electron 폴더가 깨진
상태로 남아있다면:

```
rmdir /s /q node_modules\electron
npm install
```

그래도 안 되면 `node node_modules\electron\install.js`를 직접 실행해서
실제 에러 메시지(타임아웃/403/연결거부 등)를 확인하세요 — 어느 호스트가
막혀있는지 알 수 있습니다.

### macOS에서 "'Electron.app'에 악성 코드가 포함되어 있어서 열리지 않았습니다"

npm으로 받은 서명되지 않은 개발용 바이너리를 macOS Gatekeeper가 차단하는
정상적인(itda만의 문제가 아닌) 현상입니다. 실제 배포용으로 서명·공증된
빌드에는 나타나지 않습니다. `postinstall-electron-fix.js`가 `npm install`
때 자동으로 예방 처리하지만, 혹시 다시 나타나면 직접:

```bash
xattr -cr node_modules/electron/dist/Electron.app
```

이걸로도 안 되면:
```bash
codesign --force --deep --sign - node_modules/electron/dist/Electron.app
```

### Electron 압축 해제 실패 — Node.js 24.16.0+ / 26.1.0+ 알려진 버그

다운로드는 정상 완료됐는데(`%LOCALAPPDATA%\electron\Cache`에 100MB+ zip
파일 확인됨) `node_modules\electron\dist`에 `locales` 폴더만 생기고
`electron.exe`가 없다면, 이건 **Electron 자체의 확인된 버그**입니다
(Node.js 24.16.0 이상/26.1.0 이상에서 postinstall이 쓰는 `extract-zip`
라이브러리가 깨짐 — [electron/electron#51619](https://github.com/electron/electron/issues/51619)).
Mac에서는 재현되지 않고 Windows에서만 발생합니다.

**즉시 우회하는 방법 (다운로드는 이미 됐으니 수동으로 압축만 풀면 됨):**

```
tar -xf "%LOCALAPPDATA%\electron\Cache\<해시폴더명>\electron-v버전-win32-x64.zip" -C node_modules\electron\dist
<nul set /p ="electron.exe">"node_modules\electron\path.txt"
```

`<해시폴더명>`은 `dir "%LOCALAPPDATA%\electron\Cache"`로 확인. 여러 개 있으면
zip 파일이 들어있고 크기가 100MB 이상인 폴더를 사용.

**⚠️ `path.txt`는 `dist` 폴더 안이 아니라 `node_modules\electron\path.txt`
(dist와 같은 레벨)에 만들어야 합니다** — `node_modules\electron\index.js`의
`getElectronPath()`가 `path.join(__dirname, 'path.txt')`로 찾기 때문입니다.
또한 `echo electron.exe > path.txt` 방식은 줄바꿈이 포함돼서 깨질 수 있으니
위처럼 `<nul set /p =` 트릭으로 줄바꿈 없이 정확히 써야 합니다.

**매번 이 과정을 손으로 반복하지 않도록 자동 스크립트를 만들어뒀습니다:**

```
scripts\fix_electron_windows.bat
```

이미 다운로드된 캐시에서 zip을 찾아 `dist`로 압축을 풀고 `path.txt`까지
정확한 위치에 만들어줍니다. `npm install`을 다시 실행할 때마다(예: 패키지
추가) Electron의 자동 설치가 또 깨질 수 있으니, 그때마다 이 스크립트를
한 번씩 실행해주세요.

**근본적인 해결 (권장)**: 위 우회는 재설치할 때마다 반복해야 하므로,
가능하면 Node.js를 **22.x LTS**로 낮추는 걸 권장합니다. 이 버그는
24.16.0/26.1.0 이상에서만 발생하고 22.x에서는 재현되지 않습니다.
`scripts\check_windows_env.ps1`이 Node 23 이상이면 이 문제를 미리 경고합니다.

**`fix_electron_windows.bat` 실행 시 `'癤?echo'은(는) 내부 또는 외부 명령...`처럼
깨진 글자와 함께 실패한다면**: 콘솔이 UTF-8 BOM을 한글 코드페이지(CP949)로
잘못 해석해서 첫 줄(`@echo off`)부터 깨진 것입니다. `.bat`은 `.ps1`과 달리
BOM이 있으면 오히려 깨지는 환경이 있어서, 이 스크립트는 **BOM 없이 순수
ASCII로만** 작성돼 있어야 합니다(한글 안내문 대신 영어 메시지 사용). 만약 다시
이 오류가 나면 스크립트 파일이 BOM 붙은 채로 저장된 것이니, `type` 명령이나
에디터에서 인코딩을 "UTF-8 without BOM"(또는 ANSI)으로 다시 저장해주세요.
`.ps1` 스크립트(`check_windows_env.ps1`)는 반대로 BOM이 **있어야** PowerShell
5.1이 한글을 안 깨뜨리므로, 두 파일의 인코딩 규칙이 서로 다르다는 점에 주의하세요.

## 화면 라우팅 구조

해시 기반 클라이언트 라우터(`renderer/shared/router.js`)가 사이드바 클릭 시
`#view-root` 영역만 교체합니다 (창을 새로고침하지 않음).

```
renderer/
├─ index.html          # 앱 셸: 사이드바(고정) + <main id="view-root">
├─ shared/
│  ├─ router.js         # 해시 → 화면 매핑, mount()/unmount() 라이프사이클
│  ├─ utils.js           # escapeHtml, toast, todayStr
│  └─ styles.css
└─ views/
   ├─ dashboard.js  (#/dashboard)
   ├─ inbox.js       (#/inbox)
   ├─ todo.js        (#/todo)
   ├─ calendar.js    (#/calendar) — 현재는 이번 달 리스트, 그리드 뷰는 다음 단계
   ├─ memo.js        (#/memo)
   ├─ postit.js      (#/postit)
   ├─ search.js      (#/search)
   ├─ trash.js       (#/trash)
   └─ settings.js    (#/settings) — 스텁
```

새 화면 추가 방법: `views/xxx.js`에 `export async function mount(root) {...}`
작성 → `router.js`의 `routes` 객체에 한 줄 추가 → `index.html` 사이드바에
`<a class="nav-item" href="#/xxx" data-route="#/xxx">` 추가.

## 안정성 / 오류 처리

- **모든 화면의 쓰기 작업(추가/수정/삭제/토글)이 try/catch로 감싸져 있습니다.** IPC 호출이 실패하면 콘솔 로그 + 토스트 알림으로 사용자에게 알리고, 조용히 아무 반응 없는 상태가 되지 않습니다.
- 체크박스 토글처럼 즉시 반영되는 UI는 실패 시 **자동으로 이전 상태로 복구**됩니다.
- 대시보드는 4개 섹션(할일/일정/메모/포스트잇)을 `Promise.allSettled`로 개별 로드합니다 — 하나가 실패해도 나머지 3개는 정상 표시됩니다 (이전엔 `Promise.all`이라 하나만 실패해도 라우터가 전체를 에러 화면으로 덮어썼습니다).
- 추가 버튼 등 쓰기 액션은 `busy` 플래그로 **이중 클릭/중복 요청을 방지**합니다.
- 렌더러 전역에 `unhandledrejection`/`error` 안전망이 있어 화면 코드에서 try/catch를 빠뜨려도 최소한 토스트로 알립니다.
- 메인 프로세스: DB 초기화 실패 시 조용히 죽지 않고 `dialog.showErrorBox`로 원인을 안내한 뒤 종료합니다. `uncaughtException`/`unhandledRejection`도 로깅합니다.
- renderer 프로세스가 크래시하거나 응답 없음 상태가 되는 경우도 로그로 남습니다.

## 지금 이 스켈레톤에서 실제로 동작하는 것

- 9개 화면 전체 라우팅 (대시보드/Inbox/Todo/일정/메모/포스트잇/검색/휴지통/설정)
- Inbox 빠른 입력 → 저장 → "Todo로 전환" 버튼으로 실제 Todo 생성까지 연동, 미처리/처리됨 탭 구분
- Todo: 우선순위·마감일 배지, 전체/진행중/완료 탭, 카테고리 고정 팔레트 적용
- **일정: 월/주/일 그리드 뷰 전체 구현** — 월간 달력(6주 그리드, 이벤트 pill, +N개 더보기), 주간·일간 시간대 그리드(06:00-22:00, 이벤트를 시작/종료 시각에 맞춰 절대배치), 이전/다음/오늘 네비게이션, 날짜 클릭 시 일간 뷰로 드릴다운, 카테고리 범례. 일정 추가는 모달로 분리
- 메모·포스트잇: 스티커노트 감성의 메이슨리 카드 뷰 — 카드마다 미세한 회전(스티커처럼), 호버 시 정렬+살짝 확대, 6色 개인화 팔레트 공유, 핀 고정, 클릭 즉시 편집(디바운스 자동저장)
- 통합검색(FTS5) 실시간 검색 및 결과 타입별 그룹핑, 검색 전/결과없음 안내 상태 포함
- 휴지통: 타입별 아이콘, 상대시간, 복원/완전삭제
- **설정: 카테고리 관리 실제 동작** — 이름·색상 수정(디바운스 자동저장), 새 카테고리 추가, 기본 4개는 삭제 방어(배지로 표시)
- 사이드바 접기/펼치기(SQLite에 상태 저장), 전역 빠른입력(⌘K)

## 디자인 토큰 (renderer/shared/styles.css `:root`)

색상은 중립 3단계 + 브랜드/success/danger + 카테고리 고정 4색만 사용합니다.
모서리 반경은 xs(6)/sm(9)/md(12)/lg(14)/pill 5단계로 고정되어 있고,
타이포도 page-title(20)/page-sub(12.5)/section-title(13.5)/body(13)/meta(11)
스케일 하나만 씁니다. 새 화면을 만들 때 이 토큰만 쓰면 자동으로 통일감이 유지돼요.

메모·포스트잇의 카드 색상은 `STICKY_COLORS` 팔레트(utils.js)를 공유하며,
Todo/일정의 카테고리 고정 팔레트(`--cat-*`)와는 의도적으로 분리되어 있습니다.

## 검증 방법

`main/ipc.js`의 모든 핸들러와 `renderer/views/*.js`의 렌더링·클릭·입력
상호작용을 jsdom + better-sqlite3로 실제 실행해 검증했습니다
(Electron 창 없이도 로직 정확성을 확인하는 방식). 병원 PC에서는 최종적으로
`npm start`로 실제 창 동작까지 확인해주세요.

## 자동 업데이트 (GitHub Releases 기반)

`main/updater/index.js`가 다른 기능과 완전히 분리된 독립 모듈로 담당합니다.

- **개발 모드**(`npm start`로 소스에서 직접 실행)에서는 업데이트 확인 자체가
  동작하지 않습니다 (패키징된 빌드가 아니면 배포 메타데이터가 없어서 정상입니다).
  설정 화면에 "개발 모드에서는 업데이트 확인을 지원하지 않아요"라고만 표시됩니다.
- **패키징된 빌드**에서는 설정(`#/settings`) 화면 하단 "업데이트" 패널에서:
  1. "업데이트 확인" 클릭 → 새 버전 있는지 확인만 함(자동 다운로드 안 함)
  2. 새 버전이 있으면 "다운로드" 버튼이 나타남 → 클릭해야 다운로드 시작
  3. 다운로드 완료되면 "재시작 후 설치" 버튼이 나타남 → 클릭해야 재시작+설치
  - 이 세 단계 전부 **사용자가 직접 눌러야만** 진행됩니다. 병원 PC에서 모르는 사이에
    네트워크를 쓰거나 갑자기 재시작되는 일이 없도록 의도적으로 이렇게 설계했습니다.

**릴리스 배포 방법** (개발자용):

```bash
# GitHub에 배포하려면 Personal Access Token(repo 권한)이 환경변수로 필요합니다
export GH_TOKEN=your_github_personal_access_token

npm run release:win
```

`package.json`의 `build.publish`에 GitHub owner/repo가 지정되어 있어야
electron-builder가 해당 저장소의 Releases에 설치파일 + 업데이트 메타파일을
올립니다. **현재 `dop4773-ops/itda-releases`로 지정해뒀는데, 이건 예전
Python 스택 때 쓰던 저장소를 그대로 가져온 임시값입니다 — 이 Electron
프로젝트용으로 실제 사용할 GitHub 저장소가 맞는지 꼭 확인하고, 다르면
`package.json`의 `build.publish.owner`/`build.publish.repo`를 바꿔주세요.**

## 다음 단계 (TODO)

- [ ] 미니캘린더(사이드 위젯) — 목업에 있었지만 아직 이식 안 함
- [ ] 일정 드래그로 이동/리사이즈 (현재는 클릭 추가·삭제만 가능, 수정 UI 없음)
- [ ] 구글 캘린더 읽기전용 동기화 프로세스 (별도 모듈, `google_calendar_events` 테이블 전용 write 경로)
- [ ] 앱 아이콘(`build/icon.ico`) 추가
- [ ] Todo 수정(update) UI — 현재 IPC는 준비됐지만 화면에는 삭제만 노출
- [ ] 설정 화면에 프레즌스 상태 변경, 사이드바 옵션 등 추가 (현재는 카테고리 관리만 구현)
- [ ] Todo 우선순위/마감일 UI에서 실제 수정(현재는 추가 시에만 지정 가능)

**여기까지 오면 9개 화면 전부 시각 디자인이 통일된 토큰 체계로 마무리되고,
일정 화면은 월/주/일 그리드 뷰까지 갖춘 상태입니다.**
이후 작업은 위 TODO처럼 기능 확장 위주이며, 새 화면을 추가할 때도
`renderer/shared/styles.css`의 기존 토큰(`--radius-*`, `--fs-*`, `--cat-*` 등)과
`emptyStateBlock()` / `list-row` / `sticky-card` 같은 공통 컴포넌트를 그대로 재사용하면 됩니다.
