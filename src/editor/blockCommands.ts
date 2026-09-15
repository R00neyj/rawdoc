// 단락 명령 — 우클릭 메뉴용. StateCommand 로 만들어 DOM 없이 테스트한다(F-109 방식). 명령 1회 = dispatch 1회 = 실행 취소 1단계 (specs/features/F-168.md)
import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { ChangeSpec, EditorState, StateCommand } from '@codemirror/state'

// 건너뛰는 줄 — 이 노드 안의 줄은 손대지 않는다 (F-168.md 2장)
const SKIP_NODE = new Set(['FencedCode', 'Frontmatter', 'Table'])

const QUOTE_RE = /^(?:>[ ]?)*/
const INDENT_RE = /^[ \t]*/
const HEADING_RE = /^(#{1,6}) /
const CHECKBOX_RE = /^[-*+] \[[ xX]\] /
const BULLET_RE = /^[-*+] /
const ORDERED_RE = /^\d{1,9}[.)] /

type Marker =
  | { type: 'heading'; level: number }
  | { type: 'checkbox' }
  | { type: 'bullet' }
  | { type: 'ordered' }
  | null

type ParsedLine = {
  quote: string
  quoteTo: number
  indentTo: number
  marker: Marker
  markerTo: number
  restFrom: number
  isBlank: boolean
}

// 줄을 인용 기호 + 들여쓰기 + 줄 앞 기호 + 나머지 글자 로 나눈다 (F-168.md 2장)
function parseLine(lineText: string, lineFrom: number): ParsedLine {
  const quote = QUOTE_RE.exec(lineText)![0]
  const quoteTo = lineFrom + quote.length

  const afterQuote = lineText.slice(quote.length)
  const indent = INDENT_RE.exec(afterQuote)![0]
  const indentTo = quoteTo + indent.length

  const remainder = afterQuote.slice(indent.length)

  let marker: Marker = null
  let markerLen = 0

  const headingMatch = HEADING_RE.exec(remainder)
  const checkboxMatch = CHECKBOX_RE.exec(remainder)
  const bulletMatch = BULLET_RE.exec(remainder)
  const orderedMatch = ORDERED_RE.exec(remainder)

  if (headingMatch) {
    marker = { type: 'heading', level: headingMatch[1].length }
    markerLen = headingMatch[0].length
  } else if (checkboxMatch) {
    marker = { type: 'checkbox' }
    markerLen = checkboxMatch[0].length
  } else if (bulletMatch) {
    marker = { type: 'bullet' }
    markerLen = bulletMatch[0].length
  } else if (orderedMatch) {
    marker = { type: 'ordered' }
    markerLen = orderedMatch[0].length
  }

  const markerTo = indentTo + markerLen
  const rest = remainder.slice(markerLen)
  const isBlank = marker === null && rest.trim() === ''

  return { quote, quoteTo, indentTo, marker, markerTo, restFrom: markerTo, isBlank }
}

// pos 가 걸친 줄이 펜스 코드블록·프론트매터·표 안인가
function isSkipLine(state: EditorState, lineFrom: number): boolean {
  const node = syntaxTree(state).resolveInner(lineFrom, 1)
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (SKIP_NODE.has(n.name)) return true
  }
  return false
}

// 선택이 걸친 모든 줄 번호. 여러 줄 선택의 끝이 줄 맨 앞(열 0)이면 그 마지막 줄은 뺀다 (F-168.md 2장)
function targetLineNumbers(state: EditorState): number[] {
  const set = new Set<number>()
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number
    const toLineObj = state.doc.lineAt(range.to)
    let toLine = toLineObj.number
    if (toLine > fromLine && range.to === toLineObj.from) toLine -= 1
    for (let n = fromLine; n <= toLine; n++) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

// 선택을 changes 에 맞춰 옮긴다. 지워진 자리에 있던 커서는 나머지 글자 쪽(뒤)으로 붙는다 (F-168.md 3장)
function mapSelection(state: EditorState, changes: ChangeSpec[]): EditorSelection {
  const changeSet = state.changes(changes)
  const ranges = state.selection.ranges.map((r) =>
    EditorSelection.range(changeSet.mapPos(r.anchor, 1), changeSet.mapPos(r.head, 1)),
  )
  return EditorSelection.create(ranges, state.selection.mainIndex)
}

function dispatchChanges(
  { state, dispatch }: { state: EditorState; dispatch: (tr: ReturnType<EditorState['update']>) => void },
  changes: ChangeSpec[],
): boolean {
  if (changes.length === 0) return false
  dispatch(state.update({ changes, selection: mapSelection(state, changes) }))
  return true
}

type MarkerCommandOptions = {
  isMatch: (marker: Marker) => boolean
  keepIndentOnApply: boolean
  buildMarker: (index: number) => string
}

// 목록·제목 명령의 공통 뼈대. isMatch 인 줄만 있으면 본문으로(기호·들여쓰기 제거), 아니면 적용한다(목록은 들여쓰기 유지, 제목은 들여쓰기 제거) — F-168.md 3장
function applyMarkerCommand(
  target: { state: EditorState; dispatch: (tr: ReturnType<EditorState['update']>) => void },
  { isMatch, keepIndentOnApply, buildMarker }: MarkerCommandOptions,
): boolean {
  const { state } = target
  const lineNumbers = targetLineNumbers(state)
  const parsed: { quoteTo: number; indentTo: number; markerTo: number; marker: Marker; isBlank: boolean }[] = []

  for (const n of lineNumbers) {
    const line = state.doc.line(n)
    if (isSkipLine(state, line.from)) continue
    parsed.push(parseLine(line.text, line.from))
  }
  if (parsed.length === 0) return false

  const nonBlank = parsed.filter((p) => !p.isBlank)
  const allAlready = nonBlank.length > 0 && nonBlank.every((p) => isMatch(p.marker))

  const changes: ChangeSpec[] = []
  let index = 0
  for (const p of parsed) {
    if (p.isBlank) continue
    if (allAlready) {
      changes.push({ from: p.quoteTo, to: p.markerTo, insert: '' })
    } else {
      index += 1
      const from = keepIndentOnApply ? p.indentTo : p.quoteTo
      changes.push({ from, to: p.markerTo, insert: buildMarker(index) })
    }
  }

  return dispatchChanges(target, changes)
}

// 글머리 목록. 빈 줄은 건너뛰고 `- `. 이미 모두 글머리면 본문으로
export const setBulletList: StateCommand = (target) =>
  applyMarkerCommand(target, {
    isMatch: (marker) => marker?.type === 'bullet',
    keepIndentOnApply: true,
    buildMarker: () => '- ',
  })

// 숫자 목록. 빈 줄은 건너뛰고 대상 줄 순서대로 1부터. 이미 모두 숫자 목록이면 본문으로
export const setOrderedList: StateCommand = (target) =>
  applyMarkerCommand(target, {
    isMatch: (marker) => marker?.type === 'ordered',
    keepIndentOnApply: true,
    buildMarker: (index) => `${index}. `,
  })

// 체크박스. 빈 줄은 건너뛰고 `- [ ] ` (이미 [x] 여도 체크 상태 유지 없이 [ ]). 이미 모두 체크박스면 본문으로
export const setTaskList: StateCommand = (target) =>
  applyMarkerCommand(target, {
    isMatch: (marker) => marker?.type === 'checkbox',
    keepIndentOnApply: true,
    buildMarker: () => '- [ ] ',
  })

// 제목 1~6. 빈 줄은 건너뛰고 `#`×n + 공백, 들여쓰기는 지운다. 같은 n 이면 본문으로
export function setHeading(level: number): StateCommand {
  return (target) =>
    applyMarkerCommand(target, {
      isMatch: (marker) => marker?.type === 'heading' && marker.level === level,
      keepIndentOnApply: false,
      buildMarker: () => '#'.repeat(level) + ' ',
    })
}

// 본문. 줄 앞 기호를 지운다. 목록·제목이던 줄은 들여쓰기도 지운다
export const setParagraph: StateCommand = (target) => {
  const { state } = target
  const lineNumbers = targetLineNumbers(state)
  const changes: ChangeSpec[] = []
  let any = false

  for (const n of lineNumbers) {
    const line = state.doc.line(n)
    if (isSkipLine(state, line.from)) continue
    any = true
    const parsed = parseLine(line.text, line.from)
    if (!parsed.marker) continue
    changes.push({ from: parsed.quoteTo, to: parsed.markerTo, insert: '' })
  }

  if (!any) return false
  return dispatchChanges(target, changes)
}

// 인용 토글. 모든 대상 줄(빈 줄 포함) 맨 앞에 `> `(빈 줄은 `>`). 빈 줄이 아닌 대상 줄이 모두 `>` 로 시작하면 한 단계(`>` + 공백 0~1개) 제거
export const toggleQuote: StateCommand = (target) => {
  const { state } = target
  const lineNumbers = targetLineNumbers(state)
  const entries: { from: number; text: string; quoteLen: number; isBlank: boolean }[] = []

  for (const n of lineNumbers) {
    const line = state.doc.line(n)
    if (isSkipLine(state, line.from)) continue
    const parsed = parseLine(line.text, line.from)
    entries.push({ from: line.from, text: line.text, quoteLen: parsed.quote.length, isBlank: parsed.isBlank })
  }
  if (entries.length === 0) return false

  const nonBlank = entries.filter((e) => !e.isBlank)
  const allQuoted = nonBlank.length > 0 && nonBlank.every((e) => e.quoteLen > 0)

  const changes: ChangeSpec[] = []
  for (const e of entries) {
    if (allQuoted) {
      const m = /^>[ ]?/.exec(e.text)
      if (!m) continue
      changes.push({ from: e.from, to: e.from + m[0].length, insert: '' })
    } else {
      changes.push({ from: e.from, to: e.from, insert: e.isBlank ? '>' : '> ' })
    }
  }

  return dispatchChanges(target, changes)
}
