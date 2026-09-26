// 보기 권한자의 댓글 명령 클라이언트·명령 쓰기 수단 (specs/features/F-506.md 6.4~6.7, O1~O16)
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { COMMENT_OPS_PER_MINUTE, REPLIES_PER_THREAD_MAX, isCommentId, validateCommentEntry, type CommentEntry } from '../lib/docComments'
import { encodeCommentOp, encodeCommentOpReply, type CommentOp, type CommentOpRejectReason } from '../lib/docRoomProtocol'
import type { CommentDraft } from '../editor/commentMarks'
import {
  COMMENT_OP_CLIENT_WINDOW_MS,
  COMMENT_OP_TIMEOUT_MS,
  createCommandCommentWriter,
  createCommentCommandClient,
  type CommentOpOutcome,
} from './commentOps'

function fakeClock() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const entry of timers) {
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
        }
        if (!next) break
        timers.delete(next[0])
        now = next[1].at
        next[1].fn()
      }
      now = end
    },
    pending: () => timers.size,
  }
}

function setup() {
  const clock = fakeClock()
  const sent: string[] = []
  let sendResult = true
  const client = createCommentCommandClient({
    send: (text) => {
      if (!sendResult) return false
      sent.push(text)
      return true
    },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return {
    clock,
    sent,
    client,
    setSendResult: (v: boolean) => {
      sendResult = v
    },
  }
}

// 끝났으면 결과, 아직이면 undefined — 마이크로태스크를 비운 뒤 읽는다
function track<T>(promise: Promise<T>) {
  const box: { value: T | undefined } = { value: undefined }
  void promise.then((v) => {
    box.value = v
  })
  return box
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const ack = (id: string) => encodeCommentOpReply({ type: 'comment-ack', id })
const reject = (id: string, reason: CommentOpRejectReason) => encodeCommentOpReply({ type: 'comment-reject', id, reason })
const deleteOp = (id: string): CommentOp => ({ type: 'comment-delete', id })
const never = () => false
const always = () => true

const START = { tname: 'content', item: { client: 1, clock: 0 }, assoc: 0 }
const END = { tname: 'content', item: { client: 1, clock: 2 }, assoc: -1 }
const ANCHOR = { start: START, end: END }
const OTHER_ANCHOR = { start: START, end: { tname: 'content', item: { client: 1, clock: 3 }, assoc: -1 } }
const AUTHOR = { id: 'u2', email: 'b@example.com' }

function draftOf(anchor = ANCHOR): CommentDraft {
  return { anchor, range: { from: 0, to: 3 }, quote: 'abc' }
}

function rootEntry(overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    v: 1,
    parent: null,
    anchor: ANCHOR,
    quote: 'abc',
    body: '본문',
    mentions: [],
    author: AUTHOR,
    createdAt: 1,
    resolved: null,
    ...overrides,
  }
}

function replyEntry(parent: string, createdAt = 2): CommentEntry {
  return { ...rootEntry(), parent, anchor: null, quote: '', createdAt }
}

function writerSetup() {
  const ctx = setup()
  const doc = new Y.Doc()
  const map = doc.getMap<unknown>('comments')
  let n = 0
  const writer = createCommandCommentWriter({ client: ctx.client, map, newId: () => `id-${++n}` })
  return { ...ctx, doc, map, writer }
}

const sentOps = (sent: string[]) => sent.map((t) => JSON.parse(t) as CommentOp)

describe('F-506 O1 보내고 ack', () => {
  it('보낸 문자열이 encodeCommentOp(op) 한 통, 결과 { ok: true }', async () => {
    const { client, sent } = setup()
    const op = deleteOp('c1')
    const result = track(client.request(op, never))
    expect(sent).toEqual([encodeCommentOp(op)])
    client.receive(ack('c1'))
    await flush()
    expect(result.value).toEqual({ ok: true })
  })
})

describe('F-506 O2 여섯 거절 사유', () => {
  it('서버 사유 그대로', async () => {
    const reasons: CommentOpRejectReason[] = ['forbidden', 'invalid', 'not_found', 'too_long', 'too_many', 'rate_limited']
    for (const reason of reasons) {
      const { client } = setup()
      const result = track(client.request(deleteOp('c1'), never))
      client.receive(reject('c1', reason))
      await flush()
      expect(result.value).toEqual({ ok: false, reason })
    }
  })
})

describe('F-506 O3 같은 id 는 먼저 보낸 것부터 짝', () => {
  it('resolve 두 번 뒤 ack, reject 차례로 — 첫째 성공, 둘째 그 사유', async () => {
    const { client } = setup()
    const first = track(client.request({ type: 'comment-resolve', id: 't1', resolved: true }, never))
    const second = track(client.request({ type: 'comment-resolve', id: 't1', resolved: false }, never))
    client.receive(ack('t1'))
    client.receive(reject('t1', 'not_found'))
    await flush()
    expect(first.value).toEqual({ ok: true })
    expect(second.value).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('F-506 O4 짝 없는 응답·명령 응답이 아닌 문자열', () => {
  it('무시하고 던지지 않는다', async () => {
    const { client } = setup()
    const result = track(client.request(deleteOp('c1'), never))
    expect(() => client.receive(ack('other'))).not.toThrow()
    expect(() => client.receive('{"type":"size-ok"}')).not.toThrow()
    expect(() => client.receive('아무 글')).not.toThrow()
    expect(() => client.receive('{"type":"comment-ack","id":"c1","extra":1}')).not.toThrow()
    await flush()
    expect(result.value).toBeUndefined()
    client.receive(ack('c1'))
    await flush()
    expect(result.value).toEqual({ ok: true })
  })
})

describe('F-506 O5 send 가 거짓', () => {
  it('곧바로 offline, 타이머 없음', async () => {
    const { client, clock, setSendResult } = setup()
    setSendResult(false)
    const result = track(client.request(deleteOp('c1'), never))
    await flush()
    expect(result.value).toEqual({ ok: false, reason: 'offline' })
    expect(clock.pending()).toBe(0)
  })
})

describe('F-506 O6 클라이언트 속도 창', () => {
  it('창 안에서 30개 뒤 31번째는 rate_limited·send 없음, 첫 것에서 창만큼 지나면 보낸다', async () => {
    const { client, sent, clock } = setup()
    for (let i = 0; i < COMMENT_OPS_PER_MINUTE; i++) {
      void client.request(deleteOp(`c${i}`), always)
      clock.advance(1000)
    }
    expect(sent).toHaveLength(30)
    const over = track(client.request(deleteOp('c30'), never))
    await flush()
    expect(over.value).toEqual({ ok: false, reason: 'rate_limited' })
    expect(sent).toHaveLength(30)
    clock.advance(COMMENT_OP_CLIENT_WINDOW_MS - 30_000)
    void client.request(deleteOp('c31'), always)
    expect(sent).toHaveLength(31)
  })

  it('send 가 거짓인 요청·rate_limited 요청은 세지 않는다', async () => {
    const { client, sent, setSendResult } = setup()
    setSendResult(false)
    for (let i = 0; i < 40; i++) void client.request(deleteOp(`f${i}`), never)
    setSendResult(true)
    for (let i = 0; i < COMMENT_OPS_PER_MINUTE; i++) void client.request(deleteOp(`c${i}`), always)
    expect(sent).toHaveLength(30)
  })

  it('로컬 검사에서 걸린 쓰기는 세지 않는다', async () => {
    const { writer, sent, client } = writerSetup()
    for (let i = 0; i < 40; i++) await writer.add({ draft: draftOf(), body: '   ', mentions: [] })
    expect(sent).toHaveLength(0)
    for (let i = 0; i < COMMENT_OPS_PER_MINUTE; i++) void client.request(deleteOp(`c${i}`), always)
    expect(sent).toHaveLength(30)
  })
})

describe('F-506 O7 응답 없이 시간 제한', () => {
  it('isApplied 거짓 → no_response, 참 → 성공', async () => {
    const { client, clock } = setup()
    let applied = false
    const a = track(client.request(deleteOp('a'), never))
    const b = track(client.request(deleteOp('b'), () => applied))
    clock.advance(COMMENT_OP_TIMEOUT_MS - 1)
    await flush()
    expect(a.value).toBeUndefined()
    applied = true
    clock.advance(1)
    await flush()
    expect(a.value).toEqual({ ok: false, reason: 'no_response' })
    expect(b.value).toEqual({ ok: true })
    expect(clock.pending()).toBe(0)
  })
})

describe('F-506 O8 connectionLost', () => {
  it('isApplied 거짓 → offline, 참 → 성공, 늦은 ack 는 무시, 타이머 해제', async () => {
    const { client, clock } = setup()
    const a = track(client.request(deleteOp('a'), never))
    const b = track(client.request(deleteOp('b'), always))
    client.connectionLost()
    await flush()
    expect(a.value).toEqual({ ok: false, reason: 'offline' })
    expect(b.value).toEqual({ ok: true })
    expect(clock.pending()).toBe(0)
    expect(() => client.receive(ack('a'))).not.toThrow()
    await flush()
    expect(a.value).toEqual({ ok: false, reason: 'offline' })
  })
})

describe('F-506 O9 recheck', () => {
  it('isApplied 참이면 곧바로 성공·뒤의 ack 무시, 거짓이면 그대로 기다림', async () => {
    const { client, clock } = setup()
    let applied = false
    const a = track(client.request(deleteOp('a'), () => applied))
    const b = track(client.request(deleteOp('b'), never))
    client.recheck()
    await flush()
    expect(a.value).toBeUndefined()
    applied = true
    client.recheck()
    await flush()
    expect(a.value).toEqual({ ok: true })
    expect(b.value).toBeUndefined()
    // a 의 늦은 ack 가 b 를 끝내지 않는다 (id 가 다르다) — 짝이 없어 버린다
    client.receive(ack('a'))
    await flush()
    expect(b.value).toBeUndefined()
    expect(clock.pending()).toBe(1)
  })
})

describe('F-506 O10 dispose', () => {
  it('남은 것 모두 offline(isApplied 참이면 성공), 타이머 해제', async () => {
    const { client, clock } = setup()
    const a = track(client.request(deleteOp('a'), never))
    const b = track(client.request(deleteOp('b'), always))
    client.dispose()
    await flush()
    expect(a.value).toEqual({ ok: false, reason: 'offline' })
    expect(b.value).toEqual({ ok: true })
    expect(clock.pending()).toBe(0)
  })
})

describe('F-506 O11 add 의 로컬 검사', () => {
  it('빈 본문 / 1,001자 / 항목 500개 — 보낸 것 0', async () => {
    const { writer, sent, map, doc } = writerSetup()
    expect(await writer.add({ draft: draftOf(), body: '  \n ', mentions: [] })).toEqual({ ok: false, reason: 'empty' })
    expect(await writer.add({ draft: draftOf(), body: 'x'.repeat(1001), mentions: [] })).toEqual({ ok: false, reason: 'too_long' })
    doc.transact(() => {
      for (let i = 0; i < 500; i++) map.set(`r${i}`, rootEntry({ createdAt: i }))
    })
    expect(await writer.add({ draft: draftOf(), body: '본문', mentions: [] })).toEqual({ ok: false, reason: 'doc_full' })
    expect(sent).toHaveLength(0)
  })
})

describe('F-506 O12 reply 의 로컬 검사', () => {
  it('없는 부모 / 부모가 답글 / 답글 100개 스레드 — 보낸 것 0', async () => {
    const { writer, sent, map, doc } = writerSetup()
    doc.transact(() => {
      map.set('t1', rootEntry())
      map.set('r1', replyEntry('t1'))
      map.set('t2', rootEntry({ createdAt: 3 }))
      for (let i = 0; i < REPLIES_PER_THREAD_MAX; i++) map.set(`q${i}`, replyEntry('t2', 10 + i))
    })
    expect(await writer.reply({ parent: 'none', body: '답', mentions: [] })).toEqual({ ok: false, reason: 'not_found' })
    expect(await writer.reply({ parent: 'r1', body: '답', mentions: [] })).toEqual({ ok: false, reason: 'not_found' })
    expect(await writer.reply({ parent: 't2', body: '답', mentions: [] })).toEqual({ ok: false, reason: 'thread_full' })
    expect(sent).toHaveLength(0)
  })
})

describe('F-506 O13 add 가 보내는 comment-add', () => {
  it('앵커·정규화 본문·id, 서버 흉내로 항목이 들어오면 ack 전에 성공', async () => {
    const ctx = setup()
    const doc = new Y.Doc()
    const map = doc.getMap<unknown>('comments')
    const writer = createCommandCommentWriter({ client: ctx.client, map, newId: () => crypto.randomUUID() })
    const result = track(writer.add({ draft: draftOf(), body: 'a\r\nb', mentions: [] }))
    expect(ctx.sent).toHaveLength(1)
    const op = sentOps(ctx.sent)[0]
    expect(op.type).toBe('comment-add')
    if (op.type !== 'comment-add') return
    expect(op.start).toEqual(START)
    expect(op.end).toEqual(END)
    expect(op.body).toBe('a\nb')
    expect(op.mentions).toEqual([])
    expect(isCommentId(op.id)).toBe(true)
    await flush()
    expect(result.value).toBeUndefined()
    doc.transact(() => map.set(op.id, rootEntry({ body: 'a\nb' })))
    await flush()
    expect(result.value).toEqual({ ok: true, id: op.id })
    expect(validateCommentEntry(map.get(op.id)).ok).toBe(true)
    ctx.client.receive(ack(op.id))
  })
})

describe('F-506 O14 too_many 옮기기', () => {
  it('add → doc_full / 답글 99개 스레드의 reply → doc_full / 답글 100개가 된 스레드의 reply → thread_full', async () => {
    const { writer, client, sent, map, doc } = writerSetup()
    doc.transact(() => {
      map.set('t1', rootEntry())
      for (let i = 0; i < REPLIES_PER_THREAD_MAX - 1; i++) map.set(`q${i}`, replyEntry('t1', 10 + i))
    })
    const added = track(writer.add({ draft: draftOf(), body: '본문', mentions: [] }))
    const r1 = track(writer.reply({ parent: 't1', body: '답', mentions: [] }))
    const r2 = track(writer.reply({ parent: 't1', body: '다른 답', mentions: [] }))
    const ids = sentOps(sent).map((o) => o.id)
    expect(ids).toHaveLength(3)
    client.receive(reject(ids[0], 'too_many'))
    client.receive(reject(ids[1], 'too_many'))
    await flush()
    doc.transact(() => map.set('q-last', replyEntry('t1', 500)))
    client.receive(reject(ids[2], 'too_many'))
    await flush()
    expect(added.value).toEqual({ ok: false, reason: 'doc_full' })
    expect(r1.value).toEqual({ ok: false, reason: 'doc_full' })
    expect(r2.value).toEqual({ ok: false, reason: 'thread_full' })
  })
})

describe('F-506 O15 같은 입력이면 같은 id', () => {
  it('add — offline 뒤 같은 본문·앵커는 같은 id, 본문을 바꾸면 새 id, 성공 뒤 같은 입력은 새 id', async () => {
    const { writer, client, sent, setSendResult } = writerSetup()
    const first = track(writer.add({ draft: draftOf(), body: '같은 글', mentions: [] }))
    client.connectionLost()
    await flush()
    expect(first.value).toEqual({ ok: false, reason: 'offline' })

    const second = track(writer.add({ draft: draftOf(), body: '같은 글', mentions: [] }))
    const ids = () => sentOps(sent).map((o) => o.id)
    expect(ids()[1]).toBe(ids()[0])
    client.receive(ack(ids()[1]))
    await flush()
    expect(second.value).toEqual({ ok: true, id: ids()[0] })

    void writer.add({ draft: draftOf(), body: '같은 글', mentions: [] })
    expect(ids()[2]).not.toBe(ids()[0])

    setSendResult(false)
    const off = track(writer.add({ draft: draftOf(OTHER_ANCHOR), body: '둘째', mentions: [] }))
    await flush()
    expect(off.value).toEqual({ ok: false, reason: 'offline' })
    setSendResult(true)
    void writer.add({ draft: draftOf(OTHER_ANCHOR), body: '둘째 고침', mentions: [] })
    const last = ids()[ids().length - 1]
    expect(ids().slice(0, -1)).not.toContain(last)
  })

  it('add — no_response 뒤 같은 입력은 같은 id, 앵커가 다르면 새 id', async () => {
    const { writer, clock, sent } = writerSetup()
    const first = track(writer.add({ draft: draftOf(), body: '글', mentions: [] }))
    clock.advance(COMMENT_OP_TIMEOUT_MS)
    await flush()
    expect(first.value).toEqual({ ok: false, reason: 'no_response' })
    void writer.add({ draft: draftOf(OTHER_ANCHOR), body: '글', mentions: [] })
    const ids = sentOps(sent).map((o) => o.id)
    expect(ids[1]).not.toBe(ids[0])
  })

  it('reply — 같은 부모·본문이면 같은 id, 부모가 다르면 새 id', async () => {
    const { writer, client, sent, map, doc } = writerSetup()
    doc.transact(() => {
      map.set('t1', rootEntry())
      map.set('t2', rootEntry({ createdAt: 5 }))
    })
    const first = track(writer.reply({ parent: 't1', body: '답', mentions: [] }))
    client.connectionLost()
    await flush()
    expect(first.value).toEqual({ ok: false, reason: 'offline' })
    void writer.reply({ parent: 't1', body: '답', mentions: [] })
    client.connectionLost()
    await flush()
    void writer.reply({ parent: 't2', body: '답', mentions: [] })
    const ids = sentOps(sent).map((o) => o.id)
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })
})

describe('F-506 O16 resolve·remove 의 isApplied', () => {
  it('맵을 바라는 상태로 바꾼 뒤 recheck — 성공', async () => {
    const { writer, map, doc } = writerSetup()
    doc.transact(() => {
      map.set('t1', rootEntry())
      map.set('t2', rootEntry({ createdAt: 2, resolved: { by: AUTHOR, at: 3 } }))
      map.set('t3', rootEntry({ createdAt: 4 }))
    })
    const resolve = track(writer.resolve('t1', true))
    const reopen = track(writer.resolve('t2', false))
    const remove = track(writer.remove('t3'))
    await flush()
    expect([resolve.value, reopen.value, remove.value]).toEqual([undefined, undefined, undefined])
    // 맵 observe 가 recheck 를 부른다
    doc.transact(() => {
      map.set('t1', rootEntry({ resolved: { by: AUTHOR, at: 9 } }))
      map.set('t2', rootEntry({ createdAt: 2 }))
      map.delete('t3')
    })
    await flush()
    expect(resolve.value).toEqual({ ok: true, id: 't1' })
    expect(reopen.value).toEqual({ ok: true, id: 't2' })
    expect(remove.value).toEqual({ ok: true, id: 't3' })
  })

  it('없는 스레드의 resolve 는 not_found 로 보내지 않는다, remove 는 로컬 검사 없이 보낸다', async () => {
    const { writer, sent } = writerSetup()
    expect(await writer.resolve('none', true)).toEqual({ ok: false, reason: 'not_found' })
    expect(sent).toHaveLength(0)
    void writer.remove('none')
    expect(sentOps(sent)).toEqual([{ type: 'comment-delete', id: 'none' }])
  })

  it('결과 옮기기 — offline·no_response·rate_limited·forbidden·too_long·not_found·invalid', async () => {
    const cases: [CommentOpOutcome, string][] = [
      [{ ok: false, reason: 'forbidden' }, 'forbidden'],
      [{ ok: false, reason: 'too_long' }, 'too_long'],
      [{ ok: false, reason: 'not_found' }, 'not_found'],
      [{ ok: false, reason: 'invalid' }, 'invalid'],
      [{ ok: false, reason: 'rate_limited' }, 'rate_limited'],
    ]
    for (const [outcome, reason] of cases) {
      const { writer, client, sent } = writerSetup()
      const result = track(writer.remove('x'))
      if (!outcome.ok) client.receive(reject(sentOps(sent)[0].id, outcome.reason as CommentOpRejectReason))
      await flush()
      expect(result.value).toEqual({ ok: false, reason })
    }
  })
})
