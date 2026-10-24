// OAuth 로그인 이어가기·동의·오류 화면 — worker/index.ts 한 바퀴, 실제 better-auth + oauth-provider (specs/features/F-4010.md 6장 A1~A8)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../../src/lib/site/siteMeta'
import { asAuthDb, openTestDb } from '../../worker/testD1'
import { mcpResource, oauthIssuer } from '../../worker/oauthServer'
import worker from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

const ORIGIN = new URL(SITE_URL).origin
const EMAIL = 'me@example.com'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const CLIENT_NAME = '<script>alert(1)</script>Claude'
const EXPIRED = '/oauth/error?error=request_expired'
const GUIDE = '앱 연결을 계속하려면 로그인하세요. 로그인하면 연결을 허용할지 묻는 화면으로 넘어갑니다.'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function makeEnv(): Env {
  return {
    DB: asAuthDb(openTestDb()),
    BETTER_AUTH_URL: 'https://rawdoc.app',
    BETTER_AUTH_SECRET: 's'.repeat(40),
    DEV_AUTH_EMAIL: '',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
  } as unknown as Env
}

const sql = (env: Env) => env.DB as unknown as DatabaseSync
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init) as never, env, ctx)
}

function count(db: DatabaseSync, query: string): number {
  return (db.prepare(query).get() as { n: number }).n
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

function cookiePairs(headers: Headers): string[] {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
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

function stubGoogle() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const now = Math.floor(Date.now() / 1000)
      const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email: EMAIL, email_verified: true }
      const part = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)))
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` })
    }),
  )
}

async function registerClient(env: Env): Promise<string> {
  const res = await call(env, '/api/auth/oauth2/register', {
    method: 'POST',
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
    headers: { 'Content-Type': 'application/json' },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

async function pkce(seed: string) {
  const verifier = seed.padEnd(64, 'x')
  return { verifier, challenge: await sha256(verifier) }
}

// authorize 302 의 Location
async function authorize(env: Env, clientId: string, challenge: string, opts: { cookie?: string; redirect?: string; state?: string } = {}): Promise<string> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: opts.redirect ?? REDIRECT,
    scope: 'docs offline_access',
    state: opts.state ?? 'st-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpResource(env),
  })
  const res = await call(env, `/api/auth/oauth2/authorize?${query}`, { headers: opts.cookie ? { Cookie: opts.cookie } : {} })
  expect(res.status).toBe(302)
  return res.headers.get('Location')!
}

function queryOf(location: string, prefix: string): string {
  expect(location.startsWith(prefix)).toBe(true)
  return location.slice(prefix.length)
}

// /login 폼 제출 → 제공자 → 콜백(브라우저 이동처럼 Sec-Fetch-Mode: navigate)
async function loginWith(env: Env, body: string, providerQuery = 'code=c') {
  stubGoogle()
  const start = await call(env, '/api/login', form(body))
  expect(start.status).toBe(303)
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')
  const callback = await call(env, `/api/auth/callback/google?${providerQuery}&state=${state}`, {
    headers: { Cookie: cookiePairs(start.headers).join('; '), 'Sec-Fetch-Mode': 'navigate' },
  })
  vi.unstubAllGlobals()
  const session = cookiePairs(callback.headers).find((c) => c.includes('session_token=')) ?? ''
  return { start, callback, session }
}

// 세션 없이 authorize → /login → 로그인 → 동의 화면 주소
async function untilConsent(env: Env) {
  const clientId = await registerClient(env)
  const { verifier, challenge } = await pkce('v1')
  const loginQuery = queryOf(await authorize(env, clientId, challenge), '/login?')
  const { callback, session } = await loginWith(env, `provider=google&oauth_query=${encodeURIComponent(loginQuery)}`)
  expect(callback.status).toBe(302)
  const consentQuery = queryOf(callback.headers.get('Location')!, '/oauth/consent?')
  expect(session).not.toBe('')
  return { clientId, verifier, loginQuery, consentQuery, session }
}

function submitConsent(env: Env, session: string, accept: string, oauthQuery: string, headers: Record<string, string> = {}) {
  return call(env, '/api/oauth/consent', form(`accept=${accept}&oauth_query=${encodeURIComponent(oauthQuery)}`, { Cookie: session, ...headers }))
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

describe('F-4010 A1 세션 없는 authorize → /login 이어가기', () => {
  it('서명 질의 /login 은 숨은 oauth_query 와 안내 줄, return 값은 어디에도 없다', async () => {
    const env = makeEnv()
    const clientId = await registerClient(env)
    const location = await authorize(env, clientId, (await pkce('v1')).challenge)
    expect(location).toMatch(/^\/login\?.*sig=/)
    const q = location.slice('/login?'.length)

    const page = await call(env, `${location}&return=https%3A%2F%2Fevil.example`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(`<input type="hidden" name="oauth_query" value="${escapeAttr(q)}">`)
    expect(html).toContain(`<p class="login-reauth">${GUIDE}</p>`)
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('name="return"')
  })
})

describe('F-4010 A2 로그인 → 동의 화면', () => {
  it('폼 제출 → 콜백 Location 이 /oauth/consent?, 세션이 있어도 서명 질의 /login 은 200', async () => {
    const env = makeEnv()
    const { loginQuery, consentQuery, session } = await untilConsent(env)
    expect(consentQuery).toContain('sig=')
    const again = await call(env, `/login?${loginQuery}`, { headers: { Cookie: session } })
    expect(again.status).toBe(200)
    expect(await again.text()).toContain(GUIDE)
  })

  it('제공자에서 취소하면 /login?{q} 로 돌아와 이어가기가 남고, 850자 넘는 q 는 /login 으로', async () => {
    const env = makeEnv()
    const clientId = await registerClient(env)
    const { challenge } = await pkce('v1')
    const short = queryOf(await authorize(env, clientId, challenge), '/login?')
    expect(short.length).toBeLessThanOrEqual(850)
    const cancel = await loginWith(env, `provider=google&oauth_query=${encodeURIComponent(short)}`, 'error=access_denied')
    const back = cancel.callback.headers.get('Location')!
    expect(back.startsWith(`/login?${short}`)).toBe(true)
    const page = await call(env, back)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('로그인을 취소했습니다.')
    expect(html).toContain(`name="oauth_query" value="${escapeAttr(short)}"`)

    const long = queryOf(await authorize(env, clientId, challenge, { state: 'L'.repeat(270) }), '/login?')
    expect(long.length).toBeGreaterThan(850)
    expect(long.length).toBeLessThanOrEqual(900)
    const longCancel = await loginWith(env, `provider=google&oauth_query=${encodeURIComponent(long)}`, 'error=access_denied')
    expect(longCancel.callback.headers.get('Location')).toMatch(/^\/login\?error=access_denied/)
  })

  it('1,700자 넘는 서명 질의는 /login·POST /api/login 모두 request_expired', async () => {
    const env = makeEnv()
    const clientId = await registerClient(env)
    const location = await authorize(env, clientId, (await pkce('v1')).challenge, { state: 'L'.repeat(1140) })
    const q = queryOf(location, '/login?')
    expect(q.length).toBeGreaterThan(1700)
    expect(q.length).toBeLessThanOrEqual(1800)
    const page = await call(env, location)
    expect([page.status, page.headers.get('Location')]).toEqual([302, EXPIRED])
    const start = await call(env, '/api/login', form(`provider=google&oauth_query=${encodeURIComponent(q)}`))
    expect([start.status, start.headers.get('Location')]).toEqual([303, EXPIRED])
  })
})

describe('F-4010 A3 동의 화면', () => {
  it('200, 앱 이름 이스케이프, 돌아갈 곳·휴지통 줄, CSP form-action 에 앱 출처', async () => {
    const env = makeEnv()
    const { consentQuery, session } = await untilConsent(env)
    const res = await call(env, `/oauth/consent?${consentQuery}`, { headers: { Cookie: session } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const html = await res.text()
    expect(html).toMatch(/<h1>&lt;script&gt;alert\(1\)&lt;\/script&gt;Claude 앱이 .+ 계정에 접근하려고 합니다<\/h1>/)
    expect(html).not.toContain('<script>alert')
    expect(html).toContain(`${EMAIL} 계정`)
    expect(html).toContain('돌아갈 곳: claude.ai')
    expect(html).toContain('문서·폴더를 휴지통으로 보내기')
    expect(html).toContain(`<input type="hidden" name="oauth_query" value="${escapeAttr(consentQuery)}">`)
    expect(html).toContain('<meta name="robots" content="noindex">')
    const csp = res.headers.get('Content-Security-Policy-Report-Only') ?? res.headers.get('Content-Security-Policy')!
    expect(csp).toContain("form-action 'self' https://accounts.google.com https://github.com https://claude.ai;")
    expect(csp).toContain("default-src 'none'")
  })

  it('세션 없으면 /login?{q}, 클라이언트가 없으면 invalid_client, GET·HEAD 밖은 405', async () => {
    const env = makeEnv()
    const { consentQuery, session, clientId } = await untilConsent(env)
    const anon = await call(env, `/oauth/consent?${consentQuery}`)
    expect([anon.status, anon.headers.get('Location')]).toEqual([302, `/login?${consentQuery}`])
    const head = await call(env, `/oauth/consent?${consentQuery}`, { method: 'HEAD', headers: { Cookie: session } })
    expect(head.status).toBe(200)
    const post = await call(env, `/oauth/consent?${consentQuery}`, { method: 'POST', headers: { Cookie: session, Origin: ORIGIN } })
    expect(post.status).toBe(405)
    sql(env).prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(clientId)
    const gone = await call(env, `/oauth/consent?${consentQuery}`, { headers: { Cookie: session } })
    expect([gone.status, gone.headers.get('Location')]).toEqual([302, '/oauth/error?error=invalid_client'])
  })
})

describe('F-4010 A4 허용', () => {
  it('303 redirect_uri?code&state&iss → 토큰 200, 두 번째 authorize 는 곧장 code', async () => {
    const env = makeEnv()
    const { clientId, verifier, consentQuery, session } = await untilConsent(env)
    const res = await submitConsent(env, session, 'yes', consentQuery)
    expect(res.status).toBe(303)
    const location = res.headers.get('Location')!
    expect(location.startsWith(`${REDIRECT}?code=`)).toBe(true)
    const back = new URL(location)
    expect(back.searchParams.get('state')).toBe('st-1')
    expect(back.searchParams.get('iss')).toBe(oauthIssuer(env))

    const token = await call(env, '/api/auth/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(token.status).toBe(200)

    const second = await authorize(env, clientId, (await pkce('v2')).challenge, { cookie: session })
    expect(second.startsWith(`${REDIRECT}?code=`)).toBe(true)
  })
})

describe('F-4010 A5 거부', () => {
  it('303 access_denied + state + iss, 동의 행 0', async () => {
    const env = makeEnv()
    const { consentQuery, session } = await untilConsent(env)
    const res = await submitConsent(env, session, 'no', consentQuery)
    expect(res.status).toBe(303)
    const location = res.headers.get('Location')!
    expect(location.startsWith(`${REDIRECT}?error=access_denied`)).toBe(true)
    const back = new URL(location)
    expect(back.searchParams.get('state')).toBe('st-1')
    expect(back.searchParams.get('iss')).toBe(oauthIssuer(env))
    expect(count(sql(env), 'SELECT COUNT(*) AS n FROM oauth_consents')).toBe(0)
  })

  it('accept 가 yes·no 밖이거나 폼이 아니면 invalid_request', async () => {
    const env = makeEnv()
    const { consentQuery, session } = await untilConsent(env)
    const odd = await submitConsent(env, session, 'maybe', consentQuery)
    expect([odd.status, odd.headers.get('Location')]).toEqual([303, '/oauth/error?error=invalid_request'])
    const json = await call(env, '/api/oauth/consent', {
      method: 'POST',
      body: JSON.stringify({ accept: 'yes', oauth_query: consentQuery }),
      headers: { Origin: ORIGIN, Cookie: session, 'Content-Type': 'application/json', 'Content-Length': '10' },
    })
    expect([json.status, json.headers.get('Location')]).toEqual([303, '/oauth/error?error=invalid_request'])
    const anon = await submitConsent(env, '', 'yes', consentQuery)
    expect([anon.status, anon.headers.get('Location')]).toEqual([303, `/login?${consentQuery}`])
    expect(count(sql(env), 'SELECT COUNT(*) AS n FROM oauth_consents')).toBe(0)
  })
})

describe('F-4010 A6 등록 안 된 redirect_uri', () => {
  it('/login?error=invalid_redirect → /oauth/error 400, 어느 Location 에도 그 호스트가 없다. 세션이 있어도 같다', async () => {
    const env = makeEnv()
    const clientId = await registerClient(env)
    const { challenge } = await pkce('v1')
    const { session } = await loginWith(env, 'provider=google&return=%23%2Fd%2Fabc')
    for (const cookie of [undefined, session]) {
      const headers: Record<string, string> = cookie ? { Cookie: cookie } : {}
      const first = await authorize(env, clientId, challenge, { cookie, redirect: 'https://evil.example/cb' })
      expect(first.startsWith('/login?error=invalid_redirect')).toBe(true)
      const second = await call(env, first, { headers })
      expect(second.status).toBe(302)
      const errorPath = second.headers.get('Location')!
      expect(errorPath).toBe('/oauth/error?error=invalid_redirect')
      for (const location of [first, errorPath]) expect(location).not.toContain('evil.example')
      const page = await call(env, errorPath, { headers })
      expect(page.status).toBe(400)
      const html = await page.text()
      expect(html).toContain('앱이 알려 준 돌아갈 주소가 등록된 주소와 달라 연결을 멈췄습니다.')
      expect(html).not.toContain('evil.example')
      const csp = page.headers.get('Content-Security-Policy-Report-Only') ?? page.headers.get('Content-Security-Policy')!
      expect(csp).toContain("default-src 'none'")
    }
  })
})

describe('F-4010 A7 변조·만료', () => {
  async function expectAllExpired(env: Env, loginQuery: string, consentQuery: string, session: string) {
    const page = await call(env, `/login?${loginQuery}`)
    expect([page.status, page.headers.get('Location')]).toEqual([302, EXPIRED])
    const start = await call(env, '/api/login', form(`provider=google&oauth_query=${encodeURIComponent(loginQuery)}`))
    expect([start.status, start.headers.get('Location')]).toEqual([303, EXPIRED])
    const consent = await call(env, `/oauth/consent?${consentQuery}`, { headers: { Cookie: session } })
    expect([consent.status, consent.headers.get('Location')]).toEqual([302, EXPIRED])
    const submit = await submitConsent(env, session, 'yes', consentQuery)
    expect([submit.status, submit.headers.get('Location')]).toEqual([303, EXPIRED])
    expect(count(sql(env), 'SELECT COUNT(*) AS n FROM oauth_consents')).toBe(0)
  }

  it('한 글자 변조는 네 곳 모두 request_expired', async () => {
    const env = makeEnv()
    const { loginQuery, consentQuery, session } = await untilConsent(env)
    const tamper = (q: string) => q.replace('state=st-1', 'state=st-2')
    expect(tamper(loginQuery)).not.toBe(loginQuery)
    await expectAllExpired(env, tamper(loginQuery), tamper(consentQuery), session)
  })

  it('exp 가 지나면 네 곳 모두 request_expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 16, 3, 0, 0))
    const env = makeEnv()
    const { loginQuery, consentQuery, session } = await untilConsent(env)
    vi.setSystemTime(Date.UTC(2026, 9, 16, 3, 10, 30))
    await expectAllExpired(env, loginQuery, consentQuery, session)
  })
})

describe('F-4010 A8 동의 제출의 Origin 관문', () => {
  it('Origin 없음·다른 출처 403, 동의 행 0', async () => {
    const env = makeEnv()
    const { consentQuery, session } = await untilConsent(env)
    const body = `accept=yes&oauth_query=${encodeURIComponent(consentQuery)}`
    const none = await call(env, '/api/oauth/consent', {
      method: 'POST',
      body,
      headers: { Cookie: session, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) },
    })
    expect(none.status).toBe(403)
    const foreign = await submitConsent(env, session, 'yes', consentQuery, { Origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'forbidden_origin' })
    expect(count(sql(env), 'SELECT COUNT(*) AS n FROM oauth_consents')).toBe(0)
  })
})

describe('F-4010 플러그인 밖 오류 코드는 지금 그대로', () => {
  it('서명 질의 없는 /login?error=access_denied 는 오류 줄, 세션이 있으면 앱으로', async () => {
    const env = makeEnv()
    const page = await call(env, '/login?error=access_denied')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('로그인을 취소했습니다.')
    const missing = await call(env, '/login?error=invalid_client')
    expect([missing.status, missing.headers.get('Location')]).toEqual([302, '/oauth/error?error=invalid_client'])
  })
})
