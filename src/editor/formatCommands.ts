// 우클릭 메뉴용 서식·링크 명령. StateCommand 로 DOM 없이 테스트하며, 문법 기호만 넣고 뗀다(색칠·렌더는 안 함) (specs/features/F-167.md 2장)
import { ensureSyntaxTree, language, syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { EditorState, SelectionRange, StateCommand } from '@codemirror/state'

export { toggleStrong, toggleEmphasis, insertLink } from './commands'

// 구문 트리 확보 시간 상한 — outline.ts 와 같은 값(F-144 3.2 참고)
const ENSURE_TREE_TIMEOUT_MS = 100

// state.sliceDoc 인데 범위가 문서 밖으로 나가도 던지지 않는다 (commands.ts 와 같음)
function sliceSafe(state: EditorState, from: number, to: number): string {
  const len = state.doc.length
  return state.sliceDoc(Math.max(0, from), Math.min(len, to))
}

type WrapOptions = {
  blockOuterGuard?: boolean // $ 전용: 바깥이 실제로는 $$(수식 블럭 기호)의 일부면 벗기지 않는다 (3장 각주)
  customWrap?: (text: string) => { insert: string; innerFrom: number; innerLength: number } // 코드 전용: 감싸기 분기에서 marker+text+marker 대신 쓸 모양, innerFrom·innerLength 는 insert 안에서 선택이 시작하는 자리와 길이 (3장)
  // customWrap 이 marker 자체와 다른 바깥 경계를 만들 때(코드: ``+공백) 벗기기 판정에 쓸 그 경계 문자열 — customWrap 직후 선택되는 innerFrom·innerLength 구간을 다시 선택해 토글하는 경우를 위함
  customOuter?: { before: string; after: string }
}

// 감싸기/벗기기 공용 규칙(3장): 선택 바로 바깥 양옆이 marker 면 벗기고, 아니면 선택 안쪽 양끝이 marker 면 벗기고, 아니면 marker 로 감싼다. 선택 없으면 marker+marker 삽입
function wrapRange(
  state: EditorState,
  range: SelectionRange,
  marker: string,
  options: WrapOptions = {},
) {
  const len = marker.length

  if (range.empty) {
    return {
      changes: { from: range.from, insert: marker + marker },
      range: EditorSelection.cursor(range.from + len),
    }
  }

  const text = state.sliceDoc(range.from, range.to)
  const outsideBefore = sliceSafe(state, range.from - len, range.from)
  const outsideAfter = sliceSafe(state, range.to, range.to + len)
  const blocked = options.blockOuterGuard
    ? sliceSafe(state, range.from - len * 2, range.from - len) === marker ||
      sliceSafe(state, range.to + len, range.to + len * 2) === marker
    : false

  if (outsideBefore === marker && outsideAfter === marker && !blocked) {
    return {
      changes: [
        { from: range.from - len, to: range.from },
        { from: range.to, to: range.to + len },
      ],
      range: EditorSelection.range(range.from - len, range.to - len),
    }
  }

  if (options.customOuter) {
    const { before, after } = options.customOuter
    const customOutsideBefore = sliceSafe(state, range.from - before.length, range.from)
    const customOutsideAfter = sliceSafe(state, range.to, range.to + after.length)
    if (customOutsideBefore === before && customOutsideAfter === after) {
      return {
        changes: [
          { from: range.from - before.length, to: range.from },
          { from: range.to, to: range.to + after.length },
        ],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      }
    }
  }

  if (text.length >= len * 2 && text.slice(0, len) === marker && text.slice(text.length - len) === marker) {
    const inner = text.slice(len, text.length - len)
    return {
      changes: { from: range.from, to: range.to, insert: inner },
      range: EditorSelection.range(range.from, range.from + inner.length),
    }
  }

  if (options.customWrap) {
    const { insert, innerFrom, innerLength } = options.customWrap(text)
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + innerFrom, range.from + innerFrom + innerLength),
    }
  }

  return {
    changes: { from: range.from, to: range.to, insert: `${marker}${text}${marker}` },
    range: EditorSelection.range(range.from + len, range.from + len + text.length),
  }
}

function toggleWrap(marker: string, options: WrapOptions = {}): StateCommand {
  return ({ state, dispatch }) => {
    const tr = state.update(state.changeByRange((range) => wrapRange(state, range, marker, options)))
    dispatch(tr)
    return true
  }
}

// 취소선: ~~감싸기/벗기기~~ (3장)
export const toggleStrike = toggleWrap('~~')

// 하이라이트: ==감싸기/벗기기== (3장, Obsidian 문법)
export const toggleHighlight = toggleWrap('==')

// 주석: %%감싸기/벗기기%% (3장, Obsidian 문법)
export const toggleComment = toggleWrap('%%')

// 수식: $감싸기/벗기기$. 바깥이 $$(수식 블럭 기호)면 벗기지 않고 감싼다 (3장)
export const toggleMath = toggleWrap('$', { blockOuterGuard: true })

// 코드: 선택 글자에 백틱이 있으면 ``선택`` (안쪽 공백 1개씩), 아니면 `선택` 감싸기/벗기기 (3장)
export const toggleInlineCode: StateCommand = ({ state, dispatch }) => {
  const tr = state.update(state.changeByRange((range) => wrapRange(state, range, '`', {
    customWrap: (text) => text.includes('`')
      ? { insert: `\`\` ${text} \`\``, innerFrom: 3, innerLength: text.length }
      : { insert: `\`${text}\``, innerFrom: 1, innerLength: text.length },
    customOuter: { before: '`` ', after: ' ``' },
  })))
  dispatch(tr)
  return true
}

// 링크 추가(위키링크): 선택 있으면 [[선택]] 커서는 ]] 앞, 없으면 [[]] 커서 가운데 (F-131 자동완성이 뜬다)
export const insertWikiLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.update(state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '[[]]' },
        range: EditorSelection.cursor(range.from + 2),
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
      range: EditorSelection.cursor(range.from + 2 + text.length),
    }
  }))
  dispatch(tr)
  return true
}

// 서식 지우기 대상 구문 트리 노드 → 그 노드가 감싸는 기호 노드 이름 (4장)
const FORMAT_NODE_MARK: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark',
}

// [from, to] 가 [rangeFrom, rangeTo] 와 겹치는가 — 경계가 닿기만 해도 겹친 것으로 본다(빈 범위인 커서 위치도 이 식 하나로 처리된다)
function overlaps(from: number, to: number, rangeFrom: number, rangeTo: number): boolean {
  return from <= rangeTo && to >= rangeFrom
}

// 대상 범위와 겹치는 Emphasis·StrongEmphasis·Strikethrough·InlineCode 노드의 기호(EmphasisMark 등) 전부 (4장)
function collectSyntaxFormatMarks(
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const marks: Array<{ from: number; to: number }> = []
  tree.iterate({
    from,
    to,
    enter: (node) => {
      const markName = FORMAT_NODE_MARK[node.name]
      if (!markName) return
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === markName) marks.push({ from: child.from, to: child.to })
      }
    },
  })
  return marks
}

// 줄 글자 안에서 marker 짝을 왼쪽부터 가장 가까운 닫는 기호로 맞춰 찾는다. $ 는 $$(수식 블럭 기호)의 일부인 낱개는 짝짓기 대상에서 뺀다(4장 "$…$($$ 제외)")
function findMarkerPairs(text: string, marker: string): Array<{ from: number; to: number }> {
  const len = marker.length
  const isBlockedDollar = (pos: number) =>
    marker === '$' && (text[pos - 1] === '$' || text[pos + len] === '$')
  const pairs: Array<{ from: number; to: number }> = []
  let i = 0
  while (i <= text.length - len) {
    if (text.slice(i, i + len) !== marker || isBlockedDollar(i)) {
      i += 1
      continue
    }
    let j = i + len
    let close = -1
    while (j <= text.length - len) {
      if (text.slice(j, j + len) === marker && !isBlockedDollar(j)) {
        close = j
        break
      }
      j += 1
    }
    if (close === -1) {
      i += 1
      continue
    }
    pairs.push({ from: i, to: close + len })
    i = close + len
  }
  return pairs
}

const LINE_PAIR_MARKERS = ['==', '%%', '$']

// 대상 범위가 걸친 줄 안에서 ==…==·%%…%%·$…$ 짝이 대상 범위와 겹치면 그 짝의 기호 (4장)
function collectLinePairMarks(state: EditorState, from: number, to: number): Array<{ from: number; to: number }> {
  const marks: Array<{ from: number; to: number }> = []
  const startLine = state.doc.lineAt(from).number
  const endLine = state.doc.lineAt(to).number

  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    for (const marker of LINE_PAIR_MARKERS) {
      for (const pair of findMarkerPairs(line.text, marker)) {
        const pairFrom = line.from + pair.from
        const pairTo = line.from + pair.to
        if (!overlaps(pairFrom, pairTo, from, to)) continue
        marks.push({ from: pairFrom, to: pairFrom + marker.length })
        marks.push({ from: pairTo - marker.length, to: pairTo })
      }
    }
  }
  return marks
}

// 서식 지우기: 대상 범위(선택, 없으면 커서가 들어 있는 서식 하나)의 기호를 지운다. 링크·위키링크·HTML 태그·줄 앞 기호는 대상이 아니고, 구문 트리가 없는 상태(표 칸 하위 에디터)에서는 false 를 돌려주고 아무것도 하지 않는다 (4장)
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.facet(language) === null) return false

  let tree = syntaxTree(state)
  if (tree.length < state.doc.length) {
    tree = ensureSyntaxTree(state, state.doc.length, ENSURE_TREE_TIMEOUT_MS) ?? tree
  }

  const tr = state.update(state.changeByRange((range) => {
    const from = range.from
    const to = range.empty ? range.from : range.to
    const marks = [...collectSyntaxFormatMarks(tree, from, to), ...collectLinePairMarks(state, from, to)].sort(
      (a, b) => a.from - b.from,
    )

    if (marks.length === 0) return { range }

    const changes = state.changes(marks.map((m) => ({ from: m.from, to: m.to })))
    return {
      changes,
      range: EditorSelection.range(changes.mapPos(range.from, -1), changes.mapPos(range.to, 1)),
    }
  }))
  dispatch(tr)
  return true
}
