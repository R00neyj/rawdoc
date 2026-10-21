// 상대 경로 이미지 리졸버 문맥 — previewCompartment 밖에 두어 모드·테마 전환에도 남는다 (specs/features/F-2131.md 3.1)
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { imageLineAt } from '../../lib/imageMarkdown'
import type { ImageTarget, ParsedImageLine, ResolveImagePath } from '../../lib/imageMarkdown'

export const imagePathsChanged = StateEffect.define<ResolveImagePath | null>()

export const imagePathsField = StateField.define<ResolveImagePath | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(imagePathsChanged)) value = effect.value
    }
    return value
  },
})

export function imagePathsOf(state: EditorState): ResolveImagePath | undefined {
  return state.field(imagePathsField, false) ?? undefined
}

// 목록·인용 안인가 (F-157 2.1 "문서 최상위") — 표는 tableModel 이 줄 앞 `>`·`-` 를 몰라 구조를 깨므로 원문으로 둔다 (리뷰 E2)
const LIST_OR_QUOTE = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem'])
export function isInsideListOrQuote(node: SyntaxNode): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (LIST_OR_QUOTE.has(n.name)) return true
  }
  return false
}

export type LeadingImageLine = { from: number; to: number; line: ParsedImageLine; target: ImageTarget }

// 최상위 문단·setext 제목 노드의 첫 줄이 혼자 그림 한 줄이면 그 줄 (F-2127 4.1, 요청노트 2026-10-21)
export function leadingImageLine(state: EditorState, node: SyntaxNode, resolveImagePath: ResolveImagePath | undefined): LeadingImageLine | null {
  if (isInsideListOrQuote(node) || state.doc.sliceString(node.from, node.from + 1) !== '!') return null
  const first = state.doc.lineAt(node.from)
  const image = imageLineAt(first.text, resolveImagePath)
  return image && { from: first.from, to: first.to, ...image }
}
