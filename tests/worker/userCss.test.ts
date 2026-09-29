// 사용자 CSS 서버 저장 라우트 — worker/index.ts 를 통째로 (specs/features/F-3010.md 6장 C1~C12)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const OTHER = 'other@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeWorld() {
  const sqlDb = openTestDb()
  const base = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) } }
  const owner = { ...base, DEV_AUTH_EMAIL: OWNER } as unknown as Env
  const other = { ...base, DEV_AUTH_EMAIL: OTHER } as unknown as Env
  const anon = { DB: asAuthDb(openTestDb()), BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 's'.repeat(40) } as unknown as Env
  return { sqlDb, owner, other, anon }
}

function call(env: Env, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}/api/user-css`, { ...init, headers }), env, ctx)
}

function put(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

async function userId(env: Env, sqlDb: DatabaseSync, email: string): Promise<string> {
  await worker.fetch(new Request(`${ORIGIN}/api/me`, { headers: { Origin: ORIGIN } }), env, ctx)
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

function writeCount(sqlDb: DatabaseSync, email = OWNER): number {
  const row = sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(email) as { write_count: number } | undefined
  return row?.write_count ?? 0
}

const snip = (over: Record<string, unknown> = {}) => ({ id: '0123456789abcdef', name: 'a', css: 'a{}', enabled: true, updatedAt: 1, ...over })
const hex = (i: number) => i.toString(16).padStart(16, '0')

describe('F-3010 GET·PUT /api/user-css', () => {
  it('C1 행 없는 사용자 GET', async () => {
    const { owner, sqlDb } = makeWorld()
    const res = await call(owner)
    const id = await userId(owner, sqlDb, OWNER)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ snippets: [], rev: 0 })
    expect(res.headers.get('ETag')).toBe(`"c1-${id}-0"`)
  })

  it('C2 PUT 뒤 GET', async () => {
    const { owner, sqlDb } = makeWorld()
    const put1 = await call(owner, put({ snippets: [snip()], baseRev: 0 }))
    expect(put1.status).toBe(200)
    expect(await put1.json()).toEqual({ rev: 1 })
    const res = await call(owner)
    const id = await userId(owner, sqlDb, OWNER)
    expect(await res.json()).toEqual({ snippets: [snip()], rev: 1 })
    expect(res.headers.get('ETag')).toBe(`"c1-${id}-1"`)
  })

  it('C3 If-None-Match', async () => {
    const { owner, sqlDb } = makeWorld()
    await call(owner, put({ snippets: [snip()], baseRev: 0 }))
    const id = await userId(owner, sqlDb, OWNER)
    const hit = await call(owner, { headers: { 'If-None-Match': `"c1-${id}-1"` } })
    expect(hit.status).toBe(304)
    expect(await hit.text()).toBe('')
    expect(hit.headers.get('ETag')).toBe(`"c1-${id}-1"`)
    expect((await call(owner, { headers: { 'If-None-Match': `W/"c1-${id}-1"` } })).status).toBe(304)
    expect((await call(owner, { headers: { 'If-None-Match': `"c1-${id}-0"` } })).status).toBe(200)
    expect((await call(owner, { headers: { 'If-None-Match': '"c1-other-1"' } })).status).toBe(200)
  })

  it('C4 baseRev 1 로 다시 PUT', async () => {
    const { owner } = makeWorld()
    await call(owner, put({ snippets: [snip()], baseRev: 0 }))
    const res = await call(owner, put({ snippets: [snip({ css: 'b{}' })], baseRev: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 2 })
  })

  it('C5 충돌은 409 이고 하루 카운터가 오르지 않는다', async () => {
    const { owner, other, sqlDb } = makeWorld()
    await call(owner, put({ snippets: [snip()], baseRev: 0 }))
    await call(owner, put({ snippets: [snip()], baseRev: 1 }))
    expect(writeCount(sqlDb)).toBe(2)
    for (const baseRev of [1, 0]) {
      const res = await call(owner, put({ snippets: [snip()], baseRev }))
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'conflict', rev: 2 })
    }
    const fresh = await call(other, put({ snippets: [snip()], baseRev: 3 }))
    expect(fresh.status).toBe(409)
    expect(await fresh.json()).toEqual({ error: 'conflict', rev: 0 })
    expect(writeCount(sqlDb)).toBe(2)
    expect(writeCount(sqlDb, OTHER)).toBe(0)
  })

  it('C6 주인만', async () => {
    const { owner, other, sqlDb } = makeWorld()
    await call(owner, put({ snippets: [snip()], baseRev: 0 }))
    const before = sqlDb.prepare('SELECT * FROM user_css').all()
    expect(await (await call(other)).json()).toEqual({ snippets: [], rev: 0 })
    const res = await call(other, put({ snippets: [snip({ css: 'b{}' })], baseRev: 0 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rev: 1 })
    const a = await userId(owner, sqlDb, OWNER)
    expect(sqlDb.prepare('SELECT * FROM user_css WHERE user_id = ?').all(a)).toEqual(before)
  })

  it('C7 검증 실패', async () => {
    const { owner } = makeWorld()
    const expectErr = async (body: unknown, status: number, json: unknown) => {
      const res = await call(owner, put(body))
      expect([JSON.stringify(body).slice(0, 40), res.status, await res.json()]).toEqual([JSON.stringify(body).slice(0, 40), status, json])
    }
    await expectErr([], 400, { error: 'invalid' })
    await expectErr('"x"', 400, { error: 'invalid' })
    await expectErr({ snippets: 'x', baseRev: 0 }, 400, { error: 'invalid', field: 'snippets' })
    const fiftyOne = Array.from({ length: 51 }, (_, i) => snip({ id: hex(i) }))
    await expectErr({ snippets: fiftyOne, baseRev: 0 }, 400, { error: 'invalid', field: 'snippets' })
    await expectErr({ snippets: [snip(), snip({ id: 'ABCDEF0123456789' })], baseRev: 0 }, 400, { error: 'invalid', field: 'snippets[1].id' })
    await expectErr({ snippets: [snip({ name: 'a'.repeat(61) })], baseRev: 0 }, 400, { error: 'invalid', field: 'snippets[0].name' })
    await expectErr({ snippets: [snip({ css: 'a'.repeat(262_145) })], baseRev: 0 }, 413, { error: 'too_large', limit: 262144 })
    await expectErr({ snippets: [snip()], baseRev: -1 }, 400, { error: 'invalid', field: 'baseRev' })
    await expectErr({ snippets: [snip()], baseRev: 1.5 }, 400, { error: 'invalid', field: 'baseRev' })
    await expectErr({ snippets: [snip()] }, 400, { error: 'invalid', field: 'baseRev' })
  })

  it('C8 몸통 상한 초과', async () => {
    const { owner, sqlDb } = makeWorld()
    const res = await call(owner, put('{}', { 'Content-Length': '540673' }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large', limit: 262144 })
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM user_css').get()).toEqual({ n: 0 })
  })

  it('C9 경계 — 50개·262,144 바이트, 이스케이프 2배 몸통', async () => {
    const { owner } = makeWorld()
    const plain = Array.from({ length: 50 }, (_, i) => snip({ id: hex(i), css: 'a'.repeat(5242) }))
    plain[0].css += 'a'.repeat(262_144 - 5242 * 50)
    expect((await call(owner, put({ snippets: plain, baseRev: 0 }))).status).toBe(200)

    const heavy = Array.from({ length: 50 }, (_, i) =>
      snip({ id: hex(i), name: '가'.repeat(60), css: '"'.repeat(5242), updatedAt: Number.MAX_SAFE_INTEGER }),
    )
    heavy[0].css += '"'.repeat(262_144 - 5242 * 50)
    const body = JSON.stringify({ snippets: heavy, baseRev: Number.MAX_SAFE_INTEGER })
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(500_000)
    const { owner: o2 } = makeWorld()
    expect((await call(o2, put({ snippets: heavy, baseRev: 0 }))).status).toBe(200)
  })

  it('C10 모르는 키는 저장하지 않는다', async () => {
    const { owner } = makeWorld()
    await call(owner, put({ snippets: [{ ...snip(), extra: 1 }], baseRev: 0 }))
    const body = (await (await call(owner)).json()) as { snippets: Record<string, unknown>[] }
    expect(Object.keys(body.snippets[0]).sort()).toEqual(['css', 'enabled', 'id', 'name', 'updatedAt'])
  })

  it('C11 로그인 없이', async () => {
    const { anon } = makeWorld()
    for (const init of [{}, put({ snippets: [], baseRev: 0 })]) {
      const res = await call(anon, init)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthenticated' })
    }
  })

  it('C12 막힌 계정은 읽기만', async () => {
    const { owner, sqlDb } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(Date.now(), id)
    expect((await call(owner)).status).toBe(200)
    const res = await call(owner, put({ snippets: [], baseRev: 0 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_blocked' })
  })
})
