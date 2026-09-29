// F-3003 A1~A13 웹 푸시 구독 API — worker/index.ts 를 통째로 (specs/features/F-3003.md 7.2)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
import { DAILY_CRON, PURGE_CRON } from '../../worker/purgeJobs'
import { listLivePushSubscriptions, loadVapid } from '../../worker/pushServer'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
  scheduled(event: { cron?: string }, env: Env, ctx: ExecutionContext): Promise<void>
}
let worker: Worker
let getAuth: typeof import('../../worker/authServer').getAuth

beforeAll(async () => {
  vi.doUnmock('../../worker/auth')
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
  // worker 와 같은 모듈 묶음의 getAuth — env 를 열쇠로 캐시하므로 같은 인스턴스를 쓴다
  getAuth = (await import('../../worker/authServer')).getAuth
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const ME = 'me@example.com'
const YOU = 'you@example.com'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

function b64u(bytes: ArrayBuffer | Uint8Array): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function makeVapidJwk(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
}

async function makeKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer
  return { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) }
}

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, pending }
}

function env(db: DatabaseSync, over: Record<string, unknown> = {}): Env {
  return { DB: asD1(db), BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: ME, ...over } as unknown as Env
}

function call(e: Env, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const headers = new Headers({ Origin: LOCAL, ...extra })
  const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  return worker.fetch(new Request(`${LOCAL}${path}`, { method, headers, body: raw }), e, makeCtx().ctx)
}

const put = (e: Env, body: unknown) => call(e, 'PUT', '/api/push/subscription', body)
const del = (e: Env, body: unknown) => call(e, 'DELETE', '/api/push/subscription', body)
const test = (e: Env, body: unknown) => call(e, 'POST', '/api/push/test', body)

type Row = { id: string; user_id: string; session_id: string | null; endpoint: string; p256dh: string; auth: string; created_at: number; last_ok_at: number | null; fail_count: number }
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM push_subscriptions ORDER BY created_at, id').all() as Row[]
const userId = (db: DatabaseSync, email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined)?.id
const writeCount = (db: DatabaseSync) => (db.prepare('SELECT COALESCE(SUM(write_count), 0) AS n FROM users').get() as { n: number }).n

async function setup(vapid = true) {
  const db = openTestDb()
  const e = env(db, vapid ? { VAPID_PRIVATE_JWK: await makeVapidJwk() } : {})
  const keys = await makeKeys()
  return { db, e, keys }
}

describe('F-3003 A1 GET key', () => {
  it('있음 200, 없음 503, 로그인 없음 401', async () => {
    const { db, e } = await setup()
    const res = await call(e, 'GET', '/api/push/key')
    expect(res.status).toBe(200)
    const vapid = await loadVapid(e)
    expect(await res.json()).toEqual({ publicKey: vapid!.keys.publicKey })
    const off = env(db)
    const r2 = await call(off, 'GET', '/api/push/key')
    expect(r2.status).toBe(503)
    expect(await r2.json()).toEqual({ error: 'push_unavailable' })
    const anon = { DB: asD1(db), BETTER_AUTH_URL: 'https://rawdoc.app', BETTER_AUTH_SECRET: 's'.repeat(40), DEV_AUTH_EMAIL: '', VAPID_PRIVATE_JWK: (e as unknown as Record<string, string>).VAPID_PRIVATE_JWK } as unknown as Env
    const r3 = await call(anon, 'GET', '/api/push/key')
    expect(r3.status).toBe(401)
    expect(await r3.json()).toEqual({ error: 'unauthenticated' })
  })
})

describe('F-3003 A2 PUT 성공', () => {
  it('204·행·write_count', async () => {
    const { db, e, keys } = await setup()
    const before = Date.now()
    const res = await put(e, { endpoint: ENDPOINT, keys, expirationTime: null })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    const all = rows(db)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ user_id: userId(db, ME), session_id: null, endpoint: ENDPOINT, p256dh: keys.p256dh, auth: keys.auth, last_ok_at: null, fail_count: 0 })
    expect(all[0].created_at).toBeGreaterThanOrEqual(before)
    expect(all[0].created_at).toBeLessThanOrEqual(Date.now())
    expect(writeCount(db)).toBe(1)
  })
})

describe('F-3003 A3 PUT 검사 표', () => {
  it('거절은 행·write_count 없음', async () => {
    const { db, e, keys } = await setup()
    const long = `https://fcm.googleapis.com/${'a'.repeat(1010)}`
    const cases: [unknown, number, unknown][] = [
      ['x'.repeat(2049), 413, { error: 'too_large', limit: 2048 }],
      ['{', 400, { error: 'invalid' }],
      ['[]', 400, { error: 'invalid' }],
      [{ keys }, 400, { error: 'invalid', field: 'endpoint' }],
      [{ endpoint: 5, keys }, 400, { error: 'invalid', field: 'endpoint' }],
      [{ endpoint: '', keys }, 400, { error: 'invalid', field: 'endpoint' }],
      [{ endpoint: long, keys }, 400, { error: 'invalid', field: 'endpoint' }],
      [{ endpoint: 'not a url', keys }, 400, { error: 'invalid', field: 'endpoint' }],
      [{ endpoint: 'http://fcm.googleapis.com/fcm/send/x', keys }, 400, { error: 'unsupported_push_service' }],
      [{ endpoint: 'https://evil.com/x', keys }, 400, { error: 'unsupported_push_service' }],
      [{ endpoint: ENDPOINT }, 400, { error: 'invalid', field: 'keys' }],
      [{ endpoint: ENDPOINT, keys: { p256dh: b64u(new Uint8Array(64)), auth: keys.auth } }, 400, { error: 'invalid', field: 'keys' }],
      [{ endpoint: ENDPOINT, keys: { p256dh: b64u(new Uint8Array([4, ...new Uint8Array(64).fill(1)])), auth: keys.auth } }, 400, { error: 'invalid', field: 'keys' }],
      [{ endpoint: ENDPOINT, keys: { p256dh: keys.p256dh, auth: b64u(new Uint8Array(15)) } }, 400, { error: 'invalid', field: 'keys' }],
    ]
    for (const [body, status, json] of cases) {
      const res = await put(e, body)
      expect([res.status, await res.json()]).toEqual([status, json])
    }
    expect(rows(db)).toHaveLength(0)
    expect(writeCount(db)).toBe(0)
  })
})

describe('F-3003 A4 다시 PUT·옮기기', () => {
  it('id 유지, 값 초기화, 다른 사용자로 이동', async () => {
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    const first = rows(db)[0]
    db.prepare('UPDATE push_subscriptions SET fail_count = 3, last_ok_at = 99').run()
    const fresh = await makeKeys()
    expect((await put(e, { endpoint: ENDPOINT, keys: fresh })).status).toBe(204)
    const again = rows(db)
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ id: first.id, p256dh: fresh.p256dh, auth: fresh.auth, fail_count: 0, last_ok_at: null })
    const other = { ...e, DEV_AUTH_EMAIL: YOU } as unknown as Env
    expect((await put(other, { endpoint: ENDPOINT, keys })).status).toBe(204)
    const moved = rows(db)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ id: first.id, user_id: userId(db, YOU) })
  })
})

describe('F-3003 A5 5개 상한', () => {
  it('가장 오래된 것부터, last_ok_at 이 있으면 밀린다', async () => {
    const { db, e, keys } = await setup()
    const ep = (n: number) => `https://fcm.googleapis.com/fcm/send/e${n}`
    for (let n = 1; n <= 6; n++) {
      await put(e, { endpoint: ep(n), keys })
      db.prepare('UPDATE push_subscriptions SET created_at = ? WHERE endpoint = ?').run(1000 + n, ep(n))
    }
    expect(rows(db).map((r) => r.endpoint)).toEqual([2, 3, 4, 5, 6].map(ep))
    db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').run(Date.now(), ep(2))
    await put(e, { endpoint: ep(7), keys })
    expect(rows(db).map((r) => r.endpoint).sort()).toEqual([2, 4, 5, 6, 7].map(ep).sort())
  })

  it('다른 사용자의 행은 세지 않는다', async () => {
    const { db, e, keys } = await setup()
    const other = { ...e, DEV_AUTH_EMAIL: YOU } as unknown as Env
    for (let n = 1; n <= 5; n++) await put(other, { endpoint: `https://fcm.googleapis.com/fcm/send/o${n}`, keys })
    for (let n = 1; n <= 5; n++) await put(e, { endpoint: `https://fcm.googleapis.com/fcm/send/m${n}`, keys })
    expect(rows(db)).toHaveLength(10)
  })
})

describe('F-3003 A6 DELETE', () => {
  it('내 행만 지우고 write_count 는 그대로', async () => {
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    const count = writeCount(db)
    expect((await del(e, { endpoint: ENDPOINT })).status).toBe(204)
    expect(rows(db)).toHaveLength(0)
    expect((await del(e, { endpoint: ENDPOINT })).status).toBe(204)
    const other = { ...e, DEV_AUTH_EMAIL: YOU } as unknown as Env
    await put(other, { endpoint: ENDPOINT, keys })
    expect((await del(e, { endpoint: ENDPOINT })).status).toBe(204)
    expect(rows(db)).toHaveLength(1)
    const bad = await del(e, {})
    expect([bad.status, await bad.json()]).toEqual([400, { error: 'invalid', field: 'endpoint' }])
    expect(writeCount(db)).toBe(count + 1)
  })

  it('비밀 값이 없어도, 막힌 계정도 지운다', async () => {
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    db.prepare('UPDATE users SET blocked_at = 1').run()
    const off = { ...e, VAPID_PRIVATE_JWK: undefined } as unknown as Env
    expect((await del(off, { endpoint: ENDPOINT })).status).toBe(204)
    expect(rows(db)).toHaveLength(0)
  })
})

function pushService(status: number | 'throw') {
  const fn = vi.fn(async () => {
    if (status === 'throw') throw new Error('net')
    return new Response(null, { status })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('F-3003 A7 POST test 성공', () => {
  it('204, 머리, last_ok_at, write_count', async () => {
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    const publicKey = (await loadVapid(e))!.keys.publicKey
    const fn = pushService(201)
    const res = await test(e, { endpoint: ENDPOINT })
    expect(res.status).toBe(204)
    expect(fn).toHaveBeenCalledTimes(1)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    const h = init.headers as Record<string, string>
    expect(h.TTL).toBe('86400')
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.Authorization.startsWith('vapid t=')).toBe(true)
    expect(h.Authorization.endsWith(`, k=${publicKey}`)).toBe(true)
    expect(h.Topic).toBeUndefined()
    expect(rows(db)[0].last_ok_at).not.toBeNull()
    expect(writeCount(db)).toBe(2)
  })
})

describe('F-3003 A8 POST test 실패', () => {
  it('상태별 처리', async () => {
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    let count = writeCount(db)
    pushService(410)
    let res = await test(e, { endpoint: ENDPOINT })
    expect([res.status, await res.json()]).toEqual([502, { error: 'push_failed', status: 410 }])
    expect(rows(db)).toHaveLength(0)
    expect(writeCount(db)).toBe(++count)

    await put(e, { endpoint: ENDPOINT, keys })
    count = writeCount(db)
    pushService(400)
    for (const [n, gone] of [[1, false], [2, false], [3, true]] as const) {
      res = await test(e, { endpoint: ENDPOINT })
      expect(res.status).toBe(502)
      if (gone) expect(rows(db)).toHaveLength(0)
      else expect(rows(db)[0].fail_count).toBe(n)
    }
    expect(writeCount(db)).toBe(count + 3)

    await put(e, { endpoint: ENDPOINT, keys })
    pushService(503)
    res = await test(e, { endpoint: ENDPOINT })
    expect(await res.json()).toEqual({ error: 'push_failed', status: 503 })
    expect(rows(db)[0].fail_count).toBe(0)
    pushService('throw')
    res = await test(e, { endpoint: ENDPOINT })
    expect(await res.json()).toEqual({ error: 'push_failed', status: null })
  })
})

describe('F-3003 A9 POST test 거절', () => {
  it('남의 구독·죽은 세션·비밀 값 없음', async () => {
    const { db, e, keys } = await setup()
    const other = { ...e, DEV_AUTH_EMAIL: YOU } as unknown as Env
    await put(other, { endpoint: ENDPOINT, keys })
    const count = writeCount(db)
    const fn = pushService(201)
    let res = await test(e, { endpoint: ENDPOINT })
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }])
    await put(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/mine', keys })
    const mine = writeCount(db)
    db.prepare('UPDATE push_subscriptions SET session_id = ? WHERE endpoint = ?').run('gone', 'https://fcm.googleapis.com/fcm/send/mine')
    res = await test(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/mine' })
    expect(res.status).toBe(404)
    res = await test({ ...e, VAPID_PRIVATE_JWK: undefined } as unknown as Env, { endpoint: ENDPOINT })
    expect(res.status).toBe(503)
    expect(fn).not.toHaveBeenCalled()
    expect(writeCount(db)).toBe(mine)
    expect(count).toBeLessThan(mine)
  })
})

function b64urlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stubGoogle(email: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.startsWith('https://oauth2.googleapis.com/token')) throw new Error(`unexpected fetch ${url}`)
      const now = Math.floor(Date.now() / 1000)
      const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email, email_verified: true }
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${b64urlJson({ alg: 'RS256' })}.${b64urlJson(claims)}.sig` })
    }),
  )
}

describe('F-3003 A10 세션 묶기', () => {
  it('session_id 가 auth_sessions.id, 세션이 죽으면 산 구독에서 빠진다', async () => {
    const db = openTestDb()
    const e = {
      DB: asAuthDb(db),
      BETTER_AUTH_URL: 'https://rawdoc.app',
      BETTER_AUTH_SECRET: 's'.repeat(40),
      DEV_AUTH_EMAIL: '',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: 'github-secret',
      VAPID_PRIVATE_JWK: await makeVapidJwk(),
    } as unknown as Env
    const pairs = (h: Headers) => h.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
    stubGoogle('sess@example.org')
    const auth = getAuth(e)
    const start = await auth.api.signInSocial({ body: { provider: 'google', callbackURL: '/', errorCallbackURL: '/login' }, headers: new Headers(), returnHeaders: true })
    const state = new URL(start.response.url as string).searchParams.get('state')
    const cb = await auth.handler(new Request(`https://rawdoc.app/api/auth/callback/google?code=c&state=${state}`, { headers: { Cookie: pairs(start.headers).join('; ') } }))
    const cookie = pairs(cb.headers).find((c) => c.includes('session_token='))!
    vi.unstubAllGlobals()

    const keys = await makeKeys()
    // better-auth 는 첫 getAuth 때 잡은 DB 를 계속 쓴다 — 앱 코드만 batch 있는 D1 로 바꾼다
    ;(e as unknown as { DB: D1Database }).DB = asD1(db)
    const req = (method: string, path: string, body: unknown) =>
      worker.fetch(new Request(`https://rawdoc.app${path}`, { method, headers: { Origin: 'https://rawdoc.app', Cookie: cookie }, body: JSON.stringify(body) }), e, makeCtx().ctx)
    expect((await req('PUT', '/api/push/subscription', { endpoint: ENDPOINT, keys })).status).toBe(204)
    const sid = (db.prepare('SELECT id FROM auth_sessions').get() as { id: string }).id
    expect(rows(db)[0].session_id).toBe(sid)
    expect(await listLivePushSubscriptions(asD1(db), ['sess@example.org'], Date.now())).toHaveLength(1)
    db.prepare('DELETE FROM auth_sessions').run()
    expect(await listLivePushSubscriptions(asD1(db), ['sess@example.org'], Date.now())).toHaveLength(0)
    expect((await req('POST', '/api/push/test', { endpoint: ENDPOINT })).status).toBe(401)
  })
})

async function pending(e: Env, cron: string | undefined): Promise<number> {
  const { ctx, pending: list } = makeCtx()
  await worker.scheduled(cron === undefined ? {} : { cron }, e, ctx)
  await Promise.all(list)
  return list.length
}

describe('F-3003 A11 매일 Cron', () => {
  it('비밀 값이 있으면 넷, 없으면 셋, 10분 Cron 은 하나', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { db, e, keys } = await setup()
    await put(e, { endpoint: ENDPOINT, keys })
    db.prepare('UPDATE push_subscriptions SET session_id = ?').run('dead-session')
    expect(await pending(e, DAILY_CRON)).toBe(4)
    expect(rows(db)).toHaveLength(0)
    expect(await pending(e, PURGE_CRON)).toBe(1)
    expect(await pending(env(db), DAILY_CRON)).toBe(3)
  })
})

describe('F-3003 A12 비밀 값이 없으면 꺼진다', () => {
  it('push_subscriptions 문장 0개', async () => {
    const { db } = await setup(false)
    const executed: string[] = []
    const inner = asD1(db)
    const spy = {
      prepare: (sql: string) => {
        executed.push(sql)
        return inner.prepare(sql)
      },
      batch: (stmts: D1PreparedStatement[]) => inner.batch(stmts),
    } as unknown as D1Database
    const e = { ...env(db), DB: spy } as unknown as Env
    const keys = await makeKeys()
    expect((await call(e, 'GET', '/api/push/key')).status).toBe(503)
    expect((await put(e, { endpoint: ENDPOINT, keys })).status).toBe(503)
    expect((await test(e, { endpoint: ENDPOINT })).status).toBe(503)
    expect(executed.filter((s) => s.includes('push_subscriptions'))).toEqual([])
    expect(writeCount(db)).toBe(0)
    expect(await pending(e, DAILY_CRON)).toBe(3)
    expect(executed.filter((s) => s.includes('push_subscriptions'))).toEqual([])
  })
})

describe('F-3003 A13 계정 삭제', () => {
  it('내 구독만 사라진다', async () => {
    const { db, e, keys } = await setup()
    const other = { ...e, DEV_AUTH_EMAIL: YOU } as unknown as Env
    await put(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/m1', keys })
    await put(e, { endpoint: 'https://fcm.googleapis.com/fcm/send/m2', keys })
    await put(other, { endpoint: 'https://fcm.googleapis.com/fcm/send/o1', keys })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call({ ...e, DOC_ROOM: { getByName: () => ({ purgeRoom: async () => {} }) } } as unknown as Env, 'DELETE', '/api/account')
    expect(res.status).toBe(204)
    expect(rows(db).map((r) => r.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/o1'])
  })
})
