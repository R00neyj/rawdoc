// 댓글 API — 접근 집합·댓글 수·로그인 이관. worker/index.ts 를 통째로 (specs/features/F-503.md 6.2~6.4, 7.5 A1~A3)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asAuthDb, asD1, openTestDb } from './testD1'

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
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const EDITOR = 'bob@example.com'
const STRANGER = 'zed@example.com'
const DOC = '44444444-4444-4444-8444-444444444444'
const VAULT = '55555555-5555-4555-8555-555555555555'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

type RoomResult = { type: string; imported?: number; orphaned?: number } | Error

function makeWorld() {
  const sqlDb = openTestDb()
  const DB = asD1(sqlDb)
  const room = { next: { type: 'ok', imported: 1, orphaned: 0 } as RoomResult }
  const importComments = vi.fn(async () => {
    if (room.next instanceof Error) throw room.next
    return room.next
  })
  const getByName = vi.fn(() => ({ importComments, async revalidateConnections() {}, async purgeRoom() {} }))
  const base = { DB, BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) }, DOC_ROOM: { getByName } }
  const as = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  return { sqlDb, as, room, importComments, getByName }
}

// 로그인 없음 — 개발 우회 없이 better-auth 세션을 본다
function anonEnv(): Env {
  return { DB: asAuthDb(openTestDb()), BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 's'.repeat(40) } as unknown as Env
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

async function userId(w: ReturnType<typeof makeWorld>, email: string): Promise<string> {
  await call(w.as(email), '/api/me')
  return (w.sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

async function seedDocs(w: ReturnType<typeof makeWorld>) {
  const owner = await userId(w, OWNER)
  const insert = w.sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?)')
  insert.run(DOC, owner, '회의록', 'hello world\n', 'lf', 4, 1, 1, null)
  insert.run(VAULT, owner, '', 'cipher', 'lf', 1, 1, 1, 'A'.repeat(55) + '=')
  const grant = w.sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
  grant.run('doc', DOC, owner, FRIEND, 'view', 1)
  grant.run('doc', DOC, owner, EDITOR, 'edit', 1)
  return owner
}

function commentRow(sqlDb: DatabaseSync, id: string, parent: string | null, resolvedAt: number | null) {
  sqlDb
    .prepare('INSERT INTO doc_comments (doc_id, id, parent_id, body, created_at, resolved_at, bytes, sig, anchor_sig) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(DOC, id, parent, 'b', 1, resolvedAt, 1, 's', 'a')
}

const writeCount = (sqlDb: DatabaseSync, email: string) =>
  (sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(email) as { write_count: number }).write_count

function record(id: string, parent: string | null = null) {
  return {
    id,
    parent,
    body: '기록',
    mentions: [],
    authorId: null,
    authorEmail: null,
    createdAt: 1,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: parent ? '' : 'hello',
    prefix: '',
    suffix: '',
    anchorFrom: parent ? null : 0,
    anchorLength: parent ? null : 5,
  }
}

describe('F-503 A1 GET /api/docs/:id/people', () => {
  it('소유자 / view 초대자 → 200 loadDocPeople 순서(요청자 포함), 남 → 404, 금고 → 409, 로그인 없음 → 401', async () => {
    const w = makeWorld()
    await seedDocs(w)
    const people = [
      { email: OWNER, role: 'owner' },
      { email: EDITOR, role: 'edit' },
      { email: FRIEND, role: 'view' },
    ]
    for (const email of [OWNER, FRIEND]) {
      const res = await call(w.as(email), `/api/docs/${DOC}/people`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ people })
    }
    const stranger = await call(w.as(STRANGER), `/api/docs/${DOC}/people`)
    expect([stranger.status, await stranger.json()]).toEqual([404, { error: 'not_found' }])
    const vault = await call(w.as(OWNER), `/api/docs/${VAULT}/people`)
    expect([vault.status, await vault.json()]).toEqual([409, { error: 'e2ee_doc' }])
    const anon = await call(anonEnv(), `/api/docs/${DOC}/people`)
    expect([anon.status, await anon.json()]).toEqual([401, { error: 'unauthenticated' }])
  })
})

describe('F-503 A2 GET /api/docs/:id/comments/count', () => {
  it('첫 댓글 2(하나 해결)·답글 3 → {5, 1} / 행 없음 → {0, 0} / 금고 → 409', async () => {
    const w = makeWorld()
    await seedDocs(w)
    expect(await (await call(w.as(FRIEND), `/api/docs/${DOC}/comments/count`)).json()).toEqual({ total: 0, open: 0 })
    commentRow(w.sqlDb, 'r1', null, null)
    commentRow(w.sqlDb, 'r2', null, 99)
    commentRow(w.sqlDb, 'a1', 'r1', null)
    commentRow(w.sqlDb, 'a2', 'r1', null)
    commentRow(w.sqlDb, 'a3', 'r2', null)
    const res = await call(w.as(OWNER), `/api/docs/${DOC}/comments/count`)
    expect([res.status, await res.json()]).toEqual([200, { total: 5, open: 1 }])
    expect((await call(w.as(OWNER), `/api/docs/${VAULT}/comments/count`)).status).toBe(409)
  })
})

describe('F-503 A3 POST /api/docs/:id/comments/import', () => {
  const path = `/api/docs/${DOC}/comments/import`

  it('판정 순서와 응답', async () => {
    const w = makeWorld()
    await seedDocs(w)
    const owner = w.as(OWNER)
    const expectRes = async (res: Promise<Response>, status: number, body: unknown) => {
      const r = await res
      expect([r.status, r.status === 204 ? null : await r.json()]).toEqual([status, body])
    }
    await expectRes(call(w.as(EDITOR), path, post({ records: [record('r1')] })), 403, { error: 'forbidden' })
    await expectRes(call(owner, path, post('{"records":')), 400, { error: 'invalid' })
    await expectRes(call(owner, path, post('{}', { 'Content-Length': '5000001' })), 413, { error: 'too_large', limit: 5_000_000 })
    await expectRes(call(owner, path, post({ records: [], extra: 1 })), 400, { error: 'invalid' })
    await expectRes(call(owner, path, post({ records: Array.from({ length: 501 }, (_, i) => record(`r${i}`)) })), 413, { error: 'too_many', limit: 500 })
    await expectRes(call(owner, path, post({ records: [{ ...record('r1'), body: '' }] })), 400, { error: 'invalid' })
    await expectRes(call(owner, path, post({ records: [] })), 200, { imported: 0, orphaned: 0 })
    expect(w.importComments).not.toHaveBeenCalled()

    const before = writeCount(w.sqlDb, OWNER)
    w.room.next = { type: 'ok', imported: 2, orphaned: 1 }
    await expectRes(call(owner, path, post({ records: [record('r1'), record('a1', 'r1')] })), 200, { imported: 2, orphaned: 1 })
    expect(writeCount(w.sqlDb, OWNER)).toBe(before + 1)
    expect(w.getByName).toHaveBeenCalledWith(DOC)
    expect(w.importComments).toHaveBeenLastCalledWith({
      records: [record('r1'), record('a1', 'r1')],
      user: { id: expect.any(String), email: OWNER },
      docVersion: 4,
    })

    w.room.next = { type: 'exists' }
    await expectRes(call(owner, path, post({ records: [record('r1')] })), 409, { error: 'comments_exist' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    w.room.next = new Error('rpc down')
    await expectRes(call(owner, path, post({ records: [record('r1')] })), 503, { error: 'unavailable' })
    w.room.next = { type: 'not_found' }
    await expectRes(call(owner, path, post({ records: [record('r1')] })), 404, { error: 'not_found' })
    w.room.next = { type: 'unavailable' }
    await expectRes(call(owner, path, post({ records: [record('r1')] })), 503, { error: 'unavailable' })
  })

  it('금고 문서 → 409 e2ee_doc, 없는 문서 → 404', async () => {
    const w = makeWorld()
    await seedDocs(w)
    const vault = await call(w.as(OWNER), `/api/docs/${VAULT}/comments/import`, post({ records: [record('r1')] }))
    expect([vault.status, await vault.json()]).toEqual([409, { error: 'e2ee_doc' }])
    const missing = await call(w.as(OWNER), `/api/docs/66666666-6666-4666-8666-666666666666/comments/import`, post({ records: [] }))
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }])
  })
})
