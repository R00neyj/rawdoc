// 알림 API — 목록·읽음. worker/index.ts 를 통째로 (specs/features/F-503.md 6.5·6.6, 7.5 A4~A6)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from './testD1'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
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
