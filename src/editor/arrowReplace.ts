// `->` 를 치면 `→` 로 바꾸고, 바로 뒤 Backspace 는 `->` 로 되돌린다 (small 2026-11-12)
import type { SyntaxNode } from '@lezer/common'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { EditorSelection, Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

import { isComposing } from './composition'

const ARROW = '→'
const SKIP_NODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'Frontmatter', 'HTMLBlock', 'CommentBlock', 'Comment'])

let enabled = true

// 앱 설정이 부른다 — 이미 열린 편집기도 다음 입력부터 따른다
export function setArrowReplace(on: boolean): void {
  enabled = on
}

function insideSkipped(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (SKIP_NODE.has(n.name)) return true
  }
  return false
}

const markArrow = StateEffect.define<number>()

// 방금 바꾼 → 바로 뒤 위치. 그 뒤 다른 변경·커서 이동이 있으면 지운다
const justReplaced = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(markArrow)) return effect.value
    if (value === null || (!tr.docChanged && !tr.selection)) return value
    return null
  },
})

export function arrowReplaceInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (!enabled || text !== '>' || from !== to || state.readOnly) return null
  if (state.selection.ranges.length !== 1) return null
  if (from < 1 || state.doc.sliceString(from - 1, from) !== '-') return null
  if (from >= 2 && state.doc.sliceString(from - 2, from - 1) === '-') return null // `-->` HTML 주석 닫기
  if (insideSkipped(state, from)) return null
  return {
    changes: { from: from - 1, to: from, insert: ARROW },
    selection: EditorSelection.cursor(from),
    effects: markArrow.of(from),
    userEvent: 'input.type',
  }
}

export function arrowReplaceBackspace(state: EditorState): TransactionSpec | null {
  const at = state.field(justReplaced, false)
  const range = state.selection.main
  if (at == null || state.selection.ranges.length !== 1 || !range.empty || range.head !== at) return null
  if (state.doc.sliceString(at - 1, at) !== ARROW) return null
  return {
    changes: { from: at - 1, to: at, insert: '->' },
    selection: EditorSelection.cursor(at + 1),
    userEvent: 'delete.backward',
  }
}

export function arrowReplace() {
  return [
    justReplaced,
    EditorView.inputHandler.of((view, from, to, text) => {
      if (isComposing(view)) return false
      const spec = arrowReplaceInput(view.state, from, to, text)
      if (!spec) return false
      view.dispatch(spec)
      return true
    }),
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            if (isComposing(view) || view.state.readOnly) return false
            const spec = arrowReplaceBackspace(view.state)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
      ]),
    ),
  ]
}
