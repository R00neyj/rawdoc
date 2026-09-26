// 보기 권한자의 댓글 명령 — 보내기·응답 기다리기·연결을 잃으면 버리기, 그리고 같은 모양의 쓰기 수단. DOM·React 없음 (specs/features/F-506.md 6.4~6.7)
import type * as Y from 'yjs'

import {
  COMMENT_OPS_PER_MINUTE,
  REPLIES_PER_THREAD_MAX,
  checkCommentBody,
  checkCommentCapacity,
  groupCommentThreads,
  normalizeCommentBody,
  validateCommentEntry,
  type CommentThread,
} from '../lib/docComments'
import { encodeCommentOp, parseCommentOpReply, type CommentOp, type CommentOpRejectReason } from '../lib/docRoomProtocol'
import type { CommentWriteFailure, CommentWriteResult, CommentWriter } from './useDocComments'

export const COMMENT_OP_TIMEOUT_MS = 10_000 // 보낸 뒤 응답을 기다리는 시간
export const COMMENT_OP_CLIENT_WINDOW_MS = 61_000 // 클라이언트 속도 창 — 이 안에서 COMMENT_OPS_PER_MINUTE(30)개까지 보낸다

export type CommentOpOutcome = { ok: true } | { ok: false; reason: CommentOpRejectReason | 'offline' | 'no_response' }

export type CommentCommandClient = {
  request(op: CommentOp, isApplied: () => boolean): Promise<CommentOpOutcome>
  receive(text: string): void // 명령 응답이 아니면 무시
  recheck(): void // 기다리는 명령 중 isApplied() 가 참인 것을 곧바로 성공으로 끝낸다
  connectionLost(): void
  dispose(): void
}

type Waiting = { id: string; isApplied: () => boolean; timer: unknown; settle: (outcome: CommentOpOutcome) => void }

export function createCommentCommandClient(deps: {
  send(text: string): boolean
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}): CommentCommandClient {
  // 보낸 차례 — 같은 id 의 응답은 먼저 보낸 것부터 짝짓는다 (6.5)
  const waiting: Waiting[] = []
  const sentAt: number[] = []

  function finish(item: Waiting, outcome: CommentOpOutcome) {
    const index = waiting.indexOf(item)
    if (index === -1) return
    waiting.splice(index, 1)
    deps.clearTimeout(item.timer)
    item.settle(outcome)
  }

  function endAll(reason: 'offline') {
    for (const item of [...waiting]) finish(item, item.isApplied() ? { ok: true } : { ok: false, reason })
  }

  function underRate(): boolean {
    const now = deps.now()
    while (sentAt.length > 0 && now - sentAt[0] >= COMMENT_OP_CLIENT_WINDOW_MS) sentAt.shift()
    return sentAt.length < COMMENT_OPS_PER_MINUTE
  }

  return {
    request(op, isApplied) {
      if (!underRate()) return Promise.resolve({ ok: false, reason: 'rate_limited' })
      if (!deps.send(encodeCommentOp(op))) return Promise.resolve({ ok: false, reason: 'offline' })
      sentAt.push(deps.now())
      return new Promise<CommentOpOutcome>((resolve) => {
        const item: Waiting = { id: op.id, isApplied, timer: null, settle: resolve }
        item.timer = deps.setTimeout(() => finish(item, item.isApplied() ? { ok: true } : { ok: false, reason: 'no_response' }), COMMENT_OP_TIMEOUT_MS)
        waiting.push(item)
      })
    },

    receive(text) {
      const reply = parseCommentOpReply(text)
      if (!reply) return
      const item = waiting.find((w) => w.id === reply.id)
      if (!item) return
      finish(item, reply.type === 'comment-ack' ? { ok: true } : { ok: false, reason: reply.reason })
    },

    recheck() {
      for (const item of [...waiting]) if (item.isApplied()) finish(item, { ok: true })
    },

    connectionLost: () => endAll('offline'),
    dispose: () => endAll('offline'),
  }
}

// ----- 6.6 명령 쓰기 수단 -----

export type CommandCommentWriter = CommentWriter & { dispose(): void }

// offline·no_response 로 끝난 add·reply 한 건 — 같은 입력이면 그 id 를 다시 쓴다 (6.7)
type Remembered = { key: string; id: string }

function bodyFailure(rawBody: string): CommentWriteFailure | null {
  const err = checkCommentBody(normalizeCommentBody(rawBody))
  if (err === 'empty_body') return 'empty'
  if (err === 'body_too_long') return 'too_long'
  return null
}

function rootOf(threads: readonly CommentThread[], id: string): CommentThread | null {
  return threads.find((t) => t.id === id) ?? null
}

export function createCommandCommentWriter(input: {
  client: CommentCommandClient
  map: Y.Map<unknown> // 편집기 Doc 의 comments (handle.comments.map)
  newId(): string // crypto.randomUUID()
}): CommandCommentWriter {
  const { client, map } = input
  let remembered: Remembered | null = null

  const threads = () => groupCommentThreads(map.entries()).threads
  // 서버가 쓴 항목은 Yjs 로 먼저 올 수 있다 — ack 를 기다리지 않고 끝낸다 (F-500 4.4)
  const onChange = () => client.recheck()
  map.observe(onChange)

  function idFor(key: string): string {
    return remembered?.key === key ? remembered.id : input.newId()
  }

  async function sendNew(key: string, id: string, op: CommentOp, parent: string | null): Promise<CommentWriteResult> {
    const outcome = await client.request(op, () => map.has(id))
    if (outcome.ok) {
      remembered = null
      return { ok: true, id }
    }
    const reason = outcome.reason
    // rate_limited 는 서버가 id 를 보기 전에 거절한다 — 앞서 보낸 것이 쓰였는지 알 수 없어 기억을 둔다
    if (reason === 'offline' || reason === 'no_response') remembered = { key, id }
    else if (reason !== 'rate_limited') remembered = null
    if (reason === 'too_many') {
      if (parent === null) return { ok: false, reason: 'doc_full' }
      const thread = rootOf(threads(), parent)
      return { ok: false, reason: thread && thread.replies.length >= REPLIES_PER_THREAD_MAX ? 'thread_full' : 'doc_full' }
    }
    return { ok: false, reason }
  }

  async function sendTarget(op: CommentOp, isApplied: () => boolean): Promise<CommentWriteResult> {
    const outcome = await client.request(op, isApplied)
    if (outcome.ok) return { ok: true, id: op.id }
    return { ok: false, reason: outcome.reason === 'too_many' ? 'doc_full' : outcome.reason }
  }

  function localFailure(reason: CommentWriteFailure): CommentWriteResult {
    remembered = null
    return { ok: false, reason }
  }

  return {
    async add({ draft, body, mentions }) {
      const bf = bodyFailure(body)
      if (bf) return localFailure(bf)
      const capacity = checkCommentCapacity(threads(), null)
      if (capacity) return localFailure(capacity)
      const normalized = normalizeCommentBody(body)
      const key = JSON.stringify(['add', normalized, draft.anchor])
      const id = idFor(key)
      const op: CommentOp = { type: 'comment-add', id, start: draft.anchor.start, end: draft.anchor.end, body: normalized, mentions }
      return sendNew(key, id, op, null)
    },

    async reply({ parent, body, mentions }) {
      const bf = bodyFailure(body)
      if (bf) return localFailure(bf)
      const all = threads()
      if (!rootOf(all, parent)) return localFailure('not_found')
      const capacity = checkCommentCapacity(all, parent)
      if (capacity) return localFailure(capacity)
      const normalized = normalizeCommentBody(body)
      const key = JSON.stringify(['reply', normalized, parent])
      const id = idFor(key)
      return sendNew(key, id, { type: 'comment-reply', id, parent, body: normalized, mentions }, parent)
    },

    async resolve(threadId, resolved) {
      if (!rootOf(threads(), threadId)) return { ok: false, reason: 'not_found' }
      const isApplied = () => {
        const check = validateCommentEntry(map.get(threadId))
        return check.ok && (check.entry.resolved !== null) === resolved
      }
      return sendTarget({ type: 'comment-resolve', id: threadId, resolved }, isApplied)
    },

    async remove(id) {
      return sendTarget({ type: 'comment-delete', id }, () => !map.has(id))
    },

    dispose() {
      map.unobserve(onChange)
    },
  }
}
