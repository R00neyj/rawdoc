# T-004 — 표·코드블록 위젯 치환과 커서 진입/이탈

작성일: 2026-09-08

<!-- wf:plan
task: T-004
title: 표·코드블록 위젯 치환과 커서 진입/이탈
files: spike/src/editor/blocks.js, spike/src/editor/inline.js, spike/src/editor/index.js, spike/src/App.jsx, .workflow/architecture.md, .workflow/requirements.md
-->

## 1. 무엇을 왜

- 백로그: **B-003**

`docs/research.html` 이 이번 사이클에서 유일하게 **하지 말라고 권한 부분**이다.
그 문서 8장의 문장은 이렇다 — "1차에서는 인라인 요소만 라이브 프리뷰하고,
표·코드블록은 원문 그대로 두는 게 안전함. 블록을 위젯으로 치환하면
커서 진입·이탈 처리가 까다로워짐".

`requirements.md` 4장이 그 권고를 의도적으로 뒤집었다. 스파이크의 목적이
"가장 위험한 것을 먼저 확인" 이기 때문이다. **여기가 그 가장 위험한 지점이다.**

이 task 의 산출물도 T-003 과 같이 코드가 아니라 판정이다. 세 갈래 중 하나가 나온다.

1. 블록 위젯이 데스크톱에서 멀쩡하다 → B-005 에서 안드로이드로 넘어간다
2. 커서 진입/이탈은 되는데 IME 가 깨진다 → 보류 로직(T-003)이 블록에서는 실제로 필요하다는 뜻이다.
   `architecture.md` 3장의 항목이 다시 강해진다
3. 진입/이탈 자체가 안 된다 → **라이브 프리뷰 범위를 인라인으로 줄이는 판단**이 필요하다.
   research.html 8장의 권고가 옳았던 것이므로 `requirements.md` 4장을 되돌리고 B-006 에 근거를 적는다

## 2. 현재 상태

브라우저에서 실제 문서를 넣어 확인한 사실과, `node_modules` 를 직접 읽어 확인한 사실이다.

| 항목 | 확인된 내용 |
| --- | --- |
| `markdown()` 의 `base` 기본값 | **`commonmarkLanguage`** (`@codemirror/lang-markdown` d.ts). 즉 **GFM 표가 파싱되지 않는다** |
| 표 입력 결과 | `\| 이름 \| 값 \|` 이 아무 처리 없이 원문 그대로 표시됐다. `Table` 노드가 아예 생기지 않는다 |
| 펜스 코드블록 입력 결과 | **버그.** 9번 줄 `` ```js `` 가 화면에 `js` 로, 11번 줄 `` ``` `` 가 빈 줄로 나온다 |
| 그 버그의 원인 | `inline.js` 의 `MARKER` 에 있는 `CodeMark` 를 인라인 코드의 백틱과 펜스 울타리가 **공유한다**. 울타리가 숨겨지는데 `InlineCode` 가 아니라 `.md-code` 스타일은 안 붙는다 → 코드블록이 일반 문단과 구분되지 않는다 |
| Lezer 표 노드 | `Table` > `TableHeader` / `TableRow` > `TableCell`, 구분자 `TableDelimiter` (`@lezer/markdown` 소스에서 확인) |
| Lezer 코드블록 노드 | `FencedCode` > `CodeMark`(울타리) / `CodeInfo`(언어) / `CodeText`(내용) |
| `Decoration.replace` | `{ widget, block, inclusive, inclusiveStart, inclusiveEnd }` 를 받는다. `block` 기본 false, 블록일 때 `inclusive` 기본 **true** |
| `WidgetType` | `toDOM(view)` 필수. `eq(other)` 기본 구현이 **항상 false** — 구현하지 않으면 매 갱신마다 위젯을 새로 그린다 |
| `EditorView.atomicRanges` | 커서 이동과 삭제에서 범위를 통짜로 취급하게 하는 facet. **이번에는 쓰지 않는다** (3장) |

**코드블록 버그는 T-003 검증에서 드러나지 않았다.** SEED 에 코드블록이 없었기 때문이다.
이 task 에서 함께 고친다.

## 3. 변경 내용

### 진입/이탈 방식 — 자동 해제 (옵시디언 방식)

사람이 고른 방식이다. `requirements.md` 5장의 미해결 질문 ② 를 이것으로 닫는다.

- 커서나 선택 영역이 **블록 노드 범위와 겹치면** 그 블록은 위젯을 씌우지 않고 원문을 보여준다
- 겹치지 않으면 위젯으로 치환한다
- **`atomicRanges` 를 쓰지 않는다.**

> ### 1차 구현에서 이 전제가 틀렸음이 드러났다 (2026-09-08)
>
> "`atomicRanges` 를 안 쓰는 것이 곧 구현 방법이다" 라고 적었으나 **아니었다.**
> `atomicRanges` 없이도 방향키가 블록을 건너뛴다. 실측:
>
> | 출발 | 방향 | 도착 | |
> | --- | --- | --- | --- |
> | 8줄 | ↓ | 13줄 | 코드블록 9~12 통째로 건너뜀 |
> | 13줄 | ↑ | 8줄 | 같음 |
> | 13줄 | ↓ | 18줄 | 표 14~17 통째로 건너뜀 |
> | 18줄 | ↑ | 13줄 | 같음 |
>
> 원인은 `Decoration.replace({ block: true })` 자체다. `view.moveVertically` 가
> 블록 위젯을 **하나의 시각적 줄**로 보고 그 너머로 커서를 보낸다.
> `atomicRanges` 는 이 동작과 무관하다.
>
> 클릭 진입(C5)은 정상 동작하므로 완전히 막힌 것은 아니다.
> 1장의 세 번째 갈래(라이브 프리뷰를 인라인으로 제한)로 가기 전에 키맵 보조로 푼다.

### 방향키 보조 (1차 실패 대응)

`blocks.js` 가 `keymap` 확장을 함께 내보낸다. ArrowUp / ArrowDown 을 가로채:

1. `view.moveVertically` 가 주는 도착 줄을 미리 계산한다
2. 현재 줄과의 차이가 **1 이하면** 아무것도 하지 않고 `false` 를 돌려준다 (기본 동작에 맡긴다)
3. 2줄 이상 건너뛰었다면 블록 위젯을 넘은 것이므로,
   **바로 옆 줄**(아래로 이동이면 `현재+1`, 위로면 `현재-1`)로 selection 을 보낸다

그 줄이 블록 범위 안이므로 겹침 판정에 걸려 블록이 열린다. 그 다음 방향키부터는
블록이 이미 열려 있어 기본 동작이 정상적으로 한 줄씩 움직인다.

전제: **줄바꿈(line wrapping)을 켜지 않는다.** 켜면 한 논리적 줄이 여러 시각 줄이 되어
"차이가 1 이하" 판정이 무너진다. 현재 `createEditor` 는 `EditorView.lineWrapping` 을
넣지 않으므로 성립한다. 이 사실을 7장의 "하지 않는 것" 에 적는다.

선택 영역이 있는 상태(`!range.empty`)에서는 개입하지 않는다 — Shift+방향키의
선택 확장을 망가뜨리지 않기 위해서다.

인라인은 **줄** 단위로 판정하고, 블록은 **노드 범위** 단위로 판정한다.
표가 3줄이면 그 3줄 전체가 한 덩어리로 열리고 닫힌다.

### 새로 만드는 것

| 경로 | 책임 | 신규/기존 |
| --- | --- | --- |
| `spike/src/editor/blocks.js` | `Table` / `FencedCode` 를 위젯으로 치환. 커서가 겹치면 해제 | 신규 (경로는 `architecture.md` 2장에 이미 적힌 이름) |

내보내는 것은 하나다.

```js
/**
 * 표·코드블록을 위젯으로 치환하는 확장.
 * 커서나 선택이 블록 범위와 겹치면 그 블록만 원문으로 둔다.
 *
 * @param {object} [opts]
 * @param {() => boolean} [opts.suspended]  true 를 반환하면 재계산을 건너뛴다
 * @returns {import('@codemirror/state').Extension}
 */
export function blockPreview(opts)
```

`inlinePreview` 와 시그니처를 맞춘다. 같은 `suspended` 콜백을 공유해
보류 토글 하나가 인라인과 블록에 동시에 걸리게 한다.

내부 위젯 2종은 모듈 밖으로 내보내지 않는다.

- `TableWidget` — `<table>` 로 렌더. `TableHeader` 는 `<th>`, `TableRow` 의 `TableCell` 은 `<td>`
- `CodeWidget` — `<pre>` + 언어 라벨(`CodeInfo` 가 있을 때만). **구문 강조는 하지 않는다** (7장)

두 위젯 모두 `eq(other)` 를 구현한다. 비교 기준은 **원문 문자열 하나뿐**이다.
구현하지 않으면 커서를 움직일 때마다 위젯이 통째로 새로 그려져 깜빡인다 (2장 참조).

> **블록 시작 위치를 비교에 넣지 않는다** (검토 R4). 위치를 넣으면 블록 앞에서
> 글자 하나만 쳐도 모든 위젯이 새로 그려진다. 내용이 같으면 같은 위젯이고,
> 위치는 CM6 가 `DecorationSet` 쪽에서 따로 관리한다. C8 이 이것을 검사한다.

`toDOM` 이 만든 DOM 에 `mousedown` 핸들러를 단다. 클릭하면
`event.preventDefault()` 를 부른 뒤
`view.dispatch({ selection: { anchor: <블록 시작> } })` 로 진입시킨다.

- `WidgetType.ignoreEvent` 의 기본값이 "모든 이벤트 무시" 라서, 이 핸들러 없이는
  **마우스로 블록에 들어갈 수 없다.** 방향키로만 가능해진다
- `preventDefault` 를 빠뜨리면 CM6 가 그 뒤에 자기 방식으로 selection 을 다시 잡아
  진입 위치가 어긋난다 (검토 R6)

### 커서 겹침 판정 — 각자 구현한다 (검토 R5)

`inline.js` 에 이미 `activeLines` 가 있지만 `blocks.js` 가 재사용하지 않는다.
판정 단위가 다르기 때문이다 — 인라인은 **줄** 번호 집합, 블록은 **노드 범위** 겹침이다.
`blocks.js` 쪽은 `state.selection.ranges` 와 노드의 `from`/`to` 가 겹치는지만 보면 되는
세 줄짜리라 공용 유틸로 뽑을 만한 양이 아니다.
**이것이 중복이 아니라 의도된 분리임을 여기에 기록해 둔다.**

### 고치는 것

| 경로 | 어떻게 |
| --- | --- |
| `spike/src/editor/inline.js` | `enter` 에서 `Table` 또는 `FencedCode` 를 만나면 `return false` 로 **하위 순회를 막는다.** 2장의 `CodeMark` 오탐이 이것으로 사라진다 |
| `spike/src/editor/index.js` | `markdown({ base: markdownLanguage })` 로 GFM 을 켠다. `options.blockPreview`(기본 true)를 추가하고 `blockPreview({ suspended })` 를 조립한다 |
| `spike/src/App.jsx` | SEED 에 표 1개와 펜스 코드블록 1개를 추가한다. 블록 프리뷰 ON/OFF 토글을 붙인다 |
| `.workflow/architecture.md` | 3장에 진입 방식(자동 해제, atomicRanges 미사용)을 불변조건으로 추가한다. 결과에 따라 1장의 세 갈래를 반영한다 |
| `.workflow/requirements.md` | 5장 미해결 질문 ②(블록 위젯 진입 UX)를 "자동 해제로 확정" 으로 닫는다 |

### 조합 종료 시 밀린 재계산 따라잡기 (verify 6.5 대응, 2026-09-08)

1차 verify 에서 **결함 A** 가 재현됐다. 보류(`suspendOnComposition`)가 켜져 있을 때
조합 중 밀린 재계산이 `compositionend` 시점에 따라잡히지 않는다.

| 시점 | 관측 (`pre` 개수, 커서는 블록 밖) | 기대 |
| --- | --- | --- |
| 조합 중 | 0 | 0 — 보류의 의도된 결과 |
| `compositionend` 직후 | **0** | **1** |
| 그 다음 트랜잭션 후 | 1 | 1 |

`inline.js` 도 같다 — 조합 중 다른 줄로 이동하면 원래 줄의 마커가 계속 보이고,
조합이 끝나도 그대로 남는다.

**원인.** 두 확장 모두 갱신 트리거를 트랜잭션에만 의존한다.

- `inline.js:97` — `if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return`
- `blocks.js:246` — `if (!tr.docChanged && !tr.selection) return value`

`compositionend` 는 그 자체로 문서도 선택도 바꾸지 않는다. 따라서 밀린 계산을
따라잡을 시점이 **아예 없다.**

**수정.** `index.js` 가 `StateEffect` 를 하나 정의하고, `compositionend` 에서 그것을 보낸다.
두 확장은 그 effect 를 보면 `suspended()` 와 무관하게 재계산한다.

```js
// index.js
const forceRecalc = StateEffect.define()

EditorView.domEventHandlers({
  compositionend: (_event, view) => {
    // 이 시점에 CM6 가 아직 DOM 정리 중일 수 있다. 다음 틱에 보낸다.
    setTimeout(() => view.dispatch({ effects: forceRecalc.of(null) }), 0)
    return false
  },
})
```

effect 를 별도 모듈로 빼지 않고 `suspended` 처럼 **인자로 내려보낸다.**
`inline.js` / `blocks.js` 가 `index.js` 를 import 하면 순환이 생기기 때문이고,
새 모듈을 만들면 계획의 `files` 목록을 넓혀야 하기 때문이다.

- `inline.js` — `update.transactions.some(tr => tr.effects.some(e => e.is(forceRecalc)))`
- `blocks.js` — `tr.effects.some(e => e.is(forceRecalc))`

둘 다 참이면 조기 반환 두 줄을 모두 건너뛰고 `build()` 를 부른다.

**로그.** `forceRecalc` 로 돌린 재계산은 `recalc` 가 아니라 `recalc:end` 로 남긴다.
조합 종료가 갱신을 유발했다는 사실이 로그에서 보여야 B-006 의 3개 환경 비교에 쓸 수 있다.

**부작용 검토.** 조합이 끝날 때마다 재계산이 한 번 더 돈다. 보류를 켠 목적은
조합 **중** 재계산을 없애는 것이었으므로 이 한 번은 원래 설계 의도에 어긋나지 않는다.
보류가 꺼져 있으면 이미 매번 재계산하고 있어 추가 비용이 없다.

### 인라인 순회 차단이 만드는 부수 효과

`inline.js` 가 블록 안으로 안 들어가므로, **표 셀 안의 `**굵게**` 는 프리뷰되지 않는다.**
원문 그대로 남는다. 이번 스파이크에서는 그대로 둔다 — 표 위젯이 셀 내용을 직접 렌더하므로
위젯 상태에서는 어차피 `TableWidget` 이 그리고, 원문 상태에서는 원문이 보이는 게 맞다.
중첩 프리뷰는 7장의 "하지 않는 것" 이다.

### GFM 을 켜면서 함께 들어오는 것

`markdownLanguage` 는 GFM + subscript + superscript + emoji 다.
`Strikethrough`, `Task`, `Autolink` 같은 노드가 새로 파싱된다.
**스타일을 붙이지 않으므로 화면에는 원문 그대로 보인다.** 회귀 기준 C12 로 확인한다.

## 4. 수용 기준

**파싱과 치환**

- [ ] **C2** 커서가 블록 밖일 때 표는 `<table>` 로, 펜스 코드블록은 `<pre>` 로 치환돼 보인다.
      DOM 에 `.cm-content table` 1개, `.cm-content pre` 1개가 존재한다.
      **이것이 GFM 활성의 증거를 겸한다** — `<table>` 이 생겼다는 것은 `Table` 노드가
      파싱됐다는 뜻이다 (검토 R2 로 C1 을 삭제하고 여기에 흡수했다)
- [ ] **C3** 커서를 표 범위 안으로 옮기면 **그 표만** 원문 3줄로 열리고,
      같은 문서의 코드블록은 `<pre>` 위젯 상태를 유지한다. 반대도 성립한다

**커서 진입/이탈** — 이 task 의 핵심이다

- [ ] **C4** 위젯 바로 윗줄에서 ↓ 를 누르면 블록이 열리고 커서가 블록 안에 놓인다.
      블록을 벗어나면 다시 닫힌다. 커서가 사라지거나 문서 끝으로 튀지 않는다
- [ ] **C5** 위젯을 마우스로 클릭하면 그 블록이 열리고 커서가 블록 시작 위치에 놓인다
- [ ] **C6** C2~C5 어느 상태에서든 `view.state.doc.toString()` 이 원문과 완전히 같다
- [ ] **C7** 펜스 코드블록의 울타리 ``` 가 화면에서 사라지지 않는다 (2장의 버그 수정 확인).
      위젯 상태에서는 `<pre>` 안에, 원문 상태에서는 텍스트로 보인다
- [ ] **C8** 위젯이 불필요하게 다시 그려지지 않는다.
      블록 밖에서 커서를 5회 이동시킨 뒤에도 `<table>` DOM 노드가 **같은 인스턴스**다
      (이동 전 요소를 변수에 잡아두고 `===` 비교)

- [ ] **C15** 코드블록을 **만드는 도중에** 위젯이 씌워져 타이핑이 막히지 않는다 (검토 R3).
      빈 줄에서 ` ```js ` 를 치고 Enter 를 눌러 코드를 입력하는 동안 원문이 계속 보이고,
      울타리를 닫고 커서가 블록을 벗어나는 순간 `<pre>` 위젯으로 전환된다.
      **이것은 예외 경로가 아니라 사용자가 매번 지나가는 정상 흐름이다**

**IME**

- [ ] **C9** **C4 의 방향키 진입 직후 그 자리에서** 한글을 입력했을 때
      커서 튐과 글자 중복이 없다. `requirements.md` 4장 성공 기준 3번의 문장
      ("방향키로 진입/이탈할 때 원문이 정확히 복원되고 그 안에서 한글 입력이 동작한다")을
      그대로 따라간다
- [ ] **C10** 한글 조합 중에 방향키를 눌렀을 때 IME 가 셋 중 무엇을 하는지 로그로 판별해 기록한다
      (검토 R1). **(a)** 조합을 확정하고 이동 — `compositionend` 가 커서 이동보다 앞에 온다,
      **(b)** 조합을 유지한 채 이동 — `compositionend` 없이 `recalc`/`skip` 이 이어진다,
      **(c)** 아무 일도 안 함 — 로그에 변화가 없다.
      셋 중 무엇이든 **관찰 결과 자체가 산출물이다**
- [ ] **C16** 조합 중에 커서가 블록 밖(또는 다른 줄)으로 나간 뒤 `compositionend` 가 오면,
      **추가 조작 없이** 화면이 즉시 맞는 상태로 갱신된다.
      `blocks.js`(위젯 복구)와 `inline.js`(마커 숨김) 양쪽에서 확인한다.
      1차 verify 6.5 의 결함 A 가 이 기준이 된다
- [ ] **C11** 블록 프리뷰 ON/OFF 토글이 동작하고 `suspend:*` 와 같은 방식으로 로그에 남는다

**회귀**

- [ ] **C12** T-003 의 B1~B3 이 여전히 성립한다 (인라인 4종 숨김/복귀, 문서 원문 불변).
      GFM 을 켠 뒤에도 깨지지 않는지가 핵심이다
- [ ] **C13** `npm run build && npm run build:spike` 종료 코드 0, `npm run lint` 종료 코드 0 경고 0건
- [ ] **C14** 상위 경로 참조 0건 (`grep -rn "\.\./" spike/src spike/index.html`)

## 5. 검증 방법

| 수용 기준 | 검증 수단 | 자동/수동 | 누가 |
| --- | --- | --- | --- |
| C2 | `document.querySelectorAll('.cm-content table, .cm-content pre')` 개수 | 수동(스니펫) | 에이전트 |
| C3 | `view.dispatch({selection})` 로 커서를 표/코드블록에 각각 두고 DOM 비교 | 수동(스니펫) | 에이전트 |
| C4 | **실제 방향키 입력** (`computer` 도구의 key 액션). dispatch 로 대신하지 않는다 | 수동 | 에이전트 |
| C5 | 위젯 실제 클릭 후 `view.state.selection.main.head` 확인 | 수동 | 에이전트 |
| C6 | 각 상태에서 `doc.toString()` 을 원문 리터럴과 `===` 비교 | 수동(스니펫) | 에이전트 |
| C7 | 코드블록의 위젯/원문 양쪽 상태에서 ``` 가 보이는지 스크린샷 + DOM 확인 | 수동 | 에이전트 |
| C8 | 커서 이동 전후 `<table>` 요소 참조를 `===` 비교 | 수동(스니펫) | 에이전트 |
| C15 | 자동화로 ` ```js ` + Enter + 코드 입력 (영문이라 IME 불필요) | 수동 | 에이전트 |
| **C9** | **블록 안에서 `**한글을 굵게**` 직접 타이핑** | 수동 | **사람** |
| **C10** | **조합 중 방향키 조작, 로그로 (a)/(b)/(c) 판별** | 수동 | **사람** |
| **C16** | 합성 `CompositionEvent` 로 조합 재현 후 `compositionend`. 6.5 절차 그대로 | 수동(스니펫) | 에이전트 |
| C11 | 화면 토글 조작 후 로그 패널 확인 | 수동 | 에이전트 |
| C12 | T-003 verify 2장의 B1~B3 절차를 그대로 재실행 | 수동(스니펫) | 에이전트 |
| C13 | `wfctl check` | 자동 | — |
| C14 | `grep -rn "\.\./" spike/src spike/index.html` → 0줄 | 자동(명령) | — |

**C9·C10 은 사람이 해야 한다.** 브라우저 자동화의 `type` 은 `compositionstart` 없이
문자를 그대로 삽입하므로 IME 조합을 재현하지 못한다 (T-003 verify 2장, T-004 verify 6.1).

**단, 합성 `CompositionEvent` 로 갈 수 있는 데까지는 간다** (T-004 verify 6.2).
`compositionstart` 를 직접 dispatch 하고 `view.domAtPos()` 로 얻은 텍스트 노드를 고치면
CM6 의 DOMObserver 가 그것을 조합으로 인식한다 — `view.composing` 이 실제로 true 가 된다.

| 합성으로 되는 것 | 합성으로 안 되는 것 |
| --- | --- |
| 보류 경로(`skip`)가 실제로 밟히는지 | 실제 IME 가 방향키에 어떻게 반응하는지 (C10 의 (a)/(b)/(c)) |
| 조합 중 decoration 이 문서 변경을 따라가는지 | 브라우저가 contentEditable 을 직접 고칠 때의 충돌 |
| 조합 종료 후 화면이 맞는지 (C16) | 자모 단위 조합의 실제 타이밍 |

C16 은 **합성만으로 판정 가능하다** — 결함 A 가 합성으로 재현됐기 때문이다.
C9 는 합성 조건에서 통과했으나 실제 IME 확인이 남고, C10 은 합성으로 판별할 수 없다.

C4 는 자동화라도 **실제 키 이벤트**를 쓴다. `document.getSelection()` 조작은
CM6 가 자기 state 로 되돌리므로 무효다 (T-003 verify 2장).

## 6. 실패·예외 경로

계획 단계에서 미리 짚어둔다. 구현에서 빠뜨리지 않는다.

| 상황 | 처리 |
| --- | --- |
| 표가 문법적으로 깨져 있다 (`\|` 개수 불일치) | Lezer 가 `Table` 로 파싱하지 않는다 → 위젯이 안 생기고 원문이 보인다. 그것이 맞는 동작이다 |
| 코드블록의 울타리가 닫히지 않았다 | `FencedCode` 가 문서 끝까지로 파싱된다. 자동 해제 방식이라 커서가 그 안에 있으면 열려 있으므로 무사할 것으로 보이지만, **이것은 예외가 아니라 코드블록을 만들 때마다 지나가는 정상 흐름이다.** 수용 기준 **C15** 로 승격했다 (검토 R3) |
| 블록이 문서의 첫 줄 또는 마지막 줄이다 | 위젯 위/아래에 커서를 둘 줄이 없다. SEED 에 블록을 문서 중간에 두고, 마지막 줄 경우는 별도로 확인한다 |
| 선택 영역이 블록을 가로질러 걸친다 | 겹침 판정이므로 그 블록은 열린다. 여러 블록에 걸치면 걸친 블록 전부 열린다 |
| 빈 표 셀 | `TableCell` 이 `from === to` 다. `<td>` 를 빈 채로 만든다 |
| `visibleRanges` 가 블록을 반만 덮는다 | 블록 노드의 시작이 보이는 범위 밖이면 `iterate` 가 그 노드를 안 준다. 스크롤 시 위젯이 사라지는 현상으로 나타날 수 있다. 블록이 화면보다 클 때를 C8 옆에 기록한다 |

## 7. 하지 않는 것

손대고 싶지만 참는다. 필요한 것은 `backlog.yaml` 로 보낸다.

- **코드블록 구문 강조.** `codeLanguages` 를 붙이면 언어별 파서가 줄줄이 딸려온다.
  이미 spike 번들이 694 kB 다. `requirements.md` 4장의 "고급 렌더링" 제외에 해당한다
- **표 위젯 안에서 셀 직접 편집.** 위젯은 읽기 전용이다. 편집은 블록을 열어서 한다.
  셀을 클릭했을 때 그 셀의 원문 위치로 정확히 진입하는 것도 이번에는 하지 않는다 —
  블록 시작으로 보내고, 사용자가 한 번 더 클릭한다
- **표 셀 안의 인라인 프리뷰.** 3장에 적은 대로 원문으로 둔다
- **위젯의 접근성 속성**(role, aria-label). 검증용 스파이크다
- **atomicRanges 방식과의 비교.** 사람이 "자동 해제만" 을 골랐다.
  자동 해제가 깨지면 그때 대안으로 검토한다 — B-006 에 적는다
- **인용문(Blockquote)·목록·헤딩 위젯화.** 대상은 표와 펜스 코드블록 2종뿐이다
- **줄바꿈(`EditorView.lineWrapping`).** 켜지 않는다. 3장의 방향키 보조가
  "시각 줄 = 논리 줄" 을 전제로 하기 때문이다. 켜야 한다면 보조 로직을
  `moveVertically` 대신 `visualLineSide` 기반으로 다시 짜야 한다 — B-006 에 적는다

## 8. 롤백

커밋 `db07bd9` 가 T-003 완료 시점이다.

```
git checkout db07bd9 -- spike/src .workflow/architecture.md .workflow/requirements.md
rm -f spike/src/editor/blocks.js
```

`package.json` 은 이 task 에서 건드리지 않는다 — `markdownLanguage` 는 이미 설치된
`@codemirror/lang-markdown` 안에 있고 새 의존성이 없다.

## 9. 자기 점검

- [x] 모든 파일 경로가 실재하거나 신규임이 명시되었는가 — `blocks.js` 만 신규이고
      그 경로는 `architecture.md` 2장에 이미 적혀 있던 이름을 그대로 쓴다
- [x] 수용 기준마다 대응하는 검증 수단이 있는가 — 5장이 C2~C15 를 1:1 로 덮는다.
      **1차 검토에서 두 건이 미통과였고 고쳤다** — C1 은 실행 불가한 수단이라 C2 로 흡수했고(R2),
      C10 은 관찰 대상이 성립하지 않을 수 있어 (a)/(b)/(c) 판별로 바꿨다(R1)
- [x] 아키텍처의 의존 방향을 어기지 않는가 — `blocks.js` 는 `@codemirror/*` 만 import 한다.
      `editor -> block-widget` 은 2장에 허용된 방향이다
- [x] 실패·예외 경로가 계획에 있는가 — 6장에 6가지.
      그중 "닫히지 않은 코드블록" 은 예외가 아니라 정상 흐름이므로 **C15 로 승격**했다(R3).
      위젯 클릭의 `preventDefault` 누락 위험도 3장에 명시했다(R6)
- [x] 롤백 방법이 적혀 있는가 — 8장
- [ ] 더 작게 쪼갤 수 있는데 안 쪼갠 것은 아닌가 — **쪼갤 수 있다.**
      "코드블록만" 과 "표만" 으로 나눌 수 있다. 나누지 않은 이유는
      C3(한쪽이 열릴 때 다른 쪽은 닫혀 있는가)이 **두 종류가 같이 있어야 판정 가능**하기 때문이다.
      다만 구현은 코드블록 → 표 순서로 진행한다. 코드블록이 단순하고, 2장의 기존 버그와 직결된다
