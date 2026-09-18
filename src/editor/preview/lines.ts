// 줄 단위 요소 표시 (specs/features/F-105.md)
// 구조·IME 처리·활성 줄 판정은 F-104 2.1·2.3 과 같다. 계산(buildLines)은 DOM 없이 동작한다.
// decoration 은 문서를 바꾸지 않는다 — 체크박스 클릭도 위젯이 트랜잭션을 하나 내보낼 뿐,
// decoration 자체는 표시만 바꾼다 (CLAUDE.md 불변조건)
import type { SyntaxNode } from '@lezer/common'
import { syntaxTree } from '@codemirror/language'
import type { ChangeDesc, EditorState, Extension, Range as CMRange } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'

import { activeLines, isEditorFocused } from './active'
import { isComposing, isForced } from '../composition'
import { frontmatterWidgetExtension, frontmatterWidgetInfo } from '../frontmatter'
import { parseCalloutHeader, defaultCalloutTitle } from '../../lib/callout'
import { calloutIconSvg } from '../../lib/calloutIcons'

const HIDE = Decoration.replace({})

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'md-h1',
  ATXHeading2: 'md-h2',
  ATXHeading3: 'md-h3',
  ATXHeading4: 'md-h4',
  ATXHeading5: 'md-h5',
  ATXHeading6: 'md-h6',
}

const SETEXT_CLASS: Record<string, string> = {
  SetextHeading1: 'md-h1',
  SetextHeading2: 'md-h2',
}

type Line = ReturnType<EditorState['doc']['lineAt']>

// ListMark(또는 HeaderMark·QuoteMark) 뒤에 오는 공백 1칸까지 포함한 숨김 범위
function hideMarkAndSpace(state: EditorState, node: SyntaxNode): CMRange<Decoration> {
  let to = node.to
  if (state.doc.sliceString(to, to + 1) === ' ') to += 1
  return HIDE.range(node.from, to)
}

function lineClassRange(line: Line, className: string): CMRange<Decoration> {
  return Decoration.line({ class: className }).range(line.from)
}

// Blockquote 의 "머리 텍스트" — `>` 와 그 뒤 공백 0~1개를 뗀 첫 줄 나머지, 그리고
// 그 텍스트가 시작하는 문서 위치. parseCalloutHeader(F-128 2장)에 그대로 적용한다
function calloutHeadOf(state: EditorState, blockquoteNode: SyntaxNode): { headFrom: number; headText: string } {
  let headFrom = blockquoteNode.from + 1
  if (state.doc.sliceString(headFrom, headFrom + 1) === ' ') headFrom += 1
  const line = state.doc.lineAt(blockquoteNode.from)
  return { headFrom, headText: state.doc.sliceString(headFrom, line.to) }
}

// 이 Blockquote 가 콜아웃 후보인가 — 중첩된 인용(부모가 Blockquote)은 후보가 아니다.
// 편집 모드는 "가장 바깥 인용만 콜아웃 모양" (F-128 2장) — 인용 안에 인용을 넣어
// 만든 콜아웃(`> > [!tip]`)은 편집 모드에서 안쪽 그대로 판정하지 않는다
function isCalloutCandidate(blockquoteNode: SyntaxNode): boolean {
  return blockquoteNode.parent?.name !== 'Blockquote'
}

// 콜아웃 색 묶음 → 줄 클래스 문자열 (F-128 4.1)
function calloutLineClass(kind: string, { isFirst, isLast }: { isFirst: boolean; isLast: boolean }): string {
  let cls = `md-callout md-callout--${kind}`
  if (isFirst) cls += ' md-callout-title'
  if (isLast) cls += ' md-callout-last'
  return cls
}

// 콜아웃 비활성 머리 줄의 종류 아이콘 위젯 (F-148 3.1). `[!type]`(+접기 기호, 제목이
// 있으면 뒤 공백 1칸까지) 자리를 통째로 이 위젯으로 바꾼다. 제목이 없는 콜아웃은
// 위젯 안에 보기 모드와 같은 기본 제목 글자를 같이 보인다(defaultTitle). 클릭은 커서
// 이동만 하도록(F-148 3.1 "다른 동작 없음") BulletWidget 과 같은 방식(ignoreEvent true)을 쓴다
class CalloutIconWidget extends WidgetType {
  type: string
  defaultTitle: string | null

  constructor(type: string, defaultTitle: string | null) {
    super()
    this.type = type
    this.defaultTitle = defaultTitle // 제목이 있으면 null
  }

  eq(other: CalloutIconWidget): boolean {
    return other instanceof CalloutIconWidget && other.type === this.type && other.defaultTitle === this.defaultTitle
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'md-callout-icon-widget'
    wrap.setAttribute('aria-hidden', 'true')

    const icon = document.createElement('span')
    icon.className = 'md-callout-icon'
    icon.innerHTML = calloutIconSvg(this.type)
    wrap.appendChild(icon)

    if (this.defaultTitle !== null) {
      const title = document.createElement('span')
      title.textContent = this.defaultTitle
      wrap.appendChild(title)
    }

    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

// 글머리 목록 마커 → •
class BulletWidget extends WidgetType {
  eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'md-bullet'
    span.textContent = '•'
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

// 체크박스 위젯 (F-105 "체크박스 위젯" 절)
// eq() 는 checked 값만 비교한다. 클릭하면 대괄호 안 한 글자를 x ↔ 공백으로
// 바꾸는 트랜잭션 1개만 내보낸다 — 선택은 바꾸지 않는다
class CheckboxWidget extends WidgetType {
  checked: boolean

  constructor(checked: boolean) {
    super()
    this.checked = checked
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.tabIndex = -1
    input.className = 'md-checkbox'
    input.checked = this.checked

    input.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(input)
      // TaskMarker 범위는 항상 "[ ]" 또는 "[x]"(3글자) 이고, 위젯은 그 범위 전체를
      // 치환한다. 가운데 글자(대괄호 안)의 위치는 pos + 1 이다
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' },
      })
    })

    return input
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

// hasFocus 는 편집기 포커스 (F-146 3.2). 기본값 true 는 포커스를 다루지 않는
// 기존 호출부(테스트 등)의 동작을 그대로 유지한다
export function buildLines(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  hasFocus = true,
): CMRange<Decoration>[] {
  const active = activeLines(state, hasFocus)
  const out: CMRange<Decoration>[] = []
  // 콜아웃으로 판정된 줄 번호 — 중첩된 인용(부모 Blockquote 가 콜아웃)이 같은 줄에
  // md-quote 를 겹쳐 붙이지 않게 막는 데 쓴다 (F-128 4.1 "이 줄들에는 md-quote 를
  // 붙이지 않는다"). Blockquote 는 바깥에서 안쪽 순서로 방문되므로(tree.iterate),
  // 바깥이 콜아웃이면 안쪽을 처리할 때 이미 이 집합에 그 줄들이 들어 있다
  const calloutLines = new Set<number>()

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            const line = state.doc.lineAt(node.from)
            out.push(lineClassRange(line, HEADING_CLASS[node.name]))
            if (!active.has(line.number)) {
              const mark = node.node.getChild('HeaderMark')
              if (mark) out.push(hideMarkAndSpace(state, mark))
            }
            return
          }

          case 'SetextHeading1':
          case 'SetextHeading2': {
            const mark = node.node.getChild('HeaderMark')
            const lastContentLine = mark ? state.doc.lineAt(mark.from).number - 1 : state.doc.lineAt(node.to).number
            const firstLine = state.doc.lineAt(node.from).number
            for (let n = firstLine; n <= lastContentLine; n++) {
              out.push(lineClassRange(state.doc.line(n), SETEXT_CLASS[node.name]))
            }
            // HeaderMark(밑줄)는 숨기지 않는다
            return
          }

          case 'Blockquote': {
            const firstLine = state.doc.lineAt(node.from).number
            const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number

            if (isCalloutCandidate(node.node)) {
              const { headFrom, headText } = calloutHeadOf(state, node.node)
              const header = parseCalloutHeader(headText)
              if (header) {
                for (let n = firstLine; n <= lastLine; n++) {
                  calloutLines.add(n)
                  out.push(
                    lineClassRange(
                      state.doc.line(n),
                      calloutLineClass(header.kind, { isFirst: n === firstLine, isLast: n === lastLine }),
                    ),
                  )
                }
                // "[!type]" 자리 — 활성 머리 줄은 원문 그대로 색만(F-128 4.1), 비활성 머리
                // 줄은 접기 기호까지 숨기고 종류 아이콘 위젯으로 바꾼다 (F-148 3.1)
                if (active.has(firstLine)) {
                  out.push(
                    Decoration.mark({ class: 'md-callout-type' }).range(
                      headFrom + header.typeFrom,
                      headFrom + header.typeTo,
                    ),
                  )
                } else {
                  let hideTo = headFrom + header.typeTo
                  if (header.title && state.doc.sliceString(hideTo, hideTo + 1) === ' ') hideTo += 1
                  out.push(
                    Decoration.replace({
                      widget: new CalloutIconWidget(header.type, header.title ? null : defaultCalloutTitle(header.type)),
                    }).range(headFrom + header.typeFrom, hideTo),
                  )
                }
                return
              }
            }

            for (let n = firstLine; n <= lastLine; n++) {
              if (calloutLines.has(n)) continue // 바깥 콜아웃이 이미 차지한 줄 (F-128 4.1)
              out.push(lineClassRange(state.doc.line(n), 'md-quote'))
            }
            return
          }

          case 'QuoteMark': {
            const line = state.doc.lineAt(node.from).number
            if (!active.has(line)) out.push(hideMarkAndSpace(state, node.node))
            return
          }

          case 'ListMark': {
            const listItem = node.node.parent
            const list = listItem?.parent
            const lineObj = state.doc.lineAt(node.from)
            // 내어쓰기 대상 (F-152 2.3, 값은 listIndentPreview)
            out.push(lineClassRange(lineObj, 'md-list-line'))
            if (active.has(lineObj.number)) return
            const nextIsTask = node.node.nextSibling?.name === 'Task'
            if (nextIsTask) {
              out.push(hideMarkAndSpace(state, node.node))
            } else if (list?.name === 'BulletList') {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
            } else {
              // 순서 기호는 그대로, 폭만 보기 모드와 맞춤 (F-152 2.3)
              let markEnd = node.to
              if (state.doc.sliceString(markEnd, markEnd + 1) === ' ') markEnd += 1
              out.push(Decoration.mark({ class: 'md-list-marker' }).range(node.from, markEnd))
            }
            return
          }

          case 'TaskMarker': {
            const line = state.doc.lineAt(node.from).number
            if (active.has(line)) return
            const mid = state.doc.sliceString(node.from + 1, node.to - 1)
            const checked = mid === 'x' || mid === 'X'
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to))
            return
          }

          case 'Frontmatter': {
            // 위젯 조건(F-155 2.1)이면 frontmatter.js 의 블록 위젯이 대체한다 — 줄 클래스 없음
            if (frontmatterWidgetInfo(state)) return false

            // 예외(빈 프론트매터·닫는 줄 뒤 줄 없음)는 원문을 숨기지 않고 줄 클래스만 준다 (F-133 3.2)
            const firstLine = state.doc.lineAt(node.from).number
            const lastLine = state.doc.lineAt(Math.max(node.from, node.to - 1)).number
            for (let n = firstLine; n <= lastLine; n++) {
              let cls = 'md-frontmatter'
              if (n === firstLine) cls += ' md-frontmatter-first'
              if (n === lastLine) cls += ' md-frontmatter-last'
              out.push(lineClassRange(state.doc.line(n), cls))
            }
            return false // 안은 FrontmatterMark 뿐 — 더 볼 것이 없다
          }

          case 'HorizontalRule': {
            const line = state.doc.lineAt(node.from)
            if (!active.has(line.number)) {
              out.push(lineClassRange(line, 'md-hr'))
              out.push(HIDE.range(node.from, node.to))
            }
            return
          }

          default:
            return
        }
      },
    })
  }

  return out
}

// 조합 중 보류할 때 문서가 바뀌었으면 decoration 위치를 따라간다 (F-134 3.1).
// inline.ts 의 같은 이름 함수와 이유가 같다 — 옛 decoration 을 옛 위치 그대로 두면
// 새 문서에서 다른 글자(줄바꿈 포함)를 가리킬 수 있어 CM 이 RangeError 를 던진다.
export function mapDecorationsOnHold(decorations: DecorationSet, changes: ChangeDesc): DecorationSet {
  return decorations.map(changes)
}

// F-104 2.3 과 같은 IME 규칙. 조합 중 보류 시 문서 변경분은 따라간다(F-134 3.1).
// 구문 트리만 바뀐 갱신도 재계산 조건에 넣는다(F-134 3.8)
export function linePreview(): Extension {
  const viewPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = Decoration.set(buildLines(view.state, view.visibleRanges, isEditorFocused(view)), true)
      }

      update(update: ViewUpdate) {
        if (!isForced(update)) {
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
          if (!update.docChanged && !update.selectionSet && !update.viewportChanged && !treeChanged) return
          if (isComposing(update.view)) {
            if (update.docChanged) this.decorations = mapDecorationsOnHold(this.decorations, update.changes)
            return
          }
        }
        this.decorations = Decoration.set(
          buildLines(update.state, update.view.visibleRanges, isEditorFocused(update.view)),
          true,
        )
      }
    },
    { decorations: (v) => v.decorations },
  )
  // 프론트매터 위젯(StateField·atomicRanges·커서 보정, F-155)도 이 호출부에 얹는다
  return [viewPlugin, frontmatterWidgetExtension()]
}

// 펜스 코드블록(```)이 걸친 모든 줄에 md-fence-line 을 붙인다 (F-124 3.4 11번 요청).
// linePreview()/buildLines() 와 달리 활성(커서) 여부를 보지 않고 항상 켠다 — 편집 모드
// 위젯이 접혀 있을 때(blocks.ts 의 block:true replace 로 줄 자체가 안 그려질 때)는 이
// decoration 이 있어도 그릴 줄이 없어 아무 효과가 없고, 원문 모드는 애초에 위젯이 없어
// 코드블록 줄이 늘 이 클래스를 받는다.
//
// 배경(--md-bg-muted)을 잇는 모양은 CSS 에서 편집 모드(`[data-view='live']`)로만
// 준다 — 원문 모드는 "요소 모양은 바꾸지 않는다"(F-124 1장)는 원칙대로 서체·크기만
// 따르고, 이 클래스는 `.md-code` 인라인코드 모양만 지우는 데 쓴다(코드블록 본문이
// 인라인코드와 같은 태그(tags.monospace)를 받아 생기는 문제 — highlight.js 주석 참고)
export function fenceLineRanges(state: EditorState, ranges: readonly { from: number; to: number }[]): CMRange<Decoration>[] {
  const out: CMRange<Decoration>[] = []

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return
        const firstLine = state.doc.lineAt(node.from).number
        const lastLine = state.doc.lineAt(node.to).number
        for (let n = firstLine; n <= lastLine; n++) {
          out.push(lineClassRange(state.doc.line(n), 'md-fence-line'))
        }
        return false // 안은 더 볼 것이 없다 (CodeMark·CodeInfo·CodeText)
      },
    })
  }

  return out
}

// createEditor.ts 확장 목록에 직접(previewCompartment 밖) 넣는다 — 편집·원문 모드 공통.
// 조합 중 보류·구문 트리 변경 재계산은 linePreview 와 같다(F-134 3.1·3.8)
export function fenceLinePreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = Decoration.set(fenceLineRanges(view.state, view.visibleRanges), true)
      }

      update(update: ViewUpdate) {
        if (!isForced(update)) {
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
          if (!update.docChanged && !update.viewportChanged && !treeChanged) return
          if (isComposing(update.view)) {
            if (update.docChanged) this.decorations = mapDecorationsOnHold(this.decorations, update.changes)
            return
          }
        }
        this.decorations = Decoration.set(fenceLineRanges(update.state, update.view.visibleRanges), true)
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// 여백·글자 크기가 본문과 달라 거터 숫자가 어긋나는 줄 (F-152 2.1)
const GUTTER_ALIGN_SELECTOR = [
  'md-h1',
  'md-h2',
  'md-h3',
  'md-h4',
  'md-h5',
  'md-h6',
  'md-hr',
  'md-frontmatter-first',
  'md-callout-title',
]
  .map((cls) => `.cm-line.${cls}`)
  .join(', ')

type GutterAlignResult = { gutterEl: Element; shift: number }

// 거터 숫자를 첫 화면 줄 가운데로 translateY. 되먹임 막으려 기준은 줄번호 글자·내용 줄 rect 만 (F-152 2.1)
export function gutterAlignPreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.scheduleMeasure(view)
      }

      update(update: ViewUpdate) {
        if (isForced(update) || update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
          this.scheduleMeasure(update.view)
        }
      }

      scheduleMeasure(view: EditorView) {
        view.requestMeasure<GutterAlignResult[]>({
          read: (view) => {
            const numberMap = new Map<number, Element>()
            for (const el of view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')) {
              const n = Number(el.textContent)
              if (el.getBoundingClientRect().height > 0 && Number.isInteger(n)) numberMap.set(n, el)
            }
            const results: GutterAlignResult[] = []
            for (const lineEl of view.contentDOM.querySelectorAll(GUTTER_ALIGN_SELECTOR)) {
              const pos = view.posAtDOM(lineEl, 0)
              const gutterEl = numberMap.get(view.state.doc.lineAt(pos).number)
              if (!gutterEl) continue
              const coords = view.coordsAtPos(pos, 1)
              if (!coords) continue
              const lineRect = lineEl.getBoundingClientRect()
              const contentCenter = (coords.top + coords.bottom) / 2
              const gutterLineHeight = parseFloat(getComputedStyle(gutterEl).lineHeight) || 0
              const shift = Math.max(0, Math.round(contentCenter - lineRect.top - gutterLineHeight / 2))
              results.push({ gutterEl, shift })
            }
            return results
          },
          write: (results, view) => {
            const used = new Set(results.map((r) => r.gutterEl))
            for (const el of view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')) {
              if (!used.has(el)) (el as HTMLElement).style.removeProperty('transform')
            }
            for (const { gutterEl, shift } of results) {
              ;(gutterEl as HTMLElement).style.setProperty('transform', `translateY(${shift}px)`)
            }
          },
        })
      }
    },
  )
}

type ListContentStart = { lineFrom: number; pos: number }

// 목록 줄마다 기호+공백 뒤 글자 시작 위치 (F-152 2.3)
export function listContentStarts(state: EditorState, ranges: readonly { from: number; to: number }[]): ListContentStart[] {
  const out: ListContentStart[] = []

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'ListMark') {
          const line = state.doc.lineAt(node.from)
          let pos = node.to
          if (state.doc.sliceString(pos, pos + 1) === ' ') pos += 1
          out.push({ lineFrom: line.from, pos })
          return
        }
        if (node.name === 'TaskMarker') {
          const line = state.doc.lineAt(node.from)
          let pos = node.to
          if (state.doc.sliceString(pos, pos + 1) === ' ') pos += 1
          const existing = out.find((e) => e.lineFrom === line.from)
          if (existing) existing.pos = pos
          else out.push({ lineFrom: line.from, pos })
        }
      },
    })
  }

  return out
}

type ListAncestorMarks = { lineFrom: number; ancestorMarkFroms: number[]; ancestorMarkTos: number[] }

// ListMark 가 있는 줄의 조상 목록 항목 ListMark 문서 위치 — 1단계 조상이 배열 앞, 가까운 부모가 뒤 (F-236 3장). 최상위 줄은 결과에 없다
// ancestorMarkTos 는 각 조상 기호가 끝나는 위치(가로 가운데 계산용, F-236 6장)
export function listAncestorMarks(state: EditorState, ranges: readonly { from: number; to: number }[]): ListAncestorMarks[] {
  const out: ListAncestorMarks[] = []

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'ListMark') return
        const marks: number[] = []
        const marksTo: number[] = []
        let list = node.node.parent?.parent // 이 항목을 담은 List(BulletList/OrderedList)
        while (list) {
          const ancestorItem = list.parent
          if (!ancestorItem || ancestorItem.name !== 'ListItem') break
          const ancestorMark = ancestorItem.getChild('ListMark')
          if (ancestorMark) {
            marks.push(ancestorMark.from)
            marksTo.push(ancestorMark.to)
          }
          list = ancestorItem.parent
        }
        if (marks.length > 0) {
          out.push({ lineFrom: state.doc.lineAt(node.from).from, ancestorMarkFroms: marks.reverse(), ancestorMarkTos: marksTo.reverse() })
        }
      },
    })
  }

  return out
}

type ListIndentResult = { lineFrom: number; px: number; guides?: number[] }

// 줄 하나의 --md-list-indent + 중첩 깊이 안내선(F-236) 을 합친 style 속성 문자열 — 안내선은 조상마다 배경 세로 선(1px, 줄 높이 100%) 하나, decoration 은 표시만 바꾼다(원문·구조는 그대로)
function listIndentStyle({ px, guides }: ListIndentResult): string {
  let style = `--md-list-indent: ${px}px`
  if (guides && guides.length > 0) {
    const image = guides.map(() => 'linear-gradient(var(--md-border-muted), var(--md-border-muted))').join(', ')
    const position = guides.map((g) => `${g}px 0`).join(', ')
    style += `; background-image: ${image}; background-position: ${position}; background-size: 1px 100%; background-repeat: no-repeat`
  }
  return style
}

// --md-list-indent 실측값을 문서 위치에 매단다(StateEffect) — el.style 에 직접 쓰면 CM6 가 그 줄을 다시 그릴 때(커서 출입만으로도) decoration 밖 style 을 지운다(observer.ignore 로도 못 막음); decoration attributes 로 넣으면 재적용이 최신 값 그대로라 지워지는 틈이 없다 (F-166 3장 (나))
const setListIndent = StateEffect.define<ListIndentResult[]>()

function listIndentDecorations(results: ListIndentResult[]): DecorationSet {
  return Decoration.set(
    results.map((result) => Decoration.line({ attributes: { style: listIndentStyle(result) } }).range(result.lineFrom)),
    true,
  )
}

const listIndentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(setListIndent)) next = listIndentDecorations(effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

// results 가 view 에 이미 반영된 값과 같으면 true — 같으면 쓰지 않는다 (F-166 3장)
function sameListIndent(view: EditorView, results: ListIndentResult[]): boolean {
  const current: string[] = []
  view.state.field(listIndentField).between(0, view.state.doc.length, (from, _to, deco) => {
    const style = (deco.spec.attributes as { style: string }).style
    current.push(`${from}:${style}`)
  })
  const next = results.map((result) => `${result.lineFrom}:${listIndentStyle(result)}`).sort()
  current.sort()
  return current.length === next.length && current.every((v, i) => v === next[i])
}

// 글자 시작 x 를 실측해 줄에 --md-list-indent 로 씀 (F-152 2.3)
export function listIndentPreview(): Extension {
  const viewPlugin = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.scheduleMeasure(view)
      }

      update(update: ViewUpdate) {
        if (isForced(update) || update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
          this.scheduleMeasure(update.view)
        }
      }

      scheduleMeasure(view: EditorView) {
        view.requestMeasure<ListIndentResult[]>({
          read: (view) => {
            const ancestorsByLine = new Map(
              listAncestorMarks(view.state, view.visibleRanges).map((a) => [a.lineFrom, { froms: a.ancestorMarkFroms, tos: a.ancestorMarkTos }]),
            )
            return listContentStarts(view.state, view.visibleRanges)
              .map(({ lineFrom, pos }) => {
                const lineLeft = view.coordsAtPos(lineFrom, 1)
                const contentLeft = view.coordsAtPos(pos, 1)
                if (!lineLeft || !contentLeft) return null
                const px = Math.max(0, Math.round(contentLeft.left - lineLeft.left))
                const ancestors = ancestorsByLine.get(lineFrom)
                if (!ancestors) return { lineFrom, px }
                // 조상 마커 좌표를 하나라도 못 재면(화면 밖 등) 안내선 없이 들여쓰기만 둔다. 가운데 = 기호 시작·끝 좌표 평균 (F-236 6장)
                const guides: number[] = []
                for (let i = 0; i < ancestors.froms.length; i++) {
                  const markLeft = view.coordsAtPos(ancestors.froms[i], 1)
                  const markRight = view.coordsAtPos(ancestors.tos[i], -1)
                  if (!markLeft || !markRight) return { lineFrom, px }
                  guides.push(Math.round((markLeft.left + markRight.left) / 2 - lineLeft.left))
                }
                return { lineFrom, px, guides }
              })
              .filter((r): r is ListIndentResult => r !== null)
          },
          write: (results, view) => {
            if (sameListIndent(view, results)) return
            // write 는 CM6 자신의 update 처리 도중(같은 호출 스택)에도 불려 바로 dispatch 하면 "update 중 update 호출" 오류가 난다 — 현재 동기 실행이 끝난 뒤(마이크로태스크)로 미룬다
            Promise.resolve().then(() => {
              // 조합 중에는 줄 속성을 다시 쓰지 않는다 — compositionend 의 forceRecalc 로 다시 잰다
              if (view.dom.isConnected && !isComposing(view) && !sameListIndent(view, results)) {
                view.dispatch({ effects: setListIndent.of(results) })
              }
            })
          },
        })
      }
    },
  )

  return [listIndentField, viewPlugin]
}
