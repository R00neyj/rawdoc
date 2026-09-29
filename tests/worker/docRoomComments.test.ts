// DO 댓글 — 사후 검사·D1 복사본·복원·알림 통합 (specs/features/F-502.md 3~6장, 13.3 D1~D16)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { DatabaseSync } from 'node:sqlite'

vi.mock('../../src/lib/commentAnchor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/commentAnchor')>()
  return { ...actual, resolveCommentAnchors: vi.fn(actual.resolveCommentAnchors) }
})

import { COMMENT_FIX_ORIGIN, DocRoomCore, LOAD_FLUSH_DELAY_MS, SERVER_ORIGINS, SNAPSHOT_RETRY_MS } from '../../worker/docRoomCore'
import type { DocRoomHost, RoomConnection } from '../../worker/docRoomCore'
import type { DoStorageLike } from '../../worker/yStore'
import { asD1, openTestDb } from '../../worker/testD1'
import { rowToCommentRecord } from '../../worker/commentRows'
import type { DocCommentDbRow } from '../../worker/commentRows'
import { createCommentAnchor, resolveCommentAnchor, resolveCommentAnchors, toCommentRecord } from '../../src/lib/commentAnchor'
import type { CommentEntry } from '../../src/lib/docComments'

const DOC_ID = '22222222-2222-4222-8222-222222222222'
const OWNER = { userId: 'owner', email: 'owner@example.com', role: 'owner' as const }
const BOB = { userId: 'bob', email: 'bob@example.com', role: 'edit' as const }
const BODY = 'L1 intro line\n' + 'x'.repeat(80) + '\nThe target phrase lives here.\n' + 'y'.repeat(80) + '\nlast line\n'

type Sql = { sql: string; args: unknown[] }

function makeDb(sqlDb: DatabaseSync) {
  const inner = asD1(sqlDb)
  const state = {
    batches: [] as Sql[][],
    prepares: [] as string[],
    failAfterCommit: 0,
    beforeBatch: null as null | (() => void),
    failAll: null as null | ((sql: string) => boolean),
  }
  type Stmt = { sql: string; args: unknown[]; bind(...a: unknown[]): Stmt; first(): Promise<unknown>; all(): Promise<{ results: unknown[] }>; run(): Promise<unknown> }
  const wrap = (sql: string, args: unknown[], stmt: D1PreparedStatement): Stmt => ({
    sql,
    args,
    bind: (...a: unknown[]) => wrap(sql, a, stmt.bind(...a)),
    first: () => stmt.first(),
    all: () => (state.failAll?.(sql) ? Promise.reject(new Error('D1 down')) : (stmt.all() as Promise<{ results: unknown[] }>)),
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
        // RETURNING 이 붙은 사용량 줄·SELECT 는 D1 처럼 results 를 돌려준다
        for (const s of list) {
          if (s.sql.includes(' RETURNING ')) results.push({ ...(await s.all()), meta: { changes: 1 } })
          else if (s.sql.startsWith('SELECT')) results.push({ ...(await s.all()), meta: { changes: 0 } })
          else results.push(await s.run())
        }
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

function makeRoom(
  DB: D1Database,
  storage = makeStorage(),
  extraEnv: Record<string, unknown> = {},
  hostExtra: Pick<Partial<DocRoomHost<RoomConnection>>, 'connections' | 'getAlarm' | 'lastPing'> = {},
) {
  const doc = new Y.Doc()
  const alarms: number[] = []
  const host: DocRoomHost<RoomConnection> = {
    docId: DOC_ID,
    env: { DB, ...extraEnv } as unknown as Env,
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
    ...hostExtra,
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
  if (sql.startsWith('UPDATE users SET notif_rev')) return 'rev' // F-2057 3.5
  if (sql.startsWith('UPDATE users SET content_bytes = content_bytes + (')) return 'c7'
  if (sql.startsWith('SELECT MIN(push_due_at)')) return 'min'
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
      { recipient_email: 'owner@example.com', kind: 'comment', comment_id: 'r1', thread_id: 'r1', actor_email: 'bob@example.com', doc_title: '회의록', excerpt: body },
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
    expect(notes(sqlDb)).toHaveLength(2)
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
    expect(notes(sqlDb)).toHaveLength(3)
    const r2Bytes = dbRows(sqlDb).find((r) => r.id === 'r2')!.bytes
    put(room.doc, conn(BOB), (m) => m.delete('r1'))
    await room.core.flush()
    expect(dbRows(sqlDb).map((r) => r.id)).toEqual(['r2'])
    expect(notes(sqlDb)).toHaveLength(1)
    expect(notes(sqlDb)[0]).toMatchObject({ kind: 'comment', comment_id: 'r2' })
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
    expect(labels(state.batches[0])).toEqual(['usage', 'c1', 'c3', 'rev', 'c4', 'c7'])
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
    expect(notes(sqlDb)).toHaveLength(4)
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

async function vapidEnv() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
  return { VAPID_PRIVATE_JWK: jwk, BETTER_AUTH_URL: 'http://localhost:8790' }
}

const ownerComments = (sqlDb: DatabaseSync) =>
  sqlDb.prepare("SELECT push_due_at, created_at FROM notifications WHERE recipient_email = 'owner@example.com' AND kind = 'comment'").all() as { push_due_at: number | null; created_at: number }[]

function subscribeOwner(sqlDb: DatabaseSync) {
  sqlDb.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)').run('s1', 'owner', 'https://push.example/1', 'k', 'a', 1)
}

async function bobComments(w: ReturnType<typeof setup>, env: Record<string, unknown>) {
  const room = makeRoom(w.DB, makeStorage(), env)
  await room.core.load()
  put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB)))
  await room.core.flush()
}

describe('F-3005 D1~D4 comment 알림·push_due_at', () => {
  it('D1 주인 아닌 사람의 새 댓글 → 주인 comment, 답글은 reply 가 이긴다', async () => {
    const { DB, sqlDb } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(OWNER), (m) => m.set('r2', entryAt(room.content, 'intro', OWNER)))
    await room.core.flush()
    put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB)))
    put(room.doc, conn(BOB), (m) => m.set('a1', reply('r2', BOB)))
    await room.core.flush()
    expect(notes(sqlDb).map((n) => [n.recipient_email, n.kind, n.comment_id, n.thread_id, n.actor_email])).toEqual([
      ['owner@example.com', 'comment', 'r1', 'r1', 'bob@example.com'],
      ['owner@example.com', 'reply', 'a1', 'r2', 'bob@example.com'],
    ])
  })

  it('D2 주인 혼자 → 알림 0, 접근 집합 질의 0', async () => {
    const { DB, sqlDb, state } = setup()
    const room = makeRoom(DB)
    await room.core.load()
    put(room.doc, conn(OWNER), (m) => m.set('r1', entryAt(room.content, 'target', OWNER)))
    put(room.doc, conn(OWNER), (m) => m.set('r2', entryAt(room.content, 'intro', OWNER)))
    await room.core.flush()
    expect(notes(sqlDb)).toHaveLength(0)
    expect(state.prepares.filter((s) => s.includes('FROM grants'))).toHaveLength(0)
  })

  it('D3 푸시 켜짐 → 구독 있는 주인 행에 created_at + 180000, 구독 없으면 NULL', async () => {
    const env = await vapidEnv()
    const withSub = setup()
    subscribeOwner(withSub.sqlDb)
    await bobComments(withSub, env)
    const [row] = ownerComments(withSub.sqlDb)
    expect(row.push_due_at).toBe(row.created_at + 180_000)
    const noSub = setup()
    await bobComments(noSub, env)
    expect(ownerComments(noSub.sqlDb)[0].push_due_at).toBeNull()
  })

  it('D4 푸시 꺼짐 → NULL, 켜진 env 와 batch 문장 배열이 같다', async () => {
    const off = setup()
    subscribeOwner(off.sqlDb)
    await bobComments(off, {})
    expect(ownerComments(off.sqlDb)[0].push_due_at).toBeNull()
    const on = setup()
    subscribeOwner(on.sqlDb)
    await bobComments(on, await vapidEnv())
    expect(labels(on.state.batches[0])).toEqual([...labels(off.state.batches[0]), 'min'])
    for (const batch of [off.state.batches[0], on.state.batches[0]]) {
      expect(batch.filter((s) => s.sql.includes('push_subscriptions')).map((s) => label(s.sql))).toEqual(['c5'])
    }
  })
})

describe('F-3006 R1~R7 스냅숏 끝 MIN·알람이 보낸다', () => {
  const T = Date.parse('2026-09-30T00:00:00Z')
  const DUE = T + 180_000

  beforeEach(() => {
    vi.setSystemTime(T)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function b64url(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  // 보내기까지 가려면 허용 목록 안 주소와 곡선 위 점이 있어야 한다 (F-3002 3.4)
  async function subscribeOwnerLive(sqlDb: DatabaseSync) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    sqlDb
      .prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
      .run('s1', 'owner', 'https://fcm.googleapis.com/fcm/send/s1', b64url(raw), b64url(crypto.getRandomValues(new Uint8Array(16))), 1)
  }

  async function world(hostExtra: Parameters<typeof makeRoom>[3] = {}, before?: (sqlDb: DatabaseSync) => void) {
    const w = setup()
    await subscribeOwnerLive(w.sqlDb)
    before?.(w.sqlDb)
    const room = makeRoom(w.DB, makeStorage(), await vapidEnv(), hostExtra)
    await room.core.load()
    put(room.doc, conn(BOB), (m) => m.set('r1', entryAt(room.content, 'target', BOB)))
    await room.core.flush()
    return { ...w, room }
  }

  const retryMark = (storage: DoStorageLike) =>
    storage.sql.exec('SELECT key, value FROM ydoc_meta').toArray().find((r) => r.key === 'push_retry')?.value ?? null

  it('R1 켜진 env·주인 구독, BOB 첫 댓글 → batch 끝 min, 알람 = 그 행 push_due_at', async () => {
    const { sqlDb, state, room } = await world()
    expect(labels(state.batches[0]).at(-1)).toBe('min')
    expect(ownerComments(sqlDb)[0].push_due_at).toBe(DUE)
    expect(room.alarms).toEqual([DUE])
  })

  it('R2 1시간 넘은 행은 MIN 에서 빠진다', async () => {
    const { room } = await world({}, (sqlDb) => {
      sqlDb
        .prepare(
          'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, push_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run('old', 'owner@example.com', 'comment', DOC_ID, 'old-c', 'old-c', 'bob@example.com', '회의록', 'x', T - 7_400_000, T - 7_200_000)
    })
    expect(room.alarms).toEqual([DUE])
  })

  it('R3 그 시각의 alarm() 한 번에 푸시 1, 주인 행 NULL, 다시 걸린 알람 없음', async () => {
    const { sqlDb, room } = await world()
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.setSystemTime(DUE)
    await room.core.alarm()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ownerComments(sqlDb)[0].push_due_at).toBeNull()
    expect(room.alarms).toEqual([DUE])
  })

  it('R4 모으기가 던지면 10분 뒤 한 번, 또 던지면 포기 — 표지 0, 알람이 던지지 않음', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { state, room } = await world()
    state.failAll = (sql) => sql.includes('FROM notifications n')
    vi.setSystemTime(DUE)
    await room.core.alarm()
    expect(room.alarms.at(-1)).toBe(DUE + 600_000)
    expect(retryMark(room.storage)).toBe(String(DUE))

    const count = room.alarms.length
    vi.setSystemTime(DUE + 600_000)
    await expect(room.core.alarm()).resolves.toBeUndefined()
    expect(room.alarms).toHaveLength(count)
    expect(retryMark(room.storage)).toBe('0')
    expect(warn).toHaveBeenCalled()
  })

  it('R5 주인이 열어 둠(connectedAt 10초 전) → fetch 0, 행 NULL', async () => {
    const open: RoomConnection[] = []
    const { sqlDb, room } = await world({ connections: () => open })
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.setSystemTime(DUE)
    open.push({ state: { ...OWNER, connectedAt: DUE - 10_000 }, close() {} })
    await room.core.alarm()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ownerComments(sqlDb)[0].push_due_at).toBeNull()
  })

  it('R6 느린 날 — MIN 알람 뒤 느린 저장 알람이 더 이르면 건다, 같은 창은 되풀이 안 함', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { room } = await world({}, (sqlDb) => {
      sqlDb.prepare("UPDATE users SET write_day = '2026-09-30', write_count = 5000 WHERE id = 'owner'").run()
    })
    expect(room.alarms).toEqual([T + 180_000])
    vi.setSystemTime(T + 20_000)
    room.doc.transact(() => room.content.insert(0, 'Z'), conn(OWNER))
    await room.core.flush()
    expect(room.alarms).toEqual([T + 180_000, T + 60_000])
    vi.setSystemTime(T + 30_000)
    room.doc.transact(() => room.content.insert(0, 'Y'), conn(OWNER))
    await room.core.flush()
    expect(room.alarms).toEqual([T + 180_000, T + 60_000])
  })

  it('R7 쫓겨난 뒤 새 코어는 getAlarm 을 한 번 읽는다 — 더 이르면 두고, 늦으면 건다', async () => {
    let reads = 0
    const early = await world({
      getAlarm: async () => {
        reads++
        return T + 50_000
      },
    })
    expect(early.room.alarms).toEqual([])
    expect(reads).toBe(1)

    const late = await world({ getAlarm: async () => T + 500_000 })
    expect(late.room.alarms).toEqual([T + 180_000])
  })
})

describe('F-3008 R1~R4 스냅숏 뒤 저장 공간 경고', () => {
  const T = Date.parse('2026-09-30T00:00:00Z')
  const NEAR = 104_857_600 * 0.9

  beforeEach(() => {
    vi.setSystemTime(T)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function b64url(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  async function world(env: Record<string, unknown> | null) {
    const w = setup()
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
    const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
    w.sqlDb
      .prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
      .run('s1', 'owner', 'https://fcm.googleapis.com/fcm/send/s1', b64url(raw), b64url(crypto.getRandomValues(new Uint8Array(16))), 1)
    w.sqlDb.prepare("UPDATE users SET content_bytes = ? WHERE id = 'owner'").run(NEAR)
    const room = makeRoom(w.DB, makeStorage(), env ?? {})
    await room.core.load()
    return { ...w, room }
  }

  const grow = (room: ReturnType<typeof makeRoom>, ch: string) => room.doc.transact(() => room.content.insert(0, ch), conn(OWNER))
  const quotaSql = (state: { prepares: string[] }) => state.prepares.filter((s) => s.includes('push_quota_at'))
  const quotaAt = (sqlDb: DatabaseSync) => (sqlDb.prepare("SELECT push_quota_at AS n FROM users WHERE id = 'owner'").get() as { n: number | null }).n

  it('R1 스냅숏이 90% 를 넘기면 fetch 1, 표지가 찍히고 스냅숏은 정상', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const { sqlDb, room } = await world(await vapidEnv())
    grow(room, 'Z')
    await room.core.flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(quotaAt(sqlDb)).toBe(T)
    expect(docRow(sqlDb).version).toBe(2)
  })

  it('R2 같은 방에서 더 flush 해도 claim SQL 은 모두 1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const { state, room } = await world(await vapidEnv())
    for (const ch of ['Z', 'Y', 'X']) {
      grow(room, ch)
      await room.core.flush()
    }
    expect(quotaSql(state)).toHaveLength(1)
  })

  it('R3 알람이 부른 flush 는 건너뛰고 보통 flush 가 한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const { state, room } = await world(await vapidEnv())
    grow(room, 'Z')
    await room.core.alarm()
    expect(quotaSql(state)).toHaveLength(0)
    grow(room, 'Y')
    await room.core.flush()
    expect(quotaSql(state)).toHaveLength(1)
  })

  it('R4 VAPID 없음이면 claim SQL 0, 구독 읽기가 던져도 flush 는 풀리고 warn 1', async () => {
    const off = await world(null)
    grow(off.room, 'Z')
    await off.room.core.flush()
    expect(quotaSql(off.state)).toHaveLength(0)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const on = await world(await vapidEnv())
    const prepare = on.DB.prepare.bind(on.DB)
    on.DB.prepare = ((sql: string) => {
      if (sql.includes('FROM push_subscriptions')) throw new Error('D1 down')
      return prepare(sql)
    }) as D1Database['prepare']
    grow(on.room, 'Z')
    await on.room.core.flush()
    expect(docRow(on.sqlDb).version).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
