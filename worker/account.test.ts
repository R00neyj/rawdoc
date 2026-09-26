// 계정 삭제 API — worker/index.ts 를 통째로 (specs/features/F-2038.md 9.1 W1~W8·W10)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { SITE_URL } from '../src/lib/siteMeta'
import { asAuthDb, asD1, openTestDb } from './testD1'
import { isFreshSession } from './account'
import { PURGE_SQL } from './purgeJobs'
import { DAILY_WRITE_LIMIT, utcDay } from './usage'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('./auth')
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const OWNER_EMAIL = 'owner@example.com'
const OWNER = 'u-owner'
const OTHER = 'u-other'
const OTHER_EMAIL = 'other@example.com'

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, pending }
}

// 방 비우기가 던지는 DO — 정리 작업 행이 남아 테스트가 들여다볼 수 있다
function failingRooms() {
  const names: string[] = []
  const getByName = vi.fn((name: string) => {
    names.push(name)
    return {
      async purgeRoom() {
        throw new Error('room down')
      },
    }
  })
  return { DOC_ROOM: { getByName }, names }
}

function devEnv(sqlDb: DatabaseSync, over: Record<string, unknown> = {}): Env {
  return {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: LOCAL,
    DEV_AUTH_EMAIL: OWNER_EMAIL,
    ...over,
  } as unknown as Env
}

function call(env: Env, path: string, init: RequestInit = {}, ctx = makeCtx().ctx): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }), env, ctx)
}

function run(sqlDb: DatabaseSync, sql: string, ...args: (string | number | null)[]) {
  sqlDb.prepare(sql).run(...args)
}

function count(sqlDb: DatabaseSync, sql: string, ...args: (string | number)[]): number {
  return (sqlDb.prepare(sql).get(...args) as { n: number }).n
}

function addUser(sqlDb: DatabaseSync, id: string, email: string) {
  run(sqlDb, 'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', id, email, 1)
}

function addFolder(sqlDb: DatabaseSync, id: string, owner: string, parent: string | null = null) {
  run(sqlDb, 'INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)', id, owner, id, parent)
}

function addDoc(sqlDb: DatabaseSync, id: string, owner: string, opts: { folder?: string; updatedAt?: number; e2ee?: boolean } = {}) {
  run(
    sqlDb,
    "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key) VALUES (?, ?, ?, 'body', 'lf', ?, 1, 1, ?, ?)",
    id,
    owner,
    id,
    opts.folder ?? null,
    opts.updatedAt ?? 10,
    opts.e2ee ? 'wrapped' : null,
  )
}

function addGrant(sqlDb: DatabaseSync, type: 'doc' | 'folder', target: string, owner: string, email: string) {
  run(sqlDb, "INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?, ?, ?, ?, 'view', 1)", type, target, owner, email)
}

function addLink(sqlDb: DatabaseSync, token: string, owner: string, type: 'doc' | 'folder', target: string, revokedAt: number | null = null) {
  run(sqlDb, 'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, ?, ?, ?, 1, ?)', token, owner, type, target, revokedAt)
}

function addAttachment(sqlDb: DatabaseSync, owner: string, id: string, size: number) {
  run(sqlDb, "INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?, ?, 'png', 'image/png', ?, 1, 1, 1)", owner, id, size)
}

function addToken(sqlDb: DatabaseSync, id: string, user: string, revokedAt: number | null = null) {
  run(sqlDb, "INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at, revoked_at) VALUES (?, ?, 'n', ?, 'rd_xxxxxxxx', 1, ?)", id, user, `hash-${id}`, revokedAt)
}

// W1 의 세계 — 3.2 규칙마다 문서 하나씩
function seedWorld(sqlDb: DatabaseSync) {
  addUser(sqlDb, OWNER, OWNER_EMAIL)
  addUser(sqlDb, OTHER, OTHER_EMAIL)
  addFolder(sqlDb, 'fA', OWNER)
  addFolder(sqlDb, 'fA1', OWNER, 'fA')
  addFolder(sqlDb, 'fB', OWNER)
  addDoc(sqlDb, 'd1', OWNER, { updatedAt: 11 }) // 문서 초대
  addDoc(sqlDb, 'd2', OWNER, { folder: 'fA1', updatedAt: 12 }) // 초대 걸린 폴더의 하위 폴더
  addDoc(sqlDb, 'd3', OWNER, { updatedAt: 13 }) // 살아있는 문서 링크의 시작
  addDoc(sqlDb, 'd4', OWNER, { folder: 'fB', updatedAt: 14 }) // 살아있는 링크의 묶음
  addDoc(sqlDb, 'd5', OWNER, { updatedAt: 15 }) // 끊은 링크의 시작
  addDoc(sqlDb, 'd6', OWNER, { updatedAt: 16 }) // 끊은 링크의 묶음
  addDoc(sqlDb, 'd7', OWNER, { updatedAt: 17, e2ee: true })
  addDoc(sqlDb, 'x1', OTHER)
  addFolder(sqlDb, 'xf', OTHER)
  addGrant(sqlDb, 'doc', 'd1', OWNER, 'friend@example.com')
  addGrant(sqlDb, 'folder', 'fA', OWNER, 'friend@example.com')
  addLink(sqlDb, 'live', OWNER, 'doc', 'd3')
  run(sqlDb, 'INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)', 'live', 'd4')
  addLink(sqlDb, 'dead', OWNER, 'doc', 'd5', 5)
  run(sqlDb, 'INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)', 'dead', 'd6')
  // 남의 것 — 어디에도 세지 않는다
  addGrant(sqlDb, 'doc', 'x1', OTHER, OWNER_EMAIL)
  addGrant(sqlDb, 'doc', 'x1', OTHER, 'friend@example.com')
  addLink(sqlDb, 'xlink', OTHER, 'doc', 'x1')
  addAttachment(sqlDb, OWNER, 'a1', 1000)
  addAttachment(sqlDb, OWNER, 'a2', 234)
  addAttachment(sqlDb, OTHER, 'a3', 99)
  addToken(sqlDb, 't1', OWNER)
  addToken(sqlDb, 't2', OWNER)
  addToken(sqlDb, 't3', OWNER, 5)
  addToken(sqlDb, 't4', OTHER)
}

describe('F-2038 W1 미리 보기 개수', () => {
  it('3.2 규칙대로 세고, 끊은 링크·남의 것은 빠진다', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    const res = await call(devEnv(sqlDb), '/api/account')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      email: OWNER_EMAIL,
      docs: 7,
      e2eeDocs: 1,
      sharedDocs: 4,
      folders: 3,
      attachments: { count: 2, bytes: 1234 },
      tokens: 2,
      fresh: true,
      freshUntil: null,
    })
  })

  it('살아있는 폴더 링크의 하위 폴더 문서도 센다', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    addFolder(sqlDb, 'fC', OWNER)
    addFolder(sqlDb, 'fC1', OWNER, 'fC')
    addDoc(sqlDb, 'd8', OWNER, { folder: 'fC1' })
    addLink(sqlDb, 'flink', OWNER, 'folder', 'fC')
    const body = (await (await call(devEnv(sqlDb), '/api/account')).json()) as { sharedDocs: number }
    expect(body.sharedDocs).toBe(5)
  })
})

describe('F-2038 W2 미리 보기 권한', () => {
  it('막힌 사용자도 200', async () => {
    const sqlDb = openTestDb()
    addUser(sqlDb, OWNER, OWNER_EMAIL)
    run(sqlDb, 'UPDATE users SET blocked_at = ? WHERE id = ?', 5, OWNER)
    const res = await call(devEnv(sqlDb), '/api/account')
    expect(res.status).toBe(200)
  })

  it('세션이 없으면 401 unauthenticated', async () => {
    const env = authEnv()
    const res = await authCall(env, '/api/account')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthenticated' })
    const del = await authCall(env, '/api/account', { method: 'DELETE', headers: { Origin: ORIGIN } })
    expect(del.status).toBe(401)
    expect(await del.json()).toEqual({ error: 'unauthenticated' })
  })
})

const OWNER_TABLES: [string, string][] = [
  ['users', 'SELECT COUNT(*) AS n FROM users WHERE id = ?1'],
  ['auth_sessions', 'SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?1'],
  ['auth_accounts', 'SELECT COUNT(*) AS n FROM auth_accounts WHERE user_id = ?1'],
  ['docs', 'SELECT COUNT(*) AS n FROM docs WHERE owner_id = ?1'],
  ['folders', 'SELECT COUNT(*) AS n FROM folders WHERE owner_id = ?1'],
  ['attachments', 'SELECT COUNT(*) AS n FROM attachments WHERE owner_id = ?1'],
  ['share_links', 'SELECT COUNT(*) AS n FROM share_links WHERE owner_id = ?1'],
  ['share_link_docs', "SELECT COUNT(*) AS n FROM share_link_docs WHERE token IN ('live', 'dead') OR doc_id LIKE 'd%'"],
  ['grants given', 'SELECT COUNT(*) AS n FROM grants WHERE owner_id = ?1'],
  ['grants received', "SELECT COUNT(*) AS n FROM grants WHERE grantee_email = 'owner@example.com'"],
  ['doc_locks', "SELECT COUNT(*) AS n FROM doc_locks WHERE user_id = ?1 OR doc_id LIKE 'd%'"],
  ['api_tokens', 'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?1'],
  ['e2ee_keys', 'SELECT COUNT(*) AS n FROM e2ee_keys WHERE user_id = ?1'],
  ['doc_comments', "SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id LIKE 'd%'"],
  ['notifications', "SELECT COUNT(*) AS n FROM notifications WHERE doc_id LIKE 'd%' OR recipient_email = 'owner@example.com'"],
]

function seedDeleteExtras(sqlDb: DatabaseSync) {
  const iso = new Date().toISOString()
  run(sqlDb, 'INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', 's1', OWNER, 'tok', iso, iso, iso)
  run(sqlDb, "INSERT INTO auth_accounts (id, user_id, account_id, provider_id, created_at, updated_at) VALUES ('ac1', ?, 'g-1', 'google', ?, ?)", OWNER, iso, iso)
  run(sqlDb, "INSERT INTO doc_locks (doc_id, user_id, email, session_id, expires_at) VALUES ('x1', ?, ?, 'ls', 9)", OWNER, OWNER_EMAIL)
  run(sqlDb, "INSERT INTO doc_locks (doc_id, user_id, email, session_id, expires_at) VALUES ('d1', ?, ?, 'ls', 9)", OTHER, OTHER_EMAIL)
  run(sqlDb, "INSERT INTO e2ee_keys (user_id, bundle, rev, created_at, updated_at) VALUES (?, '{}', 1, 1, 1)", OWNER)
  run(
    sqlDb,
    "INSERT INTO doc_comments (doc_id, id, body, created_at, bytes, sig, anchor_sig) VALUES ('d1', 'c1', 'hi', 1, 2, 's', 'a'), ('x1', 'c2', 'mine on other', 1, 2, 's', 'a')",
  )
  run(
    sqlDb,
    "INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES ('n1', 'friend@example.com', 'mention', 'd1', 'c1', 'c1', 'x@example.com', 't', 'e', 1), ('n2', ?, 'mention', 'x1', 'c2', 'c2', 'x@example.com', 't', 'e', 1), ('n3', 'friend@example.com', 'mention', 'x1', 'c2', 'c2', 'x@example.com', 't', 'e', 1)",
    OWNER_EMAIL,
  )
}

describe('F-2038 W3 지우기', () => {
  it('204, 5.1 의 표마다 내 행 0, 남의 것 그대로, purge_jobs 에 방·접두사', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    seedDeleteExtras(sqlDb)
    const rooms = failingRooms()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx, pending } = makeCtx()
    const res = await call(devEnv(sqlDb, { DOC_ROOM: rooms.DOC_ROOM }), '/api/account', { method: 'DELETE' }, ctx)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    for (const [name, sql] of OWNER_TABLES) {
      expect([name, count(sqlDb, sql.replace('?1', `'${OWNER}'`))]).toEqual([name, 0])
    }
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM docs WHERE id = 'x1'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM folders WHERE id = 'xf'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM grants WHERE target_id = 'x1' AND grantee_email = 'friend@example.com'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM share_links WHERE token = 'xlink'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM attachments WHERE owner_id = ?", OTHER)).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?", OTHER)).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = 'x1'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE id = 'n3'")).toBe(1)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', OTHER)).toBe(1)

    await Promise.all(pending)
    expect(pending).toHaveLength(1)
    const jobs = sqlDb.prepare('SELECT kind, target, priority FROM purge_jobs ORDER BY kind, target').all() as { kind: string; target: string; priority: number }[]
    expect(jobs).toEqual([
      { kind: 'r2_prefix', target: `att/${OWNER}/`, priority: 0 },
      { kind: 'room', target: 'd1', priority: 11 },
      { kind: 'room', target: 'd2', priority: 12 },
      { kind: 'room', target: 'd3', priority: 13 },
      { kind: 'room', target: 'd4', priority: 14 },
      { kind: 'room', target: 'd5', priority: 15 },
      { kind: 'room', target: 'd6', priority: 16 },
      { kind: 'room', target: 'd7', priority: 17 },
    ])
    // 응답 뒤 waitUntil 이 방을 곧바로 비우러 갔다 — 최근 고친 문서부터
    expect(rooms.names).toEqual(['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'])
  })
})

describe('F-2038 W4 관문 없음', () => {
  it('막힌 사용자·하루 한도·분당 한도에 닿은 사용자도 204', async () => {
    for (const setup of ['blocked', 'day'] as const) {
      const sqlDb = openTestDb()
      addUser(sqlDb, OWNER, OWNER_EMAIL)
      addDoc(sqlDb, 'd1', OWNER)
      if (setup === 'blocked') run(sqlDb, 'UPDATE users SET blocked_at = 5 WHERE id = ?', OWNER)
      else run(sqlDb, 'UPDATE users SET write_day = ?, write_count = ? WHERE id = ?', utcDay(Date.now()), DAILY_WRITE_LIMIT, OWNER)
      const env = devEnv(sqlDb, { WRITE_LIMITER: { limit: async () => ({ success: false }) } })
      const res = await call(env, '/api/account', { method: 'DELETE' })
      expect([setup, res.status]).toEqual([setup, 204])
      expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', OWNER)).toBe(0)
    }
  })
})

describe('F-2038 W5 Origin', () => {
  it('다른 출처의 DELETE 는 403 forbidden_origin, 아무것도 안 지움', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    const res = await call(devEnv(sqlDb), '/api/account', { method: 'DELETE', headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM docs WHERE owner_id = ?', OWNER)).toBe(7)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', OWNER)).toBe(1)
  })
})

// ----- 실제 세션 (loginRoutes.test.ts 의 loginThroughWorker 와 같은 틀) -----

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
  } as unknown as Env
}

function authCall(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, makeCtx().ctx)
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
  const start = await authCall(env, '/api/login', {
    method: 'POST',
    body,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) },
  })
  const state = new URL(start.headers.get('Location')!).searchParams.get('state')
  const callback = await authCall(env, `/api/auth/callback/google?code=c&state=${state}`, {
    headers: { Cookie: cookiePairs(start.headers).join('; ') },
  })
  vi.unstubAllGlobals()
  return cookiePairs(callback.headers).find((c) => c.includes('session_token=')) ?? ''
}

describe('F-2038 W6 최근 로그인', () => {
  it('로그인 직후 fresh, 10분 지나면 reauth_required 이고 아무것도 안 지움', async () => {
    const env = authEnv()
    const sqlDb = env.DB as unknown as DatabaseSync
    const session = await loginThroughWorker(env)
    expect(session).not.toBe('')
    const createdAt = Date.parse((sqlDb.prepare('SELECT created_at FROM auth_sessions').get() as { created_at: string }).created_at)

    const fresh = await authCall(env, '/api/account', { headers: { Cookie: session } })
    expect(fresh.status).toBe(200)
    const body = (await fresh.json()) as { fresh: boolean; freshUntil: number; email: string }
    expect(body.email).toBe('me@example.org')
    expect(body.fresh).toBe(true)
    expect(body.freshUntil).toBe(createdAt + 600_000)

    const userId = (sqlDb.prepare('SELECT id FROM users').get() as { id: string }).id
    addDoc(sqlDb, 'd1', userId)
    sqlDb.prepare('UPDATE auth_sessions SET created_at = ?').run(new Date(Date.now() - 600_000).toISOString())

    const stale = await authCall(env, '/api/account', { headers: { Cookie: session } })
    expect(((await stale.json()) as { fresh: boolean }).fresh).toBe(false)

    const del = await authCall(env, '/api/account', { method: 'DELETE', headers: { Cookie: session, Origin: ORIGIN } })
    expect(del.status).toBe(403)
    expect(await del.json()).toEqual({ error: 'reauth_required', freshMinutes: 10 })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM users')).toBe(1)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM docs')).toBe(1)
  })

  it('판정 순수 함수 — 경과 599,999ms 참, 600,000ms 거짓', () => {
    expect(isFreshSession(1_000, 1_000 + 599_999)).toBe(true)
    expect(isFreshSession(1_000, 1_000 + 600_000)).toBe(false)
  })
})

describe('F-2038 W7 batch 원자성', () => {
  it('purge_jobs 가 없는 DB 에서 500 internal, 아무것도 안 지움', async () => {
    const sqlDb = openTestDb('0012')
    seedWorld(sqlDb)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(devEnv(sqlDb), '/api/account', { method: 'DELETE' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', OWNER)).toBe(1)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM docs WHERE owner_id = ?', OWNER)).toBe(7)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM attachments WHERE owner_id = ?', OWNER)).toBe(2)
  })
})

// D1 어댑터를 감싸 실행된 문장을 센다 — batch 안 문장은 하나씩
function countingD1(inner: D1Database) {
  const executed: string[] = []
  type Inner = D1PreparedStatement
  function wrap(sql: string, stmt: Inner): D1PreparedStatement {
    return {
      bind: (...args: unknown[]) => wrap(sql, stmt.bind(...args)),
      first: (...a: []) => {
        executed.push(sql)
        return stmt.first(...a)
      },
      all: () => {
        executed.push(sql)
        return stmt.all()
      },
      run: () => {
        executed.push(sql)
        return stmt.run()
      },
      __inner: stmt,
    } as unknown as D1PreparedStatement
  }
  const db = {
    prepare: (sql: string) => wrap(sql, inner.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) => {
      const unwrapped = statements.map((s) => {
        executed.push('batch')
        return (s as unknown as { __inner: Inner }).__inner
      })
      return inner.batch(unwrapped)
    },
  } as unknown as D1Database
  return { db, executed }
}

describe('F-2038 W8 문장 수', () => {
  it('개발 우회 DELETE 한 번의 동기 경로 D1 문장 ≤ 22, 뒤따르는 정리는 ≤ 4', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    const { db, executed } = countingD1(asD1(sqlDb))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx, pending } = makeCtx()
    const env = { ...devEnv(sqlDb, failingRooms()), DB: db } as unknown as Env
    const res = await call(env, '/api/account', { method: 'DELETE' }, ctx)
    expect(res.status).toBe(204)
    await Promise.all(pending)
    const purgeSql = new Set<string>(Object.values(PURGE_SQL))
    const purge = executed.filter((sql) => purgeSql.has(sql))
    const sync = executed.filter((sql) => !purgeSql.has(sql))
    expect(sync.length).toBeLessThanOrEqual(22)
    expect(purge.length).toBeGreaterThan(0)
    expect(purge.length).toBeLessThanOrEqual(4)
  })
})

describe('F-2038 W10 두 번', () => {
  it('두 번째도 204, purge_jobs 에 겹친 행 없음', async () => {
    const sqlDb = openTestDb()
    seedWorld(sqlDb)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = devEnv(sqlDb, failingRooms())
    expect((await call(env, '/api/account', { method: 'DELETE' })).status).toBe(204)
    expect((await call(env, '/api/account', { method: 'DELETE' })).status).toBe(204)
    const rows = sqlDb.prepare('SELECT kind, target FROM purge_jobs').all() as { kind: string; target: string }[]
    const keys = rows.map((r) => `${r.kind}:${r.target}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(rows.filter((r) => r.kind === 'room')).toHaveLength(7)
    expect(rows.filter((r) => r.kind === 'r2_prefix')).toHaveLength(2)
  })
})
