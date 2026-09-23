// 보기 화면 DOM 읽기·스크롤 (specs/features/F-295.md 7장). 전역 document 대신 넘겨받은 요소만 본다 — outlinePosition.ts 와 같은 이유로 app/ 에 둔다
import { anchorAtTop, topForAnchor } from '../lib/scrollAnchor'
import type { LineBlock, ScrollAnchor } from '../lib/scrollAnchor'

type Rect = { top: number; bottom: number }
type Scroller = {
  getBoundingClientRect(): Rect
  scrollTop: number
  clientHeight: number
  querySelectorAll(sel: string): Iterable<{ getBoundingClientRect(): Rect; getAttribute(n: string): string | null }>
  scrollTo(opts: { top: number; behavior: ScrollBehavior }): void
}

export function readViewerBlocks(root: Scroller | null): LineBlock[] {
  if (!root) return []
  const rootTop = root.getBoundingClientRect().top
  const blocks: LineBlock[] = []

  for (const el of root.querySelectorAll('[data-source-line]')) {
    const line = Number(el.getAttribute('data-source-line'))
    if (!Number.isFinite(line)) continue
    const rect = el.getBoundingClientRect()
    blocks.push({ line, top: rect.top - rootTop + root.scrollTop, bottom: rect.bottom - rootTop + root.scrollTop })
  }

  blocks.sort((a, b) => a.line - b.line)
  return blocks
}

export function readViewerAnchor(root: Scroller | null): ScrollAnchor | null {
  if (!root || root.clientHeight === 0) return null
  // 제목이 보이는 채 맨 위(createEditor.ts 의 0 sentinel 짝, anchor=1 과 구별 안 됨)와 정확히 맨 위를 나눈다 (F-295 A4 실측, 명세 7장을 벗어난 보정)
  if (root.scrollTop <= 0) return 0
  return anchorAtTop(readViewerBlocks(root), root.scrollTop)
}

export function scrollViewerToAnchor(root: Scroller | null, anchor: ScrollAnchor): void {
  if (!root || root.clientHeight === 0) return
  const y = topForAnchor(readViewerBlocks(root), anchor)
  if (y === null) return
  // scrollTop 대입이 아니라 scrollTo 를 쓴다 — .viewer 가 scroll-behavior: smooth 라 대입은 애니메이션이 되어 즉시 반영되지 않는다 (F-295.md 3.3)
  root.scrollTo({ top: Math.max(0, y), behavior: 'instant' })
}
