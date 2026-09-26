// DO 댓글 — 사후 검사·D1 복사본·복원·알림 통합 (specs/features/F-502.md 3~6장, 13.3 D1~D16)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { DatabaseSync } from 'node:sqlite'

vi.mock('../src/lib/commentAnchor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/commentAnchor')>()
  return { ...actual, resolveCommentAnchors: vi.fn(actual.resolveCommentAnchors) }
})

import { COMMENT_FIX_ORIGIN, DocRoomCore, LOAD_FLUSH_DELAY_MS, SERVER_ORIGINS, SNAPSHOT_RETRY_MS } from './docRoomCore'
import type { DocRoomHost, RoomConnection } from './docRoomCore'
import type { DoStorageLike } from './yStore'
import { asD1, openTestDb } from './testD1'
import { rowToCommentRecord } from './commentRows'
import type { DocCommentDbRow } from './commentRows'
import { createCommentAnchor, resolveCommentAnchor, resolveCommentAnchors, toCommentRecord } from '../src/lib/commentAnchor'
import type { CommentEntry } from '../src/lib/docComments'

const DOC_ID = '22222222-2222-4222-8222-222222222222'
const OWNER = { userId: 'owner', email: 'owner@example.com', role: 'owner' as const }
const BOB = { userId: 'bob', email: 'bob@example.com', role: 'edit' as const }
const BODY = 'L1 intro line\n' + 'x'.repeat(80) + '\nThe target phrase lives here.\n' + 'y'.repeat(80) + '\nlast line\n'

type Sql = { sql: string; args: unknown[] }

function makeDb(sqlDb: DatabaseSync) {
  const inner = asD1(sqlDb)
  const state = { batches: [] as Sql[][], prepares: [] as string[], failAfterCommit: 0, beforeBatch: null as null | (() => void) }
  type Stmt = { sql: string; args: unknown[]; bind(...a: unknown[]): Stmt; first(): Promise<unknown>; all(): Promise<{ results: unknown[] }>; run(): Promise<unknown> }
  const wrap = (sql: string, args: unknown[], stmt: D1PreparedStatement): Stmt => ({
    sql,
    args,
    bind: (...a: unknown[]) => wrap(sql, a, stmt.bind(...a)),
    first: () => stmt.first(),
    all: () => stmt.all() as Promise<{ results: unknown[] }>,
    run: () => stmt.run(),
  })
  const DB = {
    prepare(sql: string) {
      state.prepares.push(sql)
      return wrap(sql, [], inner.prepare(sql))
    },
    async batch(list: Stmt[]) {
      state.batches.push(list.map((s) => ({ sql: s.sql, args: s.args })))
      state.beforeBatch?.()
      sqlDb.exec('BEGIN')
      const results: unknown[] = []
      try {
        // RETURNING 이 붙은 사용량 줄은 D1 처럼 results 를 돌려준다
        for (const s of list) results.push(s.sql.includes(' RETURNING ') ? { ...(await s.all()), meta: { changes: 1 } } : await s.run())
        sqlDb.exec('COMMIT')
      } catch (err) {
        sqlDb.exec('ROLLBACK')
        throw err
      }
      if (state.failAfterCommit > 0) {
        state.failAfterCommit--
        throw new Error('response lost')
      }
      return results
    },
  }
  return { DB: DB as unknown as D1Database, state }
}

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

function setup(opts: { content?: string; title?: string } = {}) {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
  user.run('owner', 'owner@example.com', 1)
  user.run('bob', 'bob@example.com', 1)
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(DOC_ID, 'owner', opts.title ?? '회의록', opts.content ?? BODY, 'lf', 1, 1, 1)
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run('doc', DOC_ID, 'owner', 'bob@example.com', 'edit', 1)
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run('doc', DOC_ID, 'owner', 'carol@example.com', 'view', 1)
  const db = makeDb(sqlDb)
  return { sqlDb, ...db }
}

function makeRoom(DB: D1Database, storage = makeStorage()) {
  const doc = new Y.Doc()
  const alarms: number[] = []
  const host: DocRoomHost<RoomConnection> = {
    docId: DOC_ID,
    env: { DB } as unknown as Env,
    storage,
    doc,
    connections: () => [],
    sendCustom: () => {},
    broadcastCustom: () => {},
    ensureLoaded: async () => {},
    exclusive: <T,>(fn: () => Promise<T>) => fn(),
    setAlarm: async (at: number) => {
      alarms.push(at)
    },
  }
  const core = new DocRoomCore(host)
  return { core, doc, storage, alarms, comments: doc.getMap<unknown>('comments'), content: doc.getText('content') }
}

function conn(actor: { userId: string; email: string; role: 'owner' | 'edit' } | null): RoomConnection {
  return { state: actor, close() {} }
}

function entryAt(content: Y.Text, needle: string, author: { userId: string; email: string }, over: Partial<CommentEntry> = {}): CommentEntry {
  const from = content.toString().indexOf(needle)
  return {
    v: 1,
    parent: null,
    anchor: createCommentAnchor(content, from, from + needle.length),
    quote: needle,
    body: '본문',
    mentions: [],
    author: { id: author.userId, email: author.email },
    createdAt: 100,
    resolved: null,
    ...over,
  }
}

function reply(parent: string, author: { userId: string; email: string }, over: Partial<CommentEntry> = {}): CommentEntry {
  return { v: 1, parent, anchor: null, quote: '', body: '답글', mentions: [], author: { id: author.userId, email: author.email }, createdAt: 200, resolved: null, ...over }
}

function put(doc: Y.Doc, origin: unknown, fn: (map: Y.Map<unknown>) => void) {
  doc.transact(() => fn(doc.getMap('comments')), origin)
}

function label(sql: string): string {
  if (sql.startsWith('UPDATE docs SET')) return 'body'
  if (sql.includes(' RETURNING ')) return 'usage'
  if (sql.startsWith('UPDATE users SET content_bytes = content_bytes - (')) return 'c1'
  if (sql.startsWith('INSERT INTO doc_comments')) return 'c2'
  if (sql.startsWith('DELETE FROM doc_comments')) return 'c3'
  if (sql.startsWith('DELETE FROM notifications')) return sql.includes('LIMIT') ? 'c6' : 'c4'
  if (sql.startsWith('INSERT OR IGNORE INTO notifications')) return 'c5'
  if (sql.startsWith('UPDATE users SET content_bytes = content_bytes + (')) return 'c7'
  return sql
}

const labels = (batch: Sql[]) => batch.map((s) => label(s.sql))
const dbRows = (sqlDb: DatabaseSync) =>
  sqlDb.prepare('SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, id').all(DOC_ID) as DocCommentDbRow[]
const notes = (sqlDb: DatabaseSync) =>
  sqlDb.prepare('SELECT recipient_email, kind, comment_id, thread_id, actor_email, doc_title, excerpt FROM notifications ORDER BY recipient_email, kind').all() as Record<string, unknown>[]
const ownerBytes = (sqlDb: DatabaseSync) => (sqlDb.prepare("SELECT content_bytes AS n FROM users WHERE id = 'owner'").get() as { n: number }).n
const docRow = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT version, updated_at FROM docs WHERE id = ?').get(DOC_ID) as { version: number; updated_at: number }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  vi.mocked(resolveCommentAnchors).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('F-502 D1~D3 사후 검사', () => {
  it('D1 작성자를 속인 추가는 곧바로 다시 도장, update 는 연결 → 고치기 순서, 관찰은 한 번 더 부르고 멈춘다', async () => {
    const { DB } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    const origins: unknown[] = []
    room.doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    let observed = 0
    room.comments.observe(() => observed++)
    const c = conn(BOB)
    put(room.doc, c, (m) => m.set('c1', entryAt(room.content, 'target', OWNER)))
    expect((room.comments.get('c1') as CommentEntry).author).toEqual({ id: 'bob', email: 'bob@example.com' })
    expect(origins).toEqual([c, COMMENT_FIX_ORIGIN])
    expect(observed).toBe(2)
  })

  it('D2 연결 state 를 읽을 수 없으면 그 트랜잭션의 댓글 변경이 모두 되돌려진다', async () => {
    const { DB } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    const kept = entryAt(room.content, 'target', BOB)
    put(room.doc, conn(BOB), (m) => m.set('keep', kept))
    put(room.doc, conn(null), (m) => {
      m.set('new', entryAt(room.content, 'intro', BOB))
      m.set('keep', { ...kept, body: '바꿈' })
    })
    expect(room.comments.has('new')).toBe(false)
    expect(room.comments.get('keep')).toEqual(kept)
  })

  it('D3 서버 origin 으로 쓴 항목은 고치지 않는다', async () => {
    const { DB } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    let n = 0
    for (const origin of SERVER_ORIGINS) {
      const bad = { ...entryAt(room.content, 'target', OWNER), author: { id: 'x', email: 'x@example.com' } }
      put(room.doc, origin, (m) => m.set(`s${n}`, bad))
      expect(room.comments.get(`s${n}`)).toEqual(bad)
      n++
    }
  })
})

describe('F-502 D4~D6 스냅숏 batch 모양', () => {
  it('D4 댓글만 → [사용량(0), c1, c2, c7], docs version·updated_at 불변, D1 행이 항목과 같다', async () => {
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    const before = docRow(sqlDb)
    const e = entryAt(room.content, 'target', OWNER)
    put(room.doc, conn(OWNER), (m) => m.set('c1', e))
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    expect(labels(state.batches[0])).toEqual(['usage', 'c1', 'c2', 'c7'])
    expect(state.batches[0][0].args).toEqual(['1970-01-01', 0, 0, 'owner'])
    expect(docRow(sqlDb)).toEqual(before)
    const rows = dbRows(sqlDb)
    expect(rows.map(rowToCommentRecord)).toEqual([toCommentRecord('c1', e, room.content.toString(), resolveCommentAnchor(room.content, e.anchor))])
    expect(ownerBytes(sqlDb)).toBe(rows[0].bytes)
  })

  it('D5 본문 + 댓글 → 앞 두 문장이 지금과 같고 그 뒤 c1·c2·c7', async () => {
    const { DB, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    room.doc.transact(() => room.content.insert(0, 'Z'), conn(OWNER))
    put(room.doc, conn(OWNER), (m) => m.set('c1', entryAt(room.content, 'target', OWNER)))
    await room.core.flush()
    expect(labels(state.batches[0])).toEqual(['body', 'usage', 'c1', 'c2', 'c7'])
    expect(state.batches[0][0].sql).toBe('UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
    expect(state.batches[0][1].args).toEqual(['1970-01-01', 1, 0, 'owner'])
  })

  it('D6 댓글 변화 없이 본문만 → 두 문장', async () => {
    const { DB, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    room.doc.transact(() => room.content.insert(0, 'Z'), conn(OWNER))
    await room.core.flush()
    expect(labels(state.batches[0])).toEqual(['body', 'usage'])
  })
})

describe('F-502 D7·D8 알림', () => {
  it('D7 멘션·답글 → 접근 집합 안, 자기 자신 빠짐, doc_title·excerpt·thread_id', async () => {
    const { DB, sqlDb } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    const body = '@carol@example.com @zed@example.com @bob@example.com 확인 부탁'
    put(room.doc, conn(BOB), (m) =>
      m.set('r1', entryAt(room.content, 'target', BOB, { body, mentions: ['carol@example.com', 'zed@example.com', 'bob@example.com'] })),
    )
    put(room.doc, conn(OWNER), (m) => m.set('a1', reply('r1', OWNER, { body: '네 볼게요' })))
    await room.core.flush()
    expect(notes(sqlDb)).toEqual([
      { recipient_email: 'bob@example.com', kind: 'reply', comment_id: 'a1', thread_id: 'r1', actor_email: 'owner@example.com', doc_title: '회의록', excerpt: '네 볼게요' },
      { recipient_email: 'carol@example.com', kind: 'mention', comment_id: 'r1', thread_id: 'r1', actor_email: 'bob@example.com', doc_title: '회의록', excerpt: body },
    ])
  })

  it('D8 batch 가 커밋된 뒤 던지면 다시 시도해도 알림 1행, content_bytes 한 번 몫', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB, { body: '@carol@example.com 봐 주세요', mentions: ['carol@example.com'] })))
    state.failAfterCommit = 1
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS)
    expect(state.batches).toHaveLength(2)
    expect(notes(sqlDb)).toHaveLength(1)
    expect(ownerBytes(sqlDb)).toBe(dbRows(sqlDb)[0].bytes)
    await room.core.flush()
    expect(state.batches).toHaveLength(2)
  })
})

describe('F-502 D9 복원', () => {
  it('roomEmptied → 저장소를 잃은 새 코어가 같은 댓글을 되살린다, 새 알림 0', async () => {
    const { DB, sqlDb } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    const r1 = entryAt(room.content, 'target phrase', BOB, { body: '@carol@example.com 봐 주세요', mentions: ['carol@example.com'] })
    const r2 = entryAt(room.content, 'intro', OWNER, { createdAt: 150, resolved: { by: { id: 'owner', email: 'owner@example.com' }, at: 300 } })
    put(room.doc, conn(BOB), (m) => m.set('r1', r1))
    put(room.doc, conn(OWNER), (m) => m.set('r2', r2))
    put(room.doc, conn(BOB), (m) => m.set('a1', reply('r1', BOB)))
    await room.core.roomEmptied()
    const rowsBefore = dbRows(sqlDb).length
    const notesBefore = notes(sqlDb).length
    expect(rowsBefore).toBe(3)

    const fresh = makeRoom(DB)
    await fresh.core.load()
    const got = Object.fromEntries(fresh.comments.entries()) as Record<string, CommentEntry>
    expect(Object.keys(got).sort()).toEqual(['a1', 'r1', 'r2'])
    const slice = (c: Y.Text, e: CommentEntry) => {
      const range = resolveCommentAnchor(c, e.anchor)!
      return c.toString().slice(range.from, range.to)
    }
    expect(slice(fresh.content, got.r1)).toBe('target phrase')
    expect(slice(fresh.content, got.r2)).toBe('intro')
    expect(got.r1.author).toEqual(r1.author)
    expect(got.r1.mentions).toEqual(['carol@example.com'])
    expect(got.r2.resolved).toEqual(r2.resolved)
    expect(got.a1).toEqual(reply('r1', BOB))

    await fresh.core.roomEmptied()
    await vi.advanceTimersByTimeAsync(LOAD_FLUSH_DELAY_MS)
    expect(notes(sqlDb).length).toBe(notesBefore)
    expect(dbRows(sqlDb).length).toBe(rowsBefore)
  })
})

describe('F-502 D10~D12 지우기·앵커 다시 적기', () => {
  it('D10 댓글 지우기 → 행과 그 알림이 지워지고 content_bytes 가 그만큼 준다', async () => {
    const { DB, sqlDb } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB, { body: '@carol@example.com 봐 주세요', mentions: ['carol@example.com'] })))
    put(room.doc, conn(BOB), (m) => m.set('r2', entryAt(room.content, 'intro', BOB)))
    await room.core.flush()
    expect(notes(sqlDb)).toHaveLength(1)
    const r2Bytes = dbRows(sqlDb).find((r) => r.id === 'r2')!.bytes
    put(room.doc, conn(BOB), (m) => m.delete('r1'))
    await room.core.flush()
    expect(dbRows(sqlDb).map((r) => r.id)).toEqual(['r2'])
    expect(notes(sqlDb)).toHaveLength(0)
    expect(ownerBytes(sqlDb)).toBe(r2Bytes)
  })

  it('D11 멀리 위쪽 편집은 댓글 문장 없음, 앵커 둘레를 고치면 roomEmptied 에서 그 행만', async () => {
    const { DB, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(OWNER), (m) => {
      m.set('r1', entryAt(room.content, 'target', OWNER))
      m.set('r2', entryAt(room.content, 'last line', OWNER, { createdAt: 101 }))
    })
    await room.core.flush()
    room.doc.transact(() => room.content.insert(0, 'top '), conn(OWNER))
    await room.core.flush()
    expect(labels(state.batches[1])).toEqual(['body', 'usage'])
    await room.core.roomEmptied()
    expect(state.batches).toHaveLength(2)

    const at = room.content.toString().indexOf('target')
    room.doc.transact(() => room.content.insert(at - 1, '!'), conn(OWNER))
    await room.core.roomEmptied()
    expect(state.batches).toHaveLength(3)
    expect(labels(state.batches[2])).toEqual(['body', 'usage', 'c1', 'c2', 'c7'])
    const json = state.batches[2][3].args.find((a) => typeof a === 'string' && a.startsWith('[')) as string
    expect((JSON.parse(json) as { id: string }[]).map((r) => r.id)).toEqual(['r1'])
  })

  it('D12 변화 없는 두 번째 roomEmptied → 댓글 문장 없음, resolveCommentAnchors 를 부르지 않음', async () => {
    const { DB, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(OWNER), (m) => m.set('r1', entryAt(room.content, 'target', OWNER)))
    await room.core.roomEmptied()
    const batches = state.batches.length
    vi.mocked(resolveCommentAnchors).mockClear()
    await room.core.roomEmptied()
    expect(state.batches).toHaveLength(batches)
    expect(resolveCommentAnchors).not.toHaveBeenCalled()
  })
})

describe('F-502 D13 막힘·느린 저장', () => {
  it('막힌 소유자 → 댓글 문장 없음, 풀린 뒤 flush 에서 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    sqlDb.prepare("UPDATE users SET blocked_at = 1 WHERE id = 'owner'").run()
    room.doc.transact(() => room.content.insert(0, 'Z'), conn(OWNER))
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    put(room.doc, conn(OWNER), (m) => m.set('r1', entryAt(room.content, 'target', OWNER)))
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    expect(dbRows(sqlDb)).toHaveLength(0)
    sqlDb.prepare("UPDATE users SET blocked_at = NULL WHERE id = 'owner'").run()
    await room.core.flush()
    expect(labels(state.batches[1])).toEqual(['usage', 'c1', 'c2', 'c7'])
    expect(dbRows(sqlDb)).toHaveLength(1)
  })

  it('느린 저장 60초 안 → 댓글 문장 없음, 알람 flush 에서 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { DB, sqlDb, state } = setup()
    sqlDb.prepare("UPDATE users SET write_day = '1970-01-01', write_count = 5000 WHERE id = 'owner'").run()
    const room = makeRoom(DB)
    await room.core.load()
    room.doc.transact(() => room.content.insert(0, 'Z'), conn(OWNER))
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    put(room.doc, conn(OWNER), (m) => m.set('r1', entryAt(room.content, 'target', OWNER)))
    await room.core.flush()
    expect(state.batches).toHaveLength(1)
    expect(room.alarms).toHaveLength(1)
    await room.core.alarm()
    expect(labels(state.batches[1])).toEqual(['usage', 'c1', 'c2', 'c7'])
    expect(dbRows(sqlDb)).toHaveLength(1)
  })
})

describe('F-502 D14 D1 에만 있는 행', () => {
  it('불러온 뒤 LOAD_FLUSH_DELAY_MS flush 에서 지워진다', async () => {
    const { DB, sqlDb, state } = setup()
    const storage = makeStorage()
    const first = makeRoom(DB, storage)
    await first.core.load()
    sqlDb
      .prepare("INSERT INTO doc_comments (doc_id, id, body, created_at, bytes, sig, anchor_sig) VALUES (?, 'ghost', 'b', 1, 1, 's', 'a')")
      .run(DOC_ID)
    sqlDb.prepare("UPDATE users SET content_bytes = 1 WHERE id = 'owner'").run()
    const again = makeRoom(DB, storage)
    await again.core.load()
    expect(state.batches).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(LOAD_FLUSH_DELAY_MS)
    expect(labels(state.batches[0])).toEqual(['usage', 'c1', 'c3', 'c4', 'c7'])
    expect(dbRows(sqlDb)).toHaveLength(0)
    expect(ownerBytes(sqlDb)).toBe(0)
  })
})

describe('F-502 D15 접근 집합 60초 보관', () => {
  it('60초 안의 두 스냅숏 → loadDocPeople 질의 한 번 몫', async () => {
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB, { body: '@carol@example.com 하나', mentions: ['carol@example.com'] })))
    await room.core.flush()
    vi.setSystemTime(1_030_000)
    put(room.doc, conn(BOB), (m) => m.set('r2', entryAt(room.content, 'intro', BOB, { body: '@carol@example.com 둘', mentions: ['carol@example.com'] })))
    await room.core.flush()
    expect(notes(sqlDb)).toHaveLength(2)
    expect(state.prepares.filter((s) => s.includes('FROM grants'))).toHaveLength(1)
  })
})

describe('F-502 D16 스냅숏 도중 문서 삭제', () => {
  it('c2 전에 docs 행이 지워지면 댓글 행 0, content_bytes 변화 0', async () => {
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(OWNER), (m) => m.set('r1', entryAt(room.content, 'target', OWNER)))
    const bytes = ownerBytes(sqlDb)
    state.beforeBatch = () => sqlDb.prepare('DELETE FROM docs WHERE id = ?').run(DOC_ID)
    await room.core.flush()
    expect(dbRows(sqlDb)).toHaveLength(0)
    expect(ownerBytes(sqlDb)).toBe(bytes)
  })
})
