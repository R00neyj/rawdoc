// 삽입 명령 (우클릭 메뉴용, DOM 없는 StateCommand) — specs/features/F-169.md. 트랜잭션 줄바꿈은 CM6 관례대로 '\n' (F-125 addRow 와 같음), 저장·내보내기 때 문서 lineEnding 으로 바뀐다 (1장)
import type { EditorState, Line, StateCommand } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// 기준 줄이 이 노드 안이면 블록 명령은 아무것도 하지 않는다 (F-169 2장)
const OPAQUE_BLOCK = new Set(['FencedCode', 'Frontmatter', 'Table'])

function lineOrNull(state: EditorState, num: number): Line | null {
  if (num < 1 || num > state.doc.lines) return null
  return state.doc.line(num)
}

// 선택이 걸친 줄들. 여러 줄 선택의 끝이 열 0 이면 그 마지막 줄은 뺀다 (F-168 2장과 같음, F-169 2·3장)
// export: F-2022 editor/insertTemplate.ts 가 그대로 쓴다 (동작 불변)
export function selectionLines(state: EditorState): { first: Line; last: Line } {
  const { from, to, empty } = state.selection.main
  const first = state.doc.lineAt(from)
  let last = state.doc.lineAt(to)
  if (!empty && last.number > first.number && to === last.from) {
    last = state.doc.line(last.number - 1)
  }
  return { first, last }
}

function nodeChainHasOpaque(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, 1)
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (OPAQUE_BLOCK.has(n.name)) return true
  }
  return false
}

// 기준 줄 중 하나라도 펜스 코드블록·프론트매터·표 안이면 true (F-169 2장 마지막 줄)
function baselineIsOpaque(state: EditorState, first: Line, last: Line): boolean {
  for (let i = first.number; i <= last.number; i++) {
    if (nodeChainHasOpaque(state, state.doc.line(i).from)) return true
  }
  return false
}

type Placement = {
  mode: 'in-place' | 'append'
  from: number
  to: number
  leadingBlank: boolean
  trailingBlank: boolean
  hasBelow: boolean
}

// 블록 넣을 자리 계산 (F-169 2장). wrap 이면(감싸는 명령 + 선택 있음) 선택 줄 전체를 그 자리에서 바꾼다(in-place, to=last.to). 아니면 기준 줄이 빈 줄 하나일 때만 in-place(그 줄에 넣기), 그 밖은 기준 줄(마지막) 끝 뒤에 새 줄로 추가(append)
// export: F-2022 editor/insertTemplate.ts 가 그대로 쓴다 (동작 불변)
export function computePlacement(state: EditorState, first: Line, last: Line, wrap: boolean): Placement {
  const singleEmpty = !wrap && first.number === last.number && first.length === 0
  const belowLine = lineOrNull(state, last.number + 1)
  const hasBelow = belowLine !== null
  const trailingBlank = hasBelow && belowLine!.length > 0

  if (wrap || singleEmpty) {
    const aboveLine = lineOrNull(state, first.number - 1)
    const leadingBlank = aboveLine !== null && aboveLine.length > 0
    const to = wrap ? last.to : first.to
    return { mode: 'in-place', from: first.from, to, leadingBlank, trailingBlank, hasBelow }
  }

  const leadingBlank = last.length > 0
  return { mode: 'append', from: last.to, to: last.to, leadingBlank, trailingBlank, hasBelow }
}

// 자리 앞뒤 빈 줄을 core(블록 원문) 에 둘러 삽입 문자열을 만든다. forceTrailingIfNoBelow 는 수평선 전용(F-169 3장 "아랫줄이 없으면 빈 줄 1개")
// export: F-2022 editor/insertTemplate.ts 가 그대로 쓴다 (동작 불변)
export function buildInsert(
  placement: Placement,
  core: string,
  forceTrailingIfNoBelow = false,
): { insert: string; leadLen: number; trailLen: number } {
  const leadPart =
    placement.mode === 'in-place' ? (placement.leadingBlank ? '\n' : '') : placement.leadingBlank ? '\n\n' : '\n'
  let trailPart = placement.trailingBlank ? '\n' : ''
  if (forceTrailingIfNoBelow && !placement.hasBelow) trailPart = '\n'
  return { insert: leadPart + core + trailPart, leadLen: leadPart.length, trailLen: trailPart.length }
}

// 표 — 빈 문서면 머리 첫 칸 공백 뒤에 커서 (F-169 3장, A3)
export const insertTable: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectionLines(state)
  if (baselineIsOpaque(state, first, last)) return false

  const placement = computePlacement(state, first, last, false)
  const core = '|  |  |\n| --- | --- |\n|  |  |'
  const built = buildInsert(placement, core)
  const cursor = placement.from + built.leadLen + 2

  dispatch(
    state.update({
      changes: { from: placement.from, to: placement.to, insert: built.insert },
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}

// 수평선 — 아랫줄이 없으면 빈 줄 1개를 더 넣어 커서를 그 다음 줄에 둔다 (F-169 3장, A2)
export const insertHorizontalRule: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectionLines(state)
  if (baselineIsOpaque(state, first, last)) return false

  const placement = computePlacement(state, first, last, false)
  const built = buildInsert(placement, '---', true)
  const cursor = placement.from + built.insert.length + (placement.hasBelow && built.trailLen === 0 ? 1 : 0)

  dispatch(
    state.update({
      changes: { from: placement.from, to: placement.to, insert: built.insert },
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}

// 콜아웃 — 선택 없으면 빈 틀, 있으면 선택 줄마다 '> ' 를 붙여 감싼다. 커서는 항상 core 끝 (F-169 3장, A4)
export const insertCallout: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectionLines(state)
  if (baselineIsOpaque(state, first, last)) return false

  const wrap = !state.selection.main.empty
  const placement = computePlacement(state, first, last, wrap)
  const core = wrap
    ? `> [!note]\n${state
        .sliceDoc(first.from, last.to)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`
    : '> [!note]\n> '
  const built = buildInsert(placement, core)
  const cursor = placement.from + built.leadLen + core.length

  dispatch(
    state.update({
      changes: { from: placement.from, to: placement.to, insert: built.insert },
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}

// 코드 블럭 — 선택 줄 안에 이미 ``` 가 있으면 백틱 4개로 감싼다 (F-169 3장, A5)
export const insertCodeBlock: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectionLines(state)
  if (baselineIsOpaque(state, first, last)) return false

  const wrap = !state.selection.main.empty
  const placement = computePlacement(state, first, last, wrap)

  let core: string
  let cursorOffset: number
  if (wrap) {
    const text = state.sliceDoc(first.from, last.to)
    const fence = text.includes('```') ? '````' : '```'
    core = `${fence}\n${text}\n${fence}`
    cursorOffset = fence.length
  } else {
    core = '```\n\n```'
    cursorOffset = 4
  }

  const built = buildInsert(placement, core)
  const cursor = placement.from + built.leadLen + cursorOffset

  dispatch(
    state.update({
      changes: { from: placement.from, to: placement.to, insert: built.insert },
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}

// 수식 블럭 — 커서는 닫는 $$ 앞 줄 끝 (선택 없으면 가운데 빈 줄과 같은 자리) (F-169 3장, A6)
export const insertMathBlock: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectionLines(state)
  if (baselineIsOpaque(state, first, last)) return false

  const wrap = !state.selection.main.empty
  const placement = computePlacement(state, first, last, wrap)
  const content = wrap ? state.sliceDoc(first.from, last.to) : ''
  const core = `$$\n${content}\n$$`
  const built = buildInsert(placement, core)
  const cursor = placement.from + built.leadLen + core.length - 3

  dispatch(
    state.update({
      changes: { from: placement.from, to: placement.to, insert: built.insert },
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}

// 문서 안 [^숫자] 표지(정의 포함) 중 가장 큰 숫자 + 1. 이름 각주([^note])는 세지 않는다 (F-169 4장)
function nextFootnoteNumber(docText: string): number {
  const nums = [...docText.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]))
  return nums.length > 0 ? Math.max(...nums) + 1 : 1
}

// 각주 — 커서 자리에 [^n], 문서 끝에 정의를 붙인다. 트랜잭션 1개 (F-169 4장, A7)
export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  const n = nextFootnoteNumber(state.doc.toString())
  const marker = `[^${n}]`
  const cursorPos = state.selection.main.to
  const docText = state.doc.toString()

  let suffix = ''
  if (!docText.endsWith('\n')) suffix += '\n'
  const lastLineText = state.doc.line(state.doc.lines).text
  if (!/^\[\^[^\]]+\]:\s?/.test(lastLineText)) suffix += '\n'
  suffix += `${marker}: `

  const cursor = state.doc.length + marker.length + suffix.length

  dispatch(
    state.update({
      changes: [
        { from: cursorPos, insert: marker },
        { from: state.doc.length, insert: suffix },
      ],
      selection: EditorSelection.cursor(cursor),
    }),
  )
  return true
}
