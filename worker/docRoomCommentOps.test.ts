// DO 댓글 명령·view 점검·이관 (specs/features/F-503.md 3~5장, 7.4 O1~O15). 실제 access.ts + testD1
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { DatabaseSync } from 'node:sqlite'

import { COMMENT_FIX_ORIGIN, DocRoomCore, isReadOnlyState } from './docRoomCore'
import type { DocRoomHost, RoomConnection, StatefulConnection } from './docRoomCore'
import type { DoStorageLike } from './yStore'
import { asD1, openTestDb } from './testD1'
import { createCommentAnchor } from '../src/lib/commentAnchor'
import { COMMENT_BODY_MAX, commentQuote } from '../src/lib/docComments'
import type { CommentEntry, CommentRecord } from '../src/lib/docComments'
import { COMMENT_OP_MAX_CHARS, parseCommentOpReply } from '../src/lib/docRoomProtocol'
import type { CommentOp, CommentOpReply } from '../src/lib/docRoomProtocol'

const DOC_ID = '33333333-3333-4333-8333-333333333333'
const NOW = 1_000_000
const OWNER = { userId: 'owner', email: 'owner@example.com', role: 'owner' as const }
const BOB = { userId: 'bob', email: 'bob@example.com', role: 'edit' as const }
const CAROL = { userId: 'carol', email: 'carol@example.com', role: 'view' as const }
const BODY = 'L1 intro line\n' + 'x'.repeat(80) + '\nThe target phrase lives here.\n' + 'y'.repeat(80) + '\nlast line\n'

type UpdateRow = { seq: number; part: number; data: ArrayBuffer }

// docRoomCore.test.ts 의 makeStorage 와 같은 모양
function makeStorage() {
  let updates: UpdateRow[] = []
  let meta = new Map<string, string>()
  const storage: DoStorageLike = {
    sql: {
      exec(query: string, ...args: unknown[]) {
        const sql = query.trim().replace(/\s+/g, ' ')
        let rows: Record<string, unknown>[] = []
        if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) rows = []
        else if (sql.startsWith('SELECT seq, part, data FROM ydoc_updates'))
          rows = [...updates].sort((a, b) => a.seq - b.seq || a.part - b.part).map((r) => ({ ...r }))
        else if (sql.startsWith('SELECT key, value FROM ydoc_meta')) rows = [...meta].map(([key, value]) => ({ key, value }))
        else if (sql.startsWith('INSERT INTO ydoc_updates')) {
          const [seq, part, data] = args as [number, number, ArrayBuffer]
          updates.push({ seq, part, data })
        } else if (sql.startsWith('INSERT INTO ydoc_meta')) meta.set(args[0] as string, args[1] as string)
        else if (sql.startsWith('DELETE FROM ydoc_updates')) updates = []
        else if (sql.startsWith('DELETE FROM ydoc_meta')) meta = new Map()
        else throw new Error(`unhandled sql: ${sql}`)
        return { toArray: () => rows }
      },
    },
    transactionSync<T>(fn: () => T): T {
      const u = [...updates]
      const m = new Map(meta)
      try {
        return fn()
      } catch (err) {
        updates = u
        meta = m
        throw err
      }
    },
  }
  return storage
}

type Actor = { userId: string; email: string; role: 'owner' | 'edit' | 'view' }
type LogItem = 'update' | CommentOpReply
type FakeConn = RoomConnection & StatefulConnection & { log: LogItem[]; open: boolean; closed: { code: number; reason: string } | null }

function conn(actor: Actor | null): FakeConn {
  const c = {
    state: actor as unknown,
    log: [] as LogItem[],
    open: true,
    closed: null as { code: number; reason: string } | null,
    setState(update: (prev: unknown) => unknown) {
      c.state = update(c.state)
      return c.state
    },
    close(code: number, reason: string) {
      c.open = false
      c.closed = { code, reason }
    },
  }
  return c
}

function setup(opts: { grants?: [string, 'view' | 'edit'][] } = {}) {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
  user.run('owner', 'owner@example.com', 1)
  user.run('bob', 'bob@example.com', 1)
  user.run('carol', 'carol@example.com', 1)
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(DOC_ID, 'owner', '회의록', BODY, 'lf', 1, 1, 1)
  const grants = opts.grants ?? [
    ['bob@example.com', 'edit'],
    ['carol@example.com', 'view'],
  ]
  for (const [email, role] of grants) {
    sqlDb
      .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
      .run('doc', DOC_ID, 'owner', email, role, 1)
  }
  return { sqlDb, DB: asD1(sqlDb) }
}

function makeRoom(DB: D1Database, storage = makeStorage()) {
  const doc = new Y.Doc()
  const conns: FakeConn[] = []
  let loading: Promise<void> | null = null
  // y-partyserver 는 document update 마다 모든 연결에 갱신을 보낸다(동기)
  doc.on('update', () => conns.filter((c) => c.open).forEach((c) => c.log.push('update')))
  const host: DocRoomHost<FakeConn> = {
    docId: DOC_ID,
    env: { DB } as unknown as Env,
    storage,
    doc,
    connections: () => conns.filter((c) => c.open),
    sendCustom: (c, message) => c.log.push(parseCommentOpReply(message) ?? (message as unknown as CommentOpReply)),
    broadcastCustom: () => {},
    ensureLoaded: async () => {
      loading ??= core.load()
      await loading
    },
    exclusive: <T,>(fn: () => Promise<T>) => fn(),
    setAlarm: async () => {},
  }
  const core = new DocRoomCore(host)
  const join = (actor: Actor | null) => {
    const c = conn(actor)
    conns.push(c)
    return c
  }
  const load = async () => {
    await host.ensureLoaded()
  }
  return { core, doc, conns, join, load, storage, comments: doc.getMap<unknown>('comments'), content: doc.getText('content'), title: doc.getText('title') }
}

type Room = ReturnType<typeof makeRoom>

function send(room: Room, c: FakeConn, op: CommentOp | Record<string, unknown> | string): LogItem[] {
  const start = c.log.length
  room.core.handleCommentOp(c, typeof op === 'string' ? op : JSON.stringify(op))
  return c.log.slice(start)
}

const replies = (items: LogItem[]) => items.filter((x): x is CommentOpReply => x !== 'update')
const ack = (id: string): CommentOpReply => ({ type: 'comment-ack', id })
const reject = (id: string, reason: string) => ({ type: 'comment-reject', id, reason })

function anchorOf(room: Room, needle: string) {
  const from = room.content.toString().indexOf(needle)
  return createCommentAnchor(room.content, from, from + needle.length)!
}

function addOp(room: Room, id: string, needle: string, over: Partial<Extract<CommentOp, { type: 'comment-add' }>> = {}): CommentOp {
  const a = anchorOf(room, needle)
  return { type: 'comment-add', id, start: a.start, end: a.end, body: '본문', mentions: [], ...over }
}

function entry(room: Room, needle: string, author: Actor, over: Partial<CommentEntry> = {}): CommentEntry {
  return {
    v: 1,
    parent: null,
    anchor: anchorOf(room, needle),
    quote: needle,
    body: '기존',
    mentions: [],
    author: { id: author.userId, email: author.email },
    createdAt: 100,
    resolved: null,
    ...over,
  }
}

function replyEntry(parent: string, author: Actor, over: Partial<CommentEntry> = {}): CommentEntry {
  return { v: 1, parent, anchor: null, quote: '', body: '답글', mentions: [], author: { id: author.userId, email: author.email }, createdAt: 200, resolved: null, ...over }
}

// 사후 검사를 건너뛰는 서버 origin 으로 미리 심는다
function seed(room: Room, entries: Record<string, CommentEntry>) {
  room.doc.transact(() => {
    for (const [k, v] of Object.entries(entries)) room.comments.set(k, v)
  }, COMMENT_FIX_ORIGIN)
}

const snapshotComments = (room: Room) => JSON.stringify(room.comments.toJSON())
const dbComments = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT id, author_id, parent_id FROM doc_comments WHERE doc_id = ? ORDER BY id').all(DOC_ID) as { id: string; author_id: string; parent_id: string | null }[]
const noteCount = (sqlDb: DatabaseSync) => (sqlDb.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function loadedRoom(opts: Parameters<typeof setup>[0] = {}) {
  const env = setup(opts)
  const room = makeRoom(env.DB)
  await room.load()
  return { ...env, room }
}

describe('F-503 O1~O4 명령 받기', () => {
  it('O1 view 연결의 comment-add — 서버가 작성자·인용문·시각을 채우고, update 가 먼저 그 뒤 그 연결에만 ack', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    const bob = room.join(BOB)
    const log = send(room, carol, addOp(room, 'n1', 'target phrase', { body: '@bob@example.com 봐 주세요', mentions: ['bob@example.com'] }))
    expect(room.comments.get('n1')).toEqual({
      v: 1,
      parent: null,
      anchor: anchorOf(room, 'target phrase'),
      quote: commentQuote('target phrase'),
      body: '@bob@example.com 봐 주세요',
      mentions: ['bob@example.com'],
      author: { id: 'carol', email: 'carol@example.com' },
      createdAt: NOW,
      resolved: null,
    })
    expect(log).toEqual(['update', ack('n1')])
    expect(bob.log).toEqual(['update'])
  })

  it('O2 comment-reply / 해결된 스레드에 답글 → 답글 + 부모 resolved null 이 update 한 번', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    seed(room, {
      r1: entry(room, 'target', BOB),
      r2: entry(room, 'intro', BOB, { resolved: { by: { id: 'bob', email: 'bob@example.com' }, at: 150 } }),
    })
    expect(send(room, carol, { type: 'comment-reply', id: 'a1', parent: 'r1', body: '네', mentions: [] })).toEqual(['update', ack('a1')])
    expect(room.comments.get('a1')).toEqual(replyEntry('r1', CAROL, { body: '네', createdAt: NOW }))
    expect(send(room, carol, { type: 'comment-reply', id: 'a2', parent: 'r2', body: '다시', mentions: [] })).toEqual(['update', ack('a2')])
    expect((room.comments.get('r2') as CommentEntry).resolved).toBeNull()
    expect((room.comments.get('a2') as CommentEntry).parent).toBe('r2')
  })

  it('O3 comment-resolve true·false / 이미 그 상태면 ack 이고 update 없음', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    seed(room, { r1: entry(room, 'target', BOB) })
    expect(send(room, carol, { type: 'comment-resolve', id: 'r1', resolved: true })).toEqual(['update', ack('r1')])
    expect((room.comments.get('r1') as CommentEntry).resolved).toEqual({ by: { id: 'carol', email: 'carol@example.com' }, at: NOW })
    expect(send(room, carol, { type: 'comment-resolve', id: 'r1', resolved: true })).toEqual([ack('r1')])
    expect(send(room, carol, { type: 'comment-resolve', id: 'r1', resolved: false })).toEqual(['update', ack('r1')])
    expect((room.comments.get('r1') as CommentEntry).resolved).toBeNull()
    expect(send(room, carol, { type: 'comment-resolve', id: 'r1', resolved: false })).toEqual([ack('r1')])
  })

  it('O4 comment-delete — 내 답글 / 남의 답글 / 내 첫 댓글(남의 답글 둘) / 소유자가 남의 첫 댓글 / 없는 키', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    const owner = room.join(OWNER)
    seed(room, {
      r1: entry(room, 'target', CAROL),
      a1: replyEntry('r1', BOB),
      a2: replyEntry('r1', OWNER, { createdAt: 201 }),
      r2: entry(room, 'intro', BOB),
      b1: replyEntry('r2', CAROL),
      b2: replyEntry('r2', BOB, { createdAt: 202 }),
    })
    room.doc.transact(() => room.comments.set('junk', { parent: 'r1', broken: true }), COMMENT_FIX_ORIGIN)

    expect(send(room, carol, { type: 'comment-delete', id: 'b1' })).toEqual(['update', ack('b1')])
    expect(room.comments.has('b1')).toBe(false)
    const before = snapshotComments(room)
    expect(replies(send(room, carol, { type: 'comment-delete', id: 'b2' }))).toEqual([reject('b2', 'forbidden')])
    expect(snapshotComments(room)).toBe(before)
    expect(send(room, carol, { type: 'comment-delete', id: 'r1' })).toEqual(['update', ack('r1')])
    expect(['r1', 'a1', 'a2', 'junk'].map((k) => room.comments.has(k))).toEqual([false, false, false, false])
    expect(send(room, owner, { type: 'comment-delete', id: 'r2' })).toEqual(['update', ack('r2')])
    expect(room.comments.size).toBe(0)
    expect(send(room, carol, { type: 'comment-delete', id: 'gone' })).toEqual([ack('gone')])
  })
})

describe('F-503 O5~O7 거절·순서·다시 보내기', () => {
  it('O5 거절 사유 열두 가지, 모두 comments 불변', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    const full: Record<string, CommentEntry> = { r1: entry(room, 'target', BOB), q1: replyEntry('r1', BOB) }
    for (let i = 0; i < 100; i++) full[`t${i}`] = replyEntry('r1', BOB, { createdAt: 300 + i })
    delete full.q1
    seed(room, full)
    seed(room, { r2: entry(room, 'intro', BOB), q2: replyEntry('r2', BOB) })

    const good = addOp(room, 'x1', 'last line') as Extract<CommentOp, { type: 'comment-add' }>
    const titleAnchor = createCommentAnchor(room.title, 0, 2)!
    const missingClient = { ...good.start, item: { client: 987_654, clock: 0 } }
    const doomed = anchorOf(room, 'lives')
    room.doc.transact(() => {
      const at = room.content.toString().indexOf('lives')
      room.content.delete(at, 'lives'.length)
    })
    const cases: [CommentOp, string][] = [
      [{ ...good, start: missingClient }, 'invalid'],
      [{ ...good, start: titleAnchor.start, end: titleAnchor.end }, 'invalid'],
      [{ ...good, start: doomed.start, end: doomed.end }, 'invalid'],
      [{ ...good, body: 'a'.repeat(COMMENT_BODY_MAX + 1) }, 'too_long'],
      [{ ...good, body: '' }, 'invalid'],
      [{ ...good, mentions: ['zed@example.com'] }, 'invalid'],
      [{ type: 'comment-reply', id: 'x2', parent: 'r1', body: '더', mentions: [] }, 'too_many'],
      [{ type: 'comment-reply', id: 'x3', parent: 'nope', body: '더', mentions: [] }, 'not_found'],
      [{ type: 'comment-reply', id: 'x4', parent: 'q2', body: '더', mentions: [] }, 'invalid'],
      [{ type: 'comment-resolve', id: 'nope', resolved: true }, 'not_found'],
      [{ type: 'comment-resolve', id: 'q2', resolved: true }, 'invalid'],
    ]
    const before = snapshotComments(room)
    for (const [op, reason] of cases) {
      expect(send(room, carol, op), `${op.type} ${reason}`).toEqual([reject(op.id, reason)])
      carol.setState((prev) => ({ ...(prev as object), commentRate: undefined }))
    }
    expect(snapshotComments(room)).toBe(before)

    const many: Record<string, CommentEntry> = {}
    for (let i = room.comments.size; i < 500; i++) many[`m${i}`] = entry(room, 'last line', BOB, { createdAt: 1000 + i })
    seed(room, many)
    expect(room.comments.size).toBe(500)
    const fullBefore = snapshotComments(room)
    expect(send(room, carol, good)).toEqual([reject('x1', 'too_many')])
    expect(snapshotComments(room)).toBe(fullBefore)
  })

  it('O6 순서 — 본문 1,001자 + 없는 부모 → not_found / 속도 초과 + 모양 틀림 → rate_limited', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    expect(send(room, carol, { type: 'comment-reply', id: 'x1', parent: 'nope', body: 'a'.repeat(1001), mentions: [] })).toEqual([reject('x1', 'not_found')])
    carol.setState((prev) => ({ ...(prev as object), commentRate: { start: NOW, count: 30 } }))
    expect(send(room, carol, { type: 'comment-edit', id: 'x2' })).toEqual([reject('x2', 'rate_limited')])
  })

  it('O7 같은 id 로 comment-add 두 번 → 둘째도 ack·update 없음 / 남이 쓴 키로 comment-add → invalid', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    const op = addOp(room, 'n1', 'target')
    expect(send(room, carol, op)).toEqual(['update', ack('n1')])
    expect(send(room, carol, op)).toEqual([ack('n1')])
    seed(room, { b1: entry(room, 'intro', BOB) })
    expect(send(room, carol, addOp(room, 'b1', 'intro'))).toEqual([reject('b1', 'invalid')])
  })
})

describe('F-503 O8~O10 속도·응답 없음', () => {
  it('O8 60초 안에 31번째 → rate_limited 이고 comments 불변 / 60,000ms 뒤 다시 받음', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    for (let i = 0; i < 30; i++) expect(send(room, carol, { type: 'comment-delete', id: `d${i}` })).toEqual([ack(`d${i}`)])
    vi.setSystemTime(NOW + 59_999)
    const before = snapshotComments(room)
    expect(send(room, carol, addOp(room, 'n1', 'target'))).toEqual([reject('n1', 'rate_limited')])
    expect(snapshotComments(room)).toBe(before)
    vi.setSystemTime(NOW + 60_000)
    expect(send(room, carol, addOp(room, 'n1', 'target'))).toEqual(['update', ack('n1')])
  })

  it('O9 30번 보낸 연결 상태를 새 DocRoomCore 에 두고 한 번 더 → rate_limited', async () => {
    const { DB, room } = await loadedRoom()
    const carol = room.join(CAROL)
    for (let i = 0; i < 30; i++) send(room, carol, { type: 'comment-delete', id: `d${i}` })
    const woke = makeRoom(DB, room.storage)
    await woke.load()
    woke.conns.push(carol)
    expect(replies(send(woke, carol, { type: 'comment-delete', id: 'd30' }))).toEqual([reject('d30', 'rate_limited')])
  })

  it('O10 16,385자 / id 없는 JSON → 응답 없음, 상태 null → forbidden, gone 뒤 → 응답 없음', async () => {
    const { room } = await loadedRoom()
    const carol = room.join(CAROL)
    const long = JSON.stringify({ type: 'comment-delete', id: 'd1', pad: 'x'.repeat(COMMENT_OP_MAX_CHARS) }).slice(0, COMMENT_OP_MAX_CHARS + 1)
    expect(send(room, carol, long)).toEqual([])
    expect(send(room, carol, { type: 'comment-delete' })).toEqual([])
    const nobody = room.join(null)
    expect(send(room, nobody, { type: 'comment-delete', id: 'd2' })).toEqual([reject('d2', 'forbidden')])
    room.core.purge()
    const after = conn(CAROL)
    expect(send(room, after, { type: 'comment-delete', id: 'd3' })).toEqual([])
  })
})

describe('F-503 O11 edit 연결의 명령과 F-502', () => {
  it('받고(작성자 = edit 사용자), flush 뒤 사후 검사가 지우지 않고 D1 에 행', async () => {
    const { room, sqlDb } = await loadedRoom()
    const bob = room.join(BOB)
    expect(send(room, bob, addOp(room, 'n1', 'target'))).toEqual(['update', ack('n1')])
    expect((room.comments.get('n1') as CommentEntry).author).toEqual({ id: 'bob', email: 'bob@example.com' })
    await room.core.flush()
    expect(room.comments.has('n1')).toBe(true)
    expect(dbComments(sqlDb)).toEqual([{ id: 'n1', author_id: 'bob', parent_id: null }])
  })
})

describe('F-503 O12·O13 점검', () => {
  const cases: [string, (db: DatabaseSync) => void, boolean][] = [
    ['초대 그대로', () => {}, true],
    ['초대 지움', (db) => db.prepare("DELETE FROM grants WHERE grantee_email = 'carol@example.com'").run(), false],
    ['본인 막힘', (db) => db.prepare("UPDATE users SET blocked_at = 1 WHERE id = 'carol'").run(), false],
    ['소유자 막힘', (db) => db.prepare("UPDATE users SET blocked_at = 1 WHERE id = 'owner'").run(), false],
    ['초대를 edit 로 올림', (db) => db.prepare("UPDATE grants SET role = 'edit' WHERE grantee_email = 'carol@example.com'").run(), true],
  ]
  for (const [name, change, stays] of cases) {
    it(`O12 view 연결 — ${name}`, async () => {
      const { sqlDb, DB } = setup()
      const room = makeRoom(DB)
      const carol = room.join(CAROL)
      change(sqlDb)
      await room.core.revalidateConnections()
      expect(carol.closed).toEqual(stays ? null : { code: 4403, reason: 'revoked' })
      if (stays) {
        expect((carol.state as Actor).role).toBe('view')
        expect(isReadOnlyState(carol.state)).toBe(true)
      }
    })
  }

  it('O13 edit 연결 — 초대를 view 로 내림 → 4403 revoked', async () => {
    const { sqlDb, DB } = setup()
    const room = makeRoom(DB)
    const bob = room.join(BOB)
    sqlDb.prepare("UPDATE grants SET role = 'view' WHERE grantee_email = 'bob@example.com'").run()
    await room.core.revalidateConnections()
    expect(bob.closed).toEqual({ code: 4403, reason: 'revoked' })
  })
})

function record(over: Partial<CommentRecord> & { id: string }): CommentRecord {
  return {
    parent: null,
    body: '기록',
    mentions: [],
    authorId: 'someone',
    authorEmail: 'someone@example.com',
    createdAt: 50,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: '',
    prefix: '',
    suffix: '',
    anchorFrom: null,
    anchorLength: null,
    ...over,
  }
}

function rootRecord(id: string, needle: string, over: Partial<CommentRecord> = {}): CommentRecord {
  const from = BODY.indexOf(needle)
  return record({ id, quote: needle, anchorFrom: from, anchorLength: needle.length, ...over })
}

const IMPORTER = { id: 'owner', email: 'owner@example.com' }

describe('F-503 O14·O15 importComments', () => {
  it('O14 빈 방에 첫 댓글 3(하나는 없는 인용문)·답글 2 → imported 5·orphaned 1, 작성자·해결자 이관자, 멘션 [], D1 5행·알림 0', async () => {
    const { DB, sqlDb } = setup()
    const room = makeRoom(DB)
    const records = [
      rootRecord('i1', 'target phrase', { body: '@carol@example.com 봐', mentions: ['carol@example.com'] }),
      rootRecord('i2', 'intro', { resolvedAt: 70, resolvedById: 'someone', resolvedBy: 'someone@example.com' }),
      record({ id: 'i3', quote: 'nowhere to be found', anchorFrom: 3, anchorLength: 19 }),
      record({ id: 'j1', parent: 'i1', createdAt: 60, body: '@carol@example.com 답' , mentions: ['carol@example.com'] }),
      record({ id: 'j2', parent: 'i2', createdAt: 61 }),
    ]
    const result = await room.core.importComments({ records, user: IMPORTER, docVersion: 1 })
    expect(result).toEqual({ type: 'ok', imported: 5, orphaned: 1 })
    const entries = Object.values(room.comments.toJSON()) as CommentEntry[]
    expect(entries).toHaveLength(5)
    for (const e of entries) {
      expect(e.author).toEqual(IMPORTER)
      expect(e.mentions).toEqual([])
    }
    expect((room.comments.get('i2') as CommentEntry).resolved).toEqual({ by: IMPORTER, at: 70 })
    await room.core.flush()
    expect(dbComments(sqlDb)).toHaveLength(5)
    expect(noteCount(sqlDb)).toBe(0)
  })

  it('O15 항목이 있는 방 → exists / 둘 잇달아 → ok 하나 exists 하나 / 없는 문서 → not_found / 돌아온 직후 저장소에 이관 갱신', async () => {
    const one = setup()
    const busy = makeRoom(one.DB)
    await busy.load()
    seed(busy, { r1: entry(busy, 'target', BOB) })
    expect(await busy.core.importComments({ records: [rootRecord('i1', 'intro')], user: IMPORTER, docVersion: 1 })).toEqual({ type: 'exists' })

    const two = setup()
    const room = makeRoom(two.DB)
    const input = { records: [rootRecord('i1', 'intro'), record({ id: 'j1', parent: 'i1' })], user: IMPORTER, docVersion: 1 }
    const results = await Promise.all([room.core.importComments(input), room.core.importComments(input)])
    expect(results.map((r) => r.type).sort()).toEqual(['exists', 'ok'])
    const fresh = makeRoom(two.DB, room.storage)
    await fresh.load()
    expect(fresh.comments.size).toBe(2)

    const three = setup()
    three.sqlDb.prepare('DELETE FROM docs WHERE id = ?').run(DOC_ID)
    const gone = makeRoom(three.DB)
    expect(await gone.core.importComments(input)).toEqual({ type: 'not_found' })
  })
})
