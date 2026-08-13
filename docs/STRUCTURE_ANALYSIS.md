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
