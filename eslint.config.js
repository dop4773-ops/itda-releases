// ESLint flat config — "앱을 아예 못 띄우는" 종류의 오류(no-undef, no-dupe-keys, no-const-assign,
// no-unreachable 등)를 CI/로컬에서 미리 잡는 게 목적. 스타일 규칙은 넣지 않는다.
// 바닐라 JS 유지 — TypeScript 전환 안 함.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'config/**', 'docs/**', 'package-lock.json'],
  },

  js.configs.recommended,

  // main 프로세스 + 빌드 스크립트 — CommonJS, Node 전역
  {
    files: ['main/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 'latest',
      globals: { ...globals.node },
    },
  },

  // preload — CommonJS(require)지만 렌더러 컨텍스트라 window/location도 씀(하이브리드)
  {
    files: ['preload.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 'latest',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // renderer — ES 모듈(<script type="module">), 브라우저 전역
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        // preload.js가 contextBridge로 노출하는 유일한 렌더러 API
        itda: 'readonly',
      },
    },
    rules: {
      // Electron 렌더러에서 네이티브 prompt는 아예 동작 안 하고(몇 주간 조용히 고장난 전례),
      // confirm/alert도 쓰지 않는다 — 커스텀 다이얼로그로 통일. 재발을 에러로 막는다.
      'no-restricted-globals': [
        'error',
        { name: 'prompt', message: 'Electron 렌더러에서 동작 안 함 — shared/text-prompt.js의 promptText() 사용' },
        { name: 'confirm', message: 'shared/confirm-dialog.js의 confirmDialog() 사용' },
        { name: 'alert', message: 'toast() 또는 shared/confirm-dialog.js 사용' },
      ],
    },
  },

  {
    rules: {
      // "못 띄우게 만드는" 참조/문법 오류는 에러로 유지(= eslint:recommended 기본값 그대로):
      //   no-undef, no-dupe-keys, no-dupe-args, no-const-assign, no-unreachable,
      //   no-func-assign, no-obj-calls, no-import-assign, constructor-super ...
      // 아래 둘만 "경고"로 낮춘다 — 기존 코드에 다수 존재하고, 앱 실행을 막지는 않음(프롬프트: 에러만 0).
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
