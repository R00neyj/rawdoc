// F-3014 A3~A9·A15 GitHub 연결 라우트 다섯 — worker/index.ts 를 통째로, 가짜 GitHub fetch (specs/features/F-3014.md 5장)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../../src/lib/siteMeta'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
import { importTokenKey, openToken, sealToken } from '../../worker/githubCrypto'
import { githubMonth, type GithubStatus } from '../../src/lib/githubContract'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('../../worker/auth')
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const ME = 'me@example.com'
const OTHER = 'u-other'
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const b64u = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const KEY_TEXT = b64(new Uint8Array(32).fill(9))
const CLIENT_ID = 'Iv1.cid'
const SECRET = 'csecret'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const ACCESS = 'ghu_first_access_aaaaaaaaaaaaaaaaaaaaaaaa'
const REFRESH = 'ghr_first_refresh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

const GITHUB_VARS = {
  GITHUB_APP_CLIENT_ID: CLIENT_ID,
  GITHUB_APP_SLUG: 'test-app',
  GITHUB_APP_CLIENT_SECRET: SECRET,
  GITHUB_TOKEN_KEY: KEY_TEXT,
}

function devEnv(db: DatabaseSync, over: Record<string, unknown> = {}): Env {
  return { DB: asD1(db), BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: ME, ...GITHUB_VARS, ...over } as unknown as Env
}

function enabledDb(): DatabaseSync {
  const db = openTestDb()
  db.prepare('UPDATE github_settings SET enabled = 1').run()
  return db
}

function call(env: Env, path: string, init: RequestInit = {}, base = LOCAL): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${base}${path}`, { ...init, headers }), env, ctx)
}

type Call = { method: string; url: string; headers: Headers; body: string }
type GithubAnswers = {
  token?: () => Response
  user?: () => Response
  installations?: () => Response
  grant?: () => Response
}

function fakeGithub(answers: GithubAnswers = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: req.method === 'GET' ? '' : await req.text() })
      const url = new URL(req.url)
      if (req.url === TOKEN_URL) {
        return (answers.token ?? (() => Response.json({ access_token: ACCESS, expires_in: 28800, refresh_token: REFRESH, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' })))()
      }
      if (url.origin === 'https://api.github.com' && url.pathname === '/user') return (answers.user ?? (() => Response.json({ id: 4242, login: 'octocat' })))()
      if (url.pathname === '/user/installations') return (answers.installations ?? (() => Response.json({ total_count: 1, installations: [{}] })))()
      if (url.pathname === `/applications/${CLIENT_ID}/grant`) return (answers.grant ?? (() => new Response(null, { status: 204 })))()
      return new Response('unexpected', { status: 599 })
    }),
  )
  return calls
}

function setCookieFor(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith('gh_oauth='))
}

function cookiePair(res: Response): string {
  return setCookieFor(res)!.split(';')[0]
}

function decodeCookie(pair: string): { s: string; v: string; r: string; u: string } {
  const value = pair.slice('gh_oauth='.length)
  return JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')))
}

function expectCleared(res: Response) {
  const cookie = setCookieFor(res)
  expect(cookie).toBeDefined()
  expect(cookie!.split(';')[0]).toBe('gh_oauth=')
  expect(cookie).toContain('Max-Age=0')
  expect(cookie).toContain('Path=/api/github/')
}

async function startConnect(env: Env, ret = '#/d/x') {
  const res = await call(env, `/api/github/connect?return=${encodeURIComponent(ret)}`)
  expect(res.status).toBe(302)
  const location = new URL(res.headers.get('Location')!)
  return { res, location, cookie: cookiePair(res), state: location.searchParams.get('state')! }
}

async function finishCallback(env: Env, cookie: string | null, query: string) {
  return call(env, `/api/github/callback?${query}`, cookie ? { headers: { Cookie: cookie } } : {})
}

async function connectFully(env: Env, ret = '#/d/x') {
  const { cookie, state } = await startConnect(env, ret)
  return finishCallback(env, cookie, `code=c0de&state=${state}`)
}

async function status(env: Env): Promise<GithubStatus> {
  const res = await call(env, '/api/github/status')
  expect(res.status).toBe(200)
  return (await res.json()) as GithubStatus
}

function myId(db: DatabaseSync): string {
  return (db.prepare('SELECT id FROM users WHERE email = ?').get(ME) as { id: string }).id
}

type AccountRow = { user_id: string; github_id: number; login: string; access_token: string; access_expires_at: number; refresh_token: string; refresh_expires_at: number; token_rev: number }
const accounts = (db: DatabaseSync) => db.prepare('SELECT * FROM github_accounts ORDER BY user_id').all() as AccountRow[]

async function seedAccount(db: DatabaseSync, userId: string, opts: { githubId?: number; refreshExpiresAt?: number; login?: string } = {}) {
  const key = (await importTokenKey(KEY_TEXT))!
  db.prepare(
    'INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1)',
  ).run(
    userId,
    opts.githubId ?? 4242,
    opts.login ?? 'octocat',
    await sealToken(key, userId, 'access', ACCESS),
    Date.now() + 3_600_000,
    await sealToken(key, userId, 'refresh', REFRESH),
    opts.refreshExpiresAt ?? Date.now() + 86_400_000,
  )
}

describe('F-3014 A3 꺼짐', () => {
  it('네 이름 중 하나 빠짐·키 깨짐 → status.enabled false, connect → github_error=disabled', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: Record<string, unknown>[] = [
      { GITHUB_APP_CLIENT_ID: '' },
      { GITHUB_APP_SLUG: '' },
      { GITHUB_APP_CLIENT_SECRET: undefined },
      { GITHUB_TOKEN_KEY: '' },
      { GITHUB_TOKEN_KEY: b64(new Uint8Array(31)) },
    ]
    for (const over of broken) {
      const env = devEnv(enabledDb(), over)
      expect([over, (await status(env)).enabled]).toEqual([over, false])
      const res = await call(env, '/api/github/connect?return=%23%2Fd%2Fx')
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/?app=1&github_error=disabled#/d/x')
      expect(setCookieFor(res)).toBeUndefined()
    }
  })

  it('설정 enabled = 0 도 같다, 설정 행이 없어도 같다', async () => {
    const db = openTestDb()
    const env = devEnv(db)
    expect((await status(env)).enabled).toBe(false)
    expect((await call(env, '/api/github/connect')).headers.get('Location')).toBe('/?app=1&github_error=disabled')
    db.prepare('DELETE FROM github_settings').run()
    expect((await status(env)).enabled).toBe(false)
  })

  it('켜짐 + 네 이름 → enabled true', async () => {
    expect((await status(devEnv(enabledDb()))).enabled).toBe(true)
  })
})

describe('F-3014 A4 status', () => {
  it('비로그인 401 unauthenticated', async () => {
    const res = await call(authEnv(), '/api/github/status', {}, ORIGIN)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
  })

  it('행 없음 / 행 있음 / 다시 연결 / 이번 달 사용·한도, no-store', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const first = await call(env, '/api/github/status')
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    expect(await first.json()).toEqual({ enabled: true, connected: false, month: { used: 0, limit: null } })

    await seedAccount(db, myId(db))
    expect(await status(env)).toEqual({ enabled: true, connected: true, login: 'octocat', reconnect: false, month: { used: 0, limit: null } })

    db.prepare('UPDATE github_accounts SET refresh_expires_at = 0').run()
    expect((await status(env)).reconnect).toBe(true)
    db.prepare('UPDATE github_accounts SET refresh_expires_at = ?').run(Date.now() - 1)
    expect((await status(env)).reconnect).toBe(true)

    db.prepare('UPDATE github_settings SET monthly_limit = 30').run()
    db.prepare('INSERT INTO github_usage (user_id, month, count) VALUES (?, ?, 7), (?, ?, 99)').run(myId(db), githubMonth(Date.now()), myId(db), '2001-01')
    expect((await status(env)).month).toEqual({ used: 7, limit: 30 })
  })

  it('꺼져 있어도 실제 값', async () => {
    const db = openTestDb()
    const env = devEnv(db)
    await status(env)
    await seedAccount(db, myId(db))
    expect(await status(env)).toMatchObject({ enabled: false, connected: true, login: 'octocat' })
  })
})

describe('F-3014 A5 connect', () => {
  it('302 주소 — client_id·redirect_uri(BETTER_AUTH_URL 기준)·S256·challenge = SHA-256(v)', async () => {
    const env = devEnv(enabledDb())
    const res = await call(env, '/api/github/connect?return=%23%2Fd%2Fx', {}, 'http://rawdoc.app')
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('Location')!)
    expect(`${location.origin}${location.pathname}`).toBe('https://github.com/login/oauth/authorize')
    const q = location.searchParams
    expect(q.get('client_id')).toBe(CLIENT_ID)
    expect(q.get('redirect_uri')).toBe('http://localhost:8790/api/github/callback')
    expect(q.get('code_challenge_method')).toBe('S256')
    const cookie = decodeCookie(cookiePair(res))
    expect(cookie.s).toBe(q.get('state'))
    expect(cookie.r).toBe('#/d/x')
    expect(cookie.s).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookie.v).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cookie.v))
    expect(q.get('code_challenge')).toBe(b64u(new Uint8Array(digest)))
  })

  it('쿠키 속성 — localhost 면 Secure 없음', async () => {
    const res = await call(devEnv(enabledDb()), '/api/github/connect?return=%23%2F')
    const cookie = setCookieFor(res)!
    const attrs = cookie.split(';').slice(1).map((a) => a.trim())
    expect(attrs).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/api/github/', 'Max-Age=600']))
    expect(attrs).not.toContain('Secure')
  })

  it('return 이 #/ 로 시작하지 않으면 쿠키 r 빈 글자', async () => {
    const { cookie } = await startConnect(devEnv(enabledDb()), 'https://x')
    expect(decodeCookie(cookie).r).toBe('')
  })

  it('비로그인 → /login?return=…', async () => {
    const env = authEnv()
    const res = await call(env, '/api/github/connect?return=%23%2Fd%2Fx', {}, ORIGIN)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fx')
  })

  it('운영 BETTER_AUTH_URL 이면 Secure', async () => {
    const env = authEnv()
    const db = env.DB as unknown as DatabaseSync
    db.prepare('UPDATE github_settings SET enabled = 1').run()
    const session = await loginThroughWorker(env)
    expect(session).not.toBe('')
    const res = await call(env, '/api/github/connect?return=%23%2F', { headers: { Cookie: session } }, ORIGIN)
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('Location')!).searchParams.get('redirect_uri')).toBe('https://rawdoc.app/api/github/callback')
    const attrs = setCookieFor(res)!.split(';').map((a) => a.trim())
    expect(attrs).toContain('Secure')
  })
})

describe('F-3014 A6 callback 성공', () => {
  it('행이 생기고 토큰 칸은 봉투, 만료 = now + 초×1000, token_rev 1, 302 connected#/d/x, 쿠키 지움', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const { cookie, state } = await startConnect(env)
    const calls = fakeGithub()
    const before = Date.now()
    const res = await finishCallback(env, cookie, `code=c0de&state=${state}`)
    const after = Date.now()
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/?app=1&github=connected#/d/x')
    expectCleared(res)

    const exchange = calls.find((c) => c.url === TOKEN_URL)!
    expect(exchange.method).toBe('POST')
    expect(exchange.headers.get('Accept')).toBe('application/json')
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({
      client_id: CLIENT_ID,
      client_secret: SECRET,
      code: 'c0de',
      code_verifier: decodeCookie(cookie).v,
      redirect_uri: 'http://localhost:8790/api/github/callback',
    })

    const rows = accounts(db)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toMatchObject({ user_id: myId(db), github_id: 4242, login: 'octocat', token_rev: 1 })
    for (const sealed of [row.access_token, row.refresh_token]) {
      expect(sealed.startsWith('v1.')).toBe(true)
      expect(sealed).not.toContain('ghu_')
      expect(sealed).not.toContain('ghr_')
    }
    const key = (await importTokenKey(KEY_TEXT))!
    expect(await openToken(key, row.user_id, 'access', row.access_token)).toBe(ACCESS)
    expect(await openToken(key, row.user_id, 'refresh', row.refresh_token)).toBe(REFRESH)
    expect(row.access_expires_at).toBeGreaterThanOrEqual(before + 28_800_000)
    expect(row.access_expires_at).toBeLessThanOrEqual(after + 28_800_000)
    expect(row.refresh_expires_at - row.access_expires_at).toBe(15_897_600_000 - 28_800_000)
    expect(res.headers.get('Location')).not.toContain('ghu_')
  })
})

describe('F-3014 A7 설치 0개 → 설치 화면 → setup', () => {
  it('쿠키를 남긴 채 설치 주소, setup 이 쿠키의 해시로 connected 하고 쿠키를 지운다', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const { cookie, state } = await startConnect(env, '#/d/x')
    fakeGithub({ installations: () => Response.json({ total_count: 0, installations: [] }) })
    const res = await finishCallback(env, cookie, `code=c0de&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://github.com/apps/test-app/installations/new')
    expect(setCookieFor(res)).toBeUndefined()
    expect(accounts(db)).toHaveLength(1)

    const setup = await call(env, '/api/github/setup?installation_id=1&setup_action=install', { headers: { Cookie: cookie } })
    expect(setup.status).toBe(302)
    expect(setup.headers.get('Location')).toBe('/?app=1&github=connected#/d/x')
    expectCleared(setup)
  })

  it('쿠키 없는 setup → /?app=1&github=connected', async () => {
    const res = await call(devEnv(enabledDb()), '/api/github/setup')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/?app=1&github=connected')
  })

  it('설치 목록 호출이 실패해도 connected', async () => {
    const env = devEnv(enabledDb())
    fakeGithub({ installations: () => new Response('', { status: 500 }) })
    const res = await connectFully(env)
    expect(res.headers.get('Location')).toBe('/?app=1&github=connected#/d/x')
    expectCleared(res)
  })
})

describe('F-3014 A8 callback 실패', () => {
  it('쿠키 없음·state 다름·세션 사용자 다름·깨진 쿠키 → state, 행 없음, GitHub 호출 0', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const { cookie, state } = await startConnect(env)
    const calls = fakeGithub()
    const cases: [string | null, string, Env][] = [
      [null, `code=c&state=${state}`, env],
      [cookie, 'code=c&state=nope', env],
      [cookie, `code=c&state=${state}`, devEnv(db, { DEV_AUTH_EMAIL: 'someone@example.com' })],
      ['gh_oauth=%%%', `code=c&state=${state}`, env],
    ]
    for (const [c, q, e] of cases) {
      const res = await finishCallback(e, c, q)
      expect([q, res.headers.get('Location')]).toEqual([q, '/?app=1&github_error=state' + (c === cookie ? '#/d/x' : '')])
      expectCleared(res)
    }
    expect(calls).toHaveLength(0)
    expect(accounts(db)).toHaveLength(0)
  })

  it('error=access_denied → denied', async () => {
    const env = devEnv(enabledDb())
    const { cookie, state } = await startConnect(env)
    const calls = fakeGithub()
    const res = await finishCallback(env, cookie, `error=access_denied&state=${state}`)
    expect(res.headers.get('Location')).toBe('/?app=1&github_error=denied#/d/x')
    expectCleared(res)
    expect(calls).toHaveLength(0)
  })

  it('꺼진 뒤 돌아오면 disabled', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const { cookie, state } = await startConnect(env)
    db.prepare('UPDATE github_settings SET enabled = 0').run()
    const res = await finishCallback(env, cookie, `code=c&state=${state}`)
    expect(res.headers.get('Location')).toBe('/?app=1&github_error=disabled#/d/x')
  })

  it('몸통에 refresh_token 없음 → exchange_failed, github_token_no_expiry 로그', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeGithub({ token: () => Response.json({ access_token: ACCESS, token_type: 'bearer', scope: '' }) })
    const res = await connectFully(env)
    expect(res.headers.get('Location')).toBe('/?app=1&github_error=exchange_failed#/d/x')
    expectCleared(res)
    expect(error).toHaveBeenCalledWith('github_token_no_expiry')
    expect(accounts(db)).toHaveLength(0)
    expect(JSON.stringify(error.mock.calls)).not.toContain('ghu_')
  })

  it('토큰 교환 error·5xx·/user 실패 → exchange_failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const answers: GithubAnswers[] = [
      { token: () => Response.json({ error: 'bad_verification_code' }) },
      { token: () => new Response('down', { status: 503 }) },
      { user: () => new Response('{}', { status: 401 }) },
      { user: () => Response.json({ id: 'x' }) },
    ]
    for (const a of answers) {
      const db = enabledDb()
      fakeGithub(a)
      const res = await connectFully(devEnv(db))
      expect(res.headers.get('Location')).toBe('/?app=1&github_error=exchange_failed#/d/x')
      expect(accounts(db)).toHaveLength(0)
    }
  })

  it('다른 사용자가 같은 github_id → github_taken, 그 사용자 행 그대로, grant DELETE 0', async () => {
    const db = enabledDb()
    db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'other@example.com', 1)").run(OTHER)
    await seedAccount(db, OTHER, { githubId: 4242 })
    const before = accounts(db)
    const env = devEnv(db)
    const calls = fakeGithub()
    const res = await connectFully(env)
    expect(res.headers.get('Location')).toBe('/?app=1&github_error=github_taken#/d/x')
    expectCleared(res)
    expect(accounts(db)).toEqual(before)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })
})

describe('F-3014 A9 다른 GitHub 계정으로 다시 연결', () => {
  it('행 하나, github_id·login 바뀜, token_rev +1', async () => {
    const db = enabledDb()
    const env = devEnv(db)
    fakeGithub()
    await connectFully(env)
    expect(accounts(db)).toMatchObject([{ github_id: 4242, login: 'octocat', token_rev: 1 }])
    fakeGithub({ user: () => Response.json({ id: 5151, login: 'second' }) })
    const res = await connectFully(env)
    expect(res.headers.get('Location')).toBe('/?app=1&github=connected#/d/x')
    const rows = accounts(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: myId(db), github_id: 5151, login: 'second', token_rev: 2 })
  })
})

describe('F-3014 A15 DELETE /api/github/account', () => {
  function del(env: Env) {
    return call(env, '/api/github/account', { method: 'DELETE' })
  }

  async function connected(over: Record<string, unknown> = {}, enabled = true) {
    const db = enabled ? enabledDb() : openTestDb()
    const env = devEnv(db, over)
    await status(env)
    await seedAccount(db, myId(db))
    return { db, env }
  }

  it('grant DELETE 가 Basic 머리·access_token 몸통으로 1번, 행 삭제, 204, github_links 는 남음', async () => {
    const { db, env } = await connected()
    db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1', ?, 't', '', 'lf', 1, 1, 1)").run(myId(db))
    db.prepare("INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, created_at) VALUES ('d1', ?, 1, 'o/r', 'main', 'a.md', 1)").run(myId(db))
    const calls = fakeGithub()
    const res = await del(env)
    expect(res.status).toBe(204)
    const grants = calls.filter((c) => c.method === 'DELETE')
    expect(grants).toHaveLength(1)
    expect(grants[0].url).toBe(`https://api.github.com/applications/${CLIENT_ID}/grant`)
    expect(grants[0].headers.get('Authorization')).toBe(`Basic ${btoa(`${CLIENT_ID}:${SECRET}`)}`)
    expect(JSON.parse(grants[0].body)).toEqual({ access_token: ACCESS })
    expect(accounts(db)).toHaveLength(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM github_links').get() as { n: number }).n).toBe(1)
  })

  it('GitHub 500·예외여도 204, 행 삭제', async () => {
    for (const grant of [() => new Response('', { status: 500 }), () => { throw new TypeError('down') }]) {
      const { db, env } = await connected()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      fakeGithub({ grant })
      expect((await del(env)).status).toBe(204)
      expect(accounts(db)).toHaveLength(0)
    }
  })

  it('꺼져 있어도·막힌 계정이어도 204, 행이 없어도 204', async () => {
    const off = await connected({}, false)
    let calls = fakeGithub()
    expect((await del(off.env)).status).toBe(204)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(accounts(off.db)).toHaveLength(0)

    const blocked = await connected({ WRITE_LIMITER: { limit: async () => ({ success: false }) } })
    blocked.db.prepare('UPDATE users SET blocked_at = 5').run()
    fakeGithub()
    expect((await del(blocked.env)).status).toBe(204)
    expect(accounts(blocked.db)).toHaveLength(0)

    calls = fakeGithub()
    expect((await del(blocked.env)).status).toBe(204)
    expect(calls).toHaveLength(0)
  })

  it('설정(네 이름)이 없으면 GitHub 를 부르지 않고 행만 지운다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, env } = await connected({ GITHUB_APP_CLIENT_SECRET: '' })
    const calls = fakeGithub()
    expect((await del(env)).status).toBe(204)
    expect(calls).toHaveLength(0)
    expect(accounts(db)).toHaveLength(0)
  })

  it('비로그인 401, 다른 출처 403', async () => {
    const res = await call(authEnv(), '/api/github/account', { method: 'DELETE', headers: { Origin: ORIGIN } }, ORIGIN)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
    const { db, env } = await connected()
    const evil = await call(env, '/api/github/account', { method: 'DELETE', headers: { Origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)
    expect(accounts(db)).toHaveLength(1)
  })
})

// ----- 실제 세션 (account.test.ts 의 loginThroughWorker 와 같은 틀) -----

const ORIGIN = new URL(SITE_URL).origin

function authEnv(): Env {
  return {
    DB: asAuthDb(openTestDb()),
    BETTER_AUTH_URL: 'https://rawdoc.app',
    BETTER_AUTH_SECRET: 's'.repeat(40),
    DEV_AUTH_EMAIL: '',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    ...GITHUB_VARS,
  } as unknown as Env
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function cookiePairs(headers: Headers): string[] {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
}

async function loginThroughWorker(env: Env): Promise<string> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const now = Math.floor(Date.now() / 1000)
      const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email: 'me@example.org', email_verified: true }
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig` })
    }),
  )
  const body = 'provider=google&return=%23%2Fd%2Fabc'
  const start = await call(
    env,
    '/api/login',
    { method: 'POST', body, headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) } },
    ORIGIN,
  )
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')
  const callback = await call(env, `/api/auth/callback/google?code=c&state=${state}`, { headers: { Cookie: cookiePairs(start.headers).join('; ') } }, ORIGIN)
  vi.unstubAllGlobals()
  return cookiePairs(callback.headers).find((c) => c.includes('session_token=')) ?? ''
}
