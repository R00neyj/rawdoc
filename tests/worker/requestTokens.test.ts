// F-4007 T1~T6 조각 링크용 요청 토큰 (specs/features/F-4007.md 5장)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
import { setDocE2eeStatements } from '../../worker/e2eeDocs'
import { purgeAccessRequests } from '../../worker/accessRequests'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const GUEST = 'guest@example.com'
const STRANGER = 'stranger@example.com'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOC_V = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const T0 = Date.parse('2026-10-12T00:00:00Z')
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

type Row = Record<string, unknown>

function world() {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at, name) VALUES (?,?,?,?)')
  user.run('owner', OWNER, 1, '소유자')
  user.run('friend', FRIEND, 1, '친구')
  user.run('guest', GUEST, 1, '손님')
  user.run('stranger', STRANGER, 1, '남')
  const doc = sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, folder_id, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
  doc.run(DOC_A, 'owner', '문서 A', 'c', 'lf', 1, 1, 1, null, null)
  doc.run(DOC_B, 'owner', '문서 B', 'c', 'lf', 1, 1, 1, null, null)
  doc.run(DOC_V, 'owner', '금고', 'c', 'lf', 1, 1, 1, null, 'k')
  sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)').run('doc', DOC_A, 'owner', FRIEND, 'view')
  return sqlDb
}

function envFor(sqlDb: DatabaseSync, email?: string): Env {
  return { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, ...(email ? { DEV_AUTH_EMAIL: email } : {}), WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env
}

function call(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (init.body) headers.set('Content-Type', 'application/json')
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

const issue = (env: Env, docId: string) => call(env, `/api/docs/${docId}/request-token`, { method: 'POST' })
const status = (env: Env, token: string, docId?: string) => call(env, `/api/access-requests/link/${token}${docId ? `?docId=${docId}` : ''}`)
const post = (env: Env, token: string, role: string, docId?: string) =>
  call(env, `/api/access-requests/link/${token}`, { method: 'POST', body: JSON.stringify({ role, ...(docId ? { docId } : {}) }) })
const cancel = (env: Env, token: string) => call(env, `/api/access-requests/link/${token}`, { method: 'DELETE' })
const approve = (env: Env, id: string) => call(env, `/api/access-requests/${id}/approve`, { method: 'POST' })

const tokens = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT * FROM request_tokens ORDER BY created_at, token').all() as Row[]
const requests = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT * FROM access_requests').all() as Row[]
const count = (sqlDb: DatabaseSync, sql: string) => (sqlDb.prepare(sql).get() as { n: number }).n
const writeCount = (sqlDb: DatabaseSync, id = 'owner') => (sqlDb.prepare('SELECT write_count AS n FROM users WHERE id = ?').get(id) as { n: number }).n

async function issued(sqlDb: DatabaseSync, docId = DOC_A): Promise<string> {
  const res = await issue(envFor(sqlDb, OWNER), docId)
  return ((await res.json()) as { token: string }).token
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('F-4007 T1 마이그레이션 0026', () => {
  it('같은 문서에 살아 있는 행 둘 거부, 끊긴 행 + 새 행은 받음', () => {
    const sqlDb = openTestDb('0025')
    sqlDb.exec(readFileSync(fileURLToPath(new URL('../../migrations/0026_request_tokens.sql', import.meta.url)), 'utf-8'))
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('owner', OWNER)
    const insert = sqlDb.prepare('INSERT INTO request_tokens (token, owner_id, doc_id, created_at, revoked_at) VALUES (?,?,?,1,?)')
    insert.run('t1', 'owner', DOC_A, null)
    expect(() => insert.run('t2', 'owner', DOC_A, null)).toThrow()
    insert.run('t3', 'owner', DOC_B, 5)
    insert.run('t4', 'owner', DOC_B, null)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM request_tokens')).toBe(3)
  })
})

describe('F-4007 T2 발급', () => {
  it('주인 첫 POST 201·행 1·write_count +1, 다시 200·같은 토큰·write_count 그대로', async () => {
    const sqlDb = world()
    const before = writeCount(sqlDb)
    const first = await issue(envFor(sqlDb, OWNER), DOC_A)
    expect(first.status).toBe(201)
    const { token } = (await first.json()) as { token: string }
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokens(sqlDb)).toMatchObject([{ token, owner_id: 'owner', doc_id: DOC_A, created_at: T0, revoked_at: null }])
    expect(writeCount(sqlDb)).toBe(before + 1)

    const again = await issue(envFor(sqlDb, OWNER), DOC_A)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ token })
    expect(tokens(sqlDb)).toHaveLength(1)
    expect(writeCount(sqlDb)).toBe(before + 1)
  })

  it('사전 조회 뒤 다른 요청이 먼저 넣은 경우 — 500 없이 그 토큰을 200 으로 돌려준다', async () => {
    const sqlDb = world()
    const winner = await issued(sqlDb)
    const env = envFor(sqlDb, OWNER)
    const real = env.DB
    let missed = false
    env.DB = new Proxy(real, {
      get(target, prop) {
        const value = Reflect.get(target, prop)
        if (prop !== 'prepare') return typeof value === 'function' ? value.bind(target) : value
        return (sql: string) => {
          if (!missed && sql.startsWith('SELECT token FROM request_tokens')) {
            missed = true
            return { bind: () => ({ first: async () => null }) }
          }
          return target.prepare(sql)
        }
      },
    })
    const res = await issue(env, DOC_A)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ token: winner })
    expect(tokens(sqlDb)).toHaveLength(1)
  })

  it('받은 사람 403, 남 404, 없는 문서 404, 금고 409, 로그아웃 401 — 행은 늘지 않는다', async () => {
    const sqlDb = world()
    expect((await issue(envFor(sqlDb, FRIEND), DOC_A)).status).toBe(403)
    expect((await issue(envFor(sqlDb, STRANGER), DOC_A)).status).toBe(404)
    expect((await issue(envFor(sqlDb, OWNER), crypto.randomUUID())).status).toBe(404)
    const vault = await issue(envFor(sqlDb, OWNER), DOC_V)
    expect(vault.status).toBe(409)
    expect(await vault.json()).toEqual({ error: 'e2ee_doc' })
    const anon = { DB: asAuthDb(sqlDb), BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 's'.repeat(40), WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env
    expect((await issue(anon, DOC_A)).status).toBe(401)
    expect(tokens(sqlDb)).toHaveLength(0)
  })
})

describe('F-4007 T3 요청 토큰으로 권한 요청', () => {
  it('상태·요청·취소가 그 문서를 대상으로 하고 docId 는 무시, /pub 은 404', async () => {
    const sqlDb = world()
    const token = await issued(sqlDb)
    const guest = envFor(sqlDb, GUEST)

    const state = await status(guest, token, DOC_B)
    expect(state.status).toBe(200)
    expect(await state.json()).toMatchObject({ target: 'doc', owner: false, request: null })

    const created = await post(guest, token, 'view', DOC_B)
    expect(created.status).toBe(201)
    expect(requests(sqlDb)).toMatchObject([{ target_type: 'doc', target_id: DOC_A, owner_id: 'owner', token, requester_id: 'guest', status: 'pending' }])
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE kind = 'access_request'")).toBe(1)

    expect((await cancel(guest, token)).status).toBe(204)
    expect(requests(sqlDb)).toHaveLength(0)

    expect((await call(guest, `/pub/docs/${token}`)).status).toBe(404)
  })
})

describe('F-4007 T4 끊기', () => {
  const setup = async () => {
    const sqlDb = world()
    const token = await issued(sqlDb)
    expect((await post(envFor(sqlDb, GUEST), token, 'view')).status).toBe(201)
    return { sqlDb, token }
  }
  const expectRevoked = async (sqlDb: DatabaseSync, token: string) => {
    expect(tokens(sqlDb)).toMatchObject([{ token, revoked_at: expect.any(Number) }])
    expect(requests(sqlDb)).toHaveLength(0)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE kind = 'access_request'")).toBe(0)
    expect((await status(envFor(sqlDb, GUEST), token)).status).toBe(404)
  }

  it('문서 영구 삭제 — 휴지통 뒤 DELETE /api/trash/:id (F-3023)', async () => {
    const { sqlDb, token } = await setup()
    expect((await call(envFor(sqlDb, OWNER), `/api/docs/${DOC_A}`, { method: 'DELETE' })).status).toBe(204)
    expect(tokens(sqlDb)).toMatchObject([{ token, revoked_at: null }])
    expect((await call(envFor(sqlDb, OWNER), `/api/trash/${DOC_A}`, { method: 'DELETE' })).status).toBe(204)
    await expectRevoked(sqlDb, token)
  })

  it('휴지통 비우기 (F-3023)', async () => {
    const { sqlDb, token } = await setup()
    expect((await call(envFor(sqlDb, OWNER), `/api/docs/${DOC_A}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(envFor(sqlDb, OWNER), '/api/trash', { method: 'DELETE' })).status).toBe(200)
    await expectRevoked(sqlDb, token)
  })

  it('금고로 옮기기', async () => {
    const { sqlDb, token } = await setup()
    const db = asD1(sqlDb)
    await db.batch(setDocE2eeStatements(db, { docId: DOC_A, ownerId: 'owner', title: 't', content: 'c', e2eeKey: 'wrapped', attachmentRefs: [], baseVersion: 1, now: T0, deltaBytes: 0 }))
    await expectRevoked(sqlDb, token)
  })
})

describe('F-4007 T5 승인', () => {
  it('요청 토큰으로 만든 요청도 grants 행이 생기고, 토큰을 끊은 뒤 승인은 404', async () => {
    const sqlDb = world()
    const token = await issued(sqlDb)
    await post(envFor(sqlDb, GUEST), token, 'edit')
    const [{ id }] = requests(sqlDb) as { id: string }[]
    const ok = await approve(envFor(sqlDb, OWNER), id)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ email: GUEST, role: 'edit' })
    expect(sqlDb.prepare("SELECT grantee_email, role FROM grants WHERE target_id = ? AND grantee_email = ?").all(DOC_A, GUEST)).toEqual([{ grantee_email: GUEST, role: 'edit' }])

    await post(envFor(sqlDb, STRANGER), token, 'view')
    const [{ id: pending }] = requests(sqlDb) as { id: string }[]
    sqlDb.prepare('UPDATE request_tokens SET revoked_at = ? WHERE token = ?').run(T0, token)
    expect((await approve(envFor(sqlDb, OWNER), pending)).status).toBe(404)
    expect(sqlDb.prepare('SELECT 1 FROM grants WHERE grantee_email = ?').get(STRANGER)).toBeUndefined()
    await purgeAccessRequests(envFor(sqlDb), T0)
    expect(requests(sqlDb)).toHaveLength(0)
  })
})

describe('F-4007 T6 계정 삭제·막힘', () => {
  it('주인 계정 삭제 204 뒤 request_tokens 행 0', async () => {
    const sqlDb = world()
    await issued(sqlDb)
    await issued(sqlDb, DOC_B)
    expect((await call(envFor(sqlDb, OWNER), '/api/account', { method: 'DELETE' })).status).toBe(204)
    expect(tokens(sqlDb)).toHaveLength(0)
  })

  it('주인이 막히면 상태 404, 풀리면 다시 200', async () => {
    const sqlDb = world()
    const token = await issued(sqlDb)
    sqlDb.prepare('UPDATE users SET blocked_at = 1 WHERE id = ?').run('owner')
    expect((await status(envFor(sqlDb, GUEST), token)).status).toBe(404)
    sqlDb.prepare('UPDATE users SET blocked_at = NULL WHERE id = ?').run('owner')
    expect((await status(envFor(sqlDb, GUEST), token)).status).toBe(200)
  })
})
