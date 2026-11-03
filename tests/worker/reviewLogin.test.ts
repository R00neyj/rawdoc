// 심사 전용 비밀번호 로그인 — 순수 경계 + worker/index.ts 한 바퀴, 실제 better-auth + oauth-provider (specs/features/F-4018.md 5장 A1~A10)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../../src/lib/site/siteMeta'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
import { mcpResource } from '../../worker/oauthServer'
import { getAuth } from '../../worker/authServer'
import { constantTimeEqual, isReviewEmail, reviewLoginConfig, verifyReviewPassword } from '../../worker/reviewLogin'
import worker from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

const ORIGIN = new URL(SITE_URL).origin
const REVIEW_EMAIL = 'reviewer@example.net'
const PASSWORD = 'Zq3x9-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_'
const HASH = '67f1a59fa38acb5b2511f7f48773c47b09abe6b0e16fc43c99a260e892965ef4' // sha256(PASSWORD) hex
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const EXPIRED = '/oauth/error?error=request_expired'
const WRONG = '이메일 또는 비밀번호가 맞지 않습니다.'
const TOO_MANY = '시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Limiter = { limit: (o: { key: string }) => Promise<{ success: boolean }>; keys: string[] }

function limiter(success = true): Limiter {
  const keys: string[] = []
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key)
      return { success }
    },
  }
}

// better-auth 는 batch 가 보이면 D1 방언으로 바뀐다 — `in` 에는 숨기고 읽기에는 asD1 의 batch 를 준다
function authDbWithBatch(raw: DatabaseSync, prepared: string[] = []): DatabaseSync {
  const db = asAuthDb(raw)
  const batch = asD1(raw).batch.bind(null)
  return new Proxy(db, {
    has: (target, key) => key !== 'batch' && key in target,
    get: (target, key) => {
      if (key === 'batch') return batch
      if (key === 'prepare') {
        return (sql: string) => {
          prepared.push(sql)
          return target.prepare(sql)
        }
      }
      const value = Reflect.get(target, key) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
}

function makeEnv(over: Record<string, unknown> = {}, prepared: string[] = []) {
  const raw = openTestDb()
  const env = {
    DB: authDbWithBatch(raw, prepared),
    BETTER_AUTH_URL: 'https://rawdoc.app',
    BETTER_AUTH_SECRET: 's'.repeat(40),
    DEV_AUTH_EMAIL: '',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    REVIEW_LOGIN_EMAIL: ' Reviewer@Example.NET ',
    REVIEW_LOGIN_PASSWORD_HASH: HASH,
    LOGIN_LIMITER: limiter(),
    ...over,
  } as unknown as Env
  return { env, raw }
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init) as never, env, ctx)
}

function count(db: DatabaseSync, query: string, ...args: string[]): number {
  return (db.prepare(query).get(...args) as { n: number }).n
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

function sessionOf(headers: Headers): string {
  return cookiePairs(headers).find((c) => c.includes('session_token=')) ?? ''
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

function passwordLogin(env: Env, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return call(env, '/api/login/password', form(new URLSearchParams(fields).toString(), headers))
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function block(html: string, start: string, end: string): string {
  const from = html.indexOf(start)
  expect(from).toBeGreaterThan(-1)
  return html.slice(from, html.indexOf(end, from) + end.length)
}

async function registerClient(env: Env): Promise<string> {
  const res = await call(env, '/api/auth/oauth2/register', {
    method: 'POST',
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
    headers: { 'Content-Type': 'application/json' },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

async function authorizeQuery(env: Env, clientId: string, seed: string): Promise<{ q: string; verifier: string }> {
  const verifier = seed.padEnd(64, 'x')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'docs offline_access',
    state: 'st-1',
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    resource: mcpResource(env),
  })
  const res = await call(env, `/api/auth/oauth2/authorize?${query}`)
  expect(res.status).toBe(302)
  const location = res.headers.get('Location')!
  expect(location.startsWith('/login?')).toBe(true)
  return { q: location.slice('/login?'.length), verifier }
}

describe('F-4018 A10 순수 경계', () => {
  const env = (email: unknown, hash: unknown) => ({ REVIEW_LOGIN_EMAIL: email, REVIEW_LOGIN_PASSWORD_HASH: hash }) as unknown as Env

  it('reviewLoginConfig — trim·소문자 이메일, 소문자 64자 hex 해시만', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(reviewLoginConfig(env(' Reviewer@Example.NET ', HASH))).toEqual({ email: REVIEW_EMAIL, passwordHash: HASH })
    expect(reviewLoginConfig({} as Env)).toBeNull()
    expect(reviewLoginConfig(env('', ''))).toBeNull()
    expect(error).not.toHaveBeenCalled()
    for (const [email, hash] of [
      ['   ', HASH],
      [REVIEW_EMAIL, undefined],
      [REVIEW_EMAIL, HASH.toUpperCase()],
      [REVIEW_EMAIL, HASH.slice(0, 63)],
      [REVIEW_EMAIL, HASH + '0'],
      [REVIEW_EMAIL, ` ${HASH}`],
      [REVIEW_EMAIL, 42],
    ] as const) {
      expect(reviewLoginConfig(env(email, hash)), `${email} ${String(hash)}`).toBeNull()
    }
    expect(error).toHaveBeenCalledWith('review_login_misconfigured')
  })

  it('isReviewEmail — trim·대소문자 무시, 꺼져 있으면 늘 거짓', () => {
    const on = env(REVIEW_EMAIL, HASH)
    expect(isReviewEmail(on, ' REVIEWER@example.net ')).toBe(true)
    expect(isReviewEmail(on, 'reviewer@example.net.evil')).toBe(false)
    expect(isReviewEmail(on, '')).toBe(false)
    expect(isReviewEmail(env(REVIEW_EMAIL, ''), REVIEW_EMAIL)).toBe(false)
  })

  it('constantTimeEqual — 길이가 다르면 거짓', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('가', 'ab')).toBe(false)
  })

  it('verifyReviewPassword — 평문의 SHA-256 hex 가 비밀과 같을 때만', async () => {
    expect(await verifyReviewPassword(env(REVIEW_EMAIL, HASH), PASSWORD)).toBe(true)
    expect(await verifyReviewPassword(env(REVIEW_EMAIL, HASH), PASSWORD + 'x')).toBe(false)
    expect(await verifyReviewPassword(env(REVIEW_EMAIL, HASH), HASH)).toBe(false)
    expect(await verifyReviewPassword(env(undefined, HASH), PASSWORD)).toBe(false)
  })
})

describe('F-4018 A1 기능 꺼짐', () => {
  it('비밀 하나라도 없음·빈 값·형식 틀림 → 접힌 영역 없음, POST 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: Record<string, unknown>[] = [
      { REVIEW_LOGIN_EMAIL: undefined },
      { REVIEW_LOGIN_PASSWORD_HASH: undefined },
      { REVIEW_LOGIN_EMAIL: '' },
      { REVIEW_LOGIN_PASSWORD_HASH: '' },
      { REVIEW_LOGIN_PASSWORD_HASH: HASH.toUpperCase() },
    ]
    for (const over of cases) {
      const lim = limiter()
      const { env, raw } = makeEnv({ ...over, LOGIN_LIMITER: lim })
      const html = await (await call(env, '/login')).text()
      expect(html).not.toContain('/api/login/password')
      expect(html).not.toContain('<details')
      const res = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD })
      expect([JSON.stringify(over), res.status]).toEqual([JSON.stringify(over), 404])
      expect(await res.json()).toEqual({ error: 'not_found' })
      expect(lim.keys).toEqual([])
      expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)
    }
  })
})

describe('F-4018 A2 접힌 영역', () => {
  it('3장 문구 그대로, 별도 폼, 웹은 숨은 return. 소셜 폼은 그대로', async () => {
    const { env } = makeEnv()
    const html = await (await call(env, '/login?return=%23%2Fd%2Fabc')).text()
    const details = block(html, '<details class="login-password">', '</details>')
    const summary = block(details, '<summary>', '</summary>')
    expect(textOf(summary)).toBe('이메일로 로그인 (시험 계정 · Test account)')
    expect(textOf(details)).toContain('심사·시험용으로 발급한 계정만 쓸 수 있습니다. 새 가입은 Google·GitHub 로 하세요. · Only for the issued review account. To sign up, use Google or GitHub.')
    for (const en of ['Test account', 'Only for the issued review account. To sign up, use Google or GitHub.', 'Email', 'Password', 'Sign in']) {
      expect(details).toContain(`<span lang="en">${en}</span>`)
    }
    const pwForm = block(details, '<form method="post" action="/api/login/password"', '</form>')
    expect(pwForm).toContain('<input type="hidden" name="return" value="#/d/abc">')
    expect(pwForm).not.toContain('oauth_query')
    expect(pwForm).toMatch(/<label>[^<]*이메일 · <span lang="en">Email<\/span>[^<]*<input type="email" name="email" autocomplete="username" required><\/label>/)
    expect(pwForm).toMatch(/<label>[^<]*비밀번호 · <span lang="en">Password<\/span>[^<]*<input type="password" name="password" autocomplete="current-password" required><\/label>/)
    expect(pwForm).toContain('<button type="submit">로그인 · <span lang="en">Sign in</span></button>')
    expect(pwForm).not.toContain('name="provider"')
    expect(html).not.toContain('<details class="login-password" open>')

    // 소셜 폼은 꺼진 페이지와 글자까지 같고, 접힌 영역보다 앞
    const off = makeEnv({ REVIEW_LOGIN_EMAIL: undefined }).env
    const offHtml = await (await call(off, '/login?return=%23%2Fd%2Fabc')).text()
    const social = block(html, '<form class="login-form"', '</form>')
    expect(social).toBe(block(offHtml, '<form class="login-form"', '</form>'))
    expect(social).not.toContain('password')
    expect(html.indexOf('<form class="login-form"')).toBeLessThan(html.indexOf('<details'))
  })

  it('OAuth 갈래는 숨은 oauth_query, return 없음', async () => {
    const { env } = makeEnv()
    const { q } = await authorizeQuery(env, await registerClient(env), 'v1')
    const html = await (await call(env, `/login?${q}`)).text()
    const pwForm = block(html, '<form method="post" action="/api/login/password"', '</form>')
    expect(pwForm).toContain(`<input type="hidden" name="oauth_query" value="${escapeAttr(q)}">`)
    expect(pwForm).not.toContain('name="return"')
  })
})

describe('F-4018 A3 웹 로그인', () => {
  it('303 successUrl + 세션 → /api/me 그 이메일. 첫 로그인에만 행이 생기고 가입 관문은 그대로', async () => {
    const { env, raw } = makeEnv()
    const gate = () => raw.prepare('SELECT day, count FROM signup_gate').all()
    const gateBefore = gate()
    const res = await passwordLogin(env, { email: ' Reviewer@Example.net', password: PASSWORD, return: '#/cli-login/abc123' })
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/#/cli-login/abc123')
    const session = sessionOf(res.headers)
    expect(session).not.toBe('')
    const me = await call(env, '/api/me', { headers: { Cookie: session } })
    expect(me.status).toBe(200)
    expect(((await me.json()) as { email: string }).email).toBe(REVIEW_EMAIL)

    const user = raw.prepare('SELECT id, email_verified, name, created_at, updated_at FROM users WHERE email = ?').get(REVIEW_EMAIL) as Record<string, unknown>
    expect(user.email_verified).toBe(1)
    expect(user.name).toBe('')
    expect(typeof user.created_at).toBe('number')
    expect(String(user.updated_at)).toMatch(/^\d{4}-\d\d-\d\dT/)
    const account = raw.prepare("SELECT user_id, account_id, password FROM auth_accounts WHERE provider_id = 'credential'").all()
    expect(account).toEqual([{ user_id: user.id, account_id: user.id, password: 'worker-secret' }])

    const again = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD })
    expect([again.status, again.headers.get('Location')]).toEqual([303, '/?app=1'])
    expect(sessionOf(again.headers)).not.toBe('')
    expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(1)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM auth_accounts')).toBe(1)
    expect((raw.prepare('SELECT id FROM users').get() as { id: string }).id).toBe(user.id)
    expect(gate()).toEqual(gateBefore)
  })
})

describe('F-4018 A4 OAuth 이어가기', () => {
  it('authorize → /login → POST → 동의 → code → 토큰. 다시 연결하면 POST 가 곧장 code, /login CSP 에 앱 출처', async () => {
    const { env } = makeEnv()
    const clientId = await registerClient(env)
    const first = await authorizeQuery(env, clientId, 'v1')
    const res = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD, oauth_query: first.q })
    expect(res.status).toBe(303)
    const consent = res.headers.get('Location')!
    expect(consent.startsWith('/oauth/consent?')).toBe(true)
    const session = sessionOf(res.headers)
    expect(session).not.toBe('')

    const page = await call(env, consent, { headers: { Cookie: session } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`${REVIEW_EMAIL} 계정`)
    const consentQuery = consent.slice('/oauth/consent?'.length)
    const allow = await call(env, '/api/oauth/consent', form(`accept=yes&oauth_query=${encodeURIComponent(consentQuery)}`, { Cookie: session }))
    expect(allow.status).toBe(303)
    const back = new URL(allow.headers.get('Location')!)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    const token = await call(env, '/api/auth/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: first.verifier }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(token.status).toBe(200)

    const second = await authorizeQuery(env, clientId, 'v2')
    const loginPage = await call(env, `/login?${second.q}`)
    const csp = loginPage.headers.get('Content-Security-Policy-Report-Only') ?? loginPage.headers.get('Content-Security-Policy')!
    expect(csp).toMatch(/form-action [^;]*https:\/\/claude\.ai;/)
    const direct = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD, oauth_query: second.q })
    expect(direct.status).toBe(303)
    const code = direct.headers.get('Location')!
    expect(code.startsWith(`${REDIRECT}?code=`)).toBe(true)
    expect(new URL(code).searchParams.get('iss')).toBeTruthy()
    expect(sessionOf(direct.headers)).not.toBe('')
  })
})

describe('F-4018 A5 틀린 자격 증명', () => {
  it('틀린 비밀번호와 목록 밖 이메일은 Location·헤더까지 같고 D1 에 닿지 않는다', async () => {
    const prepared: string[] = []
    const { env, raw } = makeEnv({}, prepared)
    const wrongPassword = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD.slice(0, -1) + 'A' })
    const wrongEmail = await passwordLogin(env, { email: 'someone@example.net', password: PASSWORD })
    const empty = await passwordLogin(env, { email: REVIEW_EMAIL })
    for (const res of [wrongPassword, wrongEmail, empty]) {
      expect([res.status, res.headers.get('Location')]).toEqual([303, '/login?error=invalid_credentials'])
      expect(res.headers.getSetCookie()).toEqual([])
    }
    expect([...wrongPassword.headers.entries()]).toEqual([...wrongEmail.headers.entries()])
    expect(prepared).toEqual([])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)

    const withReturn = await passwordLogin(env, { email: REVIEW_EMAIL, password: 'x', return: '#/d/abc' })
    expect(withReturn.headers.get('Location')).toBe('/login?return=%23%2Fd%2Fabc&error=invalid_credentials')

    for (const [code, message] of [['invalid_credentials', WRONG], ['too_many_attempts', TOO_MANY]]) {
      const html = await (await call(env, `/login?error=${code}`)).text()
      expect(html).toContain(`<p class="login-error" role="alert">${message}</p>`)
      expect(html).toContain('<details class="login-password" open>')
      expect(html).not.toContain(`value="${REVIEW_EMAIL}"`)
    }
  })

  it('OAuth 갈래 실패는 /login?{q}&error= 로 돌아가 이어가기가 남는다', async () => {
    const { env } = makeEnv()
    const { q } = await authorizeQuery(env, await registerClient(env), 'v1')
    const res = await passwordLogin(env, { email: REVIEW_EMAIL, password: 'nope', oauth_query: q })
    expect([res.status, res.headers.get('Location')]).toEqual([303, `/login?${q}&error=invalid_credentials`])
    const html = await (await call(env, res.headers.get('Location')!)).text()
    expect(html).toContain(WRONG)
    expect(html).toContain(`name="oauth_query" value="${escapeAttr(q)}"`)
  })
})

describe('F-4018 A6 시도 제한', () => {
  it('success:false·바인딩 없음·던짐 → too_many_attempts, 세션 없음. 키는 login-pw:{IP}', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const blocked = limiter(false)
    const throwing = { limit: async () => { throw new Error('limiter down') } }
    for (const over of [{ LOGIN_LIMITER: blocked }, { LOGIN_LIMITER: undefined }, { LOGIN_LIMITER: throwing }]) {
      const { env, raw } = makeEnv(over)
      const res = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD }, { 'CF-Connecting-IP': '203.0.113.9' })
      expect([res.status, res.headers.get('Location')]).toEqual([303, '/login?error=too_many_attempts'])
      expect(res.headers.getSetCookie()).toEqual([])
      expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)
    }
    expect(blocked.keys).toEqual(['login-pw:203.0.113.9'])

    // 실패한 시도도 센다, IP 가 없으면 unknown
    const counting = limiter()
    const { env } = makeEnv({ LOGIN_LIMITER: counting })
    await passwordLogin(env, { email: REVIEW_EMAIL, password: 'nope' }, { 'CF-Connecting-IP': '198.51.100.7' })
    await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD })
    expect(counting.keys).toEqual(['login-pw:198.51.100.7', 'login-pw:unknown'])
  })
})

describe('F-4018 A7 관문', () => {
  it('Origin 없음·다른 출처 403, oauth_query 변조 request_expired, 크기·형식 bad_request', async () => {
    const lim = limiter()
    const { env, raw } = makeEnv({ LOGIN_LIMITER: lim })
    const body = new URLSearchParams({ email: REVIEW_EMAIL, password: PASSWORD }).toString()
    const none = await call(env, '/api/login/password', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) },
    })
    expect(none.status).toBe(403)
    expect(await none.json()).toEqual({ error: 'forbidden_origin' })
    const foreign = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD }, { Origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'forbidden_origin' })

    const { q } = await authorizeQuery(env, await registerClient(env), 'v1')
    const tampered = q.replace('state=st-1', 'state=st-2')
    expect(tampered).not.toBe(q)
    const expired = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD, oauth_query: tampered })
    expect([expired.status, expired.headers.get('Location')]).toEqual([303, EXPIRED])

    const big = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD, pad: 'x'.repeat(4096) })
    expect([big.status, big.headers.get('Location')]).toEqual([303, '/login?error=bad_request'])
    const json = await call(env, '/api/login/password', {
      method: 'POST',
      body: JSON.stringify({ email: REVIEW_EMAIL, password: PASSWORD }),
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '80' },
    })
    expect([json.status, json.headers.get('Location')]).toEqual([303, '/login?error=bad_request'])
    for (const res of [none, foreign, expired, big, json]) expect(res.headers.getSetCookie()).toEqual([])
    expect(lim.keys).toEqual([])
    expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)
  })
})

describe('F-4018 A8 안쪽 가입', () => {
  it('disableSignUp — 안쪽 sign-up/email 도 계정을 만들지 않는다', async () => {
    const { env, raw } = makeEnv()
    const res = await getAuth(env).handler(
      new Request('https://rawdoc.app/api/auth/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.net', password: PASSWORD, name: 'x' }),
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)
  })
})

describe('F-4018 A9 계정 경계', () => {
  function stubGoogle(email: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const now = Math.floor(Date.now() / 1000)
        const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email, email_verified: true }
        const part = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)))
        return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` })
      }),
    )
  }

  it('Google 로 심사 이메일 → reserved_email, 계정 행 0', async () => {
    const { env, raw } = makeEnv()
    stubGoogle('Reviewer@Example.net')
    const start = await call(env, '/api/login', form('provider=google'))
    expect(start.status).toBe(303)
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')
    const callback = await call(env, `/api/auth/callback/google?code=c&state=${state}`, {
      headers: { Cookie: cookiePairs(start.headers).join('; '), 'Sec-Fetch-Mode': 'navigate' },
    })
    expect(callback.headers.get('Location')).toMatch(/[?&]error=reserved_email/)
    expect(sessionOf(callback.headers)).toBe('')
    expect(count(raw, "SELECT COUNT(*) AS n FROM auth_accounts WHERE provider_id = 'google'")).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM users')).toBe(0)
  })

  it('심사 계정이 이미 있어도 같은 이메일 Google 로그인은 연결되지 않는다', async () => {
    const { env, raw } = makeEnv()
    expect((await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD })).status).toBe(303)
    const sessions = count(raw, 'SELECT COUNT(*) AS n FROM auth_sessions')
    stubGoogle(REVIEW_EMAIL)
    const start = await call(env, '/api/login', form('provider=google'))
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')
    const callback = await call(env, `/api/auth/callback/google?code=c&state=${state}`, {
      headers: { Cookie: cookiePairs(start.headers).join('; '), 'Sec-Fetch-Mode': 'navigate' },
    })
    expect(callback.headers.get('Location')).toMatch(/[?&]error=reserved_email/)
    expect(sessionOf(callback.headers)).toBe('')
    expect(count(raw, "SELECT COUNT(*) AS n FROM auth_accounts WHERE provider_id = 'google'")).toBe(0)
    expect(count(raw, "SELECT COUNT(*) AS n FROM auth_accounts WHERE provider_id = 'credential'")).toBe(1)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM auth_sessions')).toBe(sessions)
  })

  it('심사 이메일에 google 계정 행이 이미 있으면 비밀번호 로그인은 invalid_credentials, credential 행 0', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env, raw } = makeEnv()
    const iso = new Date().toISOString()
    raw.prepare("INSERT INTO users (id, email, created_at, email_verified, updated_at) VALUES ('u-real', ?, 1, 1, ?)").run(REVIEW_EMAIL, iso)
    raw.prepare("INSERT INTO auth_accounts (id, user_id, account_id, provider_id, created_at, updated_at) VALUES ('a-1', 'u-real', 'g-9', 'google', ?, ?)").run(iso, iso)
    const res = await passwordLogin(env, { email: REVIEW_EMAIL, password: PASSWORD })
    expect([res.status, res.headers.get('Location')]).toEqual([303, '/login?error=invalid_credentials'])
    expect(res.headers.getSetCookie()).toEqual([])
    expect(count(raw, "SELECT COUNT(*) AS n FROM auth_accounts WHERE provider_id = 'credential'")).toBe(0)
    expect(count(raw, 'SELECT COUNT(*) AS n FROM auth_sessions')).toBe(0)
    expect(error).toHaveBeenCalledWith('review_email_taken')
  })
})
