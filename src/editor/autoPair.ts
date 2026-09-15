// 자동 짝 기호 — 괄호·강조 기호 (specs/features/F-127.md)
// `@codemirror/autocomplete` 의 closeBrackets() 를 쓰지 않는다 — `*` 를 다시 쳐서
// `**|**` 로 만드는 규칙과 줄머리 목록 기호(`* 항목`) 규칙을 그쪽 API 로는 넣을 수 없다.
//
// autoPairInput·autoPairBackspace 는 DOM 없이 EditorState 만으로 계산한다(F-127 4장).
// 조합 중(view.composing)·읽기 전용 여부 같은 view 필요한 판단은 autoPair() 확장이
// EditorView.inputHandler/keymap 래퍼에서 하고, 순수 함수엔 넣지 않는다.
import type { SyntaxNode } from '@lezer/common'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { EditorSelection, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

import { isComposing } from './composition'

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '*': '*', '~': '~', '`': '`' }
const EMPHASIS_SYMBOLS = new Set(['*', '~', '`'])

// 3.2 괄호: 다음 글자가 이 중 하나거나 공백·줄 끝이면 짝을 넣는다
const BRACKET_NEXT_OK = new Set([')', ']', '}', ',', '.', ';', ':'])

// 3.3 강조 기호: 다음/앞 글자가 이 중 하나거나 공백·줄 끝(시작)·같은 기호면 짝을 넣는다
const EMPHASIS_NEXT_EXTRA = new Set([')', ']', ',', '.', ';', ':'])
const EMPHASIS_PREV_EXTRA = new Set(['(', '['])

// 펜스 코드블록·인라인코드 안에서는 강조 기호 3종의 짝을 넣지 않는다(괄호는 넣는다)
const OPAQUE_NODE = new Set(['FencedCode', 'InlineCode'])

// 커서 바로 앞 한 글자. 줄 시작이면 '' (공백으로 본다)
function charBefore(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos)
  if (pos <= line.from) return ''
  return state.doc.sliceString(pos - 1, pos)
}

// 커서 바로 뒤 한 글자. 줄 끝이면 '' (공백으로 본다)
function charAfter(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos)
  if (pos >= line.to) return ''
  return state.doc.sliceString(pos, pos + 1)
}

function isSpaceLike(ch: string): boolean {
  return ch === '' || /\s/.test(ch)
}

// pos 에서 dir 방향으로 이어지는 같은 글자 ch 의 개수. 줄 경계를 넘지 않는다
function countRun(state: EditorState, pos: number, ch: string, dir: number): number {
  const line = state.doc.lineAt(pos)
  let count = 0
  let i = pos
  if (dir < 0) {
    while (i > line.from && state.doc.sliceString(i - 1, i) === ch) {
      count++
      i--
    }
  } else {
    while (i < line.to && state.doc.sliceString(i, i + 1) === ch) {
      count++
      i++
    }
  }
  return count
}

// pos 가 FencedCode·InlineCode 안인가. 판정은 syntaxTree 로 한다 (F-127 3.3)
function insideOpaqueNode(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1)
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (OPAQUE_NODE.has(n.name)) return true
  }
  return false
}

// pos 가 Frontmatter 안인가 — 이 확장은 프론트매터 안에서 동작하지 않는다 (F-133 3.2)
function insideFrontmatter(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1)
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (n.name === 'Frontmatter') return true
  }
  return false
}

// "빈 짝" 판정 (F-134 3.5) — 커서 앞뒤 같은 기호(sym) 묶음의 길이가 같고, 그 묶음보다
// 더 앞의 글자가 3.3 짝 조건의 "앞 글자" 조건(공백·줄 시작·`(`·`[`)을 만족할 때만 참이다.
// countRun 은 같은 글자가 이어지는 한 계속 세므로, 이 "묶음보다 더 앞" 글자는 이미
// 구조적으로 sym 과 다른 글자다(같았다면 묶음에 포함됐을 것) — 그래서 같은 기호인지는
// 따로 확인하지 않는다.
function isEmptyPair(state: EditorState, pos: number, sym: string): boolean {
  const leftRun = countRun(state, pos, sym, -1)
  const rightRun = countRun(state, pos, sym, 1)
  if (leftRun === 0 || leftRun !== rightRun) return false
  const outerBefore = charBefore(state, pos - leftRun)
  return isSpaceLike(outerBefore) || EMPHASIS_PREV_EXTRA.has(outerBefore)
}

// 줄에서 커서 앞이 들여쓰기 뒤 백틱 두 개뿐이고 뒤가 백틱 두 개뿐인 상태(``|``)인가
// (F-127 3.3 백틱 추가 규칙)
function isEmptyDoubleBacktickLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  const before = state.doc.sliceString(line.from, pos)
  const after = state.doc.sliceString(pos, line.to)
  return /^\s*``$/.test(before) && after === '``'
}

// 괄호 `(` `[` 를 커서 위치(선택 없음)에 입력했을 때
function bracketOpenRule(state: EditorState, pos: number, open: string): TransactionSpec | null {
  const close = OPEN_TO_CLOSE[open]
  const next = charAfter(state, pos)
  const nextOk = isSpaceLike(next) || BRACKET_NEXT_OK.has(next)
  if (!nextOk) return null
  return {
    changes: { from: pos, insert: open + close },
    selection: EditorSelection.cursor(pos + 1),
    effects: addTrackedCloser.of(pos + 1),
    userEvent: 'input.type',
  }
}

// 닫는 괄호 `)` `]` 를 입력했을 때 — 이 확장이 넣은 것이면 건너뛴다
function bracketCloseRule(state: EditorState, pos: number, closeChar: string): TransactionSpec | null {
  const next = charAfter(state, pos)
  if (next !== closeChar) return null
  const tracked = state.field(trackedClosers, false) ?? []
  if (!tracked.includes(pos)) return null
  return { selection: EditorSelection.cursor(pos + 1), userEvent: 'input.type' }
}

// 빈 짝 `*|*` 에서 공백 — 닫는 기호를 지우고 공백만 남긴다 (F-127 3.3)
function spaceInEmptyStarPair(state: EditorState, pos: number): TransactionSpec | null {
  if (insideOpaqueNode(state, pos)) return null
  if (countRun(state, pos, '*', -1) !== 1) return null
  if (countRun(state, pos, '*', 1) !== 1) return null
  return {
    changes: { from: pos, to: pos + 1, insert: ' ' },
    selection: EditorSelection.cursor(pos + 1),
    userEvent: 'input.type',
  }
}

// 강조 기호 `*` `~` `` ` `` 를 커서 위치(선택 없음)에 입력했을 때
function emphasisRule(state: EditorState, pos: number, sym: string): TransactionSpec | null {
  // ``|`` 에서 ` → 닫는 백틱을 지우고 ```| (펜스 코드블록 시작). 이 조건을 만족하는
  // 4개짜리 백틱 뭉치 자체를 lezer-markdown 이 이미 (내용 없는) FencedCode 로 파싱해
  // 버리므로, insideOpaqueNode 게이트보다 먼저 확인해야 한다 — 아니면 이 규칙이 그
  // 게이트에 막혀 한 번도 발동하지 못한다
  if (sym === '`' && isEmptyDoubleBacktickLine(state, pos)) {
    return {
      changes: { from: pos, to: pos + 2, insert: '`' },
      selection: EditorSelection.cursor(pos + 1),
      userEvent: 'input.type',
    }
  }

  if (insideOpaqueNode(state, pos)) return null

  const before = charBefore(state, pos)
  const after = charAfter(state, pos)

  // 다음 글자가 같은 기호일 때: 빈 짝을 새로 쌓아 가는 중(양옆이 전부 같은 기호의
  // 대칭 묶음이고, 그 바깥은 공백·줄 경계)이면 한 겹 더 nest, 아니면(예: 내용 뒤
  // **굵게|** 나 그 다음 남은 닫는 기호 **굵게*|*) 글자를 넣지 않고 건너뛴다
  // (추적 여부와 무관)
  if (after === sym) {
    if (before === sym) {
      const leftRun = countRun(state, pos, sym, -1)
      const rightRun = countRun(state, pos, sym, 1)
      const outerBefore = charBefore(state, pos - leftRun)
      const outerAfter = charAfter(state, pos + rightRun)
      if (leftRun === rightRun && isSpaceLike(outerBefore) && isSpaceLike(outerAfter)) {
        if (leftRun >= 3) return null // 4번째는 기본 입력
        return {
          changes: { from: pos, insert: sym + sym },
          selection: EditorSelection.cursor(pos + 1),
          userEvent: 'input.type',
        }
      }
      // 앞 글자도 같은 기호지만 빈 짝 nesting 조건은 아니다(예: 남은 닫는 기호
      // **굵게*|*) — 기존 동작 그대로 건너뛴다
      return { selection: EditorSelection.cursor(pos + 1), userEvent: 'input.type' }
    }
    // F-134 3.5: 앞 글자가 다른 기호(공백·줄 시작 포함)일 때는 "공백이 아닌 글자"일
    // 때만 건너뛴다. 줄 시작·공백 뒤에서는 건너뛰지 않고 기본 입력으로 넘긴다 — 줄머리
    // 목록 기호(`* 항목`)나 `단어 * 단어` 를 치는 흐름을 막지 않기 위해서다
    if (isSpaceLike(before)) return null
    return { selection: EditorSelection.cursor(pos + 1), userEvent: 'input.type' }
  }

  const nextOk = isSpaceLike(after) || EMPHASIS_NEXT_EXTRA.has(after)
  const prevOk = isSpaceLike(before) || before === sym || EMPHASIS_PREV_EXTRA.has(before)
  if (nextOk && prevOk) {
    return {
      changes: { from: pos, insert: sym + sym },
      selection: EditorSelection.cursor(pos + 1),
      userEvent: 'input.type',
    }
  }

  return null
}

// 규칙 계산. DOM 없음. `null` 이면 기본 입력.
export function autoPairInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (state.readOnly) return null
  if (state.selection.ranges.length !== 1) return null // 3.4 여러 커서 → 기본 입력
  if (text.length !== 1) return null
  if (insideFrontmatter(state, from)) return null // F-133 3.2: 프론트매터 안에서는 동작하지 않는다

  const isOpen = Object.prototype.hasOwnProperty.call(OPEN_TO_CLOSE, text)
  const isClose = text === ')' || text === ']'

  if (from !== to) {
    // 3.1 선택 범위 감싸기 — 대상 여는 기호에만 적용
    if (!isOpen) return null
    if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return null // 여러 줄 → 기본 입력
    const close = OPEN_TO_CLOSE[text]
    return {
      changes: [
        { from, insert: text },
        { from: to, insert: close },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
      userEvent: 'input.type',
    }
  }

  const pos = from

  if (text === ' ') return spaceInEmptyStarPair(state, pos)
  if (text === '(' || text === '[') return bracketOpenRule(state, pos, text)
  if (isClose) return bracketCloseRule(state, pos, text)
  if (EMPHASIS_SYMBOLS.has(text)) return emphasisRule(state, pos, text)

  return null
}

// Backspace 규칙 계산. DOM 없음. `null` 이면 기본 처리(다음 키맵)로 넘긴다.
export function autoPairBackspace(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  if (state.selection.ranges.length !== 1) return null
  const range = state.selection.main
  if (!range.empty) return null

  const pos = range.from
  if (pos <= 0 || pos >= state.doc.length) return null
  if (insideFrontmatter(state, pos)) return null // F-133 3.2
  const before = state.doc.sliceString(pos - 1, pos)
  const after = state.doc.sliceString(pos, pos + 1)

  // 빈 짝 지우기: (|) [|] — 추적 여부와 무관
  if ((before === '(' && after === ')') || (before === '[' && after === ']')) {
    return {
      changes: { from: pos - 1, to: pos + 1 },
      selection: EditorSelection.cursor(pos - 1),
      userEvent: 'delete.backward',
    }
  }

  // 빈 짝 *|* / **|** / ~|~ / `|` 에서 Backspace → 안쪽 한 쌍 지움. "빈 짝" 일 때만
  // 동작한다(F-134 3.5) — 앞뒤가 같은 기호라고 해서 항상 지우면 `a**|b`, `**굵게*|*`
  // 처럼 빈 짝이 아닌 자리에서도 두 글자를 지워 버린다. 코드블록·인라인코드 안에서는
  // 동작하지 않는다
  if (before === after && EMPHASIS_SYMBOLS.has(before) && !insideOpaqueNode(state, pos) && isEmptyPair(state, pos, before)) {
    return {
      changes: { from: pos - 1, to: pos + 1 },
      selection: EditorSelection.cursor(pos - 1),
      userEvent: 'delete.backward',
    }
  }

  return null
}

// 이 확장이 넣은 닫는 괄호 위치를 추적에 더한다
const addTrackedCloser = StateEffect.define<number>()

// 이 확장이 넣은 닫는 괄호(`)` `]`) 위치 추적. 문서 변경에 맞춰 옮기고,
// 커서가 그 줄을 떠나거나 그 자리 글자가 더는 닫는 괄호가 아니면 지운다 (F-127 3.2)
const trackedClosers = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    if (tr.docChanged) next = next.map((pos) => tr.changes.mapPos(pos, 1))
    for (const effect of tr.effects) {
      if (effect.is(addTrackedCloser)) next = [...next, effect.value]
    }

    const state = tr.state
    const doc = state.doc
    const cursorLine = state.selection.ranges.length === 1 ? doc.lineAt(state.selection.main.head).number : -1

    next = next.filter((pos) => {
      if (pos < 0 || pos >= doc.length) return false
      if (doc.lineAt(pos).number !== cursorLine) return false
      const ch = doc.sliceString(pos, pos + 1)
      return ch === ')' || ch === ']'
    })

    return next
  },
})

// Backspace 는 lang-markdown 의 deleteMarkupBackward(Prec.high) 보다 먼저 받는다 —
// createEditor.ts 에서 markdown() 보다 앞서 조립해 같은 Prec.high 안에서 순서를 이긴다
function backspaceCommand(view: EditorView): boolean {
  if (isComposing(view)) return false
  if (view.state.readOnly) return false
  const spec = autoPairBackspace(view.state)
  if (!spec) return false
  view.dispatch(spec)
  return true
}

// 자동 짝 기호 확장. `EditorView.inputHandler`, Backspace 키맵(Prec.high), 추적
// `StateField` 를 묶는다 (F-127 4장)
export function autoPair() {
  return [
    trackedClosers,
    EditorView.inputHandler.of((view, from, to, text) => {
      if (isComposing(view)) return false // 3.5 조합 중에는 가로채지 않는다
      if (view.state.readOnly) return false
      const spec = autoPairInput(view.state, from, to, text)
      if (!spec) return false
      view.dispatch(spec)
      return true
    }),
    Prec.high(keymap.of([{ key: 'Backspace', run: backspaceCommand }])),
  ]
}
