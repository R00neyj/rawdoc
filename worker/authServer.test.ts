// better-auth 인스턴스·스키마·콜백 흉내·설정 검사 (specs/features/F-2033.md 2장·4장·8장, U1~U13)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { betterAuth } from 'better-auth'
import {
  AUTH_SECRET_MIN_LENGTH,
  AuthConfigError,
  SIGNUP_DAILY_LIMIT,
  admitNewUser,
  authOptions,
  cleanupExpiredAuth,
  getAuth,
} from './authServer'
import type { ValidateUserInfoData } from './authServer'
import { getUser } from './auth'
import { asAuthDb, asD1 } from './testD1'
import { utcDay } from './usage'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const SECRET = 's'.repeat(40)
const RETURN = '#/d/abc'
const SUCCESS = '/#/d/abc'
const FAILURE = '/login?return=%23%2Fd%2Fabc'

function openDb(until = '9999'): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.slice(0, 4) <= until) db.exec(readFileSync(MIGRATIONS + file, 'utf-8'))
  }
  return db
}

function makeEnv(db: unknown, over: Record<string, unknown> = {}): Env {
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

function rows(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type GithubEmail = { email: string; primary: boolean; verified: boolean }
type Providers = { google?: Record<string, unknown>; github?: { id: number; email: string | null; emails: GithubEmail[] } }

function stubProviders(p: Providers) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const now = Math.floor(Date.now() / 1000)
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const claims = { iss: 'https://accounts.google.com', aud: 'google-id', iat: now, exp: now + 3600, ...p.google }
        return Response.json({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig` })
      }
      if (url.startsWith('https://github.com/login/oauth/access_token')) {
        return Response.json({ access_token: 'gh', token_type: 'bearer', scope: 'read:user,user:email' })
      }
      if (url === 'https://api.github.com/user' && p.github) {
        return Response.json({ id: p.github.id, login: 'octo', name: 'Octo', email: p.github.email, avatar_url: 'https://x/y.png' })
      }
      if (url === 'https://api.github.com/user/emails' && p.github) return Response.json(p.github.emails)
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

function cookieHeader(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ')
}

type AnyAuth = ReturnType<typeof getAuth>

async function signIn(auth: AnyAuth, provider: 'google' | 'github') {
  const start = await auth.api.signInSocial({
    body: { provider, callbackURL: SUCCESS, errorCallbackURL: FAILURE },
    headers: new Headers(),
    returnHeaders: true,
  })
  const state = new URL(start.response.url as string).searchParams.get('state')
  const res = await auth.handler(
    new Request(`https://rawdoc.app/api/auth/callback/${provider}?code=c&state=${state}`, {
      headers: { Cookie: cookieHeader(start.headers) },
    }),
  )
  return { status: res.status, location: res.headers.get('Location') ?? '' }
}

const verifiedGoogle = { sub: 'g-1', email: 'New@Example.org', email_verified: true, name: 'New Person', picture: 'https://x/p.png' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F-2033 U1·U2 스키마', () => {
  it('U1 마이그레이션 전부가 better-auth 스키마 검사를 통과한다', async () => {
    const db = openDb()
    const opts = authOptions(makeEnv(db), db as never)
    const auth = betterAuth({ ...opts, advanced: { ...opts.advanced, database: { ...opts.advanced?.database, validateSchema: true } } })
    const ctx = await auth.$context
    expect(typeof ctx.checkSchema).toBe('function')
    await ctx.checkSchema!()
  })

  it('U1 대조 — 0009 가 없으면 스키마 검사가 실패한다', async () => {
    const db = openDb('0008')
    const opts = authOptions(makeEnv(db), db as never)
    const auth = betterAuth({ ...opts, advanced: { ...opts.advanced, database: { ...opts.advanced?.database, validateSchema: true } } })
    const ctx = await auth.$context
    await expect(ctx.checkSchema!()).rejects.toThrow()
  })

  it('F-2025 U13 0009 까지만 적용한 DB 는 사용량 열이 없어 스키마 검사가 실패한다', async () => {
    const db = openDb('0009')
    const opts = authOptions(makeEnv(db), db as never)
    const auth = betterAuth({ ...opts, advanced: { ...opts.advanced, database: { ...opts.advanced?.database, validateSchema: true } } })
    const ctx = await auth.$context
    await expect(ctx.checkSchema!()).rejects.toThrow(/write_day|warned_at|Missing columns/)
  })

  it('U2 기존 users 행은 0009 뒤 인증된 행이 된다', () => {
    const db = openDb('0008')
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u-old', 'old@example.com', 1700000000000)
    db.exec(readFileSync(MIGRATIONS + readdirSync(MIGRATIONS).find((f) => f.startsWith('0009'))!, 'utf-8'))
    const row = db.prepare('SELECT email_verified, updated_at, name, image, created_at FROM users WHERE id = ?').get('u-old') as {
      email_verified: number
      updated_at: string
      name: string
      image: string | null
      created_at: number
    }
    expect(row.email_verified).toBe(1)
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(row.name).toBe('')
    expect(row.image).toBeNull()
    expect(row.created_at).toBe(1700000000000)
  })
})

describe('F-2033 U3~U9 콜백 흉내', () => {
  it('U3 Google 인증 이메일 새 사용자 — 저장하지 않는 값은 비운다', async () => {
    const db = asAuthDb(openDb())
    stubProviders({ google: verifiedGoogle })
    const res = await signIn(getAuth(makeEnv(db)), 'google')
    expect(res.status).toBe(302)
    expect(res.location).toBe(SUCCESS)
    const users = db.prepare('SELECT email, email_verified, typeof(created_at) AS t, name, image FROM users').all()
    expect(users).toEqual([{ email: 'new@example.org', email_verified: 1, t: 'integer', name: '', image: null }])
    const accounts = db.prepare('SELECT provider_id, access_token, refresh_token, id_token FROM auth_accounts').all()
    expect(accounts).toEqual([{ provider_id: 'google', access_token: null, refresh_token: null, id_token: null }])
    const sessions = db.prepare('SELECT ip_address, user_agent FROM auth_sessions').all()
    expect(sessions).toEqual([{ ip_address: '', user_agent: '' }])
  })

  it('U4 GitHub 기본 이메일이 인증되지 않았으면 거부, 쓰기 없음', async () => {
    const db = openDb()
    stubProviders({ github: { id: 7, email: null, emails: [{ email: 'gh@example.org', primary: true, verified: false }] } })
    const res = await signIn(getAuth(makeEnv(db)), 'github')
    expect(res.status).toBe(302)
    expect(res.location.startsWith(`${FAILURE}&error=email_not_verified`)).toBe(true)
    expect([rows(db, 'users'), rows(db, 'auth_accounts'), rows(db, 'auth_sessions')]).toEqual([0, 0, 0])
  })

  it('U5 인증된 기존 행과 같은 이메일로 GitHub 로그인하면 같은 계정에 연결', async () => {
    const db = openDb()
    db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('u-1', 'me@example.org', 1, 1)").run()
    stubProviders({ github: { id: 9, email: 'me@example.org', emails: [{ email: 'me@example.org', primary: true, verified: true }] } })
    const res = await signIn(getAuth(makeEnv(db)), 'github')
    expect(res.status).toBe(302)
    expect(res.location).toBe(SUCCESS)
    expect(rows(db, 'users')).toBe(1)
    expect(db.prepare('SELECT user_id, provider_id FROM auth_accounts').all()).toEqual([{ user_id: 'u-1', provider_id: 'github' }])
  })

  it('U6 기존 이메일에 인증 안 된 Google 은 연결하지 않는다', async () => {
    const db = openDb()
    db.prepare("INSERT INTO users (id, email, created_at, email_verified) VALUES ('u-1', 'me@example.org', 1, 1)").run()
    stubProviders({ google: { sub: 'g-2', email: 'me@example.org', email_verified: false } })
    const res = await signIn(getAuth(makeEnv(db)), 'google')
    expect(res.status).toBe(302)
    expect(res.location.startsWith(`${FAILURE}&error=account_not_linked`)).toBe(true)
    expect(rows(db, 'auth_accounts')).toBe(0)
  })

  it('U7 같은 계정으로 두 번째 로그인은 세션만 는다', async () => {
    const db = asAuthDb(openDb())
    stubProviders({ google: verifiedGoogle })
    const auth = getAuth(makeEnv(db))
    await signIn(auth, 'google')
    const res = await signIn(auth, 'google')
    expect(res.status).toBe(302)
    expect(res.location).toBe(SUCCESS)
    expect([rows(db, 'users'), rows(db, 'auth_accounts'), rows(db, 'auth_sessions')]).toEqual([1, 1, 2])
  })

  it('U8 admitNewUser 는 인증된 새 사용자에게만 불린다', async () => {
    const db = asAuthDb(openDb())
    const admit = vi.fn(admitNewUser)
    const env = makeEnv(db)
    const auth = betterAuth(authOptions(env, db as never, admit))

    stubProviders({ github: { id: 7, email: null, emails: [{ email: 'gh@example.org', primary: true, verified: false }] } })
    await signIn(auth, 'github')
    expect(admit).toHaveBeenCalledTimes(0)

    stubProviders({ google: verifiedGoogle })
    await signIn(auth, 'google')
    expect(admit).toHaveBeenCalledTimes(1)
    expect(admit.mock.calls[0][0]).toBe(env)
    expect(admit.mock.calls[0][1].source.action).toBe('create-user')

    await signIn(auth, 'google')
    expect(admit).toHaveBeenCalledTimes(1)
  })

  it('U9 admitNewUser 가 거절하면 그 코드로 /login 에 돌아가고 사용자를 만들지 않는다', async () => {
    const db = openDb()
    const auth = betterAuth(authOptions(makeEnv(db), db as never, async () => ({ error: 'x_test' })))
    stubProviders({ google: verifiedGoogle })
    const res = await signIn(auth, 'google')
    expect(res.status).toBe(302)
    expect(res.location.startsWith(`${FAILURE}&error=x_test`)).toBe(true)
    expect(rows(db, 'users')).toBe(0)
  })
})

describe('F-2028 S1~S8 가입 관문', () => {
  const NOW = Date.UTC(2026, 8, 24, 12, 0, 0)
  const TODAY = '2026-09-24'
  const YESTERDAY = '2026-09-23'
  const GATE_SQL =
    'UPDATE signup_gate SET count = CASE WHEN day = ?1 THEN count + 1 ELSE 1 END, day = ?1 WHERE id = 1 AND (day <> ?1 OR count < ?2)'
  const CLOSED = `${FAILURE}&error=signup_closed&error_description=signup_closed`
  const googleA = { sub: 'g-a', email: 'a@example.org', email_verified: true }
  const googleB = { sub: 'g-b', email: 'b@example.org', email_verified: true }
  const githubA = { id: 11, email: 'a@example.org', emails: [{ email: 'a@example.org', primary: true, verified: true }] }

  function setGate(db: DatabaseSync, day: string, count: number) {
    db.prepare('UPDATE signup_gate SET day = ?, count = ? WHERE id = 1').run(day, count)
  }

  function gate(db: DatabaseSync) {
    return { ...(db.prepare('SELECT day, count FROM signup_gate WHERE id = 1').get() as { day: string; count: number }) }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('S1 문장·바인딩·한 번 실행, changes 1 이면 통과 0 이면 signup_closed', async () => {
    for (const [changes, expected] of [
      [1, undefined],
      [0, { error: 'signup_closed' }],
    ] as const) {
      const calls = { prepare: [] as string[], bind: [] as unknown[][], run: 0, batch: 0 }
      const DB = {
        prepare(sql: string) {
          calls.prepare.push(sql)
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
      const result = await admitNewUser({ DB } as unknown as Env, {} as ValidateUserInfoData)
      expect(calls.prepare).toEqual([GATE_SQL])
      expect(calls.bind).toEqual([[utcDay(NOW), 20]])
      expect(calls.run).toBe(1)
      expect(calls.batch).toBe(0)
      expect(result).toStrictEqual(expected)
    }
  })

  it('S2 20번째는 통과, 21번째는 signup_closed 로 /login 에 돌아가고 아무 행도 만들지 않는다', async () => {
    const db = asAuthDb(openDb())
    setGate(db, TODAY, 19)
    const auth = getAuth(makeEnv(db))
    stubProviders({ google: googleA })
    const a = await signIn(auth, 'google')
    expect([a.status, a.location]).toEqual([302, SUCCESS])
    expect(gate(db)).toEqual({ day: TODAY, count: 20 })

    stubProviders({ google: googleB })
    const b = await signIn(auth, 'google')
    expect(b.status).toBe(302)
    expect(b.location).toBe(CLOSED)
    expect([rows(db, 'users'), rows(db, 'auth_accounts'), rows(db, 'auth_sessions')]).toEqual([1, 1, 1])
    expect(gate(db)).toEqual({ day: TODAY, count: 20 })
  })

  it('S3 마감 뒤에도 기존 사용자 다시 로그인·둘째 제공자 연결은 된다, 관문 그대로', async () => {
    const db = asAuthDb(openDb())
    setGate(db, TODAY, 19)
    const auth = getAuth(makeEnv(db))
    stubProviders({ google: googleA })
    await signIn(auth, 'google')
    stubProviders({ google: googleB })
    expect((await signIn(auth, 'google')).location).toBe(CLOSED)

    stubProviders({ google: googleA, github: githubA })
    const again = await signIn(auth, 'google')
    expect([again.status, again.location]).toEqual([302, SUCCESS])
    const linked = await signIn(auth, 'github')
    expect([linked.status, linked.location]).toEqual([302, SUCCESS])
    expect([rows(db, 'users'), rows(db, 'auth_accounts')]).toEqual([1, 2])
    expect(gate(db)).toEqual({ day: TODAY, count: 20 })
  })

  it('S4 인증 안 된 이메일은 관문보다 먼저 거절, 자리를 쓰지 않는다', async () => {
    const db = asAuthDb(openDb())
    setGate(db, TODAY, 0)
    stubProviders({ github: { id: 7, email: null, emails: [{ email: 'gh@example.org', primary: true, verified: false }] } })
    const res = await signIn(getAuth(makeEnv(db)), 'github')
    expect(res.location.startsWith(`${FAILURE}&error=email_not_verified`)).toBe(true)
    expect(gate(db)).toEqual({ day: TODAY, count: 0 })
  })

  it('S5 어제 20명이면 오늘 첫 가입은 통과, 관문 (오늘, 1)', async () => {
    const db = asAuthDb(openDb())
    setGate(db, YESTERDAY, 20)
    stubProviders({ google: googleA })
    const res = await signIn(getAuth(makeEnv(db)), 'google')
    expect([res.status, res.location]).toEqual([302, SUCCESS])
    expect(gate(db)).toEqual({ day: TODAY, count: 1 })
  })

  it('S6 관문 D1 이 던지면 validation_failed, 사용자 없음, 오류 기록', async () => {
    const db = openDb()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const DB = {
      prepare() {
        throw new Error('d1 down')
      },
    }
    const auth = betterAuth(authOptions(makeEnv(DB), db as never))
    stubProviders({ google: googleA })
    const res = await signIn(auth, 'google')
    expect(res.status).toBe(302)
    expect(res.location.startsWith(`${FAILURE}&error=validation_failed`)).toBe(true)
    expect(rows(db, 'users')).toBe(0)
    expect(errorLog.mock.calls.length).toBeGreaterThanOrEqual(1)
    errorLog.mockRestore()
  })

  it('S7 씨앗 그대로에서 첫 가입, 상한 20', async () => {
    expect(SIGNUP_DAILY_LIMIT).toBe(20)
    const db = asAuthDb(openDb())
    expect(gate(db)).toEqual({ day: '', count: 0 })
    stubProviders({ google: googleA })
    const res = await signIn(getAuth(makeEnv(db)), 'google')
    expect([res.status, res.location]).toEqual([302, SUCCESS])
    expect(gate(db)).toEqual({ day: TODAY, count: 1 })
  })

  it('S8 로컬 개발 우회는 관문을 보지 않는다', async () => {
    const db = openDb()
    setGate(db, TODAY, 20)
    const env = makeEnv(asD1(db), { BETTER_AUTH_URL: 'http://localhost:8790', DEV_AUTH_EMAIL: 'dev@example.com' })
    const user = await getUser(new Request('http://localhost:8790/api/docs'), env)
    expect(user?.email).toBe('dev@example.com')
    expect(rows(db, 'users')).toBe(1)
    expect(gate(db)).toEqual({ day: TODAY, count: 20 })
  })
})

describe('F-2033 U10·U11 설정 검사와 인스턴스', () => {
  it('U10 비밀이 없거나 짧거나 주소가 틀리면 AuthConfigError', () => {
    expect(AUTH_SECRET_MIN_LENGTH).toBe(32)
    const short = 'k'.repeat(31)
    const bad: Record<string, unknown>[] = [
      { BETTER_AUTH_SECRET: undefined },
      { BETTER_AUTH_SECRET: '' },
      { BETTER_AUTH_SECRET: short },
      { BETTER_AUTH_URL: undefined },
      { BETTER_AUTH_URL: 'not a url' },
    ]
    for (const over of bad) {
      let caught: unknown
      try {
        getAuth(makeEnv(openDb(), over))
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(AuthConfigError)
      expect((caught as Error).message).not.toContain(short)
    }
    const auth = getAuth(makeEnv(openDb(), { BETTER_AUTH_SECRET: 'k'.repeat(32) }))
    expect(typeof auth.handler).toBe('function')
  })

  it('U11 같은 env 면 같은 인스턴스, 다른 env 면 새 인스턴스', () => {
    const db = openDb()
    const env = makeEnv(db)
    expect(getAuth(env)).toBe(getAuth(env))
    expect(getAuth(makeEnv(db))).not.toBe(getAuth(env))
  })

  it('로컬 인증 모드면 wrangler dev 가 바꿔 쓴 출처의 로그아웃도 받는다', async () => {
    const db = openDb()
    const local = getAuth(makeEnv(db, { BETTER_AUTH_URL: 'http://localhost:8790' }))
    const res = await local.handler(
      new Request('http://rawdoc.app/api/auth/sign-out', {
        method: 'POST',
        headers: { Origin: 'http://rawdoc.app', Cookie: 'better-auth.session_token=x.y' },
      }),
    )
    expect(res.status).toBe(200)
    const prod = getAuth(makeEnv(db))
    const denied = await prod.handler(
      new Request('https://rawdoc.app/api/auth/sign-out', {
        method: 'POST',
        headers: { Origin: 'http://rawdoc.app', Cookie: '__Secure-better-auth.session_token=x.y' },
      }),
    )
    expect(denied.status).toBe(403)
  })
})

describe('F-2033 U12 wrangler.jsonc 계약', () => {
  it('운영 값이 로컬 값으로 바뀌어 커밋되지 않는다', () => {
    const config = JSON.parse(readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), 'utf-8')) as {
      vars: Record<string, string>
      secrets: { required: string[] }
      compatibility_flags: string[]
      assets: { run_worker_first: string[] }
    }
    expect(config.vars).toEqual({ BETTER_AUTH_URL: 'https://rawdoc.app', DEV_AUTH_EMAIL: '' })
    expect([...config.secrets.required].sort()).toEqual(
      ['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].sort(),
    )
    expect(config.secrets.required).not.toContain('BETTER_AUTH_URL')
    expect(config.secrets.required).not.toContain('DEV_AUTH_EMAIL')
    expect(config.compatibility_flags).toContain('nodejs_compat')
    expect(config.assets.run_worker_first).toContain('/login')
  })
})

describe('F-2033 U13 만료 행 정리', () => {
  it('한 batch 에 두 DELETE, 바인딩은 ISO 시각', async () => {
    const statements: { sql: string; args: unknown[] }[] = []
    const batches: unknown[][] = []
    const DB = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            const stmt = { sql, args }
            statements.push(stmt)
            return stmt
          },
        }
      },
      async batch(list: unknown[]) {
        batches.push(list)
        return []
      },
    }
    const now = Date.UTC(2026, 8, 24, 18, 0, 0)
    await cleanupExpiredAuth({ DB } as unknown as Env, now)
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(2)
    const iso = new Date(now).toISOString()
    expect(statements.map((s) => s.sql.replace(/\s+/g, ' ').trim())).toEqual([
      'DELETE FROM auth_sessions WHERE expires_at < ?',
      'DELETE FROM auth_verifications WHERE expires_at < ?',
    ])
    expect(statements.map((s) => s.args)).toEqual([[iso], [iso]])
  })
})
