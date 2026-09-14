// 표 칸 글자 해석 — 편집 중이 아닌 칸의 인라인 서식 표시 (specs/features/F-140.md 3.2)
// DOM·EditorView 없음. 파서는 주 에디터와 같은 markdownLanguage(GFM)의 parseInline 을 쓴다
import { markdownLanguage } from '@codemirror/lang-markdown'

import { findWikiLinks } from '../../lib/wikiLink.js'

const parser = markdownLanguage.parser

const EMPHASIS_MARK = { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 'strike' }

function typeName(el) {
  return parser.nodeSet.types[el.type].name
}

// InlineCode 안에서는 위키링크를 찾지 않는다 (3.2 "인라인코드 안에서는 찾지 않는다")
function collectCodeRanges(elements, out) {
  for (const el of elements) {
    if (typeName(el) === 'InlineCode') {
      out.push({ from: el.from, to: el.to })
      continue
    }
    if (el.children?.length) collectCodeRanges(el.children, out)
  }
  return out
}

function sameMarks(a, b) {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

// 제목 없는(title 없는) 조각끼리만 이어 붙인다 — 링크류는 항상 독립 조각으로 둔다
function push(out, text, marks, title) {
  const last = out[out.length - 1]
  if (!title && last && !last.title && sameMarks(last.marks, marks)) {
    last.text += text
    return
  }
  out.push(title ? { text, marks, title } : { text, marks })
}

/** [from, to) 구간을 elements(그 구간의 형제 노드들)·wikiMatches 로 채운다 */
function walkRange(text, from, to, elements, wikiMatches, marks, out) {
  const items = []
  for (const el of elements) {
    if (el.from < from || el.to > to) continue
    if (wikiMatches.some((m) => el.from >= m.from && el.to <= m.to)) continue
    items.push({ from: el.from, to: el.to, kind: 'node', node: el })
  }
  for (const m of wikiMatches) {
    if (m.from < from || m.to > to) continue
    items.push({ from: m.from, to: m.to, kind: 'wiki', wiki: m })
  }
  items.sort((a, b) => a.from - b.from)

  let cursor = from
  for (const item of items) {
    if (item.from < cursor) continue // 안전망: 겹치면 뒤 항목을 건너뛴다
    if (item.from > cursor) push(out, text.slice(cursor, item.from), marks)
    if (item.kind === 'wiki') {
      push(out, item.wiki.alias ?? item.wiki.target, [...marks, 'wikilink'])
    } else {
      emitNode(text, item.node, wikiMatches, marks, out)
    }
    cursor = item.to
  }
  if (cursor < to) push(out, text.slice(cursor, to), marks)
}

function emitNode(text, el, wikiMatches, marks, out) {
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
    walkRange(text, innerFrom, innerTo, children.slice(1, -1), wikiMatches, [...marks, emphasisMark], out)
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

/**
 * @param {string} text 칸 원문(패딩 제외)
 * @returns {{text:string, marks:('strong'|'em'|'strike'|'code'|'link'|'wikilink')[], title?:string}[]}
 */
export function parseCellInline(text) {
  if (text === '') return []
  const elements = parser.parseInline(text, 0)
  const codeRanges = collectCodeRanges(elements, [])
  const wikiMatches = findWikiLinks(text).filter((m) => !codeRanges.some((cr) => m.from < cr.to && m.to > cr.from))
  const out = []
  walkRange(text, 0, text.length, elements, wikiMatches, [], out)
  return out
}
