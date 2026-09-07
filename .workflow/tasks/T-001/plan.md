# T-001 — spike 골격 — CM6 빈 에디터가 데스크톱 Chrome 에서 뜬다

작성일: 2026-09-07 · **rev.2** (1차 검토 R1~R5 반영)

<!-- wf:plan
task: T-001
title: spike 골격 — CM6 빈 에디터가 데스크톱 Chrome 에서 뜬다
files: spike/**, package.json, eslint.config.js, .workflow/config.json
-->

## 1. 무엇을 왜

- 백로그: **B-001**

검증할 대상을 올릴 바닥이 없다. `docs/prototype.html` 은 단일 HTML 이고 `src/` 는 Vite 스캐폴드
그대로라, CodeMirror 6 인스턴스가 실제로 뜨는 화면이 이 저장소에 하나도 없다.

이 task 는 **IME 검증을 하지 않는다.** 검증은 B-002 부터다. 여기서는
"CM6 가 이 프로젝트의 빌드·린트 파이프라인 안에서 `src/` 를 오염시키지 않고 돌아간다" 만 확인한다.

## 2. 현재 상태

실제로 파일을 열고 명령을 돌려 확인한 사실이다.

| 파일 | 지금 하는 일 |
| --- | --- |
| `package.json` | 스크립트 4개: `dev`(vite), `build`(vite build), `lint`(eslint .), `preview`. 의존성은 react/react-dom 뿐 |
| `vite.config.js` | `defineConfig({ plugins: [react()] })` 만. root 지정 없음 → 프로젝트 루트의 `index.html` 이 유일한 엔트리 |
| `index.html` | `/src/main.jsx` 를 로드. 루트 빌드의 진입점 |
| `src/main.jsx` | `createRoot` 로 `App` 렌더. Vite 기본 스캐폴드 |
| `src/App.jsx` | Vite+React 로고 카운터 데모. 제품 코드 아님 |
| `eslint.config.js` | `globalIgnores(['dist'])` 뿐이고 대상이 `**/*.{js,jsx}` → **`spike/` 를 만들면 자동으로 lint 대상에 들어온다** |
| `node_modules/` | `@codemirror/*`, `codemirror`, `@lezer/*` **없음**. 설치가 필요하다 |
| 빌드 기준선 | 변경 전 `npm run build`·`npm run lint` 모두 **종료 코드 0**, `dist/` 생성됨 (2026-09-07 측정) |
| 저장소 | **git 저장소가 아니다.** `git revert` 로 되돌릴 수 없다 (6장 롤백 참조) |
| `wfctl.js:239` | 체크 명령을 `cp.execSync(command)` 로 실행 → Windows 에서 cmd.exe 가 처리하므로 `&&` 연결이 동작한다 |
| `docs/prototype.html` | textarea + 오버레이 방식. 이 task 에서 읽지도 고치지도 않는다 |

## 3. 변경 내용

### 새로 만드는 것

| 경로 | 책임 | 신규/기존 |
| --- | --- | --- |
| `spike/index.html` | spike 엔트리 HTML. `/src/main.jsx` 를 로드 | 신규 |
| `spike/vite.config.js` | `root` 를 `spike/` 로 고정한 별도 Vite 설정. 출력은 `dist-spike/` | 신규 |
| `spike/src/main.jsx` | `createRoot` 로 `App` 마운트 | 신규 |
| `spike/src/App.jsx` | 검증 화면 셸. 에디터 1개 + 문자 수 표시 | 신규 |
| `spike/src/editor/index.js` | CM6 `EditorView` 생성·해제. 확장 조립 지점 | 신규 |

`spike/src/editor/inline.js`, `blocks.js`, `imeLog.js` 는 **이 task 에서 만들지 않는다** (7장).

**`spike/vite.config.js` 의 제약** — 아래를 지키지 않으면 빌드가 엉뚱한 위치를 본다.

- `--config` 로 설정 파일을 지정해도 Vite 의 `root` 기본값은 **`process.cwd()`** 다.
  루트에서 실행할 것이므로 `root` 를 명시적으로 `spike/` 로 고정해야 한다
- 이 프로젝트는 `"type": "module"` 이라 `__dirname` 이 없다.
  `fileURLToPath(new URL(".", import.meta.url))` 로 디렉터리를 구한다
- `build.outDir` 을 root 바깥(`../dist-spike`)에 두므로 `emptyOutDir: true` 를 명시해야
  Vite 가 경고 없이 지운다

**에디터 구성** — `codemirror` 메타 패키지의 `basicSetup` 을 쓰지 않는다.
줄 번호·자동완성·괄호 매칭이 한꺼번에 붙어 이후 IME 관찰에 노이즈가 된다.
`@codemirror/state`, `@codemirror/view`, `@codemirror/commands` 3개만 설치하고
`history`, `defaultKeymap`, `historyKeymap` 정도만 직접 조립한다.

### 고치는 것

| 경로 | 어떻게 |
| --- | --- |
| `package.json` | 스크립트 2개 추가: `dev:spike` = `vite --config spike/vite.config.js`, `build:spike` = `vite build --config spike/vite.config.js`. 의존성 추가: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` |
| `eslint.config.js` | `globalIgnores(['dist'])` → `globalIgnores(['dist', 'dist-spike'])`. 빌드 산출물이 lint 대상에 들어오는 것을 막는다 |
| `.workflow/config.json` | `checks.build.command` 를 `npm run build --silent && npm run build:spike --silent` 로 변경. 이걸 안 하면 자동 체크가 spike 를 한 번도 빌드하지 않는다 |

기존 `src/`, `index.html`, `vite.config.js`, `docs/` 는 **한 줄도 고치지 않는다.**

### 공개 인터페이스

`spike/src/editor/index.js`

```js
/**
 * CM6 에디터를 parent 에 마운트한다.
 * @param {HTMLElement} parent      마운트 대상. HTMLElement 가 아니면 TypeError 를 던진다
 * @param {object}      [options]
 * @param {string}      [options.doc]       초기 문서. 기본 ''
 * @param {(doc:string)=>void} [options.onChange]  문서가 바뀔 때마다 호출
 * @returns {EditorHandle}
 */
export function createEditor(parent, options)

/**
 * @typedef {object} EditorHandle
 * @property {import('@codemirror/view').EditorView} view
 * @property {() => string} getDoc    현재 문서 원문
 * @property {() => void}   destroy   view 해제. 두 번째 호출부터는 아무 일도 하지 않는다
 */
```

`spike/src/App.jsx`

```jsx
export default function App()
```

`createEditor` 는 React 를 import 하지 않는다 (아키텍처 2장: `editor -X-> spike-app`).

## 4. 수용 기준

- [ ] **A1** `npm run dev:spike` 로 뜬 URL 을 데스크톱 Chrome 으로 열면 **테두리가 있는 에디터 영역**이
      보이고, 그 안을 클릭하면 커서가 깜빡인다
- [ ] **A2** 에디터를 클릭한 뒤 `abc` 를 입력하면 `abc` 가, 이어서 `가나다` 를 입력하면 `가나다` 가
      화면에 그대로 표시된다
- [ ] **A3** 화면에 문자 수가 표시되고, A2 의 입력에 따라 값이 `0 → 3 → 6` 으로 갱신된다
      (초기 문서는 빈 문자열이다. A1 의 판정은 문서 내용이 아니라 테두리와 커서로 한다)
- [ ] **A4** `spike/src/` 와 `spike/index.html` 안에 `../` 로 시작하는 경로 참조가 **0건**이다
      (구조가 얕아 상위 경로가 필요 없다. `spike/vite.config.js` 의 `outDir` 값은
      import 가 아니므로 검사 대상에서 제외한다)
- [ ] **A5** `npm run build` 와 `npm run build:spike` 가 각각 종료 코드 0 으로 끝난다
- [ ] **A6** A5 실행 후 `dist/index.html` 과 `dist-spike/index.html` 이 실제로 존재한다
- [ ] **A7** `npm run lint` 가 종료 코드 0 으로 끝난다 (경고 포함 0건)
- [ ] **A8** dev 서버가 뜬 상태에서 Chrome 콘솔에 아래를 붙여넣으면 `TypeError` 가 발생한다

      ```js
      const m = await import("/src/editor/index.js");
      m.createEditor(null);
      ```

- [ ] **A9** 같은 콘솔에서 아래를 실행해도 예외가 나지 않는다 (`destroy` 멱등성)

      ```js
      const m = await import("/src/editor/index.js");
      const el = document.createElement("div");
      const h = m.createEditor(el);
      h.destroy();
      h.destroy();
      ```

A2 는 IME 판정이 아니다. "글자가 화면에 나온다" 까지만 본다.
커서 튐·중복 입력 판정은 B-002 의 수용 기준이다.

A8·A9 의 모듈 경로가 성립하는 것은 Vite dev 서버의 root 가 `spike/` 이기 때문이다.
프로덕션 빌드에서는 성립하지 않으므로 **dev 서버 상태에서만** 확인한다.

## 5. 검증 방법

| 수용 기준 | 검증 수단 | 자동/수동 |
| --- | --- | --- |
| A1 | `npm run dev:spike` 실행 후 Chrome 으로 URL 접속, 테두리와 커서 확인 | 수동 |
| A2 | 위 화면에서 `abc` → `가나다` 순으로 직접 타이핑 | 수동 |
| A3 | 같은 화면의 문자 수 표시를 A2 와 함께 관찰 | 수동 |
| A4 | `grep -rn "\.\./" spike/src spike/index.html` → 출력 0줄 | 자동(명령) |
| A5 | `npm run build --silent && npm run build:spike --silent` → 종료 코드 0 | 자동(wf 체크) |
| A6 | `ls dist/index.html dist-spike/index.html` → 둘 다 존재 | 수동(명령) |
| A7 | `npm run lint --silent` → 종료 코드 0 | 자동(wf 체크) |
| A8 | dev 서버 + Chrome 콘솔에서 4장의 첫 번째 스니펫 실행, `TypeError` 확인 | 수동 |
| A9 | 같은 콘솔에서 4장의 두 번째 스니펫 실행, 무예외 확인 | 수동 |

이 task 에는 자동 테스트가 없다. Playwright 는 B-004 항목이며, 여기서 앞당기면
검증 대상이 없는 상태로 테스트를 쓰게 된다. A8·A9 가 수동인 것은 그 때문이며,
B-004 도입 시 두 항목을 Playwright 로 옮긴다.

## 6. 영향 범위와 위험

**깨질 수 있는 곳**

- `npm run build` — `package.json` 을 고치므로 루트 빌드가 영향을 받을 수 있다.
  변경 전 종료 코드 0 을 측정해 두었으므로(2장), 실패하면 원인이 이 task 임이 확정된다
- `npm run lint` — `spike/` 가 자동으로 lint 대상에 들어온다.
  `eslint-plugin-react-refresh` 의 `only-export-components` 규칙은 컴포넌트를 export 하는 파일에만
  발동하므로 `spike/src/editor/index.js` 는 대상이 아니어야 한다.
  그래도 걸리면 `eslint.config.js` 에 `spike/src/editor/**` 예외를 추가한다
- `.workflow/config.json` 의 build 명령 변경 — **이후 모든 task 의 verify 에 적용되는 전역 변경**이다.
  이 task 에서 `build:spike` 스크립트가 실제로 만들어져야 이후 verify 가 깨지지 않는다

**아키텍처 불변조건 저촉 여부**

| 불변조건 | 이 task 에서 |
| --- | --- |
| `spike/` 와 `src/` 상호 import 금지 | A4 로 확인. 상위 경로 참조가 0건이면 spike 밖을 볼 방법이 없다 |
| 문서 상태 원본은 `EditorState` 하나 | `App.jsx` 는 문자 수만 state 로 들고, 문서 문자열 사본을 두지 않는다 |
| decoration 이 문서를 변경하지 않음 | decoration 자체가 없다. B-002 대상 |
| IME 조합 중 재계산 보류 | 해당 없음. B-002 대상 |
| 3개 환경 각각 기록 | 해당 없음. B-006 대상 |

**롤백 방법**

이 저장소는 git 저장소가 아니므로 `git checkout` 으로 되돌릴 수 없다. 수동 절차:

1. `spike/` 와 `dist-spike/` 디렉터리 삭제
2. `package.json` 에서 `dev:spike`·`build:spike` 스크립트와 `@codemirror/*` 3개 의존성 제거 후 `npm install`
3. `eslint.config.js` 의 `globalIgnores` 를 `['dist']` 로 되돌림
4. `.workflow/config.json` 의 `checks.build.command` 를 `npm run build --silent` 로 되돌림

build 착수 **전에** `package.json`, `eslint.config.js`, `.workflow/config.json`
세 파일을 `.workflow/tasks/T-001/backup/` 에 복사해 둔다. 3개뿐이라 비용이 거의 없다.
`.workflow/**` 는 `docGlobs` 라 소스 변경으로 집계되지 않는다.

## 7. 하지 않는 것

- **라이브 프리뷰 / decoration** — B-002. 여기서 손대면 IME 가설 검증이 뒤섞인다
- **표·코드블록 위젯** — B-003
- **Playwright** — B-004. 검증 대상이 없는 상태로 테스트를 쓰지 않는다
- **Capacitor / 안드로이드** — B-005
- **마크다운 파싱** (`@codemirror/lang-markdown`) — B-002 에서 필요할 때 추가한다.
  지금 넣으면 A5·A7 에 이유 없는 변수가 는다
- **`basicSetup` 사용** — 3장에 근거를 적었다
- **`src/` 의 Vite 스캐폴드 정리** — 지우고 싶지만 `spike/` 와 무관하다. 손대지 않는다
- **`docs/prototype.html` 의 로직 이식** — 렌더러·댓글·페이지 목록 전부 이번 사이클 범위 밖이다
- **git 저장소 초기화** — 롤백 수단이 없다는 것은 실제 위험이지만 이 task 의 범위가 아니다.
  별도 항목으로 `backlog.yaml` 에 올릴지 review 단계에서 사람이 판단한다
