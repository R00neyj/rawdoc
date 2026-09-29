// 보기 모드 찾기 DOM 쪽 — 글자 색인, Range, CSS Custom Highlight 등록, 스크롤 (F-2087 3.2, 4~6장)
import { floatCoverFor } from '../lib/floatCover'
import { foldLength, locateOffset, normalizeBlockText, scrollTopToReveal, type ViewFindMatch } from './viewFindMatch'

export const MATCH_HIGHLIGHT = 'view-find-match'
export const CURRENT_HIGHLIGHT = 'view-find-current'

const EXCLUDED = '.katex, .md-mermaid, .md-image, .markdown-callout-icon, .md-code-head, div.md-math-error'
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, div, dt, dd, table, thead, tbody, tr, ul, ol'
const STRUCTURE = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'BLOCKQUOTE', 'DL', 'DIV'])

export type FindBlock = { nodes: Text[]; starts: number[]; text: string }
export type FindIndex = { blocks: FindBlock[]; texts: string[]; folded: string[] }

export function buildFindIndex(root: HTMLElement): FindIndex {
  const blocks: FindBlock[] = []
  const raw: string[] = []
  const pres: boolean[] = []
  let lastBlock: Element | null = null
  let cur: FindBlock | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const parent = n.parentElement
    if (!parent || parent.closest(EXCLUDED)) continue
    if (STRUCTURE.has(parent.tagName) && n.data.trim() === '') continue
    const block = parent.closest(BLOCK) ?? root
    if (block !== lastBlock || !cur) {
      cur = { nodes: [], starts: [], text: '' }
      blocks.push(cur)
      raw.push('')
      pres.push(block.closest('pre') !== null)
      lastBlock = block
    }
    cur.nodes.push(n)
    cur.starts.push(raw[raw.length - 1].length)
    raw[raw.length - 1] += n.data
  }
  const texts = blocks.map((b, i) => {
    b.text = normalizeBlockText(raw[i], pres[i])
    return b.text
  })
  return { blocks, texts, folded: texts.map(foldLength) }
}

// 매치는 문서 순서라 윗변이 늘어난다 — 보이는 맨 위 아래 첫 매치를 이분 탐색으로 찾는다
export function firstRangeBelow(ranges: readonly Range[], visibleTop: number): number {
  let lo = 0
  let hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid].getBoundingClientRect().top >= visibleTop) hi = mid
    else lo = mid + 1
  }
  return lo === ranges.length ? 0 : lo
}

export function rangesFor(index: FindIndex, matches: readonly ViewFindMatch[]): Range[] {
  return matches.map((m) => {
    const b = index.blocks[m.block]
    const s = locateOffset(b.starts, m.from, 'start')
    const e = locateOffset(b.starts, m.to, 'end')
    const r = document.createRange()
    r.setStart(b.nodes[s.node], s.offset)
    r.setEnd(b.nodes[e.node], e.offset)
    return r
  })
}

function highlightsSupported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

export function clearMatches(): void {
  if (!highlightsSupported()) return
  CSS.highlights.delete(MATCH_HIGHLIGHT)
  CSS.highlights.delete(CURRENT_HIGHLIGHT)
}

export function paintCurrent(range: Range | undefined): void {
  if (!highlightsSupported()) return
  if (!range) {
    CSS.highlights.delete(CURRENT_HIGHLIGHT)
    return
  }
  const cur = new Highlight(range)
  cur.priority = 1
  CSS.highlights.set(CURRENT_HIGHLIGHT, cur)
}

export function paintMatches(ranges: readonly Range[], current: number): void {
  if (!highlightsSupported()) return
  if (ranges.length === 0) {
    clearMatches()
    return
  }
  const all = new Highlight()
  for (const r of ranges) all.add(r) // 펼쳐 넘기면 매치가 많을 때 호출 스택이 넘친다
  all.priority = 0
  CSS.highlights.set(MATCH_HIGHLIGHT, all)
  paintCurrent(ranges[current])
}

function isHorizontalScroller(el: HTMLElement): boolean {
  const ox = getComputedStyle(el).overflowX
  return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth
}

export function revealRange(viewer: HTMLElement, range: Range): void {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  let el = range.startContainer.parentElement
  while (el && el !== viewer) {
    if (isHorizontalScroller(el)) {
      const box = el.getBoundingClientRect()
      if (rect.right > box.right || rect.left < box.left) {
        el.scrollTo({ left: el.scrollLeft + rect.left - (box.left + 32), behavior: 'instant' })
      }
      break
    }
    el = el.parentElement
  }
  const after = range.getClientRects()[0] ?? range.getBoundingClientRect()
  const view = viewer.getBoundingClientRect()
  const top = scrollTopToReveal({
    matchTop: after.top, matchBottom: after.bottom, viewTop: view.top, viewBottom: view.bottom,
    cover: floatCoverFor(viewer), scrollTop: viewer.scrollTop,
  })
  if (top !== null) viewer.scrollTo({ top, behavior: 'instant' })
}
