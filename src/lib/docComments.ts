// 댓글 코어 — 모양·권한·스레드·멘션·짧은 해시 (specs/features/F-501.md). yjs 를 import 하지 않는다
import type { RelativePositionJSON } from './docRoomProtocol'

// ----- 2.1 상수 -----

export const COMMENT_BODY_MAX = 1_000
export const COMMENTS_PER_DOC_MAX = 500
export const REPLIES_PER_THREAD_MAX = 100
export const MENTIONS_PER_COMMENT_MAX = 10
export const COMMENT_QUOTE_MAX = 200
export const ANCHOR_CONTEXT_CHARS = 32
export const COMMENT_OPS_PER_MINUTE = 30
export const NOTIFICATION_RETAIN_DAYS = 90
export const NOTIFICATIONS_PER_RECIPIENT_MAX = 300
export const REANCHOR_CANDIDATES_MAX = 1_000
export const COMMENT_ID_MAX = 64
export const COMMENT_EMAIL_MAX = 254
export const COMMENT_AUTHOR_ID_MAX = 128

// ----- 2.2 타입 -----

export type CommentAuthor = { id: string; email: string } | { id: null; email: null }
export type CommentAnchor = { start: RelativePositionJSON; end: RelativePositionJSON }
export type AnchorRange = { from: number; to: number }

export type CommentEntry = {
  v: 1
  parent: string | null
  anchor: CommentAnchor | null
  quote: string
  body: string
  mentions: string[]
  author: CommentAuthor
  createdAt: number
  resolved: { by: CommentAuthor; at: number } | null
}

export type CommentRecord = {
  id: string
  parent: string | null
  body: string
  mentions: string[]
  authorId: string | null
  authorEmail: string | null
  createdAt: number
  resolvedAt: number | null
  resolvedById: string | null
  resolvedBy: string | null
  quote: string
  prefix: string
  suffix: string
  anchorFrom: number | null
  anchorLength: number | null
}

export type CommentThread = {
  id: string
  root: CommentEntry
  replies: { id: string; entry: CommentEntry }[]
}

// ----- 헬퍼 -----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj)
  return objKeys.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k))
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isCommentId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= COMMENT_ID_MAX && /^[A-Za-z0-9_-]+$/.test(value)
}

function readAuthorLike(id: unknown, email: unknown): { id: string | null; email: string | null } | null {
  if (id === null && email === null) return { id: null, email: null }
  if (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= COMMENT_AUTHOR_ID_MAX &&
    typeof email === 'string' &&
    email.length >= 1 &&
    email.length <= COMMENT_EMAIL_MAX
  ) {
    return { id, email }
  }
  return null
}

// ----- 2.3 앵커 JSON 모양 검사 (yjs 에 넘기기 전) -----

const REL_POS_KEYS = ['tname', 'item', 'assoc'] as const
const ITEM_KEYS = ['client', 'clock'] as const

function readRelPos(value: unknown, assoc: number): RelativePositionJSON | null {
  if (!isPlainObject(value) || !hasExactKeys(value, REL_POS_KEYS)) return null
  if (value.tname !== 'content') return null
  const item = value.item
  if (!isPlainObject(item) || !hasExactKeys(item, ITEM_KEYS)) return null
  const { client, clock } = item
  if (!isSafeNonNegativeInt(client) || !isSafeNonNegativeInt(clock)) return null
  if (value.assoc !== assoc) return null
  return { tname: value.tname, item: { client, clock }, assoc: value.assoc }
}

export function readCommentAnchor(value: unknown): CommentAnchor | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ['start', 'end'] as const)) return null
  const start = readRelPos(value.start, 0)
  const end = readRelPos(value.end, -1)
  if (!start || !end) return null
  return { start, end }
}

export function normalizeCommentBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim()
}

export function checkCommentBody(body: string): 'bad_body' | 'empty_body' | 'body_too_long' | null {
  if (typeof body !== 'string') return 'bad_body'
  if (body !== normalizeCommentBody(body)) return 'bad_body'
  if (body.length === 0) return 'empty_body'
  if (body.length > COMMENT_BODY_MAX) return 'body_too_long'
  return null
}

// ----- 6.1 멘션 (validateCommentEntry 가 쓴다) -----

const MENTION_LOCAL = '[A-Za-z0-9._%+-]+'
const MENTION_LABEL = '[A-Za-z0-9-]+'
const MENTION_RE = new RegExp(`@(${MENTION_LOCAL}@(?:${MENTION_LABEL}\\.)+${MENTION_LABEL})`, 'g')
const MENTION_EMAIL_RE = new RegExp(`^${MENTION_LOCAL}@(?:${MENTION_LABEL}\\.)+${MENTION_LABEL}$`)
const MENTION_BEFORE_BAD = /[A-Za-z0-9._%+\-@]/
const MENTION_AFTER_BAD = /[A-Za-z0-9_%+\-@]/

function isMentionEmail(value: string): boolean {
  return MENTION_EMAIL_RE.test(value)
}

export function parseMentions(body: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  MENTION_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MENTION_RE.exec(body))) {
    const start = match.index
    const end = start + match[0].length
    const before = start === 0 ? '' : body[start - 1]
    const after = end >= body.length ? '' : body[end]
    if (before && MENTION_BEFORE_BAD.test(before)) continue
    if (after && MENTION_AFTER_BAD.test(after)) continue
    if (match[1].length > COMMENT_EMAIL_MAX) continue
    const lower = match[1].toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      result.push(lower)
    }
  }
  return result
}

export function finalizeMentions(body: string, picked: readonly string[]): string[] {
  const pickedLower = new Set(picked.map((p) => p.toLowerCase()))
  const result: string[] = []
  for (const m of parseMentions(body)) {
    if (!pickedLower.has(m)) continue
    result.push(m)
    if (result.length >= MENTIONS_PER_COMMENT_MAX) break
  }
  return result
}

function validateMentionsField(mentions: unknown, body: string, authorIdIsNull: boolean): string[] | null {
  if (!Array.isArray(mentions)) return null
  if (mentions.length > MENTIONS_PER_COMMENT_MAX) return null
  const bodyMentions = new Set(parseMentions(body))
  const seen = new Set<string>()
  for (const m of mentions) {
    if (typeof m !== 'string') return null
    if (m !== m.toLowerCase()) return null
    if (!isMentionEmail(m)) return null
    if (m.length > COMMENT_EMAIL_MAX) return null
    if (seen.has(m)) return null
    seen.add(m)
    if (!bodyMentions.has(m)) return null
  }
  if (authorIdIsNull && mentions.length > 0) return null
  return [...(mentions as string[])]
}

// ----- 2.3 CommentEntry 모양 검사 -----

export type CommentShapeError =
  | 'not_object'
  | 'unknown_field'
  | 'bad_version'
  | 'bad_parent'
  | 'bad_anchor'
  | 'bad_quote'
  | 'bad_body'
  | 'empty_body'
  | 'body_too_long'
  | 'bad_mentions'
  | 'too_many_mentions'
  | 'bad_author'
  | 'bad_created_at'
  | 'bad_resolved'

const ENTRY_KEYS = ['v', 'parent', 'anchor', 'quote', 'body', 'mentions', 'author', 'createdAt', 'resolved'] as const
const AUTHOR_KEYS = ['id', 'email'] as const
const RESOLVED_KEYS = ['by', 'at'] as const

export function validateCommentEntry(value: unknown): { ok: true; entry: CommentEntry } | { ok: false; error: CommentShapeError } {
  if (!isPlainObject(value)) return { ok: false, error: 'not_object' }
  if (!hasExactKeys(value, ENTRY_KEYS)) return { ok: false, error: 'unknown_field' }
  const { v, parent, anchor, quote, body, mentions, author, createdAt, resolved } = value

  if (v !== 1) return { ok: false, error: 'bad_version' }

  if (parent !== null && !isCommentId(parent)) return { ok: false, error: 'bad_parent' }
  const isReply = parent !== null

  let readAnchor: CommentAnchor | null = null
  if (isReply) {
    if (anchor !== null) return { ok: false, error: 'bad_anchor' }
  } else if (anchor !== null) {
    readAnchor = readCommentAnchor(anchor)
    if (readAnchor === null) return { ok: false, error: 'bad_anchor' }
  }

  if (typeof quote !== 'string') return { ok: false, error: 'bad_quote' }
  if (isReply) {
    if (quote !== '') return { ok: false, error: 'bad_quote' }
  } else if (quote.length < 1 || quote.length > COMMENT_QUOTE_MAX) {
    return { ok: false, error: 'bad_quote' }
  }

  const bodyError = typeof body === 'string' ? checkCommentBody(body) : 'bad_body'
  if (bodyError) return { ok: false, error: bodyError }

  if (!Array.isArray(mentions)) return { ok: false, error: 'bad_mentions' }
  if (mentions.length > MENTIONS_PER_COMMENT_MAX) return { ok: false, error: 'too_many_mentions' }
  const authorIdIsNull = isPlainObject(author) && author.id === null
  const readMentions = validateMentionsField(mentions, body as string, authorIdIsNull)
  if (readMentions === null) return { ok: false, error: 'bad_mentions' }

  if (!isPlainObject(author) || !hasExactKeys(author, AUTHOR_KEYS)) return { ok: false, error: 'bad_author' }
  const readAuthorEntry = readAuthorLike(author.id, author.email)
  if (!readAuthorEntry) return { ok: false, error: 'bad_author' }

  if (!isSafeNonNegativeInt(createdAt)) return { ok: false, error: 'bad_created_at' }

  let readResolved: { by: CommentAuthor; at: number } | null = null
  if (resolved !== null) {
    if (isReply) return { ok: false, error: 'bad_resolved' }
    if (!isPlainObject(resolved) || !hasExactKeys(resolved, RESOLVED_KEYS)) return { ok: false, error: 'bad_resolved' }
    const byRaw = resolved.by
    const by = isPlainObject(byRaw) && hasExactKeys(byRaw, AUTHOR_KEYS) ? readAuthorLike(byRaw.id, byRaw.email) : null
    if (!by) return { ok: false, error: 'bad_resolved' }
    const at = resolved.at
    if (!isSafeNonNegativeInt(at)) return { ok: false, error: 'bad_resolved' }
    if ((by.id === null) !== (readAuthorEntry.id === null)) return { ok: false, error: 'bad_resolved' }
    readResolved = { by: by as CommentAuthor, at }
  }

  const entry: CommentEntry = {
    v: 1,
    parent: parent as string | null,
    anchor: readAnchor,
    quote,
    body: body as string,
    mentions: readMentions,
    author: readAuthorEntry as CommentAuthor,
    createdAt,
    resolved: readResolved,
  }
  return { ok: true, entry }
}

// ----- 3.2 고아 판정 공유 규칙 -----

export function toAnchorRange(from: number | null, to: number | null): AnchorRange | null {
  if (from === null || to === null || from >= to) return null
  return { from, to }
}

// ----- 2.5 CommentRecord 검사 -----

const RECORD_KEYS = [
  'id',
  'parent',
  'body',
  'mentions',
  'authorId',
  'authorEmail',
  'createdAt',
  'resolvedAt',
  'resolvedById',
  'resolvedBy',
  'quote',
  'prefix',
  'suffix',
  'anchorFrom',
  'anchorLength',
] as const

export type CommentRecordError = 'invalid' | 'too_many'

function parseOneRecord(item: Record<string, unknown>, rootIds: ReadonlySet<string>): CommentRecord | null {
  const id = item.id as string
  const parentRaw = item.parent
  let parent: string | null
  if (parentRaw === null) {
    parent = null
  } else if (typeof parentRaw === 'string' && parentRaw !== id && rootIds.has(parentRaw)) {
    parent = parentRaw
  } else {
    return null
  }
  const isReply = parent !== null

  if (typeof item.body !== 'string' || checkCommentBody(item.body) !== null) return null
  const body = item.body

  const authorIdEmail = readAuthorLike(item.authorId, item.authorEmail)
  if (!authorIdEmail) return null

  const mentions = validateMentionsField(item.mentions, body, authorIdEmail.id === null)
  if (mentions === null) return null

  if (!isSafeNonNegativeInt(item.createdAt)) return null

  let resolvedAt: number | null
  let resolvedById: string | null
  let resolvedBy: string | null
  if (item.resolvedAt === null) {
    if (item.resolvedById !== null || item.resolvedBy !== null) return null
    resolvedAt = null
    resolvedById = null
    resolvedBy = null
  } else {
    if (isReply) return null
    if (!isSafeNonNegativeInt(item.resolvedAt)) return null
    const bothNull = item.resolvedById === null && item.resolvedBy === null
    const bothString = typeof item.resolvedById === 'string' && typeof item.resolvedBy === 'string'
    if (!bothNull && !bothString) return null
    if ((item.resolvedById === null) !== (authorIdEmail.id === null)) return null
    resolvedAt = item.resolvedAt
    resolvedById = (item.resolvedById as string | null) ?? null
    resolvedBy = (item.resolvedBy as string | null) ?? null
  }

  let quote: string
  let prefix: string
  let suffix: string
  let anchorFrom: number | null
  let anchorLength: number | null

  if (isReply) {
    if (item.quote !== '' || item.prefix !== '' || item.suffix !== '' || item.anchorFrom !== null || item.anchorLength !== null) {
      return null
    }
    quote = ''
    prefix = ''
    suffix = ''
    anchorFrom = null
    anchorLength = null
  } else if (item.anchorFrom === null && item.anchorLength === null) {
    if (typeof item.quote !== 'string' || item.quote.length < 1 || item.quote.length > COMMENT_QUOTE_MAX) return null
    if (item.prefix !== '' || item.suffix !== '') return null
    quote = item.quote
    prefix = ''
    suffix = ''
    anchorFrom = null
    anchorLength = null
  } else {
    if (!isSafeNonNegativeInt(item.anchorFrom)) return null
    if (typeof item.anchorLength !== 'number' || !Number.isSafeInteger(item.anchorLength) || item.anchorLength < 1) return null
    if (typeof item.quote !== 'string') return null
    if (item.anchorLength <= COMMENT_QUOTE_MAX) {
      if (item.quote.length !== item.anchorLength) return null
    } else {
      if (!item.quote.endsWith('…')) return null
      if (item.quote.length !== 199 && item.quote.length !== 200) return null
    }
    if (typeof item.prefix !== 'string' || item.prefix.length > ANCHOR_CONTEXT_CHARS) return null
    if (typeof item.suffix !== 'string' || item.suffix.length > ANCHOR_CONTEXT_CHARS) return null
    quote = item.quote
    prefix = item.prefix
    suffix = item.suffix
    anchorFrom = item.anchorFrom
    anchorLength = item.anchorLength
  }

  return {
    id,
    parent,
    body,
    mentions,
    authorId: authorIdEmail.id,
    authorEmail: authorIdEmail.email,
    createdAt: item.createdAt as number,
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

export function parseCommentRecords(value: unknown): { ok: true; records: CommentRecord[] } | { ok: false; reason: CommentRecordError } {
  if (!Array.isArray(value)) return { ok: false, reason: 'invalid' }
  if (value.length > COMMENTS_PER_DOC_MAX) return { ok: false, reason: 'too_many' }

  const items = value as unknown[]
  const seenIds = new Set<string>()
  for (const item of items) {
    if (!isPlainObject(item) || !hasExactKeys(item, RECORD_KEYS)) return { ok: false, reason: 'invalid' }
    if (!isCommentId(item.id)) return { ok: false, reason: 'invalid' }
    if (seenIds.has(item.id)) return { ok: false, reason: 'invalid' }
    seenIds.add(item.id)
  }

  const rootIds = new Set<string>()
  for (const item of items as Record<string, unknown>[]) {
    if (item.parent === null) rootIds.add(item.id as string)
  }

  const replyCountByParent = new Map<string, number>()
  const records: CommentRecord[] = []
  for (const raw of items as Record<string, unknown>[]) {
    const record = parseOneRecord(raw, rootIds)
    if (!record) return { ok: false, reason: 'invalid' }
    records.push(record)
    if (record.parent !== null) replyCountByParent.set(record.parent, (replyCountByParent.get(record.parent) ?? 0) + 1)
  }
  for (const count of replyCountByParent.values()) {
    if (count > REPLIES_PER_THREAD_MAX) return { ok: false, reason: 'too_many' }
  }

  return { ok: true, records }
}

// ----- 5. 권한 -----

export type CommentActor =
  | { kind: 'server'; userId: string; role: 'owner' | 'edit' | 'view'; blocked: boolean }
  | { kind: 'local'; canEdit: boolean }
export type CommentAction = 'add' | 'reply' | 'resolve' | 'delete'

export function commentAllowed(actor: CommentActor, action: CommentAction, target?: CommentEntry): boolean {
  if (actor.kind === 'server') {
    if (actor.blocked) return false
    if (action !== 'delete') return true
    if (!target) return false
    const isOwnComment = target.author.id !== null && target.author.id === actor.userId
    return actor.role === 'owner' || isOwnComment
  }
  if (!actor.canEdit) return false
  if (action !== 'delete') return true
  return target !== undefined
}

// ----- 6.2 스레드 묶기·정렬 -----

function compareByCreatedThenId(a: { id: string; entry: CommentEntry }, b: { id: string; entry: CommentEntry }): number {
  if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt - b.entry.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function groupCommentThreads(entries: Iterable<readonly [string, unknown]>): {
  threads: CommentThread[]
  strays: string[]
  invalid: string[]
} {
  const valid = new Map<string, CommentEntry>()
  const invalid: string[] = []
  for (const [id, raw] of entries) {
    if (!isCommentId(id)) {
      invalid.push(id)
      continue
    }
    const result = validateCommentEntry(raw)
    if (!result.ok) {
      invalid.push(id)
      continue
    }
    valid.set(id, result.entry)
  }
  invalid.sort()

  const roots = new Map<string, CommentEntry>()
  for (const [id, entry] of valid) {
    if (entry.parent === null) roots.set(id, entry)
  }

  const strays: string[] = []
  const repliesByParent = new Map<string, { id: string; entry: CommentEntry }[]>()
  for (const [id, entry] of valid) {
    if (entry.parent === null) continue
    const parentId = entry.parent
    if (parentId === id || !roots.has(parentId)) {
      strays.push(id)
      continue
    }
    const list = repliesByParent.get(parentId) ?? []
    list.push({ id, entry })
    repliesByParent.set(parentId, list)
  }
  strays.sort()

  const threads: CommentThread[] = []
  for (const [id, root] of roots) {
    const replies = (repliesByParent.get(id) ?? []).sort(compareByCreatedThenId)
    threads.push({ id, root, replies })
  }
  threads.sort((a, b) => compareByCreatedThenId({ id: a.id, entry: a.root }, { id: b.id, entry: b.root }))

  return { threads, strays, invalid }
}

export function sortThreadsByPosition(
  threads: readonly CommentThread[],
  ranges: ReadonlyMap<string, AnchorRange | null>,
): { anchored: CommentThread[]; orphans: CommentThread[] } {
  const anchoredWithRange: { thread: CommentThread; range: AnchorRange }[] = []
  const orphans: CommentThread[] = []
  for (const thread of threads) {
    const range = ranges.get(thread.id)
    if (range) anchoredWithRange.push({ thread, range })
    else orphans.push(thread)
  }
  anchoredWithRange.sort((a, b) => {
    if (a.range.from !== b.range.from) return a.range.from - b.range.from
    if (a.range.to !== b.range.to) return a.range.to - b.range.to
    return compareByCreatedThenId({ id: a.thread.id, entry: a.thread.root }, { id: b.thread.id, entry: b.thread.root })
  })
  orphans.sort((a, b) => compareByCreatedThenId({ id: a.id, entry: a.root }, { id: b.id, entry: b.root }))
  return { anchored: anchoredWithRange.map((a) => a.thread), orphans }
}

// ----- 6.3 한도 -----

export type CommentCapacityError = 'doc_full' | 'thread_full'
export type CommentRejectReason = 'invalid' | 'too_long' | 'too_many'

export function checkCommentCapacity(threads: readonly CommentThread[], parent: string | null): CommentCapacityError | null {
  const total = threads.reduce((sum, t) => sum + 1 + t.replies.length, 0)
  if (total + 1 > COMMENTS_PER_DOC_MAX) return 'doc_full'
  if (parent !== null) {
    const thread = threads.find((t) => t.id === parent)
    if (thread && thread.replies.length + 1 > REPLIES_PER_THREAD_MAX) return 'thread_full'
  }
  return null
}

export function commentRejectReason(error: CommentShapeError | CommentCapacityError): CommentRejectReason {
  if (error === 'body_too_long') return 'too_long'
  if (error === 'doc_full' || error === 'thread_full') return 'too_many'
  return 'invalid'
}

// ----- 7.1 짧은 해시 — FNV-1a 64, UTF-8, 소문자 16진수 16자 -----

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const U64_MASK = 0xffffffffffffffffn

export function shortHash(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let hash = FNV_OFFSET_BASIS
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * FNV_PRIME) & U64_MASK
  }
  return hash.toString(16).padStart(16, '0')
}

export function commentSig(entry: CommentEntry): string {
  return shortHash(
    JSON.stringify([
      entry.v,
      entry.parent,
      entry.body,
      entry.mentions,
      entry.author.id,
      entry.author.email,
      entry.createdAt,
      entry.resolved?.at ?? null,
      entry.resolved?.by.id ?? null,
      entry.resolved?.by.email ?? null,
    ]),
  )
}

export function recordAnchorSig(record: CommentRecord): string {
  return shortHash(JSON.stringify([record.quote, record.prefix, record.suffix, record.anchorLength]))
}

// ----- 7.2 인용문 자르기 -----

export function commentQuote(text: string): string {
  if (text.length <= COMMENT_QUOTE_MAX) return text
  let cut = 199
  const code = text.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut = 198
  return text.slice(0, cut) + '…'
}
