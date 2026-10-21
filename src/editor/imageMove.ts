// 이미지 블록 끌어 옮기기 — 놓을 틈(줄 시작)으로 블록 원문 줄을 옮기는 변경 계산 (small 2026-10-22)
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export type Span = { from: number; to: number }
export type MoveChange = { from: number; to: number; insert: string }

// 붙여넣기 자리 규칙(imageInsert.ts BLOCKED_NODE)과 같은 노드들
const BLOCKED_NODE = new Set(['FencedCode', 'Table', 'Frontmatter'])

// 틈 pos 는 from < pos <= to 이면 막힌다 — 프론트매터는 문서 첫머리여야 해서 그 앞(0)도 막는다
export function moveBlockedRanges(state: EditorState): Span[] {
  const out: Span[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!BLOCKED_NODE.has(node.name)) return
      out.push({ from: node.name === 'Frontmatter' ? -1 : node.from, to: node.to })
      return false
    },
  })
  return out
}

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = []
  let pos = 0
  for (const line of lines) {
    starts.push(pos)
    pos += line.length + 1
  }
  return starts
}

function lineIndexAt(starts: readonly number[], pos: number): number {
  let i = 0
  while (i + 1 < starts.length && starts[i + 1] <= pos) i++
  return i
}

// block 줄들을 target 틈(줄 시작 또는 문서 끝)으로 옮기는 원래 좌표 변경 두 개. 제자리·막힘·틈 아님이면 null
// 빈 줄 규칙은 computeImagePlacement 와 같다 — 위·아래가 글자 줄이면 빈 줄 하나로 띄우고, 빠진 자리엔 빈 줄 하나만 남긴다
export function imageMoveChanges(doc: string, block: Span, target: number, blocked: readonly Span[] = []): MoveChange[] | null {
  const lines = doc.split('\n')
  const starts = lineStarts(lines)
  const a = lineIndexAt(starts, block.from)
  const b = lineIndexAt(starts, block.to)
  let g = starts.indexOf(target)
  if (g < 0) {
    if (target !== doc.length) return null
    g = lines.length
  }
  if (g >= a && g <= b + 1) return null
  if (blocked.some((r) => r.from < target && target <= r.to)) return null

  let rs = a
  let re = b
  const isBlank = (i: number) => lines[i] === ''
  if (b + 1 < lines.length && isBlank(b + 1) && (a === 0 || isBlank(a - 1))) re = b + 1
  else if (b === lines.length - 1 && a > 0 && isBlank(a - 1)) rs = a - 1

  const del: MoveChange =
    re + 1 < lines.length
      ? { from: starts[rs], to: starts[re + 1], insert: '' }
      : { from: rs > 0 ? starts[rs] - 1 : 0, to: doc.length, insert: '' }

  let above = g - 1
  if (above >= rs && above <= re) above = rs - 1
  let below = g
  if (below >= rs && below <= re) below = re + 1
  const blockText = lines.slice(a, b + 1).join('\n')
  const lead = above >= 0 && !isBlank(above) ? '\n' : ''
  let ins: MoveChange
  if (below < lines.length) {
    // 마지막 빈 줄은 문서 끝 줄바꿈이라 글자 줄로 치지 않는다
    const trail = isBlank(below) ? '' : '\n'
    ins = { from: starts[below], to: starts[below], insert: lead + blockText + '\n' + trail }
  } else {
    ins = { from: doc.length, to: doc.length, insert: (above >= 0 ? '\n' : '') + lead + blockText }
  }

  const changes = [del, ins].sort((x, y) => x.from - y.from || x.to - y.to)
  let next = doc
  for (const c of [...changes].reverse()) next = next.slice(0, c.from) + c.insert + next.slice(c.to)
  return next === doc ? null : changes
}
