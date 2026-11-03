// 계정 설정 라우트 GET·PUT /api/user-prefs — worker/index.ts 를 통째로 (small 2026-11-04)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeWorld() {
  const sqlDb = openTestDb()
  const base = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) } }
  const owner = { ...base, DEV_AUTH_EMAIL: 'owner@example.com' } as unknown as Env
  const other = { ...base, DEV_AUTH_EMAIL: 'other@example.com' } as unknown as Env
  const anon = { DB: asAuthDb(openTestDb()), BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 's'.repeat(40) } as unknown as Env
  return { sqlDb, owner, other, anon }
}

function call(env: Env, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}/api/user-prefs`, { ...init, headers }), env, ctx)
}

const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

describe('GET·PUT /api/user-prefs', () => {
  it('행이 없으면 빈 설정', async () => {
    const { owner } = makeWorld()
    const res = await call(owner)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ prefs: {} })
  })

  it('PUT 한 값을 GET 이 돌려주고, 다시 PUT 하면 덮어쓴다', async () => {
    const { owner } = makeWorld()
    const first = await call(owner, put({ prefs: { lineBreaks: 'off' } }))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ prefs: { lineBreaks: 'off' } })
    expect(await (await call(owner)).json()).toEqual({ prefs: { lineBreaks: 'off' } })
    await call(owner, put({ prefs: { lineBreaks: 'on' } }))
    expect(await (await call(owner)).json()).toEqual({ prefs: { lineBreaks: 'on' } })
  })

  it('모르는 키·잘못된 값·깨진 JSON·너무 큰 몸통은 400·413', async () => {
    const { owner } = makeWorld()
    expect((await call(owner, put({ prefs: { theme: 'dark' } }))).status).toBe(400)
    expect((await call(owner, put({ prefs: { lineBreaks: 'yes' } }))).status).toBe(400)
    expect((await call(owner, put({}))).status).toBe(400)
    expect((await call(owner, put('{'))).status).toBe(400)
    expect((await call(owner, put({ prefs: { lineBreaks: 'on' }, pad: 'x'.repeat(2000) }))).status).toBe(413)
    expect(await (await call(owner)).json()).toEqual({ prefs: {} })
  })

  it('다른 사용자의 설정은 섞이지 않는다', async () => {
    const { owner, other } = makeWorld()
    await call(owner, put({ prefs: { lineBreaks: 'off' } }))
    expect(await (await call(other)).json()).toEqual({ prefs: {} })
  })

  it('로그인하지 않으면 401', async () => {
    const { anon } = makeWorld()
    expect((await call(anon)).status).toBe(401)
    expect((await call(anon, put({ prefs: { lineBreaks: 'off' } }))).status).toBe(401)
  })
})
