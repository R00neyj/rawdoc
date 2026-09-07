# T-001 검증 리포트

검증일: 2026-09-08

<!-- wf:verify
task: T-001
test:
build: pass
lint: pass
typecheck:
human: pass
agent: pass
-->

> 각 항목의 값은 `pass` 또는 `fail`. config.json 에서 켜진 항목만 요구된다.
> `test`·`typecheck` 는 config.json 에서 꺼져 있어 비워 둔다.

## 1. 자동 체크

`wfctl check` 실행 결과 (2026-09-08).

| 체크 | 명령 | 종료코드 | 판정 |
| --- | --- | --- | --- |
| build | `npm run build --silent && npm run build:spike --silent` | 0 | pass |
| lint | `npm run lint --silent` | 0 | pass |
| test | (config 에서 비활성 — B-004 에서 켠다) | — | 해당 없음 |
| typecheck | (config 에서 비활성 — JS 프로젝트) | — | 해당 없음 |

루트 빌드 32 modules, spike 빌드 39 modules. 두 산출물 모두 생성됨.
build 명령을 `&&` 로 연결하도록 바꾼 뒤 처음 돌린 것이고, spike 를 포함해 통과했다.

## 2. 수용 기준 대조

| 수용 기준 | 확인 방법 | 결과 |
| --- | --- | --- |
| A1 테두리 있는 에디터 영역이 보이고 클릭 시 커서가 깜빡인다 | 사람이 Chrome 으로 `http://localhost:5175/` 접속해 관찰 | **pass** — "테두리 상자 1개만 보임" |
| A2 `abc` → `가나다` 가 화면에 그대로 표시된다 | 사람이 직접 타이핑 | **pass** — "localhost 5175에서는 한글 작성 확인됨" |
| A3 문자 수가 `0 → 3 → 6` 으로 갱신된다 | 사람이 화면의 문자 수 표시 관찰 | **pass** — "입력한 글자 수만큼 갱신됨" |
| A4 `spike/src`·`spike/index.html` 에 상위 경로 참조 0건 | `ls spike/src` 로 대상 존재를 확인한 뒤 `grep -rn "\.\./" spike/src spike/index.html` | **pass** — 0줄. 검토 R6 이 지적한 "파일이 없어서 조용한 경우" 를 배제하기 위해 존재 확인을 선행했다 |
| A5 두 빌드가 각각 종료 코드 0 | `npm run build --silent && npm run build:spike --silent` | **pass** |
| A6 `dist/index.html`·`dist-spike/index.html` 존재 | `ls dist/index.html dist-spike/index.html` | **pass** — 둘 다 출력됨 |
| A7 lint 종료 코드 0, 경고 0건 | `npm run lint --silent` | **pass** — 출력 없음 |
| A8 `createEditor(null)` 이 TypeError 를 던진다 | 실행 중인 dev 서버 페이지에서 스니펫 실행 | **pass** — `TypeError: createEditor: parent 는 HTMLElement 여야 합니다` |
| A9 `destroy()` 두 번 호출해도 예외 없음 | 같은 페이지에서 스니펫 실행 | **pass** — 예외 없음 |

## 3. 사람 확인 체크리스트

spike dev 서버는 **http://localhost:5175/** 에 떠 있다
(5173·5174 는 이전에 실행된 `npm run dev` 두 개가 점유 중).

- [x] **A1** 검은 테두리가 있는 영역이 보이고, 클릭하면 커서가 깜빡인다 → **상자 1개만 보임**
- [x] **A2** `abc` → `가나다` 입력이 화면에 그대로 표시된다 → **한글 작성 확인됨**
- [x] **A3** 문자 수 표시가 입력에 따라 갱신된다 → **글자 수만큼 갱신됨**
- [x] **A8** `createEditor(null)` → TypeError
- [x] **A9** `createEditor(el)` 후 `destroy()` 두 번 → 예외 없음

A2 에서 커서 튐·글자 중복은 T-001 의 판정 대상이 아니다. 그것은 B-002 의 수용 기준이다.
여기서는 글자가 화면에 나오는지까지만 봤다.

확인자: yjw1555@gmail.com (A1·A2·A3 는 직접 관찰, A8·A9 는 브라우저 자동화로 실행해 결과 확인)

**A8·A9 의 실행 방식에 대한 기록** — 계획은 이 둘을 "사람이 콘솔에 붙여넣기" 로 잡았다.
실제로는 실행 중인 같은 dev 서버 페이지에서 브라우저 자동화로 스니펫을 돌려 결과를 받았다.
페이지도 코드도 계획과 동일하고 관찰된 값이 그대로 기록됐으므로 검증 내용은 같다.
B-004 에서 Playwright 가 들어오면 두 항목은 자동 테스트로 옮긴다.

## 4. 에이전트 검증 리포트

`git status --porcelain` 과 `git diff --stat` 으로 실제 변경을 확인했다.

**계획에 없는데 들어간 변경**

1. **`package-lock.json` 98줄 추가** — `npm install` 의 부산물이다.
   plan.md 의 `files` 마커에는 없지만 의존성 3개를 추가하면 필연적으로 따라온다.
   `restrictToPlannedFiles` 가 false 라 차단되지 않았다. 범위 이탈로 보지 않는다.
2. **`spike/src/App.jsx` 의 안내 문구와 스타일 객체** — 계획은 "에디터 1개 + 문자 수 표시" 만
   요구했다. 실제로는 제목(`Rawdoc spike — CM6 골격`), 한 줄 안내문, `styles` 객체가 들어갔다.
   테두리는 A1 이 요구한 것이라 필요하고 나머지는 화면을 읽을 수 있게 하는 최소치지만,
   **계획에 적히지 않은 추가인 것은 사실이다.**

**계획에 있는데 빠진 변경**

1. **`.workflow/tasks/T-001/backup/` 백업 복사** — 실행하지 않았다.
   T-002 에서 git 저장소가 생겨 초기 커밋 `c9696c5` 가 `package.json`·`eslint.config.js`·
   `.workflow/config.json` 세 파일의 변경 전 상태를 모두 담고 있다.
   review.md rev.2 판정 사유가 "git 이 있으면 커밋 되돌리기를 쓸 수 있다" 로 이 대체를
   미리 승인했다. 롤백 수단은 오히려 계획보다 강해졌다.

**발견된 결함**

없다.

- **StrictMode 이중 마운트 우려는 해소됐다.** `spike/src/main.jsx` 가 `StrictMode` 를 쓰므로
  개발 모드에서 `useEffect` 가 두 번 실행되는데, `App.jsx` 의 cleanup 이 `handle.destroy()` 를
  호출해 첫 인스턴스를 해제한다. 실제로 페이지에서 `document.querySelectorAll(".cm-editor").length`
  를 재보니 **1** 이었고, 사람이 눈으로 본 결과("테두리 상자 1개만 보임")와 일치한다.

**아키텍처 불변조건 대조**

| 불변조건 | 확인 |
| --- | --- |
| `spike/` ↔ `src/` 상호 import 금지 | A4 통과. `spike/src/App.jsx` 는 `./editor/index.js` 만 import |
| 문서 원본은 `EditorState` 하나 | `App.jsx` 는 `count`(숫자)만 state 로 든다. 문서 문자열 사본 없음 |
| `editor -X-> spike-app` | `spike/src/editor/index.js` 는 React 를 import 하지 않는다 |
| decoration 이 문서를 변경하지 않음 | decoration 자체가 없다 (B-002 대상) |

## 5. 남은 문제

- **spike 번들이 461KB** (gzip 149KB) 로 루트 빌드(194KB)보다 크다. CodeMirror 가 들어간
  결과이고 검증용 스파이크라 문제 삼지 않는다. 본 구현으로 이식할 때 다시 볼 일이다.
- **`npm run dev` 두 개가 백그라운드에 떠 있다** (포트 5173·5174). T-001 과 무관하지만
  포트를 점유하고 있어 `dev:spike` 가 5175 로 밀렸다. 정리는 사용자 판단에 맡긴다.
- **A8·A9 가 여전히 수동 항목이다.** B-004 에서 Playwright 를 도입하면 자동 체크로 옮긴다.
