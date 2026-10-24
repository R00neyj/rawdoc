// /mcp 토큰 관문·보호 자원 메타데이터·OpenAI 도메인 확인 (specs/features/F-4011.md 6장 M1~M6·M8·M9)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../../src/lib/site/siteMeta'
import brand from '../../brand.config'
import { asD1, openTestDb } from '../../worker/testD1'
import { authenticateMcp } from '../../worker/mcpAuth'
import { mcpResource, oauthIssuer } from '../../worker/oauthServer'
import worker from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

const ORIGIN = new URL(SITE_URL).origin
const NOW = Date.parse('2026-10-16T05:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const METADATA = 'https://rawdoc.app/.well-known/oauth-protected-resource/mcp'
const CHALLENGE = `Bearer resource_metadata="${METADATA}", scope="docs offline_access"`
const INVALID = `Bearer error="invalid_token", resource_metadata="${METADATA}", scope="docs offline_access"`
const INSUFFICIENT = `Bearer error="insufficient_scope", resource_metadata="${METADATA}", scope="docs offline_access"`

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const iso = (ms: number) => new Date(ms).toISOString()

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

// 실행된 문장을 센다 — waitUntil 로 넘긴 쓰기도 run() 에서 잡힌다
function countingD1(inner: D1Database) {
  const executed: string[] = []
  function wrap(sql: string, stmt: D1PreparedStatement): D1PreparedStatement {
    return {
      bind: (...args: unknown[]) => wrap(sql, stmt.bind(...args)),
      first: () => (executed.push(sql), stmt.first()),
      all: () => (executed.push(sql), stmt.all()),
      run: () => (executed.push(sql), stmt.run()),
    } as unknown as D1PreparedStatement
  }
  const db = {
    prepare: (sql: string) => wrap(sql, inner.prepare(sql)),
    batch: () => {
      throw new Error('batch 없음')
    },
  } as unknown as D1Database
  return { db, executed }
}

function setup(over: Record<string, unknown> = {}) {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u1', 'me@example.com')
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u2', 'other@example.com')
  addClient(sqlDb, 'c1', { name: 'Claude' })
  const { db, executed } = countingD1(asD1(sqlDb))
  const env = { DB: db, BETTER_AUTH_URL: 'https://rawdoc.app', DEV_AUTH_EMAIL: '', ...over } as unknown as Env
  return { sqlDb, env, executed }
}

function addClient(sqlDb: DatabaseSync, clientId: string, opts: { name?: string | null; redirect?: string; disabled?: number | null } = {}) {
  const { name = 'Claude', redirect = 'https://claude.ai/api/mcp/auth_callback', disabled = 0 } = opts
  sqlDb
    .prepare('INSERT INTO oauth_clients (id, client_id, disabled, created_at, updated_at, name, redirect_uris) VALUES (?,?,?,?,?,?,?)')
    .run(`row-${clientId}`, clientId, disabled, iso(NOW), iso(NOW), name, JSON.stringify([redirect]))
}

type TokenOpts = { userId?: string; clientId?: string; expiresAt?: number; revoked?: string | null; scopes?: string[]; resources?: string[]; sessionId?: string | null }

async function addToken(sqlDb: DatabaseSync, token: string, opts: TokenOpts = {}) {
  const { userId = 'u1', clientId = 'c1', expiresAt = NOW + HOUR_MS, revoked = null, scopes = ['docs', 'offline_access'], resources = ['https://rawdoc.app/mcp'], sessionId = null } = opts
  sqlDb
    .prepare('INSERT INTO oauth_access_tokens (id, token, client_id, session_id, user_id, resources, expires_at, created_at, revoked, scopes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(`id-${token}`, await sha256(token), clientId, sessionId, userId, JSON.stringify(resources), iso(expiresAt), iso(NOW), revoked, JSON.stringify(scopes))
}

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, pending }
}

async function authenticate(env: Env, headers: Record<string, string> = {}) {
  const { ctx, pending } = makeCtx()
  const request = new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } })
  const result = await authenticateMcp(request, env, ctx)
  await Promise.all(pending)
  return result
}

async function expectRejected(result: unknown, status: number, challenge: string, error: string) {
  expect(result).toBeInstanceOf(Response)
  const res = result as Response
  expect(res.status).toBe(status)
  expect(res.headers.get('WWW-Authenticate')).toBe(challenge)
  expect(await res.json()).toEqual({ error })
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('F-4011 M1 Authorization 없음', () => {
  it('401 unauthenticated, 도전은 error 없는 첫 줄 글자 그대로, D1 읽지 않음', async () => {
    const { env, executed } = setup()
    await expectRejected(await authenticate(env), 401, CHALLENGE, 'unauthenticated')
    expect(executed).toEqual([])
  })
})

describe('F-4011 M2 무효 토큰', () => {
  it('모르는 토큰·만료·revoked·disabled 클라이언트·rd_ API 토큰 → 401 invalid_token', async () => {
    const { sqlDb, env } = setup()
    addClient(sqlDb, 'c-off', { disabled: 1 })
    await addToken(sqlDb, 'expired', { expiresAt: NOW - 1 })
    await addToken(sqlDb, 'expiring-now', { expiresAt: NOW })
    await addToken(sqlDb, 'revoked', { revoked: iso(NOW - MINUTE_MS) })
    await addToken(sqlDb, 'disabled', { clientId: 'c-off' })
    const apiToken = 'rd_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiToken)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    sqlDb.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?,?,?,?,?,?)').run('t1', 'u1', 'cli', hex, apiToken.slice(0, 11), 1)

    for (const token of ['unknown', 'expired', 'expiring-now', 'revoked', 'disabled', apiToken]) {
      await expectRejected(await authenticate(env, bearer(token)), 401, INVALID, 'invalid_token')
    }
  })

  it('쿠키만(개발 우회 켠 로컬에서도) → 401, 토큰이 없으므로 error 없는 도전', async () => {
    const { env } = setup({ BETTER_AUTH_URL: 'http://localhost:8790', DEV_AUTH_EMAIL: 'me@example.com' })
    const result = await authenticate(env, { Cookie: '__Secure-better-auth.session_token=abc.def' })
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
    expect((result as Response).headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://localhost:8790/.well-known/oauth-protected-resource/mcp", scope="docs offline_access"',
    )
  })
})

describe('F-4011 M3 자원·범위', () => {
  it('다른 자원 → 401 invalid_token, docs 없음 → 403 insufficient_scope, 둘 다 사용 기록 없음', async () => {
    const { sqlDb, env } = setup()
    await addToken(sqlDb, 'elsewhere', { resources: ['https://example.com/mcp'] })
    await addToken(sqlDb, 'no-resource', { resources: [] })
    await addToken(sqlDb, 'offline-only', { scopes: ['offline_access'] })
    await expectRejected(await authenticate(env, bearer('elsewhere')), 401, INVALID, 'invalid_token')
    await expectRejected(await authenticate(env, bearer('no-resource')), 401, INVALID, 'invalid_token')
    await expectRejected(await authenticate(env, bearer('offline-only')), 403, INSUFFICIENT, 'insufficient_scope')
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM oauth_client_use').get()).toEqual({ n: 0 })
  })

  it('offline_access 는 요구하지 않는다', async () => {
    const { sqlDb, env } = setup()
    await addToken(sqlDb, 'docs-only', { scopes: ['docs'] })
    expect(await authenticate(env, bearer('docs-only'))).not.toBeInstanceOf(Response)
  })
})

describe('F-4011 M4 정상', () => {
  it('McpCaller — id·email·usage·clientId·clientName, sessionId 없음', async () => {
    const { sqlDb, env } = setup()
    sqlDb.prepare('UPDATE users SET write_count = 3, write_day = ? WHERE id = ?').run('2026-10-16', 'u1')
    await addToken(sqlDb, 'good')
    const caller = await authenticate(env, bearer('good'))
    expect(caller).toEqual({
      user: {
        id: 'u1',
        email: 'me@example.com',
        usage: { writeDay: '2026-10-16', writeCount: 3, contentBytes: 0, docCount: 0, blockedAt: null, warnedAt: null },
      },
      clientId: 'c1',
      clientName: 'Claude',
    })
  })

  it('이름 없는 클라이언트는 돌아갈 호스트를 이름으로', async () => {
    const { sqlDb, env } = setup()
    addClient(sqlDb, 'c-anon', { name: null, redirect: 'http://127.0.0.1:33418/callback' })
    await addToken(sqlDb, 'anon', { clientId: 'c-anon' })
    expect(await authenticate(env, bearer('anon'))).toMatchObject({ clientId: 'c-anon', clientName: '127.0.0.1:33418' })
  })

  it('session_id NULL·지워진 세션이어도 revoked NULL 이면 통과, 막힌 계정도 통과', async () => {
    const { sqlDb, env } = setup()
    sqlDb
      .prepare('INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run('s1', 'u1', 'session-token', iso(NOW + HOUR_MS), iso(NOW), iso(NOW))
    await addToken(sqlDb, 'no-session', { sessionId: null })
    await addToken(sqlDb, 'gone-session', { sessionId: 's1' })
    sqlDb.prepare('DELETE FROM auth_sessions WHERE id = ?').run('s1')
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(NOW - HOUR_MS, 'u1')

    for (const token of ['no-session', 'gone-session']) {
      const caller = await authenticate(env, bearer(token))
      expect(caller).not.toBeInstanceOf(Response)
      expect(caller).toMatchObject({ user: { id: 'u1', usage: { blockedAt: NOW - HOUR_MS } }, clientId: 'c1' })
    }
  })
})

describe('F-4011 M5 Origin', () => {
  it('다른 출처 Origin → 유효 토큰이어도 403 forbidden_origin·D1 쿼리 0', async () => {
    const { sqlDb, env, executed } = setup()
    await addToken(sqlDb, 'good')
    const result = await authenticate(env, { ...bearer('good'), Origin: 'https://evil.example' })
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(403)
    expect(await (result as Response).json()).toEqual({ error: 'forbidden_origin' })
    expect(executed).toEqual([])
  })

  it('Origin 없음·https://rawdoc.app → 통과', async () => {
    const { sqlDb, env } = setup()
    await addToken(sqlDb, 'good')
    expect(await authenticate(env, bearer('good'))).not.toBeInstanceOf(Response)
    expect(await authenticate(env, { ...bearer('good'), Origin: 'https://rawdoc.app' })).not.toBeInstanceOf(Response)
  })
})

describe('F-4011 M6 마지막 사용', () => {
  it('첫 호출 행 생김, 10분 안 두 번째 쓰기 0, 10분 넘으면 갱신', async () => {
    const { sqlDb, env, executed } = setup()
    await addToken(sqlDb, 'good', { expiresAt: NOW + 2 * HOUR_MS })
    const uses = () => sqlDb.prepare('SELECT user_id, client_id, last_used_at FROM oauth_client_use').all()
    const writes = () => executed.filter((sql) => !sql.trimStart().toUpperCase().startsWith('SELECT')).length

    await authenticate(env, bearer('good'))
    expect(uses()).toEqual([{ user_id: 'u1', client_id: 'c1', last_used_at: NOW }])
    expect(writes()).toBe(1)

    vi.setSystemTime(NOW + 10 * MINUTE_MS)
    await authenticate(env, bearer('good'))
    expect(writes()).toBe(1)
    expect(uses()).toEqual([{ user_id: 'u1', client_id: 'c1', last_used_at: NOW }])

    vi.setSystemTime(NOW + 10 * MINUTE_MS + 1)
    await authenticate(env, bearer('good'))
    expect(writes()).toBe(2)
    expect(uses()).toEqual([{ user_id: 'u1', client_id: 'c1', last_used_at: NOW + 10 * MINUTE_MS + 1 }])
  })
})

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init) as never, env, makeCtx().ctx)
}

describe('F-4011 M8 보호 자원 메타데이터', () => {
  it('두 경로 같은 JSON, 자원·발급자 글자까지 같음, 공개 캐시·CORS', async () => {
    const { env } = setup()
    const root = await call(env, '/.well-known/oauth-protected-resource')
    const withPath = await call(env, '/.well-known/oauth-protected-resource/mcp')
    expect([root.status, withPath.status]).toEqual([200, 200])
    const body = (await withPath.json()) as { resource: string; authorization_servers: string[] }
    expect(await root.json()).toEqual(body)
    expect(body).toEqual({
      resource: mcpResource(env),
      authorization_servers: [oauthIssuer(env)],
      scopes_supported: ['docs', 'offline_access'],
      bearer_methods_supported: ['header'],
      resource_name: brand.name,
    })
    expect(body.resource).toBe('https://rawdoc.app/mcp')
    expect(body.authorization_servers[0]).toBe('https://rawdoc.app/api/auth')
    for (const res of [root, withPath]) {
      expect(res.headers.get('Content-Type')).toContain('application/json')
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
    expect(new URL(METADATA).pathname).toBe('/.well-known/oauth-protected-resource/mcp')
  })

  it('HEAD 200, POST 405 method_not_allowed', async () => {
    const { env } = setup()
    expect((await call(env, '/.well-known/oauth-protected-resource/mcp', { method: 'HEAD' })).status).toBe(200)
    const post = await call(env, '/.well-known/oauth-protected-resource', { method: 'POST' })
    expect(post.status).toBe(405)
    expect(await post.json()).toEqual({ error: 'method_not_allowed' })
  })
})

describe('F-4011 M9 OpenAI 도메인 확인', () => {
  it('비밀이 있으면 200 평문(앞뒤 공백 자름)·no-store', async () => {
    const { env } = setup({ OPENAI_APPS_CHALLENGE: '  abc-123\n' })
    const res = await call(env, '/.well-known/openai-apps-challenge')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toBe('abc-123')
  })

  it('비거나 없으면 404 not_found, POST 405', async () => {
    for (const over of [{}, { OPENAI_APPS_CHALLENGE: '' }, { OPENAI_APPS_CHALLENGE: '   ' }]) {
      const res = await call(setup(over).env, '/.well-known/openai-apps-challenge')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    const post = await call(setup({ OPENAI_APPS_CHALLENGE: 'abc' }).env, '/.well-known/openai-apps-challenge', { method: 'POST' })
    expect(post.status).toBe(405)
  })
})
