# config/

이 폴더는 `.gitignore`에 등록되어 있어 절대 GitHub에 올라가지 않습니다(README.md만 예외).

## google-credentials.json

Google Calendar 연동을 쓰려면 이 폴더에 `google-credentials.json` 파일을 넣어주세요.
Google Cloud Console에서 "데스크톱 앱" 타입으로 OAuth 클라이언트를 만들고 다운로드하면
아래와 같은 구조의 JSON 파일을 받게 됩니다:

```json
{
  "installed": {
    "client_id": "...",
    "client_secret": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "redirect_uris": ["http://localhost"]
  }
}
```

다운로드한 파일을 이름만 `google-credentials.json`으로 바꿔서 이 폴더(`itda/config/`)에
넣어두면, 설정 화면의 "Google Calendar 연결하기" 버튼이 자동으로 이 파일을 읽습니다.

파일이 없으면 연결 버튼을 눌렀을 때 "연동 파일이 없습니다" 안내가 뜨고 아무 일도
일어나지 않습니다 (에러로 앱이 죽지 않음).
