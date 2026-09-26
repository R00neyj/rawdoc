// 쓰기 관문 — 401·403·429 day·429 minute, 인증 한 번 (specs/features/F-2026.md 7.1 G1~G10)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { asD1, openTestDb } from './testD1'
import type { DatabaseSync } from 'node:sqlite'
import { isWriteRoute, MINUTE_RETRY_AFTER, MINUTE_WRITE_LIMIT } from './writeGate'

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url))

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function fakeLimiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) }
}

function makeEnv(over: Record<string, unknown> = {}) {
  const sqlDb = openTestDb()
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put() {} },
    WRITE_LIMITER: fakeLimiter(true),
    ...over,
  } as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function jsonInit(method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit {
  const init: RequestInit = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return init
}

function bearerInit(method: string, token: string, body?: BodyInit, headers: Record<string, string> = {}): RequestInit {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...headers } }
  if (body !== undefined) init.body = body
  return init
}

function userId(sqlDb: DatabaseSync): string {
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }).id
}

function writeCount(sqlDb: DatabaseSync): number {
  const row = sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(EMAIL) as { write_count: number } | undefined
  return row?.write_count ?? 0
}

function docCount(sqlDb: DatabaseSync): number {
  return (sqlDb.prepare('SELECT COUNT(*) as c FROM docs').get() as { c: number }).c
}

function folderCount(sqlDb: DatabaseSync): number {
  return (sqlDb.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c
}

function blockUser(sqlDb: DatabaseSync, id: string, blockedAt = Date.now()) {
  sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(blockedAt, id)
}

function setWriteCounter(sqlDb: DatabaseSync, id: string, day: string, count: number) {
  sqlDb.prepare('UPDATE users SET write_day = ?, write_count = ? WHERE id = ?').run(day, count, id)
}

async function createToken(env: Env): Promise<string> {
  const res = await call(env, '/api/tokens', jsonInit('POST', { name: '토큰' }))
  const body = (await res.json()) as { token: string }
  return body.token
}

const WRITE_ROUTES: [string, string][] = [
  ['POST', '/api/docs'],
  ['PUT', '/api/docs/:id'],
  ['DELETE', '/api/docs/:id'],
  ['PUT', '/api/docs/:id/folder'],
  ['PUT', '/api/docs/:id/pin'],
  ['POST', '/api/docs/:id/lock'],
  ['DELETE', '/api/docs/:id/lock'],
  ['POST', '/api/docs/:id/link'],
  ['DELETE', '/api/docs/:id/link'],
  ['POST', '/api/folders'],
  ['PUT', '/api/folders/:id'],
  ['DELETE', '/api/folders/:id'],
  ['POST', '/api/folders/:id/link'],
  ['DELETE', '/api/folders/:id/link'],
  ['PUT', '/api/docs/:id/grants/:email'],
  ['DELETE', '/api/docs/:id/grants/:email'],
  ['PUT', '/api/folders/:id/grants/:email'],
  ['DELETE', '/api/folders/:id/grants/:email'],
  ['POST', '/api/tokens'],
  ['DELETE', '/api/tokens/:id'],
  ['PUT', '/api/attachments/:idext'],
  ['POST', '/v1/docs'],
  ['PUT', '/v1/docs/:id'],
  ['POST', '/v1/folders'],
  ['POST', '/v1/attachments'],
  ['POST', '/v1/docs/:id/link'],
  ['PUT', '/api/e2ee/keys'],
  ['DELETE', '/api/e2ee/keys'],
  ['PUT', '/api/docs/:id/e2ee'],
  ['DELETE', '/api/attachments/:idext'],
  ['POST', '/api/docs/:id/comments/import'],
  ['POST', '/api/notifications/read'],
]

const PUB_GET_ROUTES = [
  '/pub/docs/:token',
  '/pub/docs/:token/set',
  '/pub/docs/:token/docs/:docId',
  '/pub/docs/:token/docs/:docId/attachments/:idext',
  '/pub/docs/:token/attachments/:idext',
  '/pub/folders/:token',
  '/pub/folders/:token/docs/:docId',
  '/pub/folders/:token/docs/:docId/attachments/:idext',
]

describe('G1 isWriteRoute — 3장 표', () => {
  it('32개만 참, 나머지 전부 거짓 (F-401 금고 셋 + F-402 첨부 지우기 포함)', () => {
    for (const [method, path] of WRITE_ROUTES) {
      expect(isWriteRoute(method, path), `${method} ${path}`).toBe(true)
    }
    expect(isWriteRoute('POST', '/api/login')).toBe(false)
    expect(isWriteRoute('GET', '/api/login')).toBe(false)
    expect(isWriteRoute('GET', '/api/me')).toBe(false)
    expect(isWriteRoute('POST', '/api/auth/sign-out')).toBe(false)
    expect(isWriteRoute('GET', '/api/auth/callback/google')).toBe(false)
    for (const path of PUB_GET_ROUTES) {
      expect(isWriteRoute('GET', path), `GET ${path}`).toBe(false)
    }
    expect(isWriteRoute('GET', '/v1/me')).toBe(false)
    expect(isWriteRoute('GET', '/api/e2ee/keys')).toBe(false)
    expect(isWriteRoute('GET', '/api/docs/:id/people')).toBe(false)
    expect(isWriteRoute('GET', '/api/docs/:id/comments/count')).toBe(false)
    expect(isWriteRoute('GET', '/api/notifications')).toBe(false)
    expect(WRITE_ROUTES).toHaveLength(32)
  })
})

describe('G2 토큰 없이 쓰기', () => {
  it('401, limit 호출 0, folders 그대로', async () => {
    const { sqlDb, env } = makeEnv()
    const before = folderCount(sqlDb)
    const res = await call(env, '/v1/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
    expect((env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit).not.toHaveBeenCalled()
    expect(folderCount(sqlDb)).toBe(before)
  })
})

describe('G3 막힌 계정', () => {
  it('POST /api/docs · PUT /api/docs/:id · POST /v1/folders(토큰) 셋 다 403', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    const token = await createToken(env)
    blockUser(sqlDb, owner)
    const beforeDocs = docCount(sqlDb)
    const beforeFolders = folderCount(sqlDb)
    const beforeWrites = writeCount(sqlDb)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    limiter.limit.mockClear()

    const create = await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    expect(create.status).toBe(403)
    expect(await create.json()).toEqual({ error: 'account_blocked' })

    const update = await call(env, '/api/docs/nonexistent', jsonInit('PUT', { content: 'x', baseVersion: 1 }))
    expect(update.status).toBe(403)
    expect(await update.json()).toEqual({ error: 'account_blocked' })

    const v1 = await call(env, '/v1/folders', bearerInit('POST', token, JSON.stringify({ name: 'f' }), { 'Content-Type': 'application/json' }))
    expect(v1.status).toBe(403)
    expect(await v1.json()).toEqual({ error: 'account_blocked' })

    expect(limiter.limit).not.toHaveBeenCalled()
    expect(docCount(sqlDb)).toBe(beforeDocs)
    expect(folderCount(sqlDb)).toBe(beforeFolders)
    expect(writeCount(sqlDb)).toBe(beforeWrites)

    expect((await call(env, '/api/docs')).status).toBe(200)
    expect((await call(env, '/v1/docs', bearerInit('GET', token))).status).toBe(200)
  })
})

describe('G4 하루 한도', () => {
  const NOW = Date.UTC(2026, 8, 24, 15, 0, 0)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('5,000 이면 429 day', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    setWriteCounter(sqlDb, owner, '2026-09-24', 5000)
    const beforeFolders = folderCount(sqlDb)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 32400 })
    expect(res.headers.get('Retry-After')).toBe('32400')
    expect(limiter.limit).not.toHaveBeenCalled()
    expect(folderCount(sqlDb)).toBe(beforeFolders)
  })

  it('4,999 이면 201, write_count 5,000', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    setWriteCounter(sqlDb, owner, '2026-09-24', 4999)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(201)
    expect(limiter.limit).toHaveBeenCalledTimes(1)
    expect(writeCount(sqlDb)).toBe(5000)
  })

  it('어제 값은 안 본다', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    setWriteCounter(sqlDb, owner, '2026-09-23', 9999)

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(201)
  })
})

describe('G5 분당 한도', () => {
  it('limit false 면 429 minute, key 는 users.id', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => ({ success: false }))
    const beforeFolders = folderCount(sqlDb)
    const beforeWrites = writeCount(sqlDb)

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited', scope: 'minute', limit: MINUTE_WRITE_LIMIT, retryAfter: MINUTE_RETRY_AFTER })
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(folderCount(sqlDb)).toBe(beforeFolders)
    expect(writeCount(sqlDb)).toBe(beforeWrites)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    expect(limiter.limit).toHaveBeenCalledWith({ key: owner })
  })

  it('G5b /v1 토큰도 같은 사용자 id 를 key 로 쓴다', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    const token = await createToken(env)
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => ({ success: false }))

    await call(env, '/v1/folders', bearerInit('POST', token, JSON.stringify({ name: 'f' }), { 'Content-Type': 'application/json' }))
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    expect(limiter.limit).toHaveBeenCalledWith({ key: owner })
  })
})

describe('G6 바인딩 실패 — fail open', () => {
  it('limit 이 던지면 통과, console.error 가 write_limiter_failed 로', async () => {
    const { env } = makeEnv()
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => {
      throw new Error('boom')
    })
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(201)
    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(errorLog.mock.calls[0][0]).toBe('write_limiter_failed')
  })

  it('G6b WRITE_LIMITER 가 없으면 통과, console.warn 은 새로 import 한 모듈에서 한 번', async () => {
    vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
    vi.resetModules()
    const freshWorker = (await import('./index')).default as unknown as Worker
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const sqlDb = openTestDb()
    const env = {
      DB: asD1(sqlDb),
      BETTER_AUTH_URL: ORIGIN,
      DEV_AUTH_EMAIL: EMAIL,
      BUCKET: { async put() {} },
    } as unknown as Env

    const call1 = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
      return freshWorker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
    }

    const res1 = await call1('/api/folders', jsonInit('POST', { name: 'f1' }))
    const res2 = await call1('/api/folders', jsonInit('POST', { name: 'f2' }))
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(201)
    expect(warnLog).toHaveBeenCalledTimes(1)
    expect(warnLog).toHaveBeenCalledWith('write_limiter_missing')
  })

  it('G6c limit 결과가 빈 객체면 통과', async () => {
    const { env } = makeEnv()
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => ({}))
    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(201)
  })
})

describe('G7 순서 — 막힘/하루/분당', () => {
  const NOW = Date.UTC(2026, 8, 24, 15, 0, 0)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('(a) 막힘 + 하루초과 + limit false → 403, limit 호출 0', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    setWriteCounter(sqlDb, owner, '2026-09-24', 5000)
    blockUser(sqlDb, owner)
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => ({ success: false }))

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(403)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('(b) 하루초과 + limit false → 429 day, limit 호출 0', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs')
    const owner = userId(sqlDb)
    setWriteCounter(sqlDb, owner, '2026-09-24', 5000)
    ;(env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }).limit = vi.fn(async () => ({ success: false }))

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(429)
    expect((await res.json() as { scope: string }).scope).toBe('day')
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    expect(limiter.limit).not.toHaveBeenCalled()
  })
})

describe('G8 26개 쓰기 라우트 전부 429 minute, 그 밖은 아니다', () => {
  it('26개 429, 로그인·GET 은 아니다', async () => {
    const { env } = makeEnv()
    await call(env, '/api/docs') // 사용자 행 만들기, 기본 limiter(true) 통과
    const token = await createToken(env)
    const limiter = env.WRITE_LIMITER as unknown as { limit: ReturnType<typeof vi.fn> }
    limiter.limit = vi.fn(async () => ({ success: false }))

    const id = '00000000-0000-4000-8000-000000000001'
    const email = 'friend@example.com'
    const writeCalls: [string, string, RequestInit?][] = [
      ['POST', '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' })],
      ['PUT', `/api/docs/${id}`, jsonInit('PUT', { content: 'x', baseVersion: 1 })],
      ['DELETE', `/api/docs/${id}`, { method: 'DELETE' }],
      ['PUT', `/api/docs/${id}/folder`, jsonInit('PUT', { folderId: null })],
      ['PUT', `/api/docs/${id}/pin`, jsonInit('PUT', { pinned: true })],
      ['POST', `/api/docs/${id}/lock`, jsonInit('POST', { sessionId: 's1' })],
      ['DELETE', `/api/docs/${id}/lock`, { method: 'DELETE' }],
      ['POST', `/api/docs/${id}/link`, { method: 'POST' }],
      ['DELETE', `/api/docs/${id}/link`, { method: 'DELETE' }],
      ['POST', '/api/folders', jsonInit('POST', { name: 'f' })],
      ['PUT', `/api/folders/${id}`, jsonInit('PUT', { name: 'f2' })],
      ['DELETE', `/api/folders/${id}`, { method: 'DELETE' }],
      ['POST', `/api/folders/${id}/link`, { method: 'POST' }],
      ['DELETE', `/api/folders/${id}/link`, { method: 'DELETE' }],
      ['PUT', `/api/docs/${id}/grants/${email}`, jsonInit('PUT', { role: 'view' })],
      ['DELETE', `/api/docs/${id}/grants/${email}`, { method: 'DELETE' }],
      ['PUT', `/api/folders/${id}/grants/${email}`, jsonInit('PUT', { role: 'view' })],
      ['DELETE', `/api/folders/${id}/grants/${email}`, { method: 'DELETE' }],
      ['POST', '/api/tokens', jsonInit('POST', { name: 't2' })],
      ['DELETE', `/api/tokens/${id}`, { method: 'DELETE' }],
      ['PUT', `/api/attachments/${id}.png`, { method: 'PUT' }],
      ['POST', '/v1/docs', bearerInit('POST', token, JSON.stringify({ title: 't', content: 'c' }), { 'Content-Type': 'application/json' })],
      ['PUT', `/v1/docs/${id}`, bearerInit('PUT', token, JSON.stringify({ content: 'x', baseVersion: 1 }), { 'Content-Type': 'application/json' })],
      ['POST', '/v1/folders', bearerInit('POST', token, JSON.stringify({ name: 'f' }), { 'Content-Type': 'application/json' })],
      ['POST', '/v1/attachments', bearerInit('POST', token)],
      ['POST', `/v1/docs/${id}/link`, bearerInit('POST', token)],
    ]
    expect(writeCalls.length).toBe(26)

    for (const [method, path, init] of writeCalls) {
      const res = await call(env, path, init)
      expect(res.status, `${method} ${path}`).toBe(429)
      expect((await res.json()) as unknown, `${method} ${path}`).toEqual({
        error: 'rate_limited',
        scope: 'minute',
        limit: MINUTE_WRITE_LIMIT,
        retryAfter: MINUTE_RETRY_AFTER,
      })
    }
    expect(limiter.limit).toHaveBeenCalledTimes(26)

    const login = await call(env, '/api/login', {
      method: 'POST',
      body: 'provider=google&return=%23%2Fd%2Fabc',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String('provider=google&return=%23%2Fd%2Fabc'.length) },
    })
    expect(login.status).toBe(303)
    expect(limiter.limit).toHaveBeenCalledTimes(26)

    const getCalls: [string, RequestInit?][] = [
      ['/api/docs', undefined],
      [`/api/docs/${id}`, undefined],
      ['/api/folders', undefined],
      [`/api/docs/${id}/link`, undefined],
      [`/api/folders/${id}/link`, undefined],
      [`/api/docs/${id}/grants`, undefined],
      [`/api/folders/${id}/grants`, undefined],
      ['/api/shared', undefined],
      ['/api/shares', undefined],
      ['/api/tokens', undefined],
      ['/api/usage', undefined],
      ['/v1/docs', bearerInit('GET', token)],
      [`/v1/docs/${id}`, bearerInit('GET', token)],
      ['/v1/folders', bearerInit('GET', token)],
      ['/v1/me', bearerInit('GET', token)],
    ]
    expect(getCalls.length).toBe(15)
    for (const [path, init] of getCalls) {
      const res = await call(env, path, init)
      expect(res.status, path).not.toBe(429)
    }
    expect(limiter.limit).toHaveBeenCalledTimes(26)
  })
})

describe('G9 인증 한 번', () => {
  it('개발 우회 — INSERT INTO users 1개', async () => {
    const { sqlDb, env } = makeEnv()
    const preparedSql: string[] = []
    const inner = env.DB
    env.DB = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return (inner as unknown as { prepare(sql: string): unknown }).prepare(sql)
      },
      batch: (inner as unknown as { batch: unknown }).batch,
    } as unknown as Env['DB']

    const res = await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    expect(res.status).toBe(201)
    const inserts = preparedSql.filter((sql) => sql.startsWith('INSERT INTO users'))
    expect(inserts.length).toBe(1)
    void sqlDb
  })

  it('토큰 — SELECT id, user_id, last_used_at FROM api_tokens 1개', async () => {
    const { env } = makeEnv()
    const token = await createToken(env)
    const preparedSql: string[] = []
    const inner = env.DB
    env.DB = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return (inner as unknown as { prepare(sql: string): unknown }).prepare(sql)
      },
      batch: (inner as unknown as { batch: unknown }).batch,
    } as unknown as Env['DB']

    const res = await call(env, '/v1/folders', bearerInit('POST', token, JSON.stringify({ name: 'f2' }), { 'Content-Type': 'application/json' }))
    expect(res.status).toBe(201)
    const selects = preparedSql.filter((sql) => sql.startsWith('SELECT id, user_id, last_used_at FROM api_tokens'))
    expect(selects.length).toBe(1)
  })
})

describe('G10 설정과 상수', () => {
  it('wrangler.jsonc ratelimits, MINUTE_WRITE_LIMIT·MINUTE_RETRY_AFTER', () => {
    const raw = readFileSync(`${REPO_ROOT}wrangler.jsonc`, 'utf-8')
    const parsed = JSON.parse(raw) as { ratelimits: unknown }
    expect(parsed.ratelimits).toEqual([{ name: 'WRITE_LIMITER', namespace_id: '1001', simple: { limit: 120, period: 60 } }])
    expect(MINUTE_WRITE_LIMIT).toBe(120)
    expect(MINUTE_RETRY_AFTER).toBe(60)
  })
})
