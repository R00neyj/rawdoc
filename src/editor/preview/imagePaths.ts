// 상대 경로 이미지 리졸버 문맥 — previewCompartment 밖에 두어 모드·테마 전환에도 남는다 (specs/features/F-2131.md 3.1)
import { StateEffect, StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { imageLineAt } from '../../lib/image/imageMarkdown'
import type { ImageTarget, ParsedImageLine, ResolveImagePath } from '../../lib/image/imageMarkdown'

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

// from·to = 그 줄 전체. hideFrom = 위젯 범위 시작. markLine = 그 줄에 ListMark 가 있음 (F-2167 4.1)
export type NestedImageLine = LeadingImageLine & { imageFrom: number; hideFrom: number; markLine: boolean }

const LINE_PREFIX_RE = /^[ \t>]*/

// 줄 앞 접두(공백·`>`)에서 마지막 `>` 다음 칸 — 없으면 0
function afterLastQuote(prefix: string): number {
  return prefix.lastIndexOf('>') + 1
}

// 가장 안쪽 컨테이너가 목록 항목이면 그 항목 — 인용이 더 안쪽이면 null
export function innermostListItem(node: SyntaxNode): SyntaxNode | null {
  for (let n = node.parent; n; n = n.parent) {
    if (n.name === 'ListItem') return n
    if (n.name === 'Blockquote') return null
  }
  return null
}

function quoteDepth(node: SyntaxNode): number {
  let depth = 0
  for (let n = node.parent; n; n = n.parent) if (n.name === 'Blockquote') depth++
  return depth
}

function hasMarkOnLine(state: EditorState, node: SyntaxNode, lineNumber: number): boolean {
  for (let n = node.parent; n; n = n.parent) {
    const mark = n.name === 'ListItem' ? n.getChild('ListMark') : null
    if (mark && state.doc.lineAt(mark.from).number === lineNumber) return true
  }
  return false
}

// 둘째 줄부터: 게으른 줄·코드 들여쓰기면 false — 보기 모드 문단 종료 규칙과 같은 경계 (F-2167 3장·4.1)
function continuationFits(state: EditorState, node: SyntaxNode, prefix: string): boolean {
  if (prefix.includes('\t')) return false
  if ((prefix.match(/>/g) ?? []).length !== quoteDepth(node)) return false
  const n = prefix.length - afterLastQuote(prefix)
  const item = innermostListItem(node)
  const mark = item?.getChild('ListMark')
  if (!item || !mark) return n <= 3
  const markLine = state.doc.lineAt(mark.from)
  const markPrefix = LINE_PREFIX_RE.exec(markLine.text)![0].slice(0, mark.from - markLine.from)
  const c = mark.to + 1 - (markLine.from + afterLastQuote(markPrefix))
  return n >= c && n <= c + 3
}

// 목록·인용 안 Paragraph(모든 줄)·Task(둘째 줄부터)에서 혼자 그림인 줄 (F-2167 4.1)
export function nestedImageLines(state: EditorState, node: SyntaxNode, resolveImagePath: ResolveImagePath | undefined): NestedImageLine[] {
  if (!isInsideListOrQuote(node)) return []
  const out: NestedImageLine[] = []
  const first = state.doc.lineAt(node.from).number
  const last = state.doc.lineAt(node.to).number
  for (let n = node.name === 'Task' ? first + 1 : first; n <= last; n++) {
    const line = state.doc.line(n)
    const prefix = n === first ? '' : LINE_PREFIX_RE.exec(line.text)![0]
    if (n !== first && !continuationFits(state, node, prefix)) continue
    const imageFrom = n === first ? node.from : line.from + prefix.length
    if (state.doc.sliceString(imageFrom, imageFrom + 1) !== '!') continue
    const image = imageLineAt(state.doc.sliceString(imageFrom, line.to), resolveImagePath)
    if (!image) continue
    const markLine = hasMarkOnLine(state, node, n)
    const linePrefix = LINE_PREFIX_RE.exec(line.text)![0]
    let hideFrom = line.from + afterLastQuote(linePrefix)
    if (hideFrom > line.from && line.text[hideFrom - line.from] === ' ') hideFrom++
    out.push({ from: line.from, to: line.to, ...image, imageFrom, hideFrom: markLine ? imageFrom : hideFrom, markLine })
  }
  return out
}

// 최상위 문단·setext 제목 노드의 첫 줄이 혼자 그림 한 줄이면 그 줄 (F-2127 4.1, 요청노트 2026-10-21)
export function leadingImageLine(state: EditorState, node: SyntaxNode, resolveImagePath: ResolveImagePath | undefined): LeadingImageLine | null {
  if (isInsideListOrQuote(node) || state.doc.sliceString(node.from, node.from + 1) !== '!') return null
  const first = state.doc.lineAt(node.from)
  const image = imageLineAt(first.text, resolveImagePath)
  return image && { from: first.from, to: first.to, ...image }
}
