// 편집·원문 모드 하이라이트(==…==) 표시 (specs/features/F-283.md 4장). 계산 함수는 DOM 없이 동작한다. decoration 은 문서를 바꾸지 않는다(CLAUDE.md 불변조건)
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range as CMRange } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

import { findHighlights } from '../../lib/highlightSyntax'
import { activeLines, isEditorFocused } from './active'
import { isOpaquePosition } from './wikiLinks'
import { isComposing, isForced } from '../composition'

const HIDE = Decoration.replace({})
const HIGHLIGHT_MARK = Decoration.mark({ class: 'md-highlight' })
// md-mark 는 이미 app.css 에서 강조색(--accent)+고정폭을 주는 마크다운 기호 클래스다. 새 클래스를 만들지 않는다(F-107 2.1, F-283.md 4.2)
const SYNTAX_MARK = Decoration.mark({ class: 'md-mark' })

// 줄바꿈이 있으면 HIDE(replace) 를 만들지 않는다 — CM 이 줄바꿈을 replace 하는 decoration 을 막는다(inline.ts 의 pushHide 와 같은 이유). 짝은 줄을 넘지 않아(3.2.1) 실제로는 걸리지 않지만 같은 방어를 남겨 둔다
function pushHide(out: CMRange<Decoration>[], state: EditorState, from: number, to: number): void {
  if (state.doc.sliceString(from, to).includes('\n')) return
  out.push(HIDE.range(from, to))
}

// ranges 는 보통 view.visibleRanges. hasFocus 는 편집기 포커스(F-146 3.2). 기본값 true 는 포커스를 다루지 않는 기존 호출부(테스트 등)의 동작을 그대로 유지한다
export function buildHighlightMarks(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  hasFocus = true,
): CMRange<Decoration>[] {
  const active = activeLines(state, hasFocus)
  const out: CMRange<Decoration>[] = []
  const seenLines = new Set<number>()

  for (const { from, to } of ranges) {
    const firstLine = state.doc.lineAt(from).number
    const lastLine = state.doc.lineAt(to).number

    for (let n = firstLine; n <= lastLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)

      const line = state.doc.line(n)
      if (isOpaquePosition(state, line.from)) continue
      const lineText = state.doc.sliceString(line.from, line.to)

      for (const m of findHighlights(lineText)) {
        const matchFrom = line.from + m.from
        if (isOpaquePosition(state, matchFrom)) continue
        const matchTo = line.from + m.to
        const innerFrom = line.from + m.innerFrom
        const innerTo = line.from + m.innerTo

        // 커서가 닿든 안 닿든 배경은 항상 보인다(4.1 — Obsidian 과 같다)
        out.push(HIGHLIGHT_MARK.range(innerFrom, innerTo))

        if (!active.has(n)) {
          pushHide(out, state, matchFrom, matchFrom + 2)
          pushHide(out, state, matchTo - 2, matchTo)
        }
      }
    }
  }

  return out
}

// 편집·원문 공통, 기호 색만 (4.2). 선택과 무관하게 항상 같다
export function buildHighlightSymbols(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): CMRange<Decoration>[] {
  const out: CMRange<Decoration>[] = []
  const seenLines = new Set<number>()

  for (const { from, to } of ranges) {
    const firstLine = state.doc.lineAt(from).number
    const lastLine = state.doc.lineAt(to).number

    for (let n = firstLine; n <= lastLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)

      const line = state.doc.line(n)
      if (isOpaquePosition(state, line.from)) continue
      const lineText = state.doc.sliceString(line.from, line.to)

      for (const m of findHighlights(lineText)) {
        const matchFrom = line.from + m.from
        if (isOpaquePosition(state, matchFrom)) continue
        const matchTo = line.from + m.to

        out.push(SYNTAX_MARK.range(matchFrom, matchFrom + 2))
        out.push(SYNTAX_MARK.range(matchTo - 2, matchTo))
      }
    }
  }

  return out
}

// 조합 중 보류할 때 문서가 바뀌었으면 decoration 위치를 따라간다 (다른 프리뷰 확장과 같은 이유, F-134 3.1)
function mapDecorationsOnHold(
  decorations: ReturnType<typeof Decoration.set>,
  changes: Parameters<ReturnType<typeof Decoration.set>['map']>[0],
): ReturnType<typeof Decoration.set> {
  return decorations.map(changes)
}

// 편집(라이브) 모드 — livePreview() 안에 넣는다 (F-104 2.1 구조와 같다)
export function highlightMarkPreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof Decoration.set>

      constructor(view: EditorView) {
        this.decorations = Decoration.set(buildHighlightMarks(view.state, view.visibleRanges, isEditorFocused(view)), true)
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
          buildHighlightMarks(update.state, update.view.visibleRanges, isEditorFocused(update.view)),
          true,
        )
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// 원문 모드 — previewCompartment 밖에 둬 편집·원문 모드 모두 켠다(4.2, createEditor.ts fenceLinePreview() 옆). 선택과 무관해 selectionSet 은 재계산 조건에 넣지 않는다
export function highlightMarkStyle(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof Decoration.set>

      constructor(view: EditorView) {
        this.decorations = Decoration.set(buildHighlightSymbols(view.state, view.visibleRanges), true)
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
        this.decorations = Decoration.set(buildHighlightSymbols(update.state, update.view.visibleRanges), true)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
