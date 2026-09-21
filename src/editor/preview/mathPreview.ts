// 편집 모드 인라인 수식 $…$ 표시 (specs/features/F-291.md 4.1) — highlightMark.ts 와 같은 뼈대. decoration 은 문서를 바꾸지 않는다(CLAUDE.md 불변조건)
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range as CMRange } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

import { findInlineMath } from '../../lib/mathSyntax'
import { renderMath, requestRemeasureOnFontsReady } from '../../lib/mathRender'
import { enterOnClick } from './blocks'
import { isEditorFocused, selectionTouches } from './active'
import { isOpaquePosition } from './wikiLinks'
import { isComposing, isForced } from '../composition'

const ERROR_MARK = Decoration.mark({ class: 'md-math-error' })

// 인라인 수식 위젯. 렌더 성공한 tex 에만 만들어진다. eq() 키는 TeX 원문 하나(mermaidWidget.ts 와 같은 판단)
export class InlineMathWidget extends WidgetType {
  tex: string

  constructor(tex: string) {
    super()
    this.tex = tex
  }

  eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span')
    span.className = 'md-math-inline'

    const result = renderMath(this.tex, { display: false })
    if ('html' in result) {
      span.innerHTML = result.html
    } else {
      // 이론상 생기지 않는다(buildInlineMath 가 실패한 tex 는 위젯을 만들지 않는다) — 방어만 남긴다
      span.className = 'md-math-error'
      span.textContent = `$${this.tex}$`
      span.title = result.error
    }

    requestRemeasureOnFontsReady(view, () => view.requestMeasure())
    enterOnClick(span, view)
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

// ranges 는 보통 view.visibleRanges. hasFocus 기본값 true 는 포커스를 다루지 않는 기존 호출부의 동작을 유지한다
export function buildInlineMath(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  hasFocus = true,
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

      for (const m of findInlineMath(lineText)) {
        const matchFrom = line.from + m.from
        if (isOpaquePosition(state, matchFrom)) continue
        const matchTo = line.from + m.to

        // 판정 단위는 줄이 아니라 범위다(F-129 3.2) — 선택이 닿으면 decoration 을 아예 만들지 않는다
        if (selectionTouches(state, matchFrom, matchTo, hasFocus)) continue

        const tex = lineText.slice(m.innerFrom, m.innerTo)
        const result = renderMath(tex, { display: false })
        if ('html' in result) {
          // R7 때문에 구조적으로 줄바꿈을 덮지 않지만, inline.ts 의 pushHide 와 같은 방어를 남긴다
          if (!state.doc.sliceString(matchFrom, matchTo).includes('\n')) {
            out.push(Decoration.replace({ widget: new InlineMathWidget(tex) }).range(matchFrom, matchTo))
          }
        } else {
          // 렌더 실패 — 위젯 없이 원문 그대로, 짝 범위에 색만 다르다(6.3)
          out.push(ERROR_MARK.range(matchFrom, matchTo))
        }
      }
    }
  }

  return out
}

// 조합 중 보류할 때 문서가 바뀌었으면 decoration 위치를 따라간다(F-134 3.1)
function mapDecorationsOnHold(
  decorations: ReturnType<typeof Decoration.set>,
  changes: Parameters<ReturnType<typeof Decoration.set>['map']>[0],
): ReturnType<typeof Decoration.set> {
  return decorations.map(changes)
}

// livePreview() 안에 넣는다. IME 규칙은 다른 프리뷰 확장과 글자 그대로 같다(highlightMark.ts 와 같은 모양)
export function mathPreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof Decoration.set>

      constructor(view: EditorView) {
        this.decorations = Decoration.set(buildInlineMath(view.state, view.visibleRanges, isEditorFocused(view)), true)
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
          buildInlineMath(update.state, update.view.visibleRanges, isEditorFocused(update.view)),
          true,
        )
      }
    },
    { decorations: (v) => v.decorations },
  )
}
