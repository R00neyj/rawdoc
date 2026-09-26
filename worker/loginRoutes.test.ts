// worker/index.ts 를 통째로 — 로그인 라우팅·Origin 관문·/api/auth 허용 목록·연장 쿠키 (specs/features/F-2033.md 7장, U30~U39)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SITE_URL } from '../src/lib/siteMeta'
import { asAuthDb } from './testD1'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const ORIGIN = new URL(SITE_URL).origin
const SECRET = 's'.repeat(40)
const DAY_MS = 24 * 60 * 60 * 1000

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>
}
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('./auth')
  // index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + file, 'utf-8'))
  }
  return db
}

function makeEnv(over: Record<string, unknown> = {}, db: unknown = asAuthDb(openDb())): Env {
  return {
    DB: db,
    BETTER_AUTH_URL: 'https://rawdoc.app',
    BETTER_AUTH_SECRET: SECRET,
    DEV_AUTH_EMAIL: '',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    ...over,
  } as unknown as Env
}

const noSecret = () => makeEnv({ BETTER_AUTH_SECRET: undefined })

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx)
}

function form(body: string, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    body,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(new TextEncoder().encode(body).length),
      ...headers,
    },
  }
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stubGoogle(email = 'me@example.org') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.startsWith('https://oauth2.googleapis.com/token')) throw new Error(`unexpected fetch ${url}`)
      const now = Math.floor(Date.now() / 1000)
      const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email, email_verified: true }
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig` })
    }),
  )
}

function cookiePairs(headers: Headers): string[] {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
}

// U35 흐름 — POST /api/login → 콜백 → 세션 쿠키. 전 과정이 index.ts 를 지난다
async function loginThroughWorker(env: Env, ret = '#/d/abc') {
  stubGoogle()
  const start = await call(env, '/api/login', form(`provider=google&return=${encodeURIComponent(ret)}`))
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')
  const callback = await call(env, `/api/auth/callback/google?code=c&state=${state}`, {
    headers: { Cookie: cookiePairs(start.headers).join('; ') },
  })
  vi.unstubAllGlobals()
  const session = cookiePairs(callback.headers).find((c) => c.includes('session_token='))
  return { start, callback, session: session ?? '' }
}

function sessionRow(env: Env) {
  return (env.DB as unknown as DatabaseSync).prepare('SELECT expires_at FROM auth_sessions').get() as { expires_at: string }
}

function setExpiresAt(env: Env, when: number) {
  ;(env.DB as unknown as DatabaseSync).prepare('UPDATE auth_sessions SET expires_at = ?').run(new Date(when).toISOString())
}

describe('F-2033 U30 인스턴스를 만들지 않는 경로', () => {
  it('비밀이 없어도 세션이 필요 없는 경로는 500 이 아니다', async () => {
    const env = noSecret()
    expect((await call(env, '/v1/me')).status).toBe(401)
    expect((await call(env, '/pub/docs/x')).status).toBe(404)
    expect([200, 503]).toContain((await call(env, '/api/health')).status)
    expect((await call(env, '/api/docs', { method: 'OPTIONS' })).status).toBe(405)
    const nope = await call(env, '/api/nope', { method: 'POST', headers: { Origin: ORIGIN } })
    expect(nope.status).toBe(404)
  })
})

describe('F-2033 U31 Origin 관문', () => {
  it('Origin 이 없거나 다르면 403, SITE_URL 출처는 지나간다', async () => {
    const env = makeEnv()
    const none = await call(env, '/api/docs', { method: 'POST', body: '{}' })
    expect(none.status).toBe(403)
    expect(await none.json()).toEqual({ error: 'forbidden_origin' })
    const evil = await call(env, '/api/docs', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)
    expect(await evil.json()).toEqual({ error: 'forbidden_origin' })
    const same = await call(env, '/api/docs', { method: 'POST', body: '{}', headers: { Origin: ORIGIN } })
    expect(same.status).not.toBe(403)
  })

  it('관문에서 걸리면 D1 에 닿지 않는다', async () => {
    const DB = { prepare: vi.fn(() => { throw new Error('should not query DB') }) }
    const res = await call(makeEnv({ DB }), '/api/tokens', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect(DB.prepare).not.toHaveBeenCalled()
  })
})

describe('F-2033 U32 /api/auth 허용 목록', () => {
  it('콜백 둘·로그아웃 밖은 better-auth 에 넘기지 않고 404', async () => {
    const env = noSecret()
    const cases: [string, string][] = [
      ['GET', '/api/auth/get-session'],
      ['POST', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/update-user'],
      ['GET', '/api/auth/ok'],
      ['POST', '/api/auth/callback/google'],
      ['GET', '/api/auth/callback/googlex'],
      ['GET', '/api/auth/callback/google/'],
      ['GET', '/api/auth/callback/Google'],
    ]
    for (const [method, path] of cases) {
      const res = await call(env, path, { method, headers: { Origin: ORIGIN } })
      expect([path, res.status]).toEqual([path, 404])
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
  })
})

describe('F-2033 U33 GET /api/login', () => {
  it('세션 없으면 /login 으로, 있으면 복귀 주소로', async () => {
    const env = makeEnv()
    const anon = await call(env, '/api/login?return=%23%2Fd%2Fabc')
    expect(anon.status).toBe(302)
    expect(anon.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fabc')
    expect(anon.headers.get('Cache-Control')).toBe('no-store')

    const bare = await call(env, '/api/login?return=')
    expect(bare.headers.get('Location')).toBe('/login')

    const { session } = await loginThroughWorker(env)
    const back = await call(env, '/api/login?return=%23%2Fd%2Fabc', { headers: { Cookie: session } })
    expect(back.status).toBe(302)
    expect(back.headers.get('Location')).toBe('/#/d/abc')
    expect(back.headers.get('Cache-Control')).toBe('no-store')
    const app = await call(env, '/api/login', { headers: { Cookie: session } })
    expect(app.headers.get('Location')).toBe('/?app=1')
  })
})

describe('F-2033 U34 POST /api/login', () => {
  it('Google 은 제공자 인증 주소로 303 + 상태 쿠키', async () => {
    const res = await call(makeEnv(), '/api/login', form('provider=google&return=%23%2Fd%2Fabc'))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')!.startsWith('https://accounts.google.com/')).toBe(true)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.getSetCookie().some((c) => c.includes('oauth_state'))).toBe(true)
  })

  it('모르는 제공자·설정 없는 제공자·폼이 아닌 본문', async () => {
    const twitter = await call(makeEnv(), '/api/login', form('provider=twitter&return=%23%2Fd%2Fabc'))
    expect(twitter.status).toBe(303)
    expect(twitter.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fabc&error=bad_request')

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const github = await call(makeEnv({ GITHUB_CLIENT_ID: '' }), '/api/login', form('provider=github&return=%23%2Fd%2Fabc'))
    expect(github.status).toBe(303)
    expect(github.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fabc&error=provider_unavailable')
    expect(errorLog).toHaveBeenCalledWith('oauth provider not configured', 'github')

    const noReturn = await call(makeEnv(), '/api/login', form('provider=twitter'))
    expect(noReturn.headers.get('Location')).toBe('/login?error=bad_request')

    const body = JSON.stringify({ provider: 'google' })
    const json = await call(makeEnv(), '/api/login', {
      method: 'POST',
      body,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': String(body.length) },
    })
    expect(json.status).toBe(303)
    expect(json.headers.get('Location')).toBe('/login?error=bad_request')

    const big = 'provider=google&return=' + 'a'.repeat(5000)
    const tooLarge = await call(makeEnv(), '/api/login', form(big))
    expect(tooLarge.headers.get('Location')).toBe('/login?error=bad_request')

    const noLength = await call(makeEnv(), '/api/login', {
      method: 'POST',
      body: 'provider=google',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(noLength.headers.get('Location')).toBe('/login?error=bad_request')
  })
})

describe('F-2033 U35~U37 로그인 한 바퀴', () => {
  it('U35 POST /api/login → 콜백 → /api/me', async () => {
    const env = makeEnv()
    const { callback, session } = await loginThroughWorker(env)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe('/#/d/abc')
    expect(session).not.toBe('')
    const me = await call(env, '/api/me', { headers: { Cookie: session } })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ id: expect.any(String), email: 'me@example.org', blocked: false, warned: false })
  })

  it('U36 /api/me 는 연장 쿠키를 싣고, 만료 세션의 401 에도 지우는 쿠키를 싣는다', async () => {
    const env = makeEnv()
    const { session } = await loginThroughWorker(env)
    setExpiresAt(env, Date.now() + 28 * DAY_MS)
    const before = sessionRow(env).expires_at
    const fresh = await call(env, '/api/me', { headers: { Cookie: session } })
    expect(fresh.status).toBe(200)
    expect(fresh.headers.getSetCookie().some((c) => c.includes('session_token=') && c.includes('Max-Age=2592000'))).toBe(true)
    expect(sessionRow(env).expires_at > before).toBe(true)

    setExpiresAt(env, Date.now() - 1000)
    const expired = await call(env, '/api/me', { headers: { Cookie: session } })
    expect(expired.status).toBe(401)
    expect(await expired.json()).toEqual({ error: 'unauthenticated' })
    expect(expired.headers.getSetCookie().some((c) => c.includes('session_token=') && /Max-Age=0/.test(c))).toBe(true)
  })

  it('U37 로그아웃 뒤 같은 쿠키는 401', async () => {
    const env = makeEnv()
    const { session } = await loginThroughWorker(env)
    const out = await call(env, '/api/auth/sign-out', { method: 'POST', headers: { Origin: ORIGIN, Cookie: session } })
    expect(out.status).toBe(200)
    expect(await out.json()).toEqual({ success: true })
    const me = await call(env, '/api/me', { headers: { Cookie: session } })
    expect(me.status).toBe(401)
  })

  it('본문 스트림이 비어 있는 로그아웃도 200 — workerd 는 본문 없는 POST 에도 빈 body 를 붙인다', async () => {
    const env = makeEnv()
    const { session } = await loginThroughWorker(env)
    const out = await call(env, '/api/auth/sign-out', {
      method: 'POST',
      body: new Uint8Array(0),
      headers: { Origin: ORIGIN, Cookie: session },
    })
    expect(out.status).toBe(200)
    expect(await out.json()).toEqual({ success: true })
  })

  it('/v1/me 는 세션 쿠키를 보지 않는다', async () => {
    const env = makeEnv()
    const { session } = await loginThroughWorker(env)
    expect((await call(env, '/v1/me', { headers: { Cookie: session } })).status).toBe(401)
  })
})

describe('F-2028 LR1·LR2', () => {
  const SIGNUP_CLOSED = '오늘은 새 가입이 마감됐습니다. 한국 시간 오전 9시(UTC 자정)에 다시 열립니다. 그동안은 로그인 없이 쓸 수 있습니다.'

  afterEach(() => {
    vi.useRealTimers()
  })

  it('LR1 가입 마감이면 콜백이 signup_closed 로 /login 에 보내고, 그 페이지가 마감 문구를 보인다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 8, 24, 12, 0, 0))
    const env = makeEnv()
    const db = env.DB as unknown as DatabaseSync
    db.prepare('UPDATE signup_gate SET day = ?, count = ? WHERE id = 1').run('2026-09-24', 20)
    const { callback } = await loginThroughWorker(env)
    expect(callback.status).toBe(302)
    const location = callback.headers.get('Location')!
    expect(location).toBe('/login?return=%23%2Fd%2Fabc&error=signup_closed&error_description=signup_closed')
    const page = await call(env, location)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`<p class="login-error" role="alert">${SIGNUP_CLOSED}</p>`)
    expect((db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n).toBe(0)
  })

  it('LR2 /api/me 는 warned_at·blocked_at 을 그때그때 싣는다', async () => {
    const env = makeEnv()
    const db = env.DB as unknown as DatabaseSync
    const { session } = await loginThroughWorker(env)
    const me = async () => {
      const res = await call(env, '/api/me', { headers: { Cookie: session } })
      expect(res.status).toBe(200)
      return res.json()
    }
    const id = expect.any(String)
    expect(await me()).toEqual({ id, email: 'me@example.org', blocked: false, warned: false })
    db.prepare('UPDATE users SET warned_at = ?').run(Date.now())
    expect(await me()).toEqual({ id, email: 'me@example.org', blocked: false, warned: true })
    db.prepare('UPDATE users SET blocked_at = ?').run(Date.now())
    expect(await me()).toEqual({ id, email: 'me@example.org', blocked: true, warned: true })
  })
})

describe('F-2033 U38 GET /login', () => {
  it('세션 없으면 페이지, 있으면 복귀 주소, GET·HEAD 밖은 405', async () => {
    const env = makeEnv()
    const anon = await call(env, '/login?return=%23%2Fs&error=access_denied')
    expect(anon.status).toBe(200)
    expect(anon.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    const html = await anon.text()
    expect(html).toContain('<input type="hidden" name="return" value="#/s">')
    expect(html).toContain('로그인을 취소했습니다.')

    const { session } = await loginThroughWorker(env)
    const back = await call(env, '/login?return=%23%2Fs', { headers: { Cookie: session } })
    expect(back.status).toBe(302)
    expect(back.headers.get('Location')).toBe('/#/s')
    expect(back.headers.get('Cache-Control')).toBe('no-store')

    const head = await call(env, '/login', { method: 'HEAD' })
    expect(head.status).toBe(200)
    const post = await call(env, '/login', { method: 'POST', headers: { Origin: ORIGIN } })
    expect(post.status).toBe(405)
    expect(await post.json()).toEqual({ error: 'method_not_allowed' })
  })
})

describe('F-2033 U39 비밀이 없을 때', () => {
  it('로그인 페이지는 그리고, 로그인 시작은 오류 줄로, 세션 판정은 500', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = noSecret()
    const page = await call(env, '/login')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<main class="login">')

    const start = await call(env, '/api/login', form('provider=google&return=%23%2Fd%2Fabc'))
    expect(start.status).toBe(303)
    expect(start.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fabc&error=internal_server_error')

    const me = await call(env, '/api/me', { headers: { Cookie: '__Secure-better-auth.session_token=a.b' } })
    expect(me.status).toBe(500)
    expect(await me.json()).toEqual({ error: 'internal' })
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('F-2033 scheduled 정리', () => {
  it('첨부 정리와 세션 정리를 따로 waitUntil 하고, 한쪽이 던져도 삼킨다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending: Promise<unknown>[] = []
    const scheduledCtx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
    const DB = {
      prepare() {
        throw new Error('db down')
      },
    }
    await worker.scheduled({} as ScheduledController, { DB } as unknown as Env, scheduledCtx)
    expect(pending.length).toBe(3)
    await expect(Promise.all(pending)).resolves.toBeDefined()
  })
})
