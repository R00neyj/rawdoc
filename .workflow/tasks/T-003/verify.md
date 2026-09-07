# T-003 검증 리포트

검증일: 2026-09-08

<!-- wf:verify
task: T-003
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

`wfctl check` 실행 결과 (2026-09-08). B4 결함 수정 후 재실행한 것이 최종이다.

| 체크 | 명령 | 종료코드 | 판정 |
| --- | --- | --- | --- |
| build | `npm run build --silent && npm run build:spike --silent` | 0 | pass |
| lint | `npm run lint --silent` | 0 | pass |
| test | (config 에서 비활성) | — | 해당 없음 |
| typecheck | (config 에서 비활성) | — | 해당 없음 |

본 앱 32 modules → `dist/assets/index-zMWEHxTa.js` 193.91 kB (gzip 60.94 kB).
spike 51 modules → `dist-spike/assets/index-CeZToJG8.js` **694.42 kB** (gzip 236.27 kB).

spike 번들이 500 kB Vite 경고선을 넘는다. Lezer 마크다운 파서가 들어오면서 커진 것으로
T-001 기준선(약 190 kB)의 3.6배다. 검증용 스파이크이므로 이번 사이클에서는 문제 삼지 않되,
본 제품 이식 시 코드 분할이 필요하다는 사실은 5장에 남긴다.

## 2. 수용 기준 대조

### 구현 확인 (B1~B4)

브라우저 자동화로 `http://localhost:5175/` 에서 실측했다.
CM6 view 인스턴스 접근 경로는 `document.querySelector('.cm-content').cmTile.view` 다
(`.cmView` 가 아니다 — @codemirror/view 6.43 의 내부 구조).

| 기준 | 확인 방법 | 결과 |
| --- | --- | --- |
| B1 | 커서를 5번 빈 줄에 두고 `.cm-line` 의 `textContent` 4개를 읽음 + 스크린샷 | **pass** |
| B2 | 실제 마우스 클릭 + `view.dispatch({selection})` 양쪽으로 2·4번 줄에 커서 배치 | **pass** |
| B3 | 각 상태에서 `view.state.doc.toString() === SEED` 비교 | **pass** |
| B4 | 체크박스 조작 → 라벨 갱신과 로그 기록 확인 | **pass** (1차 fail → 수정 후 pass) |

**B1 관찰 내용.** 커서가 5번(빈) 줄일 때 1~4번 줄의 렌더 텍스트는 각각
`굵게 는 이 줄에 있습니다` / `기울임 은 이 줄에 있습니다` / `인라인코드 는 이 줄에 있습니다` /
`링크 는 이 줄에 있습니다` 였다. 즉 `**`, `*`, 백틱, `[`·`](https://example.com)` 가
모두 화면에서 사라졌다. 같은 시점에 `.md-strong` 1개, `.md-em` 1개, `.md-code` 1개,
`.md-link` 1개가 DOM 에 존재했고, 스크린샷에서 굵게·기울임·등폭+회색배경·파란밑줄이 육안으로 확인됐다.

**B2 관찰 내용.** 커서를 2번 줄로 옮기자 2번 줄만 `*기울임* 은 이 줄에 있습니다` 로
원문이 돌아왔고, 1·3·4번 줄은 숨김 상태 그대로였다. 4번 줄로 옮겼을 때도 같은 방식으로
4번 줄만 `[링크](https://example.com) 는 이 줄에 있습니다` 가 됐다.
줄 단위 판정(옵시디언 방식)이 계획대로 동작한다.

앞선 시도에서 `document.getSelection()` + `Range` 로 커서를 옮겼을 때는 반응이 없었다.
CM6 가 자기 state 를 기준으로 DOM 을 되돌리기 때문이다. **B-004 의 Playwright 는
DOM Selection 조작이 아니라 실제 클릭이나 `view.dispatch` 를 써야 한다.**

**B3 관찰 내용.** 위 네 상태(커서 1·5·2·4번 줄) 전부에서 `doc === SEED` 가 `true`,
`doc.length` 가 151 로 고정이었다. 화면의 문자 수 표시도 151 을 유지했다.
한글 입력 후에도 같았다 — 168자 시점의 문서가 8번 줄 `**한글조합**`,
9번 줄 `*한글을 굵게*` 로 사용자가 친 그대로였다.
decoration 이 문서를 건드리지 않는다는 아키텍처 불변조건이 실측으로 확인됐다.

**B4 — 1차 검증에서 fail 이었고, 고친 뒤 pass.**

1차 구현에서 토글은 전환되고 라벨(`… ON` / `… OFF`)도 갱신됐으나
**토글 상태가 로그 패널에 전혀 남지 않았다.** 로그 항목은 `recalc` / `skip` 두 종류뿐이라
조합 중이 아닐 때는 보류 ON 이든 OFF 든 똑같이 `recalc` 이 찍혔다.
계획 4장의 "상태가 로그 패널에 표시된다" 를 충족하지 못한다.

이것이 단순한 표기 문제가 아니라는 것은 B6 에서 드러났다. 사용자가 보류 OFF 로 타이핑한
사실을 **로그만 보고는 확인할 수 없었다** — ON 구간과 구분이 안 되기 때문이다.
B-006 에서 3개 환경의 ON/OFF 를 비교할 때 같은 문제가 그대로 반복된다.

`wfctl phase build` 로 되돌아가 `spike/src/App.jsx` 의 토글 `onChange` 에서
`makeEntry('suspend:on' | 'suspend:off', view)` 를 로그에 넣도록 고쳤다.
`spike/src/editor/imeLog.js` 의 `LogEntry.kind` 주석에도 두 값을 추가했다.
재검증 결과 토글 조작이 다음과 같이 기록된다:

```
suspend:off composing=false started=false len=151
suspend:on  composing=false started=false len=151
```

### 가설 검증 (B5~B8)

사용자가 데스크톱 Chrome 에서 직접 한글을 타이핑했다.
브라우저 자동화의 `type` 은 `compositionstart` 없이 문자를 그대로 삽입하므로
IME 조합을 재현하지 못한다. 이 경로로 대신 통과시키지 않았다.

| 기준 | 결과 |
| --- | --- |
| B5 보류 ON 에서 커서 튐·글자 중복 없음 | **pass** |
| B6 보류 OFF 에서의 결과 관찰·기록 | **pass** (기준은 "관찰했는가" 다) |
| B7 로그 순서와 조합 중 skip 1회 이상 | **pass** |
| B8 `architecture.md` 3장 가설 처리 | **pass** — '수정' 으로 처리 |

**B5 관찰 내용 — 보류 ON.**
사용자 보고: "잘됨". 문서 상태가 이를 뒷받침한다. 입력 결과가
8번 줄 `**한글조합**`, 9번 줄 `*한글을 굵게*` 로 남았고,
`ㅎ` / `한` 같은 미완성 자모나 중복 글자가 하나도 섞이지 않았다.
문서 길이 168자가 두 줄의 실제 문자 수와 정확히 일치한다.

**B7 관찰 내용 — 로그 50건.** 연속 중복을 압축한 순서다.

```
recalc(composing=f, started=f) x3     len 159→160
compositionstart(f, t)                len 160
  skip(t, t) x5                       len 161
compositionend(f, f)                  len 161
compositionstart(f, t)                len 161
  skip(t, t) x3                       len 162
compositionend(f, f)                  len 162
compositionstart(f, t)                len 162
  skip(t, t) x3                       len 163
compositionend(f, f)                  len 163
recalc(f, f) x1                       len 164     ← 공백. 조합 없음
compositionstart(f, t)                len 164
  skip(t, t) x4                       len 165
compositionend(f, f)                  len 165
compositionstart(f, t)                len 165
  skip(t, t) x2                       len 166
compositionend(f, f)                  len 166
recalc(f, f) x19                      len 166→168 ← 별표 2개. 조합 없음
```

집계: `recalc` 23, `compositionstart` 5, `skip` 17, `compositionend` 5.
`compositionstart → skip → compositionend` 순서가 5 사이클 모두 성립하고,
조합 1회당 `skip` 이 2~5건씩 걸렸다. 기준(1회 이상)을 넘는다.

**여기서 계획에 없던 사실이 하나 확인됐다.**
`compositionstart` 시점의 값이 매번 `composing=false, started=true` 다.
`view.composing` 은 조합 진입만으로는 켜지지 않고 첫 변경이 일어나야 켜진다 —
`@codemirror/view` d.ts 776행의 설명 그대로다.
결과적으로 **조합 진입 직후 첫 update 1건은 보류를 타지 않고 통과한다.**
데스크톱에서는 이 1건이 아무 문제를 일으키지 않았지만,
안드로이드에서도 그런지는 B-005 에서 확인해야 한다.

**B6 관찰 내용 — 보류 OFF.**
사용자 보고: "했는데 ON 과 똑같이 잘 됐음". 커서 튐도 글자 중복도 없었다.

**이 항목의 로그 근거는 남지 않았다.** B4 결함 때문이다 — 당시 구현은 토글 상태를
로그에 기록하지 않았고, 로그 상한 50건 안에는 ON 구간만 남아 있었다.
지금은 고쳤으므로 다음 관찰부터는 `suspend:off` 구간이 로그에 표시된다.
기준 B6 은 "결과를 관찰해 기록한다" 이고 관찰과 기록은 이뤄졌으므로 pass 로 적되,
근거의 약함은 5장에 남긴다.

**B8 처리 — 세 갈래 중 '수정'.**

계획 1장이 제시한 갈래는 ①확정 ②삭제 ③CM6 재검토였다.
데스크톱 결과만 보면 ②(불필요하므로 삭제)에 해당하지만, 삭제하지 않고 범위를 좁혔다.
`.workflow/architecture.md` 3장의 해당 항목을 다음 내용으로 고쳤다:

- 제목을 **"데스크톱 Chrome 에서는 불변조건이 아니다"** 로 바꾸고 원래 서술을 주석으로 보존
- 삭제하지 않는 이유 3가지를 명시 —
  (1) 안드로이드·WebView 미검증이고 같은 문서의 마지막 불변조건("한 환경 통과를
  전체 통과로 적지 않는다")이 적용된다, (2) 보류는 실제로 재계산 17건을 걸렀다.
  없어도 멀쩡했다는 것이지 아무 일도 안 했다는 뜻이 아니다,
  (3) 지금 제거하면 안드로이드에서 재검증할 수단이 사라진다
- `compositionstart` 시점 `composing=false` 사실과, `compositionStarted` 로 바꿀 때의
  트레이드오프(첫 1건은 막히지만 안드로이드에서 상시 true 위험)를 함께 기록

### 회귀 (B9~B11)

| 기준 | 확인 방법 | 결과 |
| --- | --- | --- |
| B9 | `wfctl check` 의 build | **pass** — 종료코드 0 |
| B10 | `wfctl check` 의 lint | **pass** — 종료코드 0, 경고 0건 |
| B11 | `grep -rn "\.\./" spike/src spike/index.html` | **pass** — 0줄 (종료코드 1) |

## 3. 사람 확인 체크리스트

- [x] **B5** 보류 **ON** 상태에서 `**한글을 굵게**` 타이핑
      → **확인함.** "잘됨". 커서 튐·글자 중복·별표 깜빡임 모두 없음
- [x] **B6** 보류 **OFF** 로 바꾸고 같은 입력
      → **확인함.** "했는데 ON 과 똑같이 잘 됐음"
- [x] **B7** 로그 패널 내용
      → 리포트 작성자가 직접 읽어 위 2장에 기록함

확인자: yjw1555@gmail.com

## 4. 에이전트 검증 리포트

`git status --porcelain` 과 `git diff --stat` 으로 변경 목록을 확인했다.
수정 3개(`spike/src/App.jsx`, `spike/src/editor/index.js`, `spike/src/editor/imeLog.js`),
신규 2개(`spike/src/editor/imeLog.js`, `spike/src/editor/inline.js`),
문서 1개(`.workflow/architecture.md`), 의존성 2개 추가(`package.json`, `package-lock.json`).

- **계획에 없는데 들어간 변경:** 없다.
  계획 3장의 파일 목록(`spike/src/editor/**`, `spike/src/App.jsx`, `package.json`,
  `.workflow/architecture.md`)을 벗어난 파일이 없다. `package-lock.json` 은
  `npm install` 의 부산물이다.

- **계획에 있는데 빠진 변경:** 없다. B8 로 `architecture.md` 까지 처리했다.

- **공개 인터페이스 대조:** 계획 3장에 적힌 시그니처와 실제 구현이 일치한다.
  `createEditor` 의 `livePreview`(기본 true)·`suspendOnComposition`(기본 true)·`onLog`,
  `EditorHandle` 의 `setSuspendOnComposition`, `inlinePreview(opts.suspended)`,
  `imeLog(sink)` 와 `LogEntry` 5필드가 모두 계획대로다.
  `LogEntry.kind` 에 `'suspend:on' | 'suspend:off'` 두 값이 늘었다 — B4 를 충족하기 위한
  추가이며 필드 구조는 그대로다.

- **아키텍처 불변조건 대조:**
  - `spike/` ↔ `src/` 상호 import 없음 → B11 로 확인
  - 문서 원본은 `EditorState` 하나 → `App.jsx` 는 `count`(숫자)와 `log`만 들고
    문서 문자열 사본을 두지 않는다. `setCount(handle.getDoc().length)` 로 길이만 읽는다
  - decoration 이 문서를 변경하지 않음 → B3 로 확인. 한글 입력 후에도 성립
  - 조합 중 재계산 보류 → **B8 로 범위를 좁혀 수정함.** 데스크톱은 불필요, 안드로이드 미검증
  - 3개 환경 각각 기록 → 이번 리포트는 **데스크톱 Chrome 만** 다룬다. 명시함

- **발견된 결함:**
  1. **B4 미충족 (수정 완료).** 위 2장에 경위를 적었다.
  2. **`EmphasisMark` 중복 숨김 가능성 — 실측으로 반증됨.**
     `**굵게**` 의 `StrongEmphasis` 와 `*기울임*` 의 `Emphasis` 가 같은 `EmphasisMark`
     이름을 쓰므로 오탐이 날 수 있다고 봤으나, B1 에서 네 줄 모두 정확히 숨겨졌고
     `md-strong`/`md-em` 이 각 1개씩만 잡혔다. Lezer 가 중첩을 제대로 구분한다.
  3. **`suspended()` 가 부수효과를 갖는다.** `index.js` 의 `suspended` 는 판정과 동시에
     `log()` 를 호출한다. 이름이 순수 술어처럼 보이지만 아니다.
     `inline.js` 는 재계산이 필요한 update 에서만 이 함수를 부르므로 로그가 부풀지는 않는다
     (실측: 커서 이동 3회에 로그 정확히 3건). 검증 전용 코드라 이번엔 그대로 두지만,
     본 제품 이식 시 `imeLog` 와 함께 제거되어야 한다.
  4. **`recalc x19` 구간.** 별표 2개를 넣는 동안 재계산이 19번 일어났다.
     커서 이동까지 포함된 수치이고 조합과 무관하지만, 인라인 프리뷰가
     타이핑 1회당 여러 번 `syntaxTree` 를 순회한다는 뜻이다.
     문서가 커졌을 때의 비용은 이번 스파이크 범위 밖이다. B-006 에 기록한다.

- **기존 호출부 영향:** `createEditor` 의 새 옵션 3개는 전부 기본값이 있고
  기존 호출 형태(`createEditor(parent, { doc, onChange })`)가 그대로 동작한다.
  호출부는 `spike/src/App.jsx` 하나뿐이다.

- **되돌리는 방법:** `git checkout -- spike/src package.json package-lock.json .workflow/architecture.md`
  후 `spike/src/editor/inline.js`·`imeLog.js` 삭제로 T-002 시점으로 완전히 돌아간다.

## 5. 남은 문제

- **B6 의 로그 근거가 없다.** 사용자 관찰("ON 과 똑같이 잘 됐음")만 있고
  `suspend:off` 구간이 남은 로그가 없다. B4 를 고친 지금은 기록되므로,
  **B-006 에서 3개 환경을 기록할 때 데스크톱 OFF 도 함께 재현해 기준선을 남긴다.**
  절차: 로그 지우기 → 토글 OFF → `**한글을 굵게**` 입력 → 로그에
  `suspend:off` 다음 조합 구간에 `skip` 이 아니라 `recalc` 이 찍히는지 확인.
- **데스크톱 Chrome 1개 환경만 검증했다.** 안드로이드 Chrome 과 Capacitor WebView 는
  B-005·B-006 이다. 이번 결과를 전체 결론으로 읽으면 안 된다.
- **`compositionStarted` 는 `compositionstart` 이벤트 시점에서만 관찰됐다.**
  안드로이드에서 "단어에 커서만 올려도 true" 가 실제로 나타나는지는 미확인이다.
  imeLog 가 두 값을 모두 남기므로 B-005 에서 바로 비교할 수 있다.
- **spike 번들 694 kB.** 검증용이라 이번 사이클에서는 방치한다.
  본 제품 이식 시 `@codemirror/lang-markdown` 의 코드 분할이 필요하다. B-006 에 반영할 사항이다.
- **재계산 빈도.** 위 결함 4번. 문서 크기에 따른 비용은 측정하지 않았다.
