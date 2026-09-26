// 댓글 앵커 — yjs 로 만들기·풀기, 기록으로 바꾸기, reanchor, 되살리기 (specs/features/F-501.md 3장·4장)
import * as Y from 'yjs'

import { ANCHOR_CONTEXT_CHARS, COMMENT_QUOTE_MAX, REANCHOR_CANDIDATES_MAX, commentQuote, readCommentAnchor, toAnchorRange } from './docComments'
import type { AnchorRange, CommentAnchor, CommentAuthor, CommentEntry, CommentRecord } from './docComments'

// ----- 3.1 만들기 -----

export function createCommentAnchor(ytext: Y.Text, from: number, to: number): CommentAnchor | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 0 || to > ytext.length || from >= to) return null
  const start = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from, 0))
  const end = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to, -1))
  return { start, end }
}

// ----- 3.2 풀기와 고아 판정 -----

export function resolveCommentAnchor(ytext: Y.Text, anchor: CommentAnchor | null): AnchorRange | null {
  if (anchor === null) return null
  const checked = readCommentAnchor(anchor)
  if (checked === null) return null
  const doc = ytext.doc
  if (!doc) return null
  try {
    const startAbs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(checked.start), doc)
    const endAbs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(checked.end), doc)
    if (!startAbs || !endAbs) return null
    if (startAbs.type !== ytext || endAbs.type !== ytext) return null
    return toAnchorRange(startAbs.index, endAbs.index)
  } catch {
    return null
  }
}

// ----- 3.3 한꺼번에 풀기 -----

export function resolveCommentAnchors(
  ytext: Y.Text,
  entries: Iterable<readonly [string, CommentEntry]>,
): Map<string, AnchorRange | null> {
  const result = new Map<string, AnchorRange | null>()
  for (const [id, entry] of entries) {
    if (entry.parent !== null) continue
    result.set(id, resolveCommentAnchor(ytext, entry.anchor))
  }
  return result
}

// ----- 4.1 기록 만들기 -----

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function trimLeadingLowSurrogate(text: string): string {
  return text.length > 0 && isLowSurrogate(text.charCodeAt(0)) ? text.slice(1) : text
}

function trimTrailingHighSurrogate(text: string): string {
  return text.length > 0 && isHighSurrogate(text.charCodeAt(text.length - 1)) ? text.slice(0, -1) : text
}

export function toCommentRecord(id: string, entry: CommentEntry, text: string, range: AnchorRange | null): CommentRecord {
  const isReply = entry.parent !== null
  const resolvedAt = entry.resolved?.at ?? null
  const resolvedById = entry.resolved?.by.id ?? null
  const resolvedBy = entry.resolved?.by.email ?? null

  let quote = ''
  let prefix = ''
  let suffix = ''
  let anchorFrom: number | null = null
  let anchorLength: number | null = null

  if (!isReply) {
    if (range) {
      const { from, to } = range
      quote = commentQuote(text.slice(from, to))
      prefix = trimLeadingLowSurrogate(text.slice(Math.max(0, from - ANCHOR_CONTEXT_CHARS), from))
      suffix = trimTrailingHighSurrogate(text.slice(to, to + ANCHOR_CONTEXT_CHARS))
      anchorFrom = from
      anchorLength = to - from
    } else {
      quote = entry.quote
    }
  }

  return {
    id,
    parent: entry.parent,
    body: entry.body,
    mentions: entry.mentions,
    authorId: entry.author.id,
    authorEmail: entry.author.email,
    createdAt: entry.createdAt,
    resolvedAt,
    resolvedById,
    resolvedBy,
    quote,
    prefix,
    suffix,
    anchorFrom,
    anchorLength,
  }
}

// ----- 4.2 reanchor -----

function contextScore(text: string, p: number, length: number, prefix: string, suffix: string): number {
  let prefixMatch = 0
  for (let i = 1; i <= prefix.length; i++) {
    if (text[p - i] === prefix[prefix.length - i]) prefixMatch++
    else break
  }
  let suffixMatch = 0
  const end = p + length
  for (let i = 0; i < suffix.length; i++) {
    if (text[end + i] === suffix[i]) suffixMatch++
    else break
  }
  return prefixMatch + suffixMatch
}

export function reanchor(text: string, record: CommentRecord): AnchorRange | null {
  if (record.parent !== null) return null
  const { anchorFrom, anchorLength, quote, prefix, suffix } = record
  if (anchorFrom === null || anchorLength === null) return null

  const head = anchorLength > COMMENT_QUOTE_MAX ? quote.slice(0, -1) : quote
  const h = Math.min(Math.max(anchorFrom, 0), text.length)

  if (h + anchorLength <= text.length && text.startsWith(head, h)) {
    return { from: h, to: h + anchorLength }
  }

  const positions: number[] = []
  let idx = text.indexOf(head)
  while (idx !== -1) {
    if (idx !== h && idx + anchorLength <= text.length) positions.push(idx)
    idx = text.indexOf(head, idx + 1)
  }
  if (positions.length === 0) return null

  positions.sort((a, b) => {
    const da = Math.abs(a - h)
    const db = Math.abs(b - h)
    return da !== db ? da - db : a - b
  })

  const limited = positions.slice(0, REANCHOR_CANDIDATES_MAX)
  const perfectScore = prefix.length + suffix.length
  let best: { p: number; score: number } | null = null
  for (const p of limited) {
    const score = contextScore(text, p, anchorLength, prefix, suffix)
    if (best === null || score > best.score) {
      best = { p, score }
      if (score >= perfectScore) break
    }
  }
  return best ? { from: best.p, to: best.p + anchorLength } : null
}

// ----- 4.3 기록에서 되살리기 -----

export function restoreCommentEntries(
  ytext: Y.Text,
  records: readonly CommentRecord[],
  importer?: { id: string; email: string },
): { entries: [string, CommentEntry][]; orphaned: number } {
  const text = ytext.toString()
  const rootIds = new Set(records.filter((r) => r.parent === null).map((r) => r.id))
  const entries: [string, CommentEntry][] = []
  let orphaned = 0

  for (const record of records) {
    const isReply = record.parent !== null
    if (isReply && !rootIds.has(record.parent as string)) continue

    let anchor: CommentAnchor | null = null
    let quote = ''
    if (!isReply) {
      const range = reanchor(text, record)
      if (range) {
        anchor = createCommentAnchor(ytext, range.from, range.to)
      } else {
        orphaned += 1
      }
      quote = record.quote
    }

    let author: CommentAuthor
    let mentions: string[]
    let resolved: { by: CommentAuthor; at: number } | null

    if (importer) {
      author = importer
      mentions = []
      resolved = record.resolvedAt !== null ? { by: importer, at: record.resolvedAt } : null
    } else {
      author =
        record.authorId !== null && record.authorEmail !== null
          ? { id: record.authorId, email: record.authorEmail }
          : { id: null, email: null }
      mentions = record.mentions
      resolved =
        record.resolvedAt !== null
          ? {
              by:
                record.resolvedById !== null && record.resolvedBy !== null
                  ? { id: record.resolvedById, email: record.resolvedBy }
                  : { id: null, email: null },
              at: record.resolvedAt,
            }
          : null
    }

    const entry: CommentEntry = {
      v: 1,
      parent: record.parent,
      anchor,
      quote,
      body: record.body,
      mentions,
      author,
      createdAt: record.createdAt,
      resolved,
    }
    entries.push([record.id, entry])
  }

  return { entries, orphaned }
}
