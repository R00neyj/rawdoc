// 지금 문서 기준 백링크·나가는 링크·연결되지 않은 언급, 순수 함수 (small 2026-10-11)
import { findWikiLinks } from './wikiLink'
import { maskInlineCode, proseLines, scanWikiLinks } from './wikiGraph'
import type { WikiResolver } from './wikiResolve'

export const EXCERPT_MAX = 100
// 한 글자 제목은 거의 모든 문서에 걸려 잡음이 된다
export const MENTION_MIN_LENGTH = 2

export type LinkSource = { id: string; title: string; content: string; folderId?: string | null; e2ee?: 'locked' | 'open' }
export type LinkCurrent = { id: string; title: string; folderId: string | null }
export type DocLinkRow = { id: string; title: string; excerpt: string }
export type OutgoingLinkRow = { target: string; docId: string | null; title: string }
export type IncomingLinks = { backlinks: DocLinkRow[]; mentions: DocLinkRow[]; lockedCount: number }

const ASCII_WORD = /[A-Za-z0-9_]/

// 줄 하나를 앞뒤 공백 떼고, 길면 맞는 자리를 가운데 두고 코드 포인트 max 개로 자른다
export function lineExcerpt(line: string, from: number, to: number, max = EXCERPT_MAX): string {
  const lead = line.length - line.trimStart().length
  const text = line.trim()
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const cpFrom = Array.from(text.slice(0, Math.max(0, from - lead))).length
  const cpTo = Array.from(text.slice(0, Math.max(0, to - lead))).length
  const room = Math.max(0, max - (cpTo - cpFrom))
  const end = Math.min(chars.length, Math.max(0, cpFrom - Math.floor(room / 2)) + max)
  const start = Math.max(0, end - max)
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '…' : ''}`
}

function excerptAt(content: string, from: number, to: number): string {
  let start = from
  while (start > 0 && content[start - 1] !== '\n' && content[start - 1] !== '\r') start--
  let end = to
  while (end < content.length && content[end] !== '\n' && content[end] !== '\r') end++
  return lineExcerpt(content.slice(start, end), from - start, to - start)
}

// 위키링크·코드·프론트매터 밖에서 제목이 글자로 나오는 첫 줄. 영문·숫자 끝은 낱말 경계에서만
function findMention(content: string, pattern: RegExp, title: string): string | null {
  const checkBefore = ASCII_WORD.test(title[0])
  const checkAfter = ASCII_WORD.test(title[title.length - 1])
  for (const { line } of proseLines(content)) {
    let masked = maskInlineCode(line)
    for (const link of findWikiLinks(masked)) {
      masked = masked.slice(0, link.from) + ' '.repeat(link.to - link.from) + masked.slice(link.to)
    }
    for (const match of masked.matchAll(pattern)) {
      const from = match.index
      const to = from + match[0].length
      if (checkBefore && ASCII_WORD.test(masked[from - 1] ?? '')) continue
      if (checkAfter && ASCII_WORD.test(masked[to] ?? '')) continue
      return lineExcerpt(line, from, to)
    }
  }
  return null
}

// 다른 문서 → 이 문서. 해석은 편집기와 같은 해석기(같은 제목이면 폴더 우선순위), 잠긴 금고 문서는 읽지 않고 센다
export function findIncomingLinks(input: { current: LinkCurrent; sources: readonly LinkSource[]; resolver: WikiResolver }): IncomingLinks {
  const { current, resolver } = input
  const title = current.title.trim()
  const pattern = Array.from(title).length >= MENTION_MIN_LENGTH ? new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu') : null
  const backlinks: DocLinkRow[] = []
  const mentions: DocLinkRow[] = []
  let lockedCount = 0
  for (const doc of input.sources) {
    if (doc.id === current.id) continue
    if (doc.e2ee === 'locked') {
      lockedCount++
      continue
    }
    if (doc.content === '') continue
    const sourceFolderId = doc.folderId ?? null
    const link = scanWikiLinks(doc.content).find((l) => l.target.trim() !== '' && resolver.resolve(l.target, sourceFolderId)?.id === current.id)
    if (link) backlinks.push({ id: doc.id, title: doc.title, excerpt: excerptAt(doc.content, link.from, link.to) })
    const mention = pattern ? findMention(doc.content, pattern, title) : null
    if (mention !== null) mentions.push({ id: doc.id, title: doc.title, excerpt: mention })
  }
  return { backlinks, mentions, lockedCount }
}

// 이 문서 → 다른 문서. 처음 나온 순서로 대상마다 한 번, 끊긴 링크는 docId null
export function findOutgoingLinks(input: { text: string; current: LinkCurrent; resolver: WikiResolver }): OutgoingLinkRow[] {
  const { current, resolver } = input
  const seen = new Set<string>()
  const rows: OutgoingLinkRow[] = []
  for (const link of scanWikiLinks(input.text)) {
    const target = link.target.trim()
    if (target === '') continue
    const doc = resolver.resolve(target, current.folderId)
    if (doc?.id === current.id) continue
    const key = doc ? `doc:${doc.id}` : `missing:${target.toLocaleLowerCase('ko')}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({ target, docId: doc ? doc.id : null, title: doc ? doc.title : target })
  }
  return rows
}
