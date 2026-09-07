# T-003 — 인라인 라이브 프리뷰 + IME 조합 보류 가설 확인

작성일: 2026-09-08

<!-- wf:plan
task: T-003
title: 인라인 라이브 프리뷰 + IME 조합 보류 가설 확인
files: spike/src/editor/**, spike/src/App.jsx, package.json, .workflow/architecture.md
-->

## 1. 무엇을 왜

- 백로그: **B-002**

이번 사이클의 실제 검증이 여기서 시작된다. T-001 은 바닥만 깔았다.

`architecture.md` 3장에 **검증 대상 가설**로 적어둔 항목이 하나 있다:

> IME 조합 중에는 decoration 을 재계산하지 않는다.
> `compositionstart` ~ `compositionend` 사이에는 뷰 갱신을 보류한다.

이 task 는 그 가설을 확인한다. 확인 결과는 셋 중 하나다.

1. 보류가 필요하고 그것으로 충분하다 → 가설 확정, `architecture.md` 에서 "검증 대상" 표시 제거
2. 보류 없이도 멀쩡하다 → 불필요한 제약이므로 `architecture.md` 에서 항목 삭제
3. 보류해도 깨진다 → CM6 채택 자체를 재검토해야 한다. B-006 에 대안과 함께 기록

**어느 쪽이든 결론을 문서에 남기는 것이 이 task 의 산출물이다.** 코드가 아니다.

## 2. 현재 상태

실제로 파일과 타입 정의를 읽고 확인한 사실이다.

| 항목 | 확인된 내용 |
| --- | --- |
| `spike/src/editor/index.js` | `createEditor(parent, options)` 가 `history`, `keymap`, `updateListener` 만 조립한다. decoration 없음 |
| `spike/src/App.jsx` | 에디터 1개 + 문자 수 표시. 초기 문서는 빈 문자열 |
| 설치된 CM6 | `@codemirror/state` 6.7.4, `@codemirror/view` 6.43.11, `@codemirror/commands` 6.11.0. **마크다운 파서 없음** |
| `EditorView.composing` | `@codemirror/view` d.ts 776행. "조합 중이고 **최소 한 번 변경이 일어났을 때**" true |
| `EditorView.compositionStarted` | 같은 파일 784행. 조합 상태 진입만으로 true. d.ts 주석이 **"안드로이드에서는 단어에 커서를 올리기만 해도 조합이 시작되므로 이 값이 자주 true 가 된다"** 고 명시 |

**이 두 프로퍼티의 차이가 이번 검증의 핵심 변수다.** `compositionStarted` 로 보류를 걸면
안드로이드에서 거의 항상 보류 상태가 되어 라이브 프리뷰가 사실상 동작하지 않을 수 있다.
B-005·B-006 에서 안드로이드를 볼 때 이 차이가 드러난다.

## 3. 변경 내용

### 새로 만드는 것

| 경로 | 책임 | 신규/기존 |
| --- | --- | --- |
| `spike/src/editor/inline.js` | 인라인 마크다운 구문 → decoration. 커서가 없는 줄의 마커를 숨긴다 | 신규 |
| `spike/src/editor/imeLog.js` | composition 이벤트와 decoration 재계산 횟수를 기록. **검증 전용, 본 제품 이식 시 제거** | 신규 |

### 고치는 것

| 경로 | 어떻게 |
| --- | --- |
| `spike/src/editor/index.js` | `createEditor` 에 `options.livePreview`(기본 true), `options.suspendOnComposition`(기본 true), `options.onLog` 를 추가하고 확장을 조립한다 |
| `spike/src/App.jsx` | 초기 문서에 4종 샘플을 넣고, 보류 ON/OFF 토글과 로그 패널을 붙인다 |
| `package.json` | `@codemirror/lang-markdown`, `@codemirror/language` 추가 |
| `.workflow/architecture.md` | 검증 결과에 따라 3장의 가설 항목을 확정·삭제·수정한다 (1장의 세 갈래) |

### 파싱 방식

**`@codemirror/lang-markdown` 의 Lezer 파서 + `syntaxTree` 순회를 쓴다.**
정규식 자체 파서를 쓰지 않는다 — `docs/prototype.html` 이 그 방식이었고
`docs/research.html` 4장이 중첩·경계 처리 한계를 지적했다. 같은 실수를 반복하지 않는다.

대상 노드는 4종의 **마커** 뿐이다. 내용 노드는 건드리지 않는다.

| 구문 | 숨길 마커 | 적용할 스타일 |
| --- | --- | --- |
| `**굵게**` | `EmphasisMark` (StrongEmphasis 안) | `font-weight: bold` |
| `*기울임*` | `EmphasisMark` (Emphasis 안) | `font-style: italic` |
| `` `코드` `` | `CodeMark` | 등폭 글꼴 + 배경 |
| `[텍스트](url)` | `LinkMark` + URL 부분 | 링크 색 + 밑줄 |

### 숨김 규칙

- 마커는 `Decoration.replace({})` 로 **화면에서만** 지운다. 문서는 바뀌지 않는다
- **커서가 있는 줄의 마커는 숨기지 않는다.** 판정 단위는 줄이다 (옵시디언 방식).
  선택 영역이 여러 줄에 걸치면 걸친 줄 전부를 원문으로 둔다

### 보류 처리와 토글

`suspendOnComposition` 이 true 일 때, ViewPlugin 의 `update` 에서
`update.view.composing` 이 true 면 **직전 `DecorationSet` 을 그대로 반환**하고 재계산하지 않는다.

**토글을 화면에 두는 이유** — 가설의 세 갈래(1장)를 가르려면 보류 ON 과 OFF 를
같은 조건에서 비교해야 한다. 토글 없이 ON 만 만들면 "보류가 필요한지" 를 판정할 수 없다.
구현 비용은 `Compartment` 하나다.

`composing` 을 쓰고 `compositionStarted` 는 쓰지 않는다. 2장에 적은 대로 후자는
안드로이드에서 상시 true 에 가까워 보류가 풀리지 않을 수 있다.
다만 **이 선택 자체가 B-005 에서 재검토 대상**이라는 것을 imeLog 가 두 값을 모두 기록해 남긴다.

### 공개 인터페이스

`spike/src/editor/index.js` — 기존 시그니처에 옵션 3개 추가

```js
/**
 * @param {HTMLElement} parent
 * @param {object}   [options]
 * @param {string}   [options.doc]                    초기 문서. 기본 ''
 * @param {(doc:string)=>void} [options.onChange]
 * @param {boolean}  [options.livePreview]            기본 true
 * @param {boolean}  [options.suspendOnComposition]   기본 true
 * @param {(entry:LogEntry)=>void} [options.onLog]    imeLog 항목이 생길 때마다 호출
 * @returns {EditorHandle}
 */
export function createEditor(parent, options)

/**
 * @typedef {object} EditorHandle
 * @property {EditorView} view
 * @property {() => string} getDoc
 * @property {() => void}   destroy
 * @property {(on:boolean) => void} setSuspendOnComposition   토글. 재마운트 없이 전환한다
 */
```

`spike/src/editor/inline.js`

```js
/**
 * 인라인 마크다운 마커를 커서 없는 줄에서 숨기는 확장.
 * @param {object} [opts]
 * @param {() => boolean} [opts.suspended]  true 를 반환하면 재계산을 건너뛴다
 * @returns {import('@codemirror/state').Extension}
 */
export function inlinePreview(opts)
```

`spike/src/editor/imeLog.js`

```js
/**
 * @typedef {object} LogEntry
 * @property {number} t                     performance.now()
 * @property {string} kind                  'compositionstart' | 'compositionend' | 'recalc' | 'skip'
 * @property {boolean} composing            EditorView.composing 값
 * @property {boolean} compositionStarted   EditorView.compositionStarted 값
 * @property {number} docLength
 */

/**
 * @param {(entry:LogEntry)=>void} sink
 * @returns {import('@codemirror/state').Extension}
 */
export function imeLog(sink)
```

`imeLog` 는 검증 전용이다. 본 제품 이식 시 제거한다 (`architecture.md` 1장).

## 4. 수용 기준

**구현이 됐는지**

- [ ] **B1** 초기 문서에 `**굵게**`, `*기울임*`, `` `코드` ``, `[링크](https://example.com)` 가
      각각 다른 줄로 들어 있고, 커서를 그 줄 밖에 두면 **네 줄 모두** 마커가 화면에서 사라지고
      각각 굵게·기울임·등폭·링크 스타일로 보인다
- [ ] **B2** 커서를 그 줄 안으로 옮기면 그 줄만 마커가 다시 나타난다. 다른 줄은 그대로 숨겨져 있다
- [ ] **B3** B1·B2 상태 어느 쪽에서든 `handle.getDoc()` 이 반환하는 문자열이
      원문과 **완전히 같다** (마커 포함). decoration 이 문서를 건드리지 않았음을 뜻한다
- [ ] **B4** 화면의 보류 토글을 끄고 켤 수 있고, 상태가 로그 패널에 표시된다

**가설 검증**

- [ ] **B5** 보류 **ON** 상태에서 데스크톱 Chrome 으로 `**한글을 굵게**` 를 한 번에 타이핑했을 때
      커서 튐과 글자 중복이 없다
- [ ] **B6** 보류 **OFF** 상태에서 같은 입력을 했을 때의 결과를 관찰해 기록한다
      (깨지든 안 깨지든 **관찰 결과 자체가 산출물**이다. 여기서 "깨짐" 은 실패가 아니다)
- [ ] **B7** 로그 패널에 `compositionstart` → `recalc`/`skip` → `compositionend` 순서가 남고,
      보류 ON 일 때 조합 중 `skip` 이 1회 이상 기록된다
- [ ] **B8** B5~B7 의 결과에 따라 `architecture.md` 3장의 가설 항목이
      **확정 / 삭제 / 수정** 중 하나로 처리되고, 그 근거가 문서에 적혀 있다

**회귀**

- [ ] **B9** `npm run build && npm run build:spike` 종료 코드 0
- [ ] **B10** `npm run lint` 종료 코드 0, 경고 0건
- [ ] **B11** T-001 의 A4(상위 경로 참조 0건)가 여전히 성립한다

## 5. 검증 방법

| 수용 기준 | 검증 수단 | 자동/수동 |
| --- | --- | --- |
| B1 | dev 서버 화면에서 커서를 문서 끝 빈 줄에 두고 4줄 관찰 | 수동 |
| B2 | 각 줄을 클릭해 마커 재출현과 다른 줄 유지 확인 | 수동 |
| B3 | 콘솔에서 `handle.getDoc()` 결과를 원문 리터럴과 `===` 비교 | 수동(스니펫) |
| B4 | 화면 토글 조작, 로그 패널 표시 확인 | 수동 |
| B5 | 보류 ON 에서 `**한글을 굵게**` 직접 타이핑 | 수동 |
| B6 | 보류 OFF 에서 같은 입력, 결과 기록 | 수동 |
| B7 | 로그 패널 내용 확인 | 수동 |
| B8 | `.workflow/architecture.md` diff 확인 | 수동 |
| B9 | `wfctl check` 의 build | 자동 |
| B10 | `wfctl check` 의 lint | 자동 |
| B11 | `ls spike/src` 후 `grep -rn "\.\./" spike/src spike/index.html` → 0줄 | 자동(명령) |

이 task 의 핵심 판정(B5~B7)은 **전부 수동이다.** IME 조합은 Playwright 로도 재현이 어렵다는 것이
B-004 의 확인 대상이며, 그 전까지는 사람이 직접 치는 것 외에 방법이 없다.

## 6. 영향 범위와 위험

**깨질 수 있는 곳**

- `spike/src/editor/index.js` 의 기존 시그니처 — 옵션을 **추가만** 하고 기본값을 주므로
  T-001 의 A8·A9(인자 검증, destroy 멱등성) 동작은 유지된다. B9~B11 로 회귀를 본다
- 번들 크기 — `lang-markdown` 이 Lezer 파서를 끌고 온다. 461KB 에서 더 는다.
  검증용 스파이크라 문제 삼지 않는다

**아키텍처 불변조건 저촉 여부**

| 불변조건 | 이 task 에서 |
| --- | --- |
| `spike/` ↔ `src/` 격리 | B11 로 확인 |
| 문서 원본은 `EditorState` 하나 | 로그는 별도 배열이지만 **문서 사본이 아니다**. `App.jsx` 는 여전히 문서 문자열을 들지 않는다 |
| decoration 이 문서를 변경하지 않음 | **B3 이 이것을 직접 검사한다** |
| IME 조합 중 재계산 보류 | **이 task 가 검증하는 가설 자체다.** 결과에 따라 문서를 고친다 (B8) |
| `editor -X-> spike-app` | `inline.js`·`imeLog.js` 는 React 를 import 하지 않는다 |

**롤백 방법**

git 저장소가 있으므로 커밋 단위로 되돌린다.
**build 착수 전에 T-001 완료 상태를 커밋해 둔다** — 이 task 는 실패 가능성이 실재하는
검증이므로 되돌릴 지점이 명확해야 한다.

## 7. 하지 않는 것

- **표·코드블록 위젯** — B-003. 블록을 위젯으로 치환하면 커서 진입·이탈 문제가 겹쳐
  IME 가설 검증이 뒤섞인다. 인라인만으로 가설을 먼저 가른다
- **제목(`#`)·목록·인용 마커** — 4종 외의 구문은 건드리지 않는다.
  범위를 넓히면 실패 원인 분리가 어려워진다
- **Playwright** — B-004
- **안드로이드 확인** — B-005. 2장에 적은 `compositionStarted` 문제는 거기서 본다
- **정규식 자체 파서** — 3장에 근거를 적었다
- **스타일 다듬기** — 굵게/기울임/코드/링크가 구분되면 충분하다. 색·간격 조정은 하지 않는다
- **`imeLog` 를 본 제품용으로 설계하기** — 검증 전용이다. 버릴 코드에 시간을 쓰지 않는다
