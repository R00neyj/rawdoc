// 알림 API — 목록·읽음. worker/index.ts 를 통째로 (specs/features/F-503.md 6.5·6.6, 7.5 A4~A6)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const ME = 'me@example.com'
const OTHER = 'other@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeWorld() {
  const sqlDb = openTestDb()
  const env = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: ME, WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function note(sqlDb: DatabaseSync, n: number, recipient: string, createdAt: number, readAt: number | null = null) {
  sqlDb
    .prepare(
      'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(uuid(n), recipient, n % 2 ? 'mention' : 'reply', 'd1', `c${n}`, 't1', 'actor@example.com', n === 1 ? '' : '회의록', `발췌 ${n}`, createdAt, readAt)
}

const readAt = (sqlDb: DatabaseSync, n: number) => (sqlDb.prepare('SELECT read_at FROM notifications WHERE id = ?').get(uuid(n)) as { read_at: number | null }).read_at

describe('F-503 A4 GET /api/notifications', () => {
  it('내 것만 새것부터, limit, 잘못된 limit 은 400 field limit, 없으면 30 까지, unread 는 내 안 읽은 수', async () => {
    const w = makeWorld()
    note(w.sqlDb, 1, ME, 100)
    note(w.sqlDb, 2, ME, 300, 5)
    note(w.sqlDb, 3, ME, 300)
    note(w.sqlDb, 4, OTHER, 400)
    note(w.sqlDb, 5, OTHER, 500)
    const res = await call(w.env, '/api/notifications')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string }[]; unread: number }
    expect(body.items.map((i) => i.id)).toEqual([uuid(3), uuid(2), uuid(1)])
    expect(body.unread).toBe(2)
    expect(body.items[2]).toEqual({
      id: uuid(1),
      kind: 'mention',
      docId: 'd1',
      commentId: 'c1',
      threadId: 't1',
      actorEmail: 'actor@example.com',
      docTitle: '',
      excerpt: '발췌 1',
      createdAt: 100,
      readAt: null,
    })
    const two = (await (await call(w.env, '/api/notifications?limit=2')).json()) as { items: unknown[]; unread: number }
    expect(two.items).toHaveLength(2)
    expect(two.unread).toBe(2)
    for (const bad of ['0', '51', 'abc', '', '1.5']) {
      const r = await call(w.env, `/api/notifications?limit=${bad}`)
      expect([r.status, await r.json()], bad).toEqual([400, { error: 'invalid', field: 'limit' }])
    }
    for (let n = 10; n < 45; n++) note(w.sqlDb, n, ME, 1000 + n)
    const all = (await (await call(w.env, '/api/notifications')).json()) as { items: unknown[] }
    expect(all.items).toHaveLength(30)
    const max = (await (await call(w.env, '/api/notifications?limit=50')).json()) as { items: unknown[] }
    expect(max.items).toHaveLength(38)
  })
})

describe('F-503 A5 POST /api/notifications/read', () => {
  it('ids 는 내 것만, all 은 내 안 읽은 것 전부, 이미 읽은 행 불변, 모양이 틀리면 400', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(9_000)
    try {
      const w = makeWorld()
      note(w.sqlDb, 1, ME, 100)
      note(w.sqlDb, 2, ME, 200)
      note(w.sqlDb, 3, ME, 300, 7)
      note(w.sqlDb, 4, OTHER, 400)
      const first = await call(w.env, '/api/notifications/read', post({ ids: [uuid(1), uuid(4)] }))
      expect(first.status).toBe(204)
      expect(await first.text()).toBe('')
      expect([readAt(w.sqlDb, 1), readAt(w.sqlDb, 2), readAt(w.sqlDb, 4)]).toEqual([9_000, null, null])
      vi.setSystemTime(10_000)
      expect((await call(w.env, '/api/notifications/read', post({ all: true }))).status).toBe(204)
      expect([readAt(w.sqlDb, 1), readAt(w.sqlDb, 2), readAt(w.sqlDb, 3), readAt(w.sqlDb, 4)]).toEqual([9_000, 10_000, 7, null])
      const bad: unknown[] = [
        { ids: [] },
        { ids: Array.from({ length: 51 }, (_, i) => uuid(100 + i)) },
        { ids: ['not-a-uuid'] },
        { all: true, ids: [] },
        { all: false },
      ]
      for (const body of bad) {
        const r = await call(w.env, '/api/notifications/read', post(body))
        expect([r.status, await r.json()]).toEqual([400, { error: 'invalid' }])
      }
      const big = await call(w.env, '/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '8193' },
        body: '{}',
      })
      expect([big.status, await big.json()]).toEqual([413, { error: 'too_large', limit: 8192 }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('성공하면 write_count 가 1 오른다', async () => {
    const w = makeWorld()
    await call(w.env, '/api/me')
    const count = () => (w.sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(ME) as { write_count: number }).write_count
    const before = count()
    expect((await call(w.env, '/api/notifications/read', post({ all: true }))).status).toBe(204)
    expect(count()).toBe(before + 1)
  })
})

describe('F-503 A6 막힌 계정', () => {
  it('POST read → 403 account_blocked, GET → 200', async () => {
    const w = makeWorld()
    await call(w.env, '/api/me')
    w.sqlDb.prepare('UPDATE users SET blocked_at = 1 WHERE email = ?').run(ME)
    const read = await call(w.env, '/api/notifications/read', post({ all: true }))
    expect([read.status, await read.json()]).toEqual([403, { error: 'account_blocked' }])
    expect((await call(w.env, '/api/notifications')).status).toBe(200)
  })
})

// ----- F-2057 ETag·304·리비전 -----

type NotificationsModule = typeof import('../../worker/notifications')
let notificationsMod: NotificationsModule

beforeAll(async () => {
  notificationsMod = await import('../../worker/notifications')
})

const myId = (sqlDb: DatabaseSync) => (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(ME) as { id: string }).id
const myRev = (sqlDb: DatabaseSync) => (sqlDb.prepare('SELECT notif_rev AS n FROM users WHERE email = ?').get(ME) as { n: number }).n
const myWrites = (sqlDb: DatabaseSync) => (sqlDb.prepare('SELECT write_count AS n FROM users WHERE email = ?').get(ME) as { n: number }).n

async function worldWithMe() {
  const w = makeWorld()
  await call(w.env, '/api/me')
  return { ...w, id: myId(w.sqlDb) }
}

function countNotificationQueries(env: Env): { n: number } {
  const counter = { n: 0 }
  const prepare = env.DB.prepare.bind(env.DB)
  env.DB.prepare = ((sql: string) => {
    if (sql.includes('notifications')) counter.n++
    return prepare(sql)
  }) as typeof env.DB.prepare
  return counter
}

const ifNoneMatch = (value: string): RequestInit => ({ headers: { 'If-None-Match': value } })

describe('F-2057 U1 ETag 싣기', () => {
  it('200 에 W/"n1-{id}-{rev}-30", ?limit=5 면 -5, Cache-Control no-store 유지', async () => {
    const w = await worldWithMe()
    note(w.sqlDb, 1, ME, 100)
    const res = await call(w.env, '/api/notifications')
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-30"`)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const five = await call(w.env, '/api/notifications?limit=5')
    expect(five.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-5"`)
    w.sqlDb.prepare('UPDATE users SET notif_rev = 7 WHERE email = ?').run(ME)
    expect((await call(w.env, '/api/notifications')).headers.get('ETag')).toBe(`W/"n1-${w.id}-7-30"`)
  })
})

describe('F-2057 U2 304', () => {
  it('강한 모양·W/ 모양·목록 → 304, 본문 0바이트, ETag·no-store, notifications 질의 0', async () => {
    const w = await worldWithMe()
    note(w.sqlDb, 1, ME, 100)
    const etag = `W/"n1-${w.id}-0-30"`
    const counter = countNotificationQueries(w.env)
    for (const value of [`"n1-${w.id}-0-30"`, etag, `"x", ${etag}`]) {
      const res = await call(w.env, '/api/notifications', ifNoneMatch(value))
      expect(res.status, value).toBe(304)
      expect((await res.arrayBuffer()).byteLength).toBe(0)
      expect(res.headers.get('ETag')).toBe(etag)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(counter.n).toBe(0)
  })
})

describe('F-2057 U3 빗나감', () => {
  it('* · 다른 리비전 · 다른 limit · 쓰레기 → 200 + 목록', async () => {
    const w = await worldWithMe()
    note(w.sqlDb, 1, ME, 100)
    for (const value of ['*', `W/"n1-${w.id}-1-30"`, `W/"n1-${w.id}-0-5"`, 'garbage', '']) {
      const res = await call(w.env, '/api/notifications', ifNoneMatch(value))
      expect(res.status, value).toBe(200)
      const body = (await res.json()) as { items: unknown[]; unread: number }
      expect(body.items).toHaveLength(1)
    }
  })

  it('다른 사용자 id 는 맞지 않는다 — notificationsEtag·ifNoneMatchHits', () => {
    const { notificationsEtag, ifNoneMatchHits } = notificationsMod
    const mine = notificationsEtag({ userId: 'u1', rev: 0, limit: 30 })
    const theirs = notificationsEtag({ userId: 'u2', rev: 0, limit: 30 })
    expect(mine).toBe('W/"n1-u1-0-30"')
    expect(ifNoneMatchHits(theirs, mine)).toBe(false)
    expect(ifNoneMatchHits(mine, mine)).toBe(true)
    expect(ifNoneMatchHits(' "a" ,  "n1-u1-0-30" ', mine)).toBe(true)
    expect(ifNoneMatchHits('*', mine)).toBe(false)
    expect(ifNoneMatchHits(null, mine)).toBe(false)
    expect(ifNoneMatchHits('', mine)).toBe(false)
  })
})

describe('F-2057 U4 읽음이 바꾼 때만 리비전', () => {
  it('안 읽은 것 하나 → +1, 같은 ids 다시 → 그대로, 안 읽은 것 없을 때 all → 그대로, 남의 id → 그대로. write_count 는 매번 +1', async () => {
    const w = await worldWithMe()
    note(w.sqlDb, 1, ME, 100)
    note(w.sqlDb, 2, OTHER, 200)
    const rev0 = myRev(w.sqlDb)
    const writes0 = myWrites(w.sqlDb)
    expect((await call(w.env, '/api/notifications/read', post({ ids: [uuid(1)] }))).status).toBe(204)
    expect([myRev(w.sqlDb), myWrites(w.sqlDb)]).toEqual([rev0 + 1, writes0 + 1])
    expect((await call(w.env, '/api/notifications/read', post({ ids: [uuid(1)] }))).status).toBe(204)
    expect([myRev(w.sqlDb), myWrites(w.sqlDb)]).toEqual([rev0 + 1, writes0 + 2])
    expect((await call(w.env, '/api/notifications/read', post({ all: true }))).status).toBe(204)
    expect([myRev(w.sqlDb), myWrites(w.sqlDb)]).toEqual([rev0 + 1, writes0 + 3])
    expect((await call(w.env, '/api/notifications/read', post({ ids: [uuid(2)] }))).status).toBe(204)
    expect([myRev(w.sqlDb), myWrites(w.sqlDb)]).toEqual([rev0 + 1, writes0 + 4])
  })
})

describe('F-2057 U5 읽음 뒤 옛 ETag', () => {
  it('200 과 새 ETag', async () => {
    const w = await worldWithMe()
    note(w.sqlDb, 1, ME, 100)
    const old = (await call(w.env, '/api/notifications')).headers.get('ETag')!
    expect((await call(w.env, '/api/notifications/read', post({ all: true }))).status).toBe(204)
    const res = await call(w.env, '/api/notifications', ifNoneMatch(old))
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBe(`W/"n1-${w.id}-1-30"`)
    expect(((await res.json()) as { unread: number }).unread).toBe(0)
  })
})

// ----- F-3005 comment 종류·?kinds=·읽음이 push_due_at 지움 -----

type KindNote = { n: number; kind: string; at: number; read?: number | null }

function kindNotes(sqlDb: DatabaseSync, list: KindNote[], recipient = ME) {
  for (const k of list) {
    sqlDb
      .prepare(
        'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(uuid(k.n), recipient, k.kind, 'd1', `c${k.n}`, 't1', 'actor@example.com', '회의록', `발췌 ${k.n}`, k.at, k.read ?? null, 999)
  }
}

const mixed: KindNote[] = [
  { n: 1, kind: 'mention', at: 100 },
  { n: 2, kind: 'reply', at: 200 },
  { n: 3, kind: 'comment', at: 300 },
  { n: 4, kind: 'comment', at: 400 },
]

async function listOf(env: Env, query = '') {
  const res = await call(env, `/api/notifications${query}`)
  return { res, body: (await res.json()) as { items: { id: string; kind: string }[]; unread: number } }
}

describe('F-3005 N1~N4 ?kinds=', () => {
  it('N1 kinds 없음 → mention·reply 만, 옛 모양 ETag', async () => {
    const w = await worldWithMe()
    kindNotes(w.sqlDb, mixed)
    const { res, body } = await listOf(w.env)
    expect(body.items.map((i) => i.kind)).toEqual(['reply', 'mention'])
    expect(body.unread).toBe(2)
    expect(res.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-30"`)
  })

  it('N2 kinds 지정 → 그 종류만, 정규화된 ETag 꼬리', async () => {
    const w = await worldWithMe()
    kindNotes(w.sqlDb, mixed)
    const all = await listOf(w.env, '?kinds=mention,reply,comment')
    expect(all.body.items).toHaveLength(4)
    expect(all.body.unread).toBe(4)
    expect(all.res.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-30-mention.reply.comment"`)
    const dup = await listOf(w.env, '?kinds=comment,reply,mention,comment')
    expect(dup.res.headers.get('ETag')).toBe(all.res.headers.get('ETag'))
    const only = await listOf(w.env, '?kinds=comment')
    expect(only.body.items.map((i) => i.kind)).toEqual(['comment', 'comment'])
    expect(only.body.unread).toBe(2)
    expect(only.res.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-30-comment"`)
    const same = await listOf(w.env, '?kinds=reply,mention')
    expect(same.res.headers.get('ETag')).toBe(`W/"n1-${w.id}-0-30"`)
    expect(same.body.items).toHaveLength(2)
  })

  it('N3 잘못된 kinds → 400 field kinds', async () => {
    const w = await worldWithMe()
    for (const bad of ['', 'mention,,reply', 'like', 'Mention', 'mention,%20reply', 'a'.repeat(65)]) {
      const r = await call(w.env, `/api/notifications?kinds=${bad}`)
      expect([r.status, await r.json()], bad).toEqual([400, { error: 'invalid', field: 'kinds' }])
    }
  })

  it('N4 같은 kinds 의 ETag 는 304, kinds 없는 요청에는 200', async () => {
    const w = await worldWithMe()
    kindNotes(w.sqlDb, mixed)
    const tag = `W/"n1-${w.id}-0-30-mention.reply.comment"`
    const counter = countNotificationQueries(w.env)
    const hit = await call(w.env, '/api/notifications?kinds=mention,reply,comment', ifNoneMatch(tag))
    expect(hit.status).toBe(304)
    expect(counter.n).toBe(0)
    expect((await call(w.env, '/api/notifications', ifNoneMatch(tag))).status).toBe(200)
  })
})

describe('F-3005 N5 읽음이 push_due_at 을 지운다', () => {
  const due = (sqlDb: DatabaseSync, n: number) => (sqlDb.prepare('SELECT push_due_at AS p FROM notifications WHERE id = ?').get(uuid(n)) as { p: number | null }).p

  it('ids 는 그 행만, all 은 종류 무관 전부, 남의 행은 그대로', async () => {
    const w = await worldWithMe()
    kindNotes(w.sqlDb, [
      { n: 1, kind: 'mention', at: 100 },
      { n: 2, kind: 'reply', at: 200 },
      { n: 3, kind: 'comment', at: 300 },
    ])
    kindNotes(w.sqlDb, [{ n: 4, kind: 'comment', at: 400 }], OTHER)
    expect((await call(w.env, '/api/notifications/read', post({ ids: [uuid(1)] }))).status).toBe(204)
    expect([due(w.sqlDb, 1), due(w.sqlDb, 2), due(w.sqlDb, 3)]).toEqual([null, 999, 999])
    expect(readAt(w.sqlDb, 1)).not.toBeNull()
    expect(readAt(w.sqlDb, 2)).toBeNull()
    await call(w.env, '/api/notifications/read', post({ all: true }))
    expect([due(w.sqlDb, 2), due(w.sqlDb, 3)]).toEqual([null, null])
    expect(readAt(w.sqlDb, 3)).not.toBeNull()
    expect([due(w.sqlDb, 4), readAt(w.sqlDb, 4)]).toEqual([999, null])
  })
})
