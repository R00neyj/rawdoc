// 요청 → 사용자 판정: /v1/ 토큰, 로컬 개발 우회, better-auth 세션 (specs/features/F-2033.md 3장, U14~U21)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getUser, getUserRefreshing } from './auth'
import { AuthConfigError, getAuth } from './authServer'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const SECRET = 's'.repeat(40)
const DAY_MS = 24 * 60 * 60 * 1000

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + file, 'utf-8'))
  }
  return db
}

function sessionEnv(db: unknown, over: Record<string, unknown> = {}): Env {
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

function b64url(value: unknown): string {
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

// U3 방식 — signInSocial → 콜백으로 세션을 만들고 세션 쿠키를 돌려준다
async function sessionCookie(db: DatabaseSync, email = 'me@example.org'): Promise<string> {
  stubGoogle(email)
  const auth = getAuth(sessionEnv(db))
  const start = await auth.api.signInSocial({
    body: { provider: 'google', callbackURL: '/#/d/abc', errorCallbackURL: '/login' },
    headers: new Headers(),
    returnHeaders: true,
  })
  const state = new URL(start.response.url as string).searchParams.get('state')
  const res = await auth.handler(
    new Request(`https://rawdoc.app/api/auth/callback/google?code=c&state=${state}`, {
      headers: { Cookie: cookiePairs(start.headers).join('; ') },
    }),
  )
  vi.unstubAllGlobals()
  const session = cookiePairs(res.headers).find((c) => c.includes('session_token='))
  if (!session) throw new Error(`no session cookie (${res.status} ${res.headers.get('Location')})`)
  return session
}

function apiRequest(cookie?: string, path = '/api/docs'): Request {
  return new Request(`https://rawdoc.app${path}`, cookie ? { headers: { Cookie: cookie } } : undefined)
}

function expiresAt(db: DatabaseSync): string {
  return (db.prepare('SELECT expires_at FROM auth_sessions').get() as { expires_at: string }).expires_at
}

function setExpiresAt(db: DatabaseSync, when: number) {
  db.prepare('UPDATE auth_sessions SET expires_at = ?').run(new Date(when).toISOString())
}

// 우회 문장만 받는 가짜 D1 — 그 밖의 문장은 던진다
function bypassDb() {
  const calls: { sql: string; args: unknown[] }[] = []
  const users = new Map<string, { id: string; email: string }>()
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args })
          return {
            async run() {
              if (!sql.startsWith('INSERT INTO users')) throw new Error(`unhandled sql: ${sql}`)
              const [id, email] = args as [string, string]
              if (!users.has(email)) users.set(email, { id, email })
              return { meta: { changes: 1 } }
            },
            async first<T>() {
              if (!sql.startsWith('SELECT id, email FROM users WHERE email = ?')) throw new Error(`unhandled sql: ${sql}`)
              return (users.get(args[0] as string) as T) ?? null
            },
          }
        },
      }
    },
    async batch() {
      throw new Error('unexpected batch')
    },
    async exec() {
      throw new Error('unexpected exec')
    },
  }
  return { DB, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type ApiTokenRow = { id: string; user_id: string; token_hash: string; last_used_at: number | null; revoked_at: number | null }
type UserRow = { id: string; email: string }

function tokenEnv(tokens: ApiTokenRow[], users: UserRow[]) {
  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  const userById = new Map(users.map((u) => [u.id, u]))
  const updateCalls: [number, string][] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT id, user_id, last_used_at FROM api_tokens')) {
                const [tokenHash] = args as [string]
                const row = [...tokenById.values()].find((t) => t.token_hash === tokenHash && !t.revoked_at)
                return (row as T) ?? null
              }
              if (sql.startsWith('SELECT id, email FROM users')) {
                const [id] = args as [string]
                return (userById.get(id) as T) ?? null
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('UPDATE api_tokens SET last_used_at')) {
                const [now, id] = args as [number, string]
                updateCalls.push([now, id])
                const row = tokenById.get(id)
                if (row) row.last_used_at = now
                return { meta: { changes: row ? 1 : 0 } }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { env: sessionEnv(DB), updateCalls, tokenById }
}

describe('F-222 A2 /v1/ 토큰 판정', () => {
  it('올바른 Bearer 토큰이면 사용자를 돌려준다', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    const user = await getUser(request, env)
    expect(user).toEqual({ id: 'u1', email: 'user@example.com' })
  })

  it('폐기된 토큰이면 null', async () => {
    const tokenHash = await sha256Hex('rd_revoked')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: Date.now() }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_revoked' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('틀린 토큰이면 null', async () => {
    const { env } = tokenEnv([], [])
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_wrong' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('헤더가 없으면 null', async () => {
    const { env } = tokenEnv([], [])
    const request = new Request('https://app.example.com/v1/docs')
    expect(await getUser(request, env)).toBeNull()
  })

  it('/v1/ 요청에 better-auth 세션 쿠키만 있으면 null', async () => {
    const db = openDb()
    const cookie = await sessionCookie(db)
    expect(await getUser(apiRequest(cookie), sessionEnv(db))).not.toBeNull()
    const { env } = tokenEnv([], [])
    const request = new Request('https://rawdoc.app/v1/docs', { headers: { Cookie: cookie } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('/api/ 요청에 Bearer 헤더만 있으면 null (토큰은 /v1/ 에서만 본다)', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const { env } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/api/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    expect(await getUser(request, env)).toBeNull()
  })

  it('last_used_at 은 10분 넘게 지났거나 null 일 때만 갱신한다', async () => {
    const tokenHash = await sha256Hex('rd_valid')
    const now = Date.now()
    const { env, updateCalls } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: now - 1000, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    const request = new Request('https://app.example.com/v1/docs', { headers: { Authorization: 'Bearer rd_valid' } })
    await getUser(request, env)
    expect(updateCalls.length).toBe(0)

    const { env: env2, updateCalls: updateCalls2 } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: now - 11 * 60 * 1000, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    await getUser(request, env2)
    expect(updateCalls2.length).toBe(1)

    const { env: env3, updateCalls: updateCalls3 } = tokenEnv(
      [{ id: 't1', user_id: 'u1', token_hash: tokenHash, last_used_at: null, revoked_at: null }],
      [{ id: 'u1', email: 'user@example.com' }],
    )
    await getUser(request, env3)
    expect(updateCalls3.length).toBe(1)
  })
})

describe('F-2033 U15·U16 로컬 개발 우회', () => {
  it('U15 로컬 인증 모드 + @example.com 이면 better-auth 없이 그 이메일 사용자', async () => {
    const { DB, calls } = bypassDb()
    const env = { DB, BETTER_AUTH_URL: 'http://localhost:8790', DEV_AUTH_EMAIL: 'Dev@Example.com' } as unknown as Env
    const user = await getUser(new Request('http://rawdoc.app/api/docs'), env)
    expect(user).toEqual({ id: expect.any(String), email: 'dev@example.com' })
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO users'))!
    expect(insert.sql).toContain('ON CONFLICT(email) DO NOTHING')
    const columns = insert.sql.slice(insert.sql.indexOf('(') + 1, insert.sql.indexOf(')')).split(',').map((s) => s.trim())
    expect(insert.args[columns.indexOf('email_verified')]).toBe(1)
    expect(String(insert.args[columns.indexOf('updated_at')])).toMatch(/Z$/)
    expect(await getUserRefreshing(new Request('http://rawdoc.app/api/me'), env)).toEqual({
      user: { id: user!.id, email: 'dev@example.com' },
      setCookies: [],
    })
  })

  it('U16 운영 주소·예약 도메인이 아닌 이메일·빈 값이면 우회하지 않는다', async () => {
    const cases = [
      { BETTER_AUTH_URL: 'https://rawdoc.app', DEV_AUTH_EMAIL: 'dev@example.com' },
      { BETTER_AUTH_URL: 'http://localhost:8790', DEV_AUTH_EMAIL: 'dev@rawdoc.app' },
      { BETTER_AUTH_URL: 'http://localhost:8790', DEV_AUTH_EMAIL: '' },
    ]
    for (const vars of cases) {
      const { DB, calls } = bypassDb()
      const env = sessionEnv(DB, vars)
      expect(await getUser(apiRequest(), env)).toBeNull()
      expect(calls).toEqual([])
    }
  })
})

describe('F-2033 U17~U21 better-auth 세션', () => {
  it('U17 세션 쿠키로 사용자, 없거나 모르는 토큰이면 null', async () => {
    const db = openDb()
    const cookie = await sessionCookie(db)
    const env = sessionEnv(db)
    const user = await getUser(apiRequest(cookie), env)
    expect(user).toEqual({ id: expect.any(String), email: 'me@example.org' })
    expect(Object.keys(user!).sort()).toEqual(['email', 'id'])
    expect(await getUser(apiRequest(), env)).toBeNull()
    const name = cookie.slice(0, cookie.indexOf('='))
    expect(await getUser(apiRequest(`${name}=unknown.token`), env)).toBeNull()
  })

  it('U18 getUser 는 연장하지 않는다', async () => {
    const db = openDb()
    const cookie = await sessionCookie(db)
    setExpiresAt(db, Date.now() + 28 * DAY_MS)
    const before = expiresAt(db)
    expect(await getUser(apiRequest(cookie), sessionEnv(db))).not.toBeNull()
    expect(expiresAt(db)).toBe(before)
  })

  it('U19 getUserRefreshing 은 연장하고 쿠키를 돌려준다, 곧바로 다시 부르면 없다', async () => {
    const db = openDb()
    const cookie = await sessionCookie(db)
    setExpiresAt(db, Date.now() + 28 * DAY_MS)
    const before = expiresAt(db)
    const env = sessionEnv(db)
    const first = await getUserRefreshing(apiRequest(cookie, '/api/me'), env)
    expect(first.user).toEqual({ id: expect.any(String), email: 'me@example.org' })
    expect(first.setCookies.length).toBe(1)
    expect(first.setCookies[0]).toContain('session_token=')
    expect(first.setCookies[0]).toContain('Max-Age=2592000')
    expect(expiresAt(db) > before).toBe(true)
    const second = await getUserRefreshing(apiRequest(cookie, '/api/me'), env)
    expect(second.user).not.toBeNull()
    expect(second.setCookies).toEqual([])
  })

  it('U20 만료 세션은 사용자 없음, 연장 조회는 쿠키를 지운다', async () => {
    const db = openDb()
    const cookie = await sessionCookie(db)
    setExpiresAt(db, Date.now() - 1000)
    const env = sessionEnv(db)
    expect(await getUser(apiRequest(cookie), env)).toBeNull()
    const refreshed = await getUserRefreshing(apiRequest(cookie, '/api/me'), env)
    expect(refreshed.user).toBeNull()
    expect(refreshed.setCookies.some((c) => c.includes('session_token=') && /Max-Age=0/.test(c))).toBe(true)
  })

  it('U21 비밀이 없으면 세션 판정은 던지고 /v1/ 은 던지지 않는다', async () => {
    const env = sessionEnv(openDb(), { BETTER_AUTH_SECRET: undefined })
    await expect(getUser(apiRequest('__Secure-better-auth.session_token=a.b'), env)).rejects.toBeInstanceOf(AuthConfigError)
    await expect(getUserRefreshing(apiRequest('__Secure-better-auth.session_token=a.b', '/api/me'), env)).rejects.toBeInstanceOf(AuthConfigError)
    expect(await getUser(new Request('https://rawdoc.app/v1/docs'), env)).toBeNull()
  })
})
