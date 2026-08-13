# 새 버전 배포하기 (GitHub Releases)

잇다는 `electron-updater`로 `dop4773-ops/itda-releases` 저장소의 GitHub Releases를
확인해서 업데이트합니다. **설정 화면의 "업데이트 확인" 버튼**이 이 저장소를 봅니다.

전체 흐름: `package.json` 버전 올리기 → 빌드+GitHub 업로드(`npm run release:win`) →
GitHub에서 릴리즈 노트(변경사항) 작성 → 끝. 이후 사용자들은 설정 화면에서
"업데이트 확인" → "다운로드" → "재시작 후 설치"만 누르면 됩니다(전부 수동, 자동 설치 없음).

## 1. 버전 올리기

`package.json`의 `version` 필드를 올립니다 (예: `0.1.0` → `0.2.0`).
[시맨틱 버저닝](https://semver.org/lang/ko/) 권장: 기능 추가는 minor(0.X.0),
버그 수정만이면 patch(0.0.X), 큰 구조 변경이면 major(X.0.0).

```json
{
  "version": "0.2.0"
}
```

## 2. GitHub 토큰 준비 (최초 1회만)

`npm run release:win`이 GitHub에 파일을 올리려면 토큰이 필요합니다.

1. GitHub → 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens
   → Tokens (classic)** → **Generate new token**
2. 권한(scope): **repo** 전체 체크 (private 저장소면 필수, public이어도 repo 전체 권장)
3. 생성된 토큰을 환경변수로 등록 (매번 새 터미널에서 반복해야 하면 `~/.zshrc`에 추가):
   ```bash
   export GH_TOKEN=여기에_토큰_붙여넣기
   ```

## 3. 빌드 + GitHub 업로드

```bash
npm run release:win
```

이 명령이 하는 일:
- Windows용 NSIS 설치파일(.exe)을 빌드
- `dop4773-ops/itda-releases`에 새 GitHub Release를 만들고 설치파일 업로드
- `package.json`의 `version`을 기준으로 태그(`v0.2.0`)가 자동으로 붙음

## 4. 릴리즈 노트(변경사항) 작성 — 사용자에게 "뭐가 바뀌었는지" 보여주는 부분

`npm run release:win`은 파일만 올릴 뿐, 릴리즈 설명글은 비어있는 채로 만들어집니다.
이 설명글을 채워야 잇다 설정 화면에 "새 버전이 있어요" 알림과 함께 변경사항이 표시됩니다.

1. https://github.com/dop4773-ops/itda-releases/releases 접속
2. 방금 만들어진 릴리즈(예: `v0.2.0`) 옆의 **연필(수정)** 아이콘 클릭
3. **Describe this release** 칸에 변경사항을 적습니다. 예:
   ```
   - Todo 칸반보드 추가
   - 검색 버그 수정 (여러 단어 검색 시 오류 나던 문제)
   - Google Calendar 연동 추가
   ```
4. **Update release** 클릭

이 텍스트가 `electron-updater`를 통해 그대로 사용자의 설정 화면에 표시됩니다
(`renderer/views/settings.js`의 "새 버전이 있어요" 아래 박스).

## 5. 확인

앱을 실행 중인 다른 PC에서 설정 → "업데이트 확인" → 방금 작성한 릴리즈 노트가
보이는지, "다운로드" → "재시작 후 설치"까지 정상 동작하는지 확인합니다.

## 참고: 이 방식이 왜 이런 구조인가

한때 검토했던(그리고 예전 다른 사내 프로젝트에서 쓰던) 방식은 GitHub의 파일들을
매번 직접 통째로 복사해서 실행 파일 교체하는 방식이었는데, 이 방식은:
- 설치 프로그램(installer) 없이 포터블 실행 파일을 통째로 덮어써야 해서 구조가 복잡함
- 버전 비교, 파일별 재시도, 실패 시 롤백 등을 전부 직접 구현해야 함

잇다는 `electron-builder` + `electron-updater`가 이 전체 과정(버전 비교, 다운로드,
설치, 재시작)을 표준적으로 처리해주므로 이 방식을 그대로 쓰는 게 훨씬 간단하고
안정적입니다. 위 5단계만 반복하면 됩니다.
