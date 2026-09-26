// 서버·클라이언트 공용 소켓 계약 (specs/features/F-304.md 11.1, A25)
import { describe, expect, it } from 'vitest'

import { Y_TEXT_NAME } from '../editor/yBinding'
import {
  AWARENESS_STATE_MAX_BYTES,
  COMMENT_OP_MAX_CHARS,
  Y_COMMENTS_NAME,
  Y_CONTENT_NAME,
  Y_TITLE_NAME,
  encodeCommentOp,
  encodeCommentOpReply,
  encodeDocRoomMessage,
  parseCommentOp,
  parseCommentOpReply,
  parseDocRoomMessage,
} from './docRoomProtocol'
import type { CommentOp, CommentOpRejectReason, CommentOpReply, DocRoomMessage } from './docRoomProtocol'

describe('F-304 A25 docRoomProtocol', () => {
  it('두 메시지 모양이 encode → parse 로 같게 돌아온다', () => {
    const messages: DocRoomMessage[] = [{ type: 'too-large', limit: 1_000_000, bytes: 1_000_001 }, { type: 'size-ok' }]
    for (const message of messages) {
      expect(parseDocRoomMessage(encodeDocRoomMessage(message))).toEqual(message)
    }
  })

  it('JSON 한 줄이다', () => {
    expect(encodeDocRoomMessage({ type: 'size-ok' })).not.toContain('\n')
  })

  it('모양이 다르면 null', () => {
    for (const text of ['x', '{}', '{"type":"other"}', '{"type":"too-large","limit":"1","bytes":2}', 'null', '[]']) {
      expect(parseDocRoomMessage(text)).toBeNull()
    }
  })

  it('Y_CONTENT_NAME 은 에디터 Y_TEXT_NAME 과 같다', () => {
    expect(Y_CONTENT_NAME).toBe(Y_TEXT_NAME)
  })
})

describe('F-501 1장 Y_COMMENTS_NAME', () => {
  it('comments 고 Y_CONTENT_NAME·Y_TITLE_NAME 과 다르다', () => {
    expect(Y_COMMENTS_NAME).toBe('comments')
    expect(Y_COMMENTS_NAME).not.toBe(Y_CONTENT_NAME)
    expect(Y_COMMENTS_NAME).not.toBe(Y_TITLE_NAME)
  })
})

describe('F-307 A10 awareness 계약', () => {
  it('상태 JSON 최대 512 B', () => {
    expect(AWARENESS_STATE_MAX_BYTES).toBe(512)
  })
})

describe('F-503 P1~P4 댓글 명령 계약', () => {
  const ID = 'c_1-a'
  const POS = { tname: 'content', item: { client: 1, clock: 2 }, assoc: 0 }
  const END = { tname: 'content', item: { client: 1, clock: 5 }, assoc: -1 }
  const ops: CommentOp[] = [
    { type: 'comment-add', id: ID, start: POS, end: END, body: '본문 @a@example.com', mentions: ['a@example.com'] },
    { type: 'comment-reply', id: ID, parent: 'root1', body: '답글', mentions: [] },
    { type: 'comment-resolve', id: ID, resolved: true },
    { type: 'comment-delete', id: ID },
  ]
  const reasons: CommentOpRejectReason[] = ['forbidden', 'invalid', 'not_found', 'too_long', 'too_many', 'rate_limited']

  it('P1 네 명령·ack·여섯 reject 가 encode → parse 로 같게, 한 줄', () => {
    for (const op of ops) {
      const text = encodeCommentOp(op)
      expect(text).not.toContain('\n')
      expect(parseCommentOp(text)).toEqual({ ok: true, op })
    }
    const replies: CommentOpReply[] = [{ type: 'comment-ack', id: ID }, ...reasons.map((reason) => ({ type: 'comment-reject' as const, id: ID, reason }))]
    for (const reply of replies) {
      const text = encodeCommentOpReply(reply)
      expect(text).not.toContain('\n')
      expect(parseCommentOpReply(text)).toEqual(reply)
    }
    expect(COMMENT_OP_MAX_CHARS).toBe(16_384)
  })

  it('P2 응답을 보낼 수 없는 입력 → { ok: false, id: null }', () => {
    const long = JSON.stringify({ type: 'comment-delete', id: ID, pad: 'x'.repeat(COMMENT_OP_MAX_CHARS) }).slice(0, COMMENT_OP_MAX_CHARS + 1)
    expect(long.length).toBe(16_385)
    for (const text of ['x', 'null', '[]', '{"type":"comment-delete"}', '{"type":"comment-delete","id":"a b"}', long]) {
      expect(parseCommentOp(text), text.slice(0, 40)).toEqual({ ok: false, id: null })
    }
  })

  it('P3 id 는 올바른데 모양이 틀림 → { ok: false, id }', () => {
    const add = ops[0] as Record<string, unknown>
    const bad: Record<string, unknown>[] = [
      { type: 'comment-edit', id: ID },
      { ...add, author: { id: 'x', email: 'x@example.com' } },
      { type: 'comment-reply', id: ID, parent: 'root1', mentions: [] },
      { type: 'comment-reply', id: ID, parent: 'root1', body: 'b', mentions: 'x' },
      { type: 'comment-resolve', id: ID, resolved: 'yes' },
      { ...add, start: 1 },
    ]
    for (const value of bad) expect(parseCommentOp(JSON.stringify(value))).toEqual({ ok: false, id: ID })
  })

  it('P4 parseCommentOpReply 가 틀린 모양에 null, 응답 문자열은 parseDocRoomMessage 에 null', () => {
    expect(parseCommentOpReply(JSON.stringify({ type: 'comment-reject', id: ID, reason: 'other' }))).toBeNull()
    expect(parseCommentOpReply(JSON.stringify({ type: 'comment-ack', id: ID, extra: 1 }))).toBeNull()
    expect(parseCommentOpReply(JSON.stringify({ type: 'comment-ack', id: 'a b' }))).toBeNull()
    expect(parseDocRoomMessage(encodeCommentOpReply({ type: 'comment-ack', id: ID }))).toBeNull()
    expect(parseDocRoomMessage(encodeCommentOpReply({ type: 'comment-reject', id: ID, reason: 'invalid' }))).toBeNull()
  })
})
