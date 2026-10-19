// OAuth 인가 서버 — worker/index.ts 를 통째로, 실제 better-auth + oauth-provider (specs/features/F-4009.md 4장 A1~A8)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../../src/lib/siteMeta'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
import { getAuth } from '../../worker/authServer'
import { secondsUntilUtcMidnight, utcDay } from '../../worker/usage'
import {
  OAUTH_SCOPES,
  REGISTER_DAILY_LIMIT,
  REGISTER_IP_DAILY_LIMIT,
  admitClientRegistration,
  cleanupOAuth,
  mcpResource,
  oauthIssuer,
  registerIpKey,
} from '../../worker/oauthServer'
import worker from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

const ORIGIN = new URL(SITE_URL).origin
const EMAIL = 'me@example.com'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const HOUR_MS = 60 * 60 * 1000

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function makeEnv(db: unknown = asAuthDb(openTestDb())): Env {
  return {
    DB: db,
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

async function login(env: Env): Promise<string> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const now = Math.floor(Date.now() / 1000)
      const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, sub: 'g-1', email: EMAIL, email_verified: true }
      const part = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)))
      return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${part({ alg: 'RS256' })}.${part(claims)}.sig` })
    }),
  )
  const body = 'provider=google&return=%23%2Fd%2Fabc'
  const start = await call(env, '/api/login', {
    method: 'POST',
    body,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) },
  })
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')
  const callback = await call(env, `/api/auth/callback/google?code=c&state=${state}`, { headers: { Cookie: cookiePairs(start.headers).join('; ') } })
  vi.unstubAllGlobals()
  const session = cookiePairs(callback.headers).find((c) => c.includes('session_token='))
  if (!session) throw new Error(`no session cookie (${callback.status})`)
  return session
}

function register(env: Env, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return call(env, '/api/auth/oauth2/register', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } })
}

async function registerClient(env: Env, redirect = REDIRECT): Promise<string> {
  const res = await register(env, { client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' })
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

function tokenCall(env: Env, params: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  return call(env, '/api/auth/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams(params).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  })
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; scope: string }

// authorize → (처음이면) 안쪽 consent 수락 → 리디렉트 주소
async function authorize(env: Env, cookie: string, clientId: string, challenge: string): Promise<URL> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'docs offline_access',
    state: 'st-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpResource(env),
  })
  const res = await call(env, `/api/auth/oauth2/authorize?${query}`, { headers: { Cookie: cookie } })
  expect(res.status).toBe(302)
  const location = res.headers.get('Location')!
  if (!location.startsWith('/oauth/consent?')) return new URL(location)
  const consent = await getAuth(env).handler(
    new Request(`${ORIGIN}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept: true, oauth_query: location.slice('/oauth/consent?'.length) }),
    }),
  )
  expect(consent.status).toBe(200)
  return new URL(((await consent.json()) as { url: string }).url)
}

async function pkce(seed: string) {
  const verifier = seed.padEnd(64, 'x')
  return { verifier, challenge: await sha256(verifier) }
}

// 로그인 → 등록 → 동의 → 교환까지 한 번
async function connect(env: Env) {
  const cookie = await login(env)
  const clientId = await registerClient(env)
  const { verifier, challenge } = await pkce('v1')
  const redirect = await authorize(env, cookie, clientId, challenge)
  const res = await tokenCall(env, { grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })
  expect(res.status).toBe(200)
  return { cookie, clientId, redirect, tokens: (await res.json()) as Tokens }
}

describe('F-4009 A1 AS 메타데이터', () => {
  it('두 주소가 같은 몸통, 발급자·S256·등록·iss·grant·scope, introspection 없음', async () => {
    const env = makeEnv()
    const withPath = await call(env, '/.well-known/oauth-authorization-server/api/auth')
    const root = await call(env, '/.well-known/oauth-authorization-server')
    expect([withPath.status, root.status]).toEqual([200, 200])
    expect(withPath.headers.get('Content-Type')).toContain('application/json')
    const body = (await withPath.json()) as Record<string, unknown>
    expect(await root.json()).toEqual(body)
    expect(body.issuer).toBe(oauthIssuer(env))
    expect(oauthIssuer(env)).toBe('https://rawdoc.app/api/auth')
    expect(body.code_challenge_methods_supported).toEqual(['S256'])
    expect(body.registration_endpoint).toBe('https://rawdoc.app/api/auth/oauth2/register')
    expect(body.authorization_response_iss_parameter_supported).toBe(true)
    expect(body.grant_types_supported).not.toContain('client_credentials')
    expect(Object.keys(body).filter((k) => k.startsWith('introspection_endpoint'))).toEqual([])
    expect(body.scopes_supported).toEqual(OAUTH_SCOPES)
    expect(OAUTH_SCOPES).toEqual(['docs', 'offline_access'])
  })

  it('그 밖의 /.well-known/* 는 404', async () => {
    const res = await call(makeEnv(), '/.well-known/unknown')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('F-4009 A2 동적 등록', () => {
  it('Origin 없는 등록 201 + client_id, 이름 저장, 루프백도 201', async () => {
    const env = makeEnv()
    const res = await register(env, { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { client_id: string }
    expect(typeof body.client_id).toBe('string')
    expect(sql(env).prepare('SELECT name FROM oauth_clients WHERE client_id = ?').get(body.client_id)).toEqual({ name: 'Claude' })

    const loopback = await register(env, { client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:33418/callback'], token_endpoint_auth_method: 'none' })
    expect(loopback.status).toBe(201)
  })
})

describe('F-4009 A3 인가 코드 흐름', () => {
  it('authorize → consent → code·iss → 교환, D1 에는 해시만, 자원 묶임, 틀린 verifier 는 invalid_grant', async () => {
    const env = makeEnv()
    const { cookie, clientId, redirect, tokens } = await connect(env)
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT)
    expect(redirect.searchParams.get('code')).toBeTruthy()
    expect(redirect.searchParams.get('iss')).toBe(oauthIssuer(env))
    expect(redirect.searchParams.get('state')).toBe('st-1')
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()

    const access = sql(env).prepare('SELECT token, resources FROM oauth_access_tokens').all() as { token: string; resources: string }[]
    expect(access).toHaveLength(1)
    expect(access[0].token).toBe(await sha256(tokens.access_token))
    expect(JSON.parse(access[0].resources)).toContain(mcpResource(env))
    expect(mcpResource(env)).toBe('https://rawdoc.app/mcp')
    const refresh = sql(env).prepare('SELECT token FROM oauth_refresh_tokens').all() as { token: string }[]
    expect(refresh).toEqual([{ token: await sha256(tokens.refresh_token) }])
    for (const table of ['oauth_access_tokens', 'oauth_refresh_tokens']) {
      const dump = JSON.stringify(sql(env).prepare(`SELECT * FROM ${table}`).all())
      expect(dump).not.toContain(tokens.access_token)
      expect(dump).not.toContain(tokens.refresh_token)
    }

    const second = await pkce('v2')
    const again = await authorize(env, cookie, clientId, second.challenge)
    const wrong = await tokenCall(env, { grant_type: 'authorization_code', code: again.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'w'.repeat(64) })
    expect(wrong.status).toBe(400)
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant')
  })
})

describe('F-4009 A4 갱신 토큰 회전', () => {
  it('새 쌍, 30초 안 재사용은 같은 응답, 30초 뒤 재사용은 invalid_grant 이고 가족 폐기, 접근 토큰 3600초', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 16, 3, 0, 0))
    const env = makeEnv()
    const { clientId, tokens } = await connect(env)
    const refresh = (token: string) => tokenCall(env, { grant_type: 'refresh_token', refresh_token: token, client_id: clientId })

    const first = await refresh(tokens.refresh_token)
    expect(first.status).toBe(200)
    const next = (await first.json()) as Tokens
    expect(next.access_token).not.toBe(tokens.access_token)
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    const replayDump = JSON.stringify(sql(env).prepare('SELECT * FROM oauth_refresh_tokens').all())
    expect(replayDump).not.toContain(next.access_token)
    expect(replayDump).not.toContain(next.refresh_token)
    const rows = sql(env).prepare('SELECT expires_at, created_at FROM oauth_access_tokens').all() as { expires_at: string; created_at: string }[]
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(3600 * 1000)

    vi.setSystemTime(Date.now() + 29_000)
    const replay = await refresh(tokens.refresh_token)
    expect(replay.status).toBe(200)
    // 같은 토큰 쌍을 돌려준다 — expires_in 만 지난 시간만큼 줄어 있다
    expect(await replay.json()).toEqual({ ...next, expires_in: next.expires_in - 29 })

    vi.setSystemTime(Date.now() + 2_000)
    const late = await refresh(tokens.refresh_token)
    expect(late.status).toBe(400)
    expect(((await late.json()) as { error: string }).error).toBe('invalid_grant')
    expect(count(sql(env), 'SELECT count(*) AS n FROM oauth_refresh_tokens WHERE revoked IS NULL')).toBe(0)
    const family = await refresh(next.refresh_token)
    expect(family.status).toBe(400)
  })
})

describe('F-4009 A5 등록 관문', () => {
  const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
  const TODAY = utcDay(NOW)
  const client = { client_name: 'X', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }
  const gate = (env: Env) => ({ ...(sql(env).prepare('SELECT day, count FROM oauth_register_gate WHERE id = 1').get() as { day: string; count: number }) })

  let ipSeq = 0
  const freshIp = () => ({ 'CF-Connecting-IP': `10.0.${ipSeq >> 8}.${ipSeq++ & 255}` })

  it('500번째 통과, 501번째 429·Retry-After, 다음 UTC 날 첫 등록 201, 틀린 요청도 센다', async () => {
    expect(REGISTER_DAILY_LIMIT).toBe(500)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const env = makeEnv()
    expect(gate(env)).toEqual({ day: '', count: 0 })
    const invalid = await register(env, { client_name: 'X' }, freshIp())
    expect(invalid.status).toBe(400)
    expect(gate(env)).toEqual({ day: TODAY, count: 1 })

    sql(env).prepare('UPDATE oauth_register_gate SET day = ?, count = ? WHERE id = 1').run(TODAY, 499)
    expect((await register(env, client, freshIp())).status).toBe(201)
    expect(gate(env)).toEqual({ day: TODAY, count: 500 })
    const before = count(sql(env), 'SELECT count(*) AS n FROM oauth_clients')

    const closed = await register(env, client, freshIp())
    expect(closed.status).toBe(429)
    expect(closed.headers.get('Retry-After')).toBe(String(secondsUntilUtcMidnight(NOW)))
    expect(await closed.json()).toEqual({ error: 'temporarily_unavailable', error_description: 'registration limit reached' })
    expect(count(sql(env), 'SELECT count(*) AS n FROM oauth_clients')).toBe(before)
    expect(gate(env)).toEqual({ day: TODAY, count: 500 })

    vi.setSystemTime(NOW + 24 * HOUR_MS)
    expect((await register(env, client, freshIp())).status).toBe(201)
    expect(gate(env)).toEqual({ day: utcDay(NOW + 24 * HOUR_MS), count: 1 })
  })

  it('관문은 IP 문장 하나, 통과하면 전역 문장 하나를 각각 run 한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    for (const [changes, status, statements] of [
      [1, null, 2],
      [0, 429, 1],
    ] as const) {
      const calls = { prepare: [] as string[], bind: [] as unknown[][], run: 0, batch: 0 }
      const DB = {
        prepare(text: string) {
          calls.prepare.push(text)
          return {
            bind(...args: unknown[]) {
              calls.bind.push(args)
              return {
                async run() {
                  calls.run++
                  return { success: true, meta: { changes } }
                },
              }
            },
          }
        },
        async batch() {
          calls.batch++
          return []
        },
      }
      const request = new Request('https://rawdoc.app/api/auth/oauth2/register', { headers: { 'CF-Connecting-IP': '203.0.113.7' } })
      const res = await admitClientRegistration(request, { DB } as unknown as Env)
      expect(calls.prepare).toHaveLength(statements)
      expect(calls.prepare[0]).toMatch(/^INSERT INTO oauth_register_ip /)
      expect(calls.bind[0]).toEqual(['203.0.113.7', TODAY, REGISTER_IP_DAILY_LIMIT])
      if (statements === 2) {
        expect(calls.prepare[1]).toMatch(/^UPDATE oauth_register_gate SET /)
        expect(calls.bind[1]).toEqual([TODAY, REGISTER_DAILY_LIMIT])
      }
      expect([calls.run, calls.batch]).toEqual([statements, 0])
      expect(res?.status ?? null).toBe(status)
    }
  })

  it('registerIpKey — IPv4 그대로, IPv6 는 /64, 해석 못 하면 unknown', () => {
    expect(registerIpKey('203.0.113.7')).toBe('203.0.113.7')
    expect(registerIpKey('2001:DB8:0:0:1::1')).toBe('2001:db8:0:0')
    expect(registerIpKey('2001:db8::')).toBe('2001:db8:0:0')
    expect(registerIpKey(null)).toBe('unknown')
    expect(registerIpKey('zz')).toBe('unknown')
  })

  it('같은 IP 21번째 429(전역은 20 에서 멈춤), 다른 IP 통과, 다음 날 다시 201, cleanupOAuth 가 어제 행만 지운다', async () => {
    expect(REGISTER_IP_DAILY_LIMIT).toBe(20)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const env = makeEnv()
    const same = { 'CF-Connecting-IP': '203.0.113.7' }
    for (let i = 0; i < 20; i++) expect((await register(env, client, same)).status).toBe(201)
    expect((await register(env, client, same)).status).toBe(429)
    expect(gate(env)).toEqual({ day: TODAY, count: 20 })
    expect((await register(env, client, { 'CF-Connecting-IP': '203.0.113.8' })).status).toBe(201)
    expect(gate(env)).toEqual({ day: TODAY, count: 21 })

    vi.setSystemTime(NOW + 24 * HOUR_MS)
    expect((await register(env, client, same)).status).toBe(201)
    sql(env).prepare("INSERT INTO oauth_register_ip (ip_key, day, count) VALUES ('old', ?, 3)").run(TODAY)
    await cleanupOAuth({ DB: asD1(sql(env)) } as unknown as Env, NOW + 24 * HOUR_MS)
    const rows = sql(env).prepare('SELECT ip_key FROM oauth_register_ip ORDER BY ip_key').all() as { ip_key: string }[]
    expect(rows.map((r) => r.ip_key)).toEqual(['203.0.113.7'])
  })
})

describe('F-4009 A6 닫힌 경로와 Origin 예외', () => {
  it('introspect·userinfo·바깥 consent·client/* 는 404, 다른 Origin 의 token 은 통과, Origin 없는 sign-out 은 403', async () => {
    const env = makeEnv()
    const closed: [string, string][] = [
      ['POST', '/api/auth/oauth2/introspect'],
      ['GET', '/api/auth/oauth2/userinfo'],
      ['POST', '/api/auth/oauth2/consent'],
      ['POST', '/api/auth/oauth2/client/rotate-secret'],
      ['GET', '/api/auth/oauth2/get-client'],
      ['POST', '/api/auth/oauth2/continue'],
      ['GET', '/api/auth/oauth2/end-session'],
    ]
    for (const [method, path] of closed) {
      const res = await call(env, path, { method, headers: method === 'GET' ? {} : { Origin: ORIGIN } })
      expect([path, res.status]).toEqual([path, 404])
      expect(await res.json()).toEqual({ error: 'not_found' })
    }

    const foreign = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: 'nope', client_id: 'nope' }, { Origin: 'https://evil.example' })
    expect(foreign.status).not.toBe(403)
    expect(((await foreign.json()) as { error: string }).error).not.toBe('forbidden_origin')

    const signOut = await call(env, '/api/auth/sign-out', { method: 'POST' })
    expect(signOut.status).toBe(403)
    expect(await signOut.json()).toEqual({ error: 'forbidden_origin' })
  })
})

describe('F-4009 A7 정리', () => {
  it('25시간 된 미사용 클라이언트만 지우고 만료 토큰 행은 0', async () => {
    const now = Date.UTC(2026, 9, 16, 18, 0, 0)
    const iso = (ms: number) => new Date(ms).toISOString()
    const db = openTestDb()
    db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u-1', 'a@example.org', 1)").run()
    const addClient = (id: string, age: number) =>
      db.prepare("INSERT INTO oauth_clients (id, client_id, redirect_uris, created_at) VALUES (?, ?, '[]', ?)").run(`row-${id}`, id, iso(now - age))
    addClient('old', 25 * HOUR_MS)
    addClient('consented', 25 * HOUR_MS)
    addClient('used', 25 * HOUR_MS)
    addClient('young', 23 * HOUR_MS)
    db.prepare("INSERT INTO oauth_consents (id, client_id, user_id, scopes, created_at, updated_at) VALUES ('c-1', 'consented', 'u-1', '[]', ?, ?)").run(iso(now), iso(now))
    db.prepare("INSERT INTO oauth_client_use (user_id, client_id, last_used_at) VALUES ('u-1', 'used', ?)").run(now)
    const addTokens = (id: string, expires: number) => {
      db.prepare("INSERT INTO oauth_refresh_tokens (id, token, client_id, user_id, expires_at, created_at, scopes) VALUES (?, ?, 'consented', 'u-1', ?, ?, '[]')").run(`r-${id}`, `rt-${id}`, iso(expires), iso(now - 2 * HOUR_MS))
      db.prepare("INSERT INTO oauth_access_tokens (id, token, client_id, user_id, expires_at, created_at, scopes) VALUES (?, ?, 'consented', 'u-1', ?, ?, '[]')").run(`a-${id}`, `at-${id}`, iso(expires), iso(now - 2 * HOUR_MS))
      db.prepare('INSERT INTO oauth_client_assertions (id, expires_at) VALUES (?, ?)').run(`x-${id}`, iso(expires))
    }
    addTokens('expired', now - 1000)
    addTokens('live', now + HOUR_MS)

    await cleanupOAuth({ DB: asD1(db) } as unknown as Env, now)

    expect(db.prepare('SELECT client_id FROM oauth_clients ORDER BY client_id').all().map((r) => (r as { client_id: string }).client_id)).toEqual(['consented', 'used', 'young'])
    const cutoff = iso(now)
    for (const table of ['oauth_access_tokens', 'oauth_refresh_tokens', 'oauth_client_assertions']) {
      expect([table, count(db, `SELECT count(*) AS n FROM ${table} WHERE expires_at < ?`, cutoff)]).toEqual([table, 0])
      expect([table, count(db, `SELECT count(*) AS n FROM ${table}`)]).toEqual([table, 1])
    }
  })
})

describe('F-4009 A8 계정 삭제와 로그아웃', () => {
  it('계정 삭제 batch 뒤 그 사용자의 토큰·동의·사용 행 0, 공개 클라이언트는 남는다', async () => {
    const env = makeEnv()
    const { clientId } = await connect(env)
    const userId = (sql(env).prepare('SELECT id FROM users').get() as { id: string }).id
    sql(env).prepare('INSERT INTO oauth_client_use (user_id, client_id, last_used_at) VALUES (?, ?, ?)').run(userId, clientId, Date.now())
    const owned = ['oauth_access_tokens', 'oauth_refresh_tokens', 'oauth_consents', 'oauth_client_use']
    for (const table of owned) expect([table, count(sql(env), `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, userId)]).toEqual([table, 1])

    const local = 'http://localhost:8790'
    const devEnv = { DB: asD1(sql(env)), BETTER_AUTH_URL: local, DEV_AUTH_EMAIL: EMAIL } as unknown as Env
    const del = await worker.fetch(new Request(`${local}/api/account`, { method: 'DELETE', headers: { Origin: local } }) as never, devEnv, ctx)
    expect(del.status).toBe(204)
    expect(count(sql(env), 'SELECT count(*) AS n FROM users')).toBe(0)
    for (const table of owned) expect([table, count(sql(env), `SELECT count(*) AS n FROM ${table}`)]).toEqual([table, 0])
    expect(count(sql(env), 'SELECT count(*) AS n FROM oauth_clients WHERE client_id = ?', clientId)).toBe(1)
  })

  it('로그아웃 뒤 그 세션의 접근 토큰은 revoked, 갱신은 된다', async () => {
    const env = makeEnv()
    const { cookie, clientId, tokens } = await connect(env)
    const out = await call(env, '/api/auth/sign-out', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
    expect(out.status).toBe(200)
    const access = sql(env).prepare('SELECT revoked FROM oauth_access_tokens WHERE token = ?').get(await sha256(tokens.access_token)) as { revoked: string | null }
    expect(access.revoked).not.toBeNull()
    const refreshed = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })
    expect(refreshed.status).toBe(200)
    expect(((await refreshed.json()) as Tokens).access_token).toBeTruthy()
  })
})
