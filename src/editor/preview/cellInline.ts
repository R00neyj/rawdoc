// 표 칸 글자 해석 — 편집 중이 아닌 칸의 인라인 서식 표시 (specs/features/F-140.md 3.2)
// DOM·EditorView 없음. 파서는 주 에디터와 같은 markdownLanguage(GFM)의 parseInline 을 쓴다
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownParser } from '@lezer/markdown'

import { findWikiLinks, type WikiLinkMatch } from '../../lib/wikiLink'

// markdownLanguage.parser 는 Language 의 공개 타입(LRParser)으로 좁혀지지만 실제로는
// 항상 MarkdownParser 인스턴스다(@codemirror/lang-markdown 구현) — nodeSet·parseInline 접근에 필요
const parser = markdownLanguage.parser as unknown as MarkdownParser

// @lezer/markdown Element 는 .d.ts 에 children 이 빠져 있다(런타임엔 있다) — 여기서만 보강해 쓴다
type LezerElement = { type: number; from: number; to: number; children: LezerElement[] }

const EMPHASIS_MARK: Record<string, 'strong' | 'em' | 'strike'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'strike',
}

// 표 칸 안 <br>(대소문자 무시, <br>·<br/>·<br />)을 줄바꿈 조각으로 찾는다(specs/features/F-162.md 2.2)
const BR_RE = /<br\s*\/?>/gi

type Range = { from: number; to: number }

function findBrMatches(text: string): Range[] {
  const out: Range[] = []
  let m
  BR_RE.lastIndex = 0
  while ((m = BR_RE.exec(text))) {
    out.push({ from: m.index, to: m.index + m[0].length })
  }
  return out
}

function typeName(el: LezerElement): string {
  return parser.nodeSet.types[el.type].name
}

// InlineCode 안에서는 위키링크를 찾지 않는다 (3.2 "인라인코드 안에서는 찾지 않는다")
function collectCodeRanges(elements: LezerElement[], out: Range[]): Range[] {
  for (const el of elements) {
    if (typeName(el) === 'InlineCode') {
      out.push({ from: el.from, to: el.to })
      continue
    }
    if (el.children?.length) collectCodeRanges(el.children, out)
  }
  return out
}

function sameMarks(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

export type CellInlinePiece =
  | { text: string; marks: string[]; title?: string }
  | { br: true }

// 제목 없는(title 없는) 조각끼리만 이어 붙인다 — 링크류·줄바꿈은 항상 독립 조각으로 둔다
function push(out: CellInlinePiece[], text: string, marks: string[], title?: string): void {
  const last = out[out.length - 1]
  if (!title && last && !('br' in last) && !last.title && sameMarks(last.marks, marks)) {
    last.text += text
    return
  }
  out.push(title ? { text, marks, title } : { text, marks })
}

type Item =
  | { from: number; to: number; kind: 'node'; node: LezerElement }
  | { from: number; to: number; kind: 'wiki'; wiki: WikiLinkMatch }
  | { from: number; to: number; kind: 'br' }

// [from, to) 구간을 elements(그 구간의 형제 노드들)·wikiMatches·brMatches 로 채운다
function walkRange(
  text: string,
  from: number,
  to: number,
  elements: LezerElement[],
  wikiMatches: WikiLinkMatch[],
  brMatches: Range[],
  marks: string[],
  out: CellInlinePiece[],
): void {
  const items: Item[] = []
  for (const el of elements) {
    if (el.from < from || el.to > to) continue
    if (wikiMatches.some((m) => el.from >= m.from && el.to <= m.to)) continue
    if (brMatches.some((m) => el.from >= m.from && el.to <= m.to)) continue
    items.push({ from: el.from, to: el.to, kind: 'node', node: el })
  }
  for (const m of wikiMatches) {
    if (m.from < from || m.to > to) continue
    items.push({ from: m.from, to: m.to, kind: 'wiki', wiki: m })
  }
  for (const m of brMatches) {
    if (m.from < from || m.to > to) continue
    items.push({ from: m.from, to: m.to, kind: 'br' })
  }
  items.sort((a, b) => a.from - b.from)

  let cursor = from
  for (const item of items) {
    if (item.from < cursor) continue // 안전망: 겹치면 뒤 항목을 건너뛴다
    if (item.from > cursor) push(out, text.slice(cursor, item.from), marks)
    if (item.kind === 'wiki') {
      // 보이는 글자: 별칭, 없으면 '#' 뒤까지 원문 조각 (F-2018 3.2)
      push(out, item.wiki.alias ?? text.slice(item.wiki.targetFrom, item.wiki.targetTo).trim(), [...marks, 'wikilink'])
    } else if (item.kind === 'br') {
      out.push({ br: true })
    } else {
      emitNode(text, item.node, wikiMatches, brMatches, marks, out)
    }
    cursor = item.to
  }
  if (cursor < to) push(out, text.slice(cursor, to), marks)
}

function emitNode(
  text: string,
  el: LezerElement,
  wikiMatches: WikiLinkMatch[],
  brMatches: Range[],
  marks: string[],
  out: CellInlinePiece[],
): void {
  const name = typeName(el)
  const children = el.children ?? []

  if (name === 'Escape') {
    push(out, text.slice(el.from + 1, el.to), marks) // 뒤 글자만(역슬래시 숨김)
    return
  }

  if (name === 'InlineCode') {
    const marksInCode = children.filter((c) => typeName(c) === 'CodeMark')
    const innerFrom = marksInCode[0]?.to ?? el.from
    const innerTo = marksInCode[marksInCode.length - 1]?.from ?? el.to
    push(out, text.slice(innerFrom, innerTo), [...marks, 'code']) // 안쪽은 글자 그대로
    return
  }

  const emphasisMark = EMPHASIS_MARK[name]
  if (emphasisMark) {
    const innerFrom = children[0]?.to ?? el.from
    const innerTo = children[children.length - 1]?.from ?? el.to
    walkRange(text, innerFrom, innerTo, children.slice(1, -1), wikiMatches, brMatches, [...marks, emphasisMark], out)
    return
  }

  if (name === 'Link') {
    const linkMarks = children.filter((c) => typeName(c) === 'LinkMark')
    const urlNode = children.find((c) => typeName(c) === 'URL')
    if (urlNode && linkMarks.length >= 2 && linkMarks[0].to < linkMarks[1].from) {
      const url = text.slice(urlNode.from, urlNode.to)
      push(out, text.slice(linkMarks[0].to, linkMarks[1].from), [...marks, 'link'], url)
      return
    }
    push(out, text.slice(el.from, el.to), marks) // URL 없는 Link — 표에 없는 것, 글자 그대로
    return
  }

  if (name === 'Autolink') {
    const urlNode = children.find((c) => typeName(c) === 'URL')
    if (urlNode) {
      const url = text.slice(urlNode.from, urlNode.to)
      push(out, url, [...marks, 'link'], url)
      return
    }
    push(out, text.slice(el.from, el.to), marks)
    return
  }

  if (name === 'URL') {
    const url = text.slice(el.from, el.to)
    push(out, url, [...marks, 'link'], url)
    return
  }

  // 표에 없는 것(이미지, HTML 태그, 그 밖 GFM 확장 등) — 원문 글자 그대로
  push(out, text.slice(el.from, el.to), marks)
}

// text: 칸 원문(패딩 제외)
export function parseCellInline(text: string): CellInlinePiece[] {
  if (text === '') return []
  const elements = parser.parseInline(text, 0) as unknown as LezerElement[]
  const codeRanges = collectCodeRanges(elements, [])
  const wikiMatches = findWikiLinks(text).filter((m) => !codeRanges.some((cr) => m.from < cr.to && m.to > cr.from))
  const brMatches = findBrMatches(text).filter((m) => !codeRanges.some((cr) => m.from < cr.to && m.to > cr.from))
  const out: CellInlinePiece[] = []
  walkRange(text, 0, text.length, elements, wikiMatches, brMatches, [], out)
  return out
}
