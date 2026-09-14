// 줄 단위 요소 표시 (specs/features/F-105.md)
// 구조·IME 처리·활성 줄 판정은 F-104 2.1·2.3 과 같다. 계산(buildLines)은 DOM 없이 동작한다.
// decoration 은 문서를 바꾸지 않는다 — 체크박스 클릭도 위젯이 트랜잭션을 하나 내보낼 뿐,
// decoration 자체는 표시만 바꾼다 (CLAUDE.md 불변조건)
import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'

import { activeLines, isEditorFocused } from './active.js'
import { isComposing, isForced } from '../composition.js'
import { parseCalloutHeader } from '../../lib/callout.js'

const HIDE = Decoration.replace({})

const HEADING_CLASS = {
  ATXHeading1: 'md-h1',
  ATXHeading2: 'md-h2',
  ATXHeading3: 'md-h3',
  ATXHeading4: 'md-h4',
  ATXHeading5: 'md-h5',
  ATXHeading6: 'md-h6',
}

const SETEXT_CLASS = {
  SetextHeading1: 'md-h1',
  SetextHeading2: 'md-h2',
}

/** ListMark(또는 HeaderMark·QuoteMark) 뒤에 오는 공백 1칸까지 포함한 숨김 범위 */
function hideMarkAndSpace(state, node) {
  let to = node.to
  if (state.doc.sliceString(to, to + 1) === ' ') to += 1
  return HIDE.range(node.from, to)
}

function lineClassRange(line, className) {
  return Decoration.line({ class: className }).range(line.from)
}

/**
 * Blockquote 의 "머리 텍스트" — `>` 와 그 뒤 공백 0~1개를 뗀 첫 줄 나머지, 그리고
 * 그 텍스트가 시작하는 문서 위치. parseCalloutHeader(F-128 2장)에 그대로 적용한다
 */
function calloutHeadOf(state, blockquoteNode) {
  let headFrom = blockquoteNode.from + 1
  if (state.doc.sliceString(headFrom, headFrom + 1) === ' ') headFrom += 1
  const line = state.doc.lineAt(blockquoteNode.from)
  return { headFrom, headText: state.doc.sliceString(headFrom, line.to) }
}

/**
 * 이 Blockquote 가 콜아웃 후보인가 — 중첩된 인용(부모가 Blockquote)은 후보가 아니다.
 * 편집 모드는 "가장 바깥 인용만 콜아웃 모양" (F-128 2장) — 인용 안에 인용을 넣어
 * 만든 콜아웃(`> > [!tip]`)은 편집 모드에서 안쪽 그대로 판정하지 않는다
 */
function isCalloutCandidate(blockquoteNode) {
  return blockquoteNode.parent?.name !== 'Blockquote'
}

/** 콜아웃 색 묶음 → 줄 클래스 문자열 (F-128 4.1) */
function calloutLineClass(kind, { isFirst, isLast }) {
  let cls = `md-callout md-callout--${kind}`
  if (isFirst) cls += ' md-callout-title'
  if (isLast) cls += ' md-callout-last'
  return cls
}

/** 글머리 목록 마커 → • */
class BulletWidget extends WidgetType {
  eq(other) {
    return other instanceof BulletWidget
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'md-bullet'
    span.textContent = '•'
    return span
  }

  ignoreEvent() {
    return true
  }
}

/**
 * 체크박스 위젯 (F-105 "체크박스 위젯" 절)
 * eq() 는 checked 값만 비교한다. 클릭하면 대괄호 안 한 글자를 x ↔ 공백으로
 * 바꾸는 트랜잭션 1개만 내보낸다 — 선택은 바꾸지 않는다
 */
class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super()
    this.checked = checked
  }

  eq(other) {
    return other.checked === this.checked
  }

  toDOM(view) {
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

  ignoreEvent(event) {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}

/**
 * @param {import('@codemirror/state').EditorState} state
 * @param {{from:number, to:number}[]} ranges 보통 view.visibleRanges
 * @param {boolean} [hasFocus] 편집기 포커스 (F-146 3.2). 기본값 true 는 포커스를
 *   다루지 않는 기존 호출부(테스트 등)의 동작을 그대로 유지한다
 * @returns {import('@codemirror/state').Range<import('@codemirror/view').Decoration>[]}
 */
export function buildLines(state, ranges, hasFocus = true) {
  const active = activeLines(state, hasFocus)
  const out = []
  // 콜아웃으로 판정된 줄 번호 — 중첩된 인용(부모 Blockquote 가 콜아웃)이 같은 줄에
  // md-quote 를 겹쳐 붙이지 않게 막는 데 쓴다 (F-128 4.1 "이 줄들에는 md-quote 를
  // 붙이지 않는다"). Blockquote 는 바깥에서 안쪽 순서로 방문되므로(tree.iterate),
  // 바깥이 콜아웃이면 안쪽을 처리할 때 이미 이 집합에 그 줄들이 들어 있다
  const calloutLines = new Set()

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
                // "[!type]" 자리 색 묶음 표시 (F-128 4.1). 기호는 숨기지 않고 항상 보인다
                out.push(
                  Decoration.mark({ class: 'md-callout-type' }).range(
                    headFrom + header.typeFrom,
                    headFrom + header.typeTo,
                  ),
                )
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
            // 원문을 숨기지 않는다(위젯 없음) — 줄 클래스만 준다 (F-133 3.2).
            // 활성(커서) 여부와 무관하게 항상 이 모양이다 — 펜스 코드블록 본문처럼
            // "펼쳐진 채 고정된" 영역이라 F-104 식 활성 줄 판정을 적용하지 않는다
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

/**
 * 조합 중 보류할 때 문서가 바뀌었으면 decoration 위치를 따라간다 (F-134 3.1).
 * inline.js 의 같은 이름 함수와 이유가 같다 — 옛 decoration 을 옛 위치 그대로 두면
 * 새 문서에서 다른 글자(줄바꿈 포함)를 가리킬 수 있어 CM 이 RangeError 를 던진다.
 * @param {import('@codemirror/state').DecorationSet} decorations
 * @param {import('@codemirror/state').ChangeDesc} changes
 */
export function mapDecorationsOnHold(decorations, changes) {
  return decorations.map(changes)
}

/** F-104 2.3 과 같은 IME 규칙. 조합 중 보류 시 문서 변경분은 따라간다(F-134 3.1).
 * 구문 트리만 바뀐 갱신도 재계산 조건에 넣는다(F-134 3.8) */
export function linePreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.set(buildLines(view.state, view.visibleRanges, isEditorFocused(view)), true)
      }

      update(update) {
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
}

/**
 * 펜스 코드블록(```)이 걸친 모든 줄에 md-fence-line 을 붙인다 (F-124 3.4 11번 요청).
 * linePreview()/buildLines() 와 달리 활성(커서) 여부를 보지 않고 항상 켠다 — 편집 모드
 * 위젯이 접혀 있을 때(blocks.js 의 block:true replace 로 줄 자체가 안 그려질 때)는 이
 * decoration 이 있어도 그릴 줄이 없어 아무 효과가 없고, 원문 모드는 애초에 위젯이 없어
 * 코드블록 줄이 늘 이 클래스를 받는다.
 *
 * 배경(--md-bg-muted)을 잇는 모양은 CSS 에서 편집 모드(`[data-view='live']`)로만
 * 준다 — 원문 모드는 "요소 모양은 바꾸지 않는다"(F-124 1장)는 원칙대로 서체·크기만
 * 따르고, 이 클래스는 `.md-code` 인라인코드 모양만 지우는 데 쓴다(코드블록 본문이
 * 인라인코드와 같은 태그(tags.monospace)를 받아 생기는 문제 — highlight.js 주석 참고)
 */
export function fenceLineRanges(state, ranges) {
  const out = []

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

/** createEditor.js 확장 목록에 직접(previewCompartment 밖) 넣는다 — 편집·원문 모드 공통.
 * 조합 중 보류·구문 트리 변경 재계산은 linePreview 와 같다(F-134 3.1·3.8) */
export function fenceLinePreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.set(fenceLineRanges(view.state, view.visibleRanges), true)
      }

      update(update) {
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

// 거터 숫자를 첫 화면 줄 가운데로 translateY. 되먹임 막으려 기준은 줄번호 글자·내용 줄 rect 만 (F-152 2.1)
export function gutterAlignPreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.scheduleMeasure(view)
      }

      update(update) {
        if (isForced(update) || update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
          this.scheduleMeasure(update.view)
        }
      }

      scheduleMeasure(view) {
        view.requestMeasure({
          read: (view) => {
            const numberMap = new Map()
            for (const el of view.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')) {
              const n = Number(el.textContent)
              if (el.getBoundingClientRect().height > 0 && Number.isInteger(n)) numberMap.set(n, el)
            }
            const results = []
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
              if (!used.has(el)) el.style.removeProperty('transform')
            }
            for (const { gutterEl, shift } of results) {
              gutterEl.style.setProperty('transform', `translateY(${shift}px)`)
            }
          },
        })
      }
    },
  )
}

// 목록 줄마다 기호+공백 뒤 글자 시작 위치 (F-152 2.3)
export function listContentStarts(state, ranges) {
  const out = []

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

// --md-list-indent 실측값을 문서 위치에 매단다(StateEffect) — el.style 에 직접 쓰면 CM6 가 그 줄을 다시 그릴 때(커서 출입만으로도) decoration 밖 style 을 지운다(observer.ignore 로도 못 막음); decoration attributes 로 넣으면 재적용이 최신 값 그대로라 지워지는 틈이 없다 (F-166 3장 (나))
const setListIndent = StateEffect.define()

function listIndentDecorations(results) {
  return Decoration.set(
    results.map(({ lineFrom, px }) => Decoration.line({ attributes: { style: `--md-list-indent: ${px}px` } }).range(lineFrom)),
    true,
  )
}

const listIndentField = StateField.define({
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
function sameListIndent(view, results) {
  const current = []
  view.state.field(listIndentField).between(0, view.state.doc.length, (from, _to, deco) => {
    current.push(`${from}:${deco.spec.attributes.style}`)
  })
  const next = results
    .map(({ lineFrom, px }) => `${lineFrom}:--md-list-indent: ${px}px`)
    .sort()
  current.sort()
  return current.length === next.length && current.every((v, i) => v === next[i])
}

// 글자 시작 x 를 실측해 줄에 --md-list-indent 로 씀 (F-152 2.3)
export function listIndentPreview() {
  const viewPlugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.scheduleMeasure(view)
      }

      update(update) {
        if (isForced(update) || update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
          this.scheduleMeasure(update.view)
        }
      }

      scheduleMeasure(view) {
        view.requestMeasure({
          read: (view) =>
            listContentStarts(view.state, view.visibleRanges)
              .map(({ lineFrom, pos }) => {
                const lineLeft = view.coordsAtPos(lineFrom, 1)
                const contentLeft = view.coordsAtPos(pos, 1)
                if (!lineLeft || !contentLeft) return null
                return { lineFrom, px: Math.max(0, Math.round(contentLeft.left - lineLeft.left)) }
              })
              .filter(Boolean),
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
