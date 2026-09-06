# 잇다(Itda) 구조 분석 문서

작성 기준: 프로젝트 마스터 프롬프트(Claude Code Project Constitution) 1~7번 "첫 번째 작업"
작성일: 2026-08-07
대상 코드: `itda-skeleton.zip` 최신 버전 (대시보드 재구성 완료 시점)

---

## 1. 현재 프로젝트 구조 분석

### 1-1. 규모
| 영역 | 파일 | 대략 라인수 |
|---|---|---|
| Main 프로세스 | `main/main.js`, `main/db.js`, `main/ipc.js` | ~600줄 |
| Preload | `preload.js` | ~100줄 |
| Renderer 공통 | `renderer/shared/{shell,router,utils,styles.css}` | ~450줄 |
| Renderer 화면 | `renderer/views/*.js` (9개 화면) | ~1,700줄 |
| DB 스키마 | `schema/itda_schema_v1.sql` | ~270줄 |
| **합계** | | **약 2,900줄** |

### 1-2. 디렉터리 트리 (현재)
```
itda/
├── main/
│   ├── main.js        # BrowserWindow 생성, 앱 라이프사이클
│   ├── db.js           # SQLite 연결 + 스키마 최초 적용
│   └── ipc.js           # ⚠ 41개 IPC 핸들러가 전부 이 한 파일에
├── preload.js           # contextBridge로 window.itda API 노출
├── renderer/
│   ├── index.html
│   ├── shared/
│   │   ├── shell.js      # 사이드바, 라우팅 마운트
│   │   ├── router.js      # hash 기반 라우터
│   │   ├── utils.js        # ⚠ 날짜유틸 + UI헬퍼 + 색상상수 혼재
│   │   └── styles.css
│   └── views/
│       ├── dashboard.js, calendar.js, todo.js, memo.js,
│       │   postit.js, inbox.js, search.js, settings.js, trash.js
├── schema/itda_schema_v1.sql   # 9개 테이블
└── scripts/               # Windows 배포 트러블슈팅 스크립트
```

### 1-3. 데이터 계층
9개 테이블: `categories`, `inbox_items`, `todos`, `todo_tags`, `events`, `google_calendar_events`(읽기전용, 물리 분리), `memos`, `postits`, `app_settings`.
설계 원칙(soft delete vs hard delete, 카테고리 색상 4종 고정, 읽기전용 제약을 코드가 아닌 테이블 분리로 강제)이 스키마 레벨에서 잘 지켜지고 있음.

### 1-4. IPC 계층 실측
`main/ipc.js` 한 파일 안에 도메인별 핸들러 개수:
`todos`(7) · `memos`(7) · `postits`(5) · `events`(4) · `categories`(4) · `inbox`(4) · `trash`(3) · `settings`(2) · `search`(1) — 총 41개.

---

## 2. 문제점 분석

### 🔴 (구조) `main/ipc.js` 단일 파일 과부하
20KB, 41개 핸들러, 9개 도메인이 파일 하나에 몰려있음. 헌장의 "하나의 파일에 모든 기능 작성 금지" 원칙과 정면으로 충돌하는 지점. 지금은 감당되지만, 위젯/업데이트/Google Calendar 연동이 추가되면 이 파일이 가장 먼저 병목이 됨.

### 🔴 (구조) `renderer/shared/utils.js`에 성격이 다른 코드 혼재
- UI 헬퍼(`toast`, `escapeHtml`, `emptyStateBlock`)
- 날짜/캘린더 순수 유틸(`dateKey`, `monthGridDates`, `minutesInDay` 등 — 지난 세션에 추가)
- 도메인 상수(`STICKY_COLORS`, `stickyRotation`)

세 성격이 한 파일에 있어서, "공통 유틸"이라는 이름표만 보고는 뭐가 들어있는지 예측하기 어려움.

### 🟡 (설정값 불일치) SQLite `busy_timeout`
memoryOS에 기록된 결정사항은 "busy_timeout 2초"인데, 실제 `main/db.js` 코드는 `busy_timeout = 30000`(30초)으로 되어 있음. 둘 중 어느 게 의도한 값인지 확인 필요 — 문서(기억)와 코드가 어긋난 첫 사례라 지금 바로잡아두는 게 좋음.

### 🟡 (테스트) 자동화된 테스트 부재
`SMOKE_TEST.md`는 사람이 손으로 확인하는 체크리스트로 보이고, 저장소 안에 실행 가능한 테스트 스크립트(jest 등)는 없음. 지난 세션에 dashboard/calendar를 jsdom으로 검증한 건 세션 내 임시 스크립트였고 저장소에 남기지 않음 — "테스트하기 쉬운 구조"는 지켜지고 있지만 "테스트가 실제로 존재"하지는 않는 상태.

### 🟡 (기능 공백) Google Calendar 연동 미완성
`google_calendar_events` 테이블과 대시보드 UI(체크박스)는 있지만 실제 fetch 로직·IPC 핸들러는 없음. 헌장 관점에선 "미완성 기능을 UI에 노출"한 상태 — 최소한 비활성 표시는 해뒀지만, 사용자가 헷갈릴 여지가 있음.

### 🟡 (헌장 대비 공백) 위젯 미착수
헌장은 위젯을 "핵심 기능"으로 명시하는데, 현재 로드맵엔 계속 보류로 남아있음. Simple/Fast First 철학과 위젯의 우선순위를 한 번 재정렬할 필요.

### 🟢 (양호) AI Last 원칙
v1에서 AI/규칙엔진/ML 완전 제외 방향 전환이 실제 코드에도 반영되어 있음 — IPC나 스키마 어디에도 AI 관련 흔적 없음. 헌장과 가장 잘 맞는 부분.

### 🟢 (양호) 디자인 토큰 통일
5단계 radius, 시맨틱 5색, 카테고리/포스트잇 색상 분리 — 이미 감사(audit) 완료 상태로 매직 넘버 원칙을 잘 지킴.

---

## 3. 개선 가능한 구조 제안

### 3-1. `main/ipc.js` → 도메인별 분리
```
main/
├── ipc/
│   ├── index.js        # 각 모듈의 registerXxxIpc(db) 호출만 담당
│   ├── todos.ipc.js
│   ├── events.ipc.js
│   ├── memos.ipc.js
│   ├── postits.ipc.js
│   ├── categories.ipc.js
│   ├── inbox.ipc.js
│   ├── trash.ipc.js
│   ├── settings.ipc.js
│   └── search.ipc.js
```
각 파일은 `module.exports = (db, ipcMain) => { ipcMain.handle(...) }` 형태로 자기 도메인만 다룸. `main.js`는 `require('./ipc').register(db)` 한 줄만 호출. 이 구조면 "일정 등록 폼 개선" 같은 작업을 할 때 `events.ipc.js` 하나만 열면 됨 — 파일 간 충돌도 줄어듦.

### 3-2. `renderer/shared/utils.js` → 성격별 분리
```
renderer/shared/
├── ui-utils.js       # toast, escapeHtml, emptyStateBlock, formatRelative
├── date-utils.js      # dateKey, monthGridDates, minutesInDay 등
├── theme.js           # STICKY_COLORS, stickyRotation, 카테고리 색상 상수
```
`calendar.js`/`dashboard.js`는 `date-utils.js`만 import하면 되고, 새 화면을 만들 때도 어디서 뭘 가져올지 이름만 보고 알 수 있음.

### 3-3. DB 접근 계층 얇게 분리 (선택)
지금은 `ipc.js` 안에서 직접 `db.prepare(...).run(...)`을 호출하는 구조로 보임 (main/ipc.js 20KB에 SQL이 섞여있음). 규모가 더 커지기 전에 `main/repositories/todos.repo.js`처럼 "SQL만 담당하는 계층"을 한 겹 더 두면, IPC 핸들러는 얇게 유지되고 SQL 재사용(예: 검색 기능이 todos/events/memos/postits를 모두 조회)이 쉬워짐. 다만 지금 당장 필수는 아니고, 검색·통합 기능을 손볼 때 같이 하면 자연스러움.

### 3-4. `docs/` 폴더 신설
이 문서(`STRUCTURE_ANALYSIS.md`)를 시작으로, 결정사항 문서를 리포지토리 안에도 남겨두는 걸 제안. memoryOS는 세션 간 기억이지만, 코드를 처음 보는 사람(미래의 자신 포함)은 리포지토리 안의 문서만 보게 되므로 이중화해두는 게 안전함.

---

## 4. 단계별 개발 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 스키마/스캐폴딩/IPC/라우팅/디자인 토큰 | ✅ 완료 |
| 1 | Dashboard, Inbox UI | ✅ 완료 (Dashboard는 이번에 재구성) |
| 2 | Todo/Calendar/메모/포스트잇/검색 화면 UI | 🔶 진행 중 (화면 자체는 존재, 세부 UX 개선 남음) |
| 3 | **구조 리팩터링** (본 문서 3장) | 🆕 제안 — 지금 시점에 하는 게 가장 저렴함 |
| 4 | 일정 폼 개선, 메모/포스트잇 통합, 검색·일괄삭제 등 기능 보강 | ⏳ 대기 (TODO 목록에 이미 있음) |
| 5 | Windows 실기 배포 검증 (미뤄둔 것 재개) | ⏳ 대기 |
| 6 | 위젯(항상 위 작은 창) | ⏳ 대기 — 헌장상 핵심 기능이므로 5번 이후 바로 배치 권장 |
| 7 | 검색 전역화, 알림 | ⏳ 대기 |
| 8 | 업데이트(GitHub Releases) 모듈 | ⏳ 대기 — 독립 모듈로 처음부터 분리 (헌장 요구사항) |
| 9 | AI 보조 기능 | 🔒 보류 — 1~8 안정화 후에만 검토 |

---

## 5. MVP 기능 재정의

기존 memoryOS 기록과 동일하되, 이번 분석으로 범위를 재확인:

**포함 (v1 MVP)**
- Dashboard(요약 + 우측 캘린더/포스트잇 패널)
- Inbox(단순 저장, 자동분류 없음)
- Todo / 일정(Calendar, 구글 읽기전용 표시만) / 메모 / 포스트잇
- 통합 검색
- 위젯 — **헌장 기준으로는 MVP에 포함되는 게 원칙에 맞음.** 지금까지는 "보류"였는데, 이번 분석을 계기로 우선순위 재검토를 제안 (6장 참고)

**명시적 제외 (v1)**
- AI/규칙엔진/ML 분류
- Google Calendar 쓰기 연동 (읽기전용만)
- 직원관리
- 자동 업데이트 (모듈 구조는 미리 잡아두되 실제 구현은 이후 단계)

---

## 6. 디렉터리 구조 제안 (3장 반영 최종본)

```
itda/
├── main/
│   ├── main.js
│   ├── db.js
│   ├── ipc/
│   │   ├── index.js
│   │   ├── todos.ipc.js
│   │   ├── events.ipc.js
│   │   ├── memos.ipc.js
│   │   ├── postits.ipc.js
│   │   ├── categories.ipc.js
│   │   ├── inbox.ipc.js
│   │   ├── trash.ipc.js
│   │   ├── settings.ipc.js
│   │   └── search.ipc.js
│   └── repositories/        # SQL 전담 계층 (2026-08-07 도입 완료)
├── preload.js
├── renderer/
│   ├── index.html
│   ├── shared/
│   │   ├── shell.js
│   │   ├── router.js
│   │   ├── ui-utils.js
│   │   ├── date-utils.js
│   │   ├── theme.js
│   │   └── styles.css
│   └── views/               # 화면 단위, 현행 유지
├── schema/
│   └── itda_schema_v1.sql
├── scripts/                  # Windows 트러블슈팅 (현행 유지)
└── docs/
    ├── STRUCTURE_ANALYSIS.md  # 본 문서
    └── (향후 결정사항 문서들)
```

---

## 7. 개발 우선순위 제안

1. **`busy_timeout` 값 확인 및 정정** (2초 vs 30초, 5분이면 끝나는 작업, 지금 바로 잡아두는 게 이득)
2. **`main/ipc.js` 도메인 분리** — 다음에 손댈 작업(일정 폼 개선, 메모/포스트잇 통합)이 어차피 `ipc.js`를 건드리므로, 그 작업들 시작 전에 먼저 나눠두면 이후 작업이 훨씬 쉬워짐
3. **`utils.js` 분리** — 위와 같은 이유, 비용 대비 효과가 가장 큰 시점이 지금
4. 이후 TODO 목록 순서대로 진행: 일정 폼(하루종일/종료시간 선택화) → 메모/포스트잇 통합 → 검색/전체선택/선택삭제 → 카테고리별 UI 고도화
5. Windows 실기 배포 재검증
6. 위젯 착수 (헌장상 핵심 기능이므로 더 미루기 전에 일정 배치 권장)
7. 업데이트 모듈, 알림, 전역 검색
8. AI 보조 기능 (최후순위, 1~7 안정화 후)

---

*이 문서는 헌장 "첫 번째 작업" 요구사항에 따라 실제 코드를 다시 읽고 작성되었습니다.*

---

## 후기: 리팩터링 실행 결과 (2026-08-07)

7-1·7-2·7-3 항목을 같은 날 실행 완료함.

- **`busy_timeout` 정정**: 30000 → **2000**으로 수정 (`main/db.js`). 사용자 확인 완료.
- **`main/ipc.js` 도메인 분리**: 3장 제안 그대로 `main/ipc/{_shared,inbox,categories,todos,events,memos,postits,trash,search,settings}.ipc.js` + `index.js`로 분리. `main.js`는 `require('./ipc')` 그대로 유지(디렉터리로 바뀌었을 뿐 호출부 변경 없음). mock ipcMain/db로 41개 채널 전부 정상 등록·중복 없음·샘플 호출 정상 확인.
- **`renderer/shared/utils.js` 분리**: `date-utils.js`(순수 날짜 유틸) / `ui-utils.js`(toast·escapeHtml·배지 등) / `theme.js`(STICKY_COLORS·stickyRotation)로 분리. import하던 9개 파일(shell, calendar, dashboard, todo, memo, postit, inbox, search, settings, trash) 전부 새 경로로 갱신하고 jsdom으로 14개 모듈 로드 + 대시보드 회귀 테스트 재실행, 전부 통과.

다음 대상 파일 구조는 6장 제안과 100% 일치하는 상태가 됨. `main/repositories/`(3-3, 검색 통합 시점)만 아직 미착수로 남음.

---

## 후기 2: `main/repositories/` 도입 (2026-08-07)

3-3에서 "선택"으로 남겨뒀던 DB 접근 계층 분리를 실행 완료함.

- **구조**: `main/repositories/{categories,todos,events,memos,postits,inbox,trash,links,search,settings}.repository.js` + 이들을 한번에 생성하는 `index.js`(`createRepositories(db)`). 각 repository는 순수 SQL 실행만 담당하고, "제목 필수" 같은 입력 검증이나 "시스템 카테고리는 삭제 불가" 같은 비즈니스 규칙은 여전히 `ipc/*.js`에 남겨둠 (관심사를 SQL vs 검증/정책으로 나눔).
- **ipc/*.js는 전부 얇아짐**: `db.prepare(...)`가 한 줄도 안 남고, `repos.todos.setStatus(id, status)`처럼 의도가 드러나는 이름의 repository 메서드 호출로 대체됨.
- **`main/ipc/index.js`**: `createRepositories(db)`를 한 번 호출해서 각 `register*Ipc(ipcMain, repos)`에 나눠준다. `main.js`가 부르는 `registerIpcHandlers(ipcMain, db)` 시그니처는 그대로라 호출부 변경 없음.
- **검증**: better-sqlite3로 categories/todos+subtasks/events/memos/postits/inbox/links/trash/search/settings 전 도메인을 리팩터링 후 다시 실행해서 동작이 하나도 안 바뀌었는지 확인. 특히 `todos:update`의 null-clear 버그수정, `status`/`is_favorite` 동기화, `item_links` 정규화·자기연결금지·완전삭제 연동까지 전부 재검증. `db.js` 마이그레이션 경로도 실제 schema.sql 기반으로 "구버전 DB"를 정확히 재현해서(손타이핑 대신 DROP COLUMN/DROP TABLE로 되돌리는 방식) 신규설치/기존DB 업그레이드/재실행 안전성 전부 재확인.
- renderer 쪽은 IPC 채널 이름이 하나도 안 바뀌어서 전혀 손대지 않음.

이걸로 6장 제안 구조가 완전히 실현됨.

---

# STEP 1 재분석 — 종합 개선 프롬프트 대응 (2026-09-06, v2.58.25 기준)

사용자가 "안정성 → 성능 → 검색 → 연결" 종합 개선 프롬프트를 줌. 이 섹션은 그 STEP 1
("현재 구조 분석 + 문제점 보고")이다. **읽기 전용 — 코드 변경 없음.**

전제(사용자 확정):
- **검색 구조 개편은 사용자가 추후 직접** → 이번 로드맵에서 검색 랭킹/초성/정규화/필터/일치이유는 제외.
- 빠른 찾기 전역 단축키는 현행 `Ctrl/Cmd+Shift+Space` 유지.
- 중복 단축키/기능은 이번엔 "파악만", 정리는 추후.
- 지금까지 릴리스(~v2.58.25)는 윈도우 실기에서 정상 작동 확인됨 → 실기 검증 백로그 해소.

## A. 현재 구조 (실측)

| 계층 | 파일 수 | 요지 |
|---|---|---|
| main 진입 | `main/main.js` 134줄 | 단일 인스턴스 락, 트레이 상주(창 X→hide), `whenReady`에서 `initDb`→IPC 등록→창→updater/spotlight/globalShortcut/tray/autoBackup/widgetRestore |
| DB | `main/db.js` 271줄 | `initDb`(PRAGMA 7종 + 신규시 schema.sql / 기존시 `runLightweightMigrations`) + `closeDb`(optimize + `wal_checkpoint(TRUNCATE)`) |
| IPC | `main/ipc/*.ipc.js` 24개 + `index.js` | 도메인별. 검증 + "어떤 repo 메서드 부를지"만. `db.prepare` 없음 |
| Repository | `main/repositories/*.repository.js` 24개 | 순수 SQL 전담 |
| 독립 모듈 | updater / global-shortcut / spotlight / tray / auto-backup / trash-cleanup / widget-restore / link-sync / logger | main.js가 각 `init*()` 한 줄로만 물림 |
| preload | `preload.js` | frozen `contextBridge` `window.itda.*` |
| renderer | `renderer/views/*` 12개 + `renderer/shared/*` 40여개 | hash 라우터, `mount(root)`→cleanup |

- **IPC 채널 ~115개, 진짜 중복 없음.** `updater:checkNow`/`updater:quitAndInstall`만 2회 등록으로 잡히지만 `if (!app.isPackaged) { ... return; }` 분기라 실제로는 택일.
- **계층 규율 지켜짐**: renderer가 DB 직접 접근 안 함. ipc가 SQL 안 함.
- **SQLite PRAGMA (v2.58.25)**: WAL / synchronous=NORMAL / foreign_keys=ON / busy_timeout=5000 / cache_size=-16000 / temp_store=MEMORY / mmap=64MB, 연결 시 `optimize`, 종료 시 `optimize`+`wal_checkpoint(TRUNCATE)`. **양호.**
- **에러 로깅**: `logger.js`가 main `uncaughtException`/`unhandledRejection` → `userData/logs/error.log`. renderer는 preload `itda:log-error` + `shell.js` `unhandledrejection` 안전망. `initDb` 실패 시 `dialog.showErrorBox` 후 종료. **양호.**
- **트랜잭션 사용처**: 반복 todo/event 생성, 구글 캐시 upsert, 메모폴더 reorder, 백업/복원(`data.ipc.js`). 단건 쓰기는 미사용(정상).
- **삭제 규율**: todo/event/memo/postit = soft delete(`deleted_at`), inbox = hard delete. 완전삭제는 `trash:permanentlyDelete`에서만. 하드 삭제 경로는 `deleteLinksFor`로 연결 정리.
- **연결(link)**: `item_links` 무방향 + 정규화(`canonicalizeLink`: 타입 랭크→id 순으로 a/b 고정) + `UNIQUE` 중복 방지 + 자기연결 금지. `discoverRelated`가 같은 카테고리/FTS 유사도로 추천(AI 없음). v2.58.25에서 위젯 종류별 그룹+컬러 이모지.

## B. 문제점 (우선순위)

### 🔴 P1 — 마이그레이션이 원자적이지 않음
`runLightweightMigrations(db)`가 `ALTER TABLE`/`CREATE TABLE`/`CREATE TRIGGER`/데이터 백필을
**트랜잭션 없이 순차 실행**. 실행 중 앱이 죽거나 한 문장이 throw하면 절반만 반영된 스키마가 남음.
대부분은 `if (!hasColumn(...))` 가드라 다음 실행에 자가치유되지만, **데이터 변형 블록 2개**
(`todos.status` 백필, 포스트잇 기본크기 보정)는 부분 적용/재적용 위험. 또 매 실행마다 모든
마이그레이션의 PRAGMA 체크가 다시 돎(싸지만 무한 누적).
→ **수정**: 본문 전체를 `db.transaction()`으로 감싸고, `PRAGMA user_version` 게이트로 최신이면
블록 자체를 건너뛴다. `main/db.js` 한 파일, 소규모, 위험 낮음.

### 🔴 P2 — 교차 엔티티 쓰기가 원자적이지 않음
"항목 생성 + 연결 생성"이 별도 IPC 2회(`todos:add` 후 `links:add`). 두 번째 실패 시 연결 없는
고아 항목(또는 그 반대)이 남음. 해당 경로: 포스트잇→Todo/일정 전환, Inbox→Todo/메모 전환 등.
`link-sync.js` 내용 전파도 `*:update` 직후 자체 디바운스로 도는 사이드이펙트라 원 쓰기 트랜잭션 밖.
→ **수정**: 전환/캡처 경로에 한해 repo에 "연결까지 한 트랜잭션" 메서드 추가. 중간 규모.

### 🟡 P3 — 하드 삭제 상대의 고아 연결
소프트 삭제는 연결 유지(복원 대비) — 의도됨. 하지만 하드 삭제된 상대의 `item_links` 행은
`listFor`가 읽는 시점에 `getPreview===null`로 걸러질 뿐(지연 청소) DB엔 남음. **문제**: v2.58.25에
추가한 `kindsForMany`(배지 일괄 조회)는 상대 존재 여부를 안 봄 → 하드 삭제된 Todo에만 연결됐던
포스트잇이 "Todo 연결됨" 배지를 계속 표시.
→ **수정**: `kindsForMany`에 상대 존재 필터 + 하드 삭제 시 `deleteLinksFor` 확인. 위험 낮음.

### 🟡 P4 — IPC 핸들러 대부분 try/catch 없음 (24개 중 ~7개만 보유)
Electron 설계상 throw는 renderer `invoke()` 프라미스를 reject → 대부분 호출부가
`errorToast(e, ...)`로 처리하므로 **대체로 허용 가능**. 단 일부 renderer의 await/catch 없는
fire-and-forget 호출은 `unhandledrejection`이 됨. main이 아니라 **renderer 호출부** 감사 대상. 낮음.

### 🟡 P5 — 단축키 이원화 (이번엔 파악만)
1. `shortcuts.js` `SHORTCUTS[]` — 재바인딩 가능 8개, `findConflict()` 있음:
   `quickCapture ⌘K` · `globalQuickCapture ⌘⌥I` · `globalQuickFind ⌘⇧Space`(✅현행 유지) ·
   `commandPalette ⌘⇧P` · `toggleSidebar ⌘\` · `toggleNotifications ⌘⇧N` ·
   `toggleTopbar ⌘⇧H` · `lockNow ⌘⌥L`.
2. **레지스트리 밖 하드코딩** 뷰별 keydown (findConflict 안 봄):
   - `shell.js`: `Ctrl/Cmd+1~9` 사이드바 이동 (v2.58.24)
   - `memo.js`: `⌘N`·`⌘F`, 맨키 `+` `f` `/` `a` `Delete`
   - `todo.js`: 맨키 `+`  · `postit.js`: `⌘N`
   - `calendar.js`: 맨키 `+ Tab m w d t f g ← →`
   - `dashboard.js`: 맨키 `n w e s t ← → Esc`
   런타임 충돌은 없음(뷰 스코프, `isUserTyping()` 가드). 다만 단일 소스가 없고 `f`=메모 폴더토글
   vs 캘린더 검색포커스, `w`=캘린더 주간뷰 vs 대시보드 위젯추가처럼 의미 불일치.
   → **추후**: 스크린 단축키 레지스트리를 만들어 `findConflict`에 합류. 이번엔 손대지 않음.

### 🟡 P6 — 저장소에 자동화 테스트 없음
`SMOKE_TEST.md`(수동) + CDP 스크립트(비커밋, 휘발) + eslint뿐. 프롬프트가 마이그레이션/IPC
변경 전 회귀 테스트 확보를 요구.
→ **수정**: `node:test`(빌트인, 프레임워크 없음)로 순수/핵심만 — 마이그레이션 멱등성,
`canonicalizeLink`, 반복 전개(`recurrence.js`), FTS 쿼리 빌더.

### 🟡 P7 — 시작/전환 성능 미계측
`initDb`(마이그레이션+optimize)는 창 표시 전 동기 — 빠름. 대시보드 mount가 설정 ~15개 +
todos + events + workCenter + widgets 프리페치, 위젯은 각자 또 로드. **측정된 수치 없음.**
→ **수정**: dev 플래그 뒤 시작/라우트 ms 로그부터. 그 다음 최적화.

### 🟢 양호
계층 규율 · PRAGMA · `closeDb` 생명주기 · soft/hard delete 규율 · 링크 정규화/중복방지 ·
에러 로거 · 디자인 토큰 · AI 흔적 없음.

### 참고: 기존 KNOWN_ISSUES 연계
- **Google OAuth 7일 토큰 만료**(2티어, 2회 재발): 동의화면 "테스트" 모드의 refresh token
  7일 제한이 근본 원인. 공용 OAuth 클라이언트 번들 + 동의화면 프로덕션 게시로 함께 해결 —
  단 Google Cloud Console 작업이라 **사용자 계정 필요**, 별도 처리(사용자가 "추후").
- **debounce load() null 참조**(3티어, 부분해결): `memo.js`/`inbox.js`/`tags.js` 3곳 가드 미비 —
  P6 테스트와 같이 스윕하면 자연스러움.

## C. 순차 진행 계획 (검색 제외)

| # | 파트 | 범위 | 위험 |
|---|---|---|---|
| **1** ✅ | STEP 1 분석 (본 문서) — v2.58.26 | 읽기 전용 | 없음 |
| **2** ✅ | 마이그레이션 안정화: `user_version` 게이트 + `runLightweightMigrations` 단일 트랜잭션 — v2.58.26 | `main/db.js` | 낮음 |
| **3** ✅ | 회귀 테스트(`node:test`): 마이그레이션 원자성·게이트·백필 / `canonicalizeLink` / 반복 전개. `npm test` + CI 게이트. FTS 빌더는 제외(검색 개편 예정) | `test/`, `scripts/run-tests.js`, CI | 없음 |
| **4** ✅ | 교차 엔티티 원자성: `*:add`에 `link`/`fromInbox` 옵션 → "항목 생성 + 연결/Inbox 처리표시"를 `repos.transaction` 한 방에. 전환(우클릭·Todo→일정)·Inbox 캡처가 이제 별도 IPC 2회가 아님 — v2.58.28 | `_shared.js`, 4개 add ipc, 4개 모달, context-menu/todo/inbox | 중간 |
| **5** ✅ | 고아 연결 정리: `kindsForMany`가 완전삭제된 상대는 배지 집계에서 제외(종류당 1쿼리로 존재 확인, 소프트삭제는 유지). 마이그레이션 v2 = 기존 고아 `item_links` 행 1회 청소. 하드삭제 경로(`purgeOne`/`inbox:delete`)는 이미 `deleteLinksFor` 호출 중 — v2.58.29 | `links.repository.js`, `db.js` | 낮음 |
| **6** ✅ | 시작/라우트 타이밍 계측: `main/perf.js` + `renderer/shared/perf.js`. 콘솔 전용·기본 꺼짐(개발 모드 자동 / 패키지 빌드는 `ITDA_PERF=1`). main은 initDb·IPC등록·createWindow·독립모듈·renderer로드완료, renderer는 스타일적용·initShell·라우트별 mount ms. 최적화는 이 수치 본 뒤 별도 — v2.58.30 | `main.js`, `app.ipc.js`, `preload.js`, `router.js` | 낮음 |
| **7** ✅ | 위젯 오류 격리: mount-time 로드는 이미 `Promise.allSettled`(격리 OK). `guardWidget(name, cardId, fn)` 추가 — 로더가 던지면 그 카드 안에만 "다시 시도" 인라인 오류(다른 위젯·대시보드 전체는 정상). mount·라이브새로고침·T키 전부 경유. 꾸미기 블록 렌더 루프 개별 try. `widget-loader.js` 동적 import에 `.catch`. CDP로 강제 실패 시 격리+복구 확인 — v2.58.31 | `dashboard.js`, `widget-loader.js`, `styles.css` | 낮음 |
| 8 | debounce load() null 가드 스윕 (memo/inbox/tags) | 3개 뷰 | 낮음 |
| — | (사용자가 추후) 검색 랭킹/초성/정규화/필터/일치이유 | — | — |
| — | (추후) 단축키 통합 레지스트리 (P5) | — | — |
| — | (사용자 계정 필요) 공용 OAuth 클라이언트 + 동의화면 게시 | — | — |

각 파트는 CLAUDE.md "세션당 한 작업 티어" 원칙에 따라 세션 단위로 진행하고, 끝날 때마다
변경 파일 / 내용 / 이유 / 테스트 결과 / 남은 문제를 요약한다.
