// 서버(DocRoom)·클라이언트가 같이 쓰는 소켓 계약 (specs/features/F-304.md 11.1). 이름은 저장소 식별자라 제품명과 무관하게 고정
import { isCommentId } from './docComments'

export const Y_CONTENT_NAME = 'content'
export const Y_TITLE_NAME = 'title'
export const Y_COMMENTS_NAME = 'comments'
export const DOC_SOCKET_PREFIX = '/ws/doc/'
export const SOCKET_PING = 'ping'
export const SOCKET_PONG = 'pong'

export const SOCKET_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
  unavailable: 1013,
} as const

export type SocketCloseReason = 'unauthenticated' | 'forbidden' | 'revoked' | 'not_found' | 'deleted' | 'unavailable'

export type DocRoomMessage = { type: 'too-large'; limit: number; bytes: number } | { type: 'size-ok' }

export function encodeDocRoomMessage(message: DocRoomMessage): string {
  return JSON.stringify(message)
}

export function parseDocRoomMessage(text: string): DocRoomMessage | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.type === 'size-ok') return { type: 'size-ok' }
  if (record.type === 'too-large' && typeof record.limit === 'number' && typeof record.bytes === 'number') {
    return { type: 'too-large', limit: record.limit, bytes: record.bytes }
  }
  return null
}

// awareness 계약 (specs/features/F-307.md 3.1) — 클라이언트는 커서만 싣고 신원은 서버가 찍는다
export const AWARENESS_STATE_MAX_BYTES = 512

export type RelativePositionJSON = Record<string, unknown>
export type PeerCursor = { anchor: RelativePositionJSON; head: RelativePositionJSON }

export type ClientAwarenessState = { cursor?: PeerCursor | null }

export type PeerState = { user: { id: string; email: string }; cursor: PeerCursor | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// anchor·head 가 둘 다 객체인 객체만 커서로 친다 — 서버 도장·클라이언트 읽기가 같은 판정을 쓴다
export function readPeerCursor(value: unknown): PeerCursor | null {
  if (!isRecord(value) || !isRecord(value.anchor) || !isRecord(value.head)) return null
  return { anchor: value.anchor, head: value.head }
}

// 댓글 명령 계약 (specs/features/F-503.md 4.1) — view 연결이 서버에 댓글 쓰기를 맡긴다
export const COMMENT_OP_MAX_CHARS = 16_384

export type CommentOp =
  | { type: 'comment-add'; id: string; start: RelativePositionJSON; end: RelativePositionJSON; body: string; mentions: string[] }
  | { type: 'comment-reply'; id: string; parent: string; body: string; mentions: string[] }
  | { type: 'comment-resolve'; id: string; resolved: boolean }
  | { type: 'comment-delete'; id: string }

export type CommentOpRejectReason = 'forbidden' | 'invalid' | 'not_found' | 'too_long' | 'too_many' | 'rate_limited'
export type CommentOpReply = { type: 'comment-ack'; id: string } | { type: 'comment-reject'; id: string; reason: CommentOpRejectReason }

const COMMENT_OP_KEYS: Record<CommentOp['type'], readonly string[]> = {
  'comment-add': ['type', 'id', 'start', 'end', 'body', 'mentions'],
  'comment-reply': ['type', 'id', 'parent', 'body', 'mentions'],
  'comment-resolve': ['type', 'id', 'resolved'],
  'comment-delete': ['type', 'id'],
}
const REJECT_REASONS: readonly string[] = ['forbidden', 'invalid', 'not_found', 'too_long', 'too_many', 'rate_limited']

function hasKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record)
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(record, k))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function readJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export function encodeCommentOp(op: CommentOp): string {
  return JSON.stringify(op)
}

// 신뢰하지 않는 입력 — 던지지 않는다. id 가 null 이면 응답을 보낼 수 없다
export function parseCommentOp(text: string): { ok: true; op: CommentOp } | { ok: false; id: string | null } {
  if (text.length > COMMENT_OP_MAX_CHARS) return { ok: false, id: null }
  const r = readJsonRecord(text)
  if (!r || !isCommentId(r.id)) return { ok: false, id: null }
  const id = r.id
  const fail = { ok: false as const, id }
  const type = r.type
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(COMMENT_OP_KEYS, type)) return fail
  if (!hasKeys(r, COMMENT_OP_KEYS[type as CommentOp['type']])) return fail
  switch (type as CommentOp['type']) {
    case 'comment-add':
      if (!isRecord(r.start) || !isRecord(r.end) || typeof r.body !== 'string' || !isStringArray(r.mentions)) return fail
      return { ok: true, op: { type: 'comment-add', id, start: r.start, end: r.end, body: r.body, mentions: [...r.mentions] } }
    case 'comment-reply':
      if (!isCommentId(r.parent) || typeof r.body !== 'string' || !isStringArray(r.mentions)) return fail
      return { ok: true, op: { type: 'comment-reply', id, parent: r.parent, body: r.body, mentions: [...r.mentions] } }
    case 'comment-resolve':
      if (typeof r.resolved !== 'boolean') return fail
      return { ok: true, op: { type: 'comment-resolve', id, resolved: r.resolved } }
    case 'comment-delete':
      return { ok: true, op: { type: 'comment-delete', id } }
  }
}

export function encodeCommentOpReply(reply: CommentOpReply): string {
  return JSON.stringify(reply)
}

export function parseCommentOpReply(text: string): CommentOpReply | null {
  const r = readJsonRecord(text)
  if (!r || !isCommentId(r.id)) return null
  if (r.type === 'comment-ack' && hasKeys(r, ['type', 'id'])) return { type: 'comment-ack', id: r.id }
  if (r.type === 'comment-reject' && hasKeys(r, ['type', 'id', 'reason']) && typeof r.reason === 'string' && REJECT_REASONS.includes(r.reason)) {
    return { type: 'comment-reject', id: r.id, reason: r.reason as CommentOpRejectReason }
  }
  return null
}
