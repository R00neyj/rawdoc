// 연결된 앱 목록·끊기 — worker/index.ts 를 통째로 (specs/features/F-4011.md 6장 M6·M7)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { authenticateMcp } from '../../worker/mcpAuth'
import { mcpResource } from '../../worker/oauthServer'
import worker from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

const LOCAL = 'http://localhost:8790'
const NOW = Date.parse('2026-10-16T05:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const iso = (ms: number) => new Date(ms).toISOString()

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, pending }
}

// 개발 우회 — me@example.com 이 u1 로 들어온다
function setup() {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u1', 'me@example.com')
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u2', 'other@example.com')
  const env = { DB: asD1(sqlDb), BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: 'me@example.com' } as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }) as never, env, makeCtx().ctx)
}

function addClient(sqlDb: DatabaseSync, clientId: string, name: string | null, redirect: string) {
  sqlDb
    .prepare('INSERT INTO oauth_clients (id, client_id, disabled, created_at, updated_at, name, redirect_uris) VALUES (?,?,0,?,?,?,?)')
    .run(`row-${clientId}`, clientId, iso(NOW - 3 * HOUR_MS), iso(NOW - 3 * HOUR_MS), name, JSON.stringify([redirect]))
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 동의 한 줄 + 갱신 토큰 + 그것을 참조하는 접근 토큰. 접근 토큰 원문은 `at-{user}-{client}`
async function connect(sqlDb: DatabaseSync, env: Env, userId: string, clientId: string, createdAt: number) {
  const key = `${userId}-${clientId}`
  const scopes = JSON.stringify(['docs', 'offline_access'])
  const resources = JSON.stringify([mcpResource(env)])
  sqlDb
    .prepare('INSERT INTO oauth_consents (id, client_id, user_id, scopes, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(`consent-${key}`, clientId, userId, scopes, iso(createdAt), iso(createdAt))
  sqlDb
    .prepare('INSERT INTO oauth_refresh_tokens (id, token, client_id, user_id, resources, expires_at, created_at, scopes) VALUES (?,?,?,?,?,?,?,?)')
    .run(`rt-${key}`, await sha256(`rt-${key}`), clientId, userId, resources, iso(NOW + 30 * 24 * HOUR_MS), iso(createdAt), scopes)
  sqlDb
    .prepare('INSERT INTO oauth_access_tokens (id, token, client_id, user_id, resources, refresh_id, expires_at, created_at, scopes) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`at-${key}`, await sha256(`at-${key}`), clientId, userId, resources, `rt-${key}`, iso(NOW + HOUR_MS), iso(createdAt), scopes)
}

async function authenticate(env: Env, token: string) {
  const { ctx, pending } = makeCtx()
  const result = await authenticateMcp(new Request(`${LOCAL}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx)
  await Promise.all(pending)
  return result
}

function rowsOf(sqlDb: DatabaseSync, table: string, userId: string, clientId: string): number {
  return (sqlDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND client_id = ?`).get(userId, clientId) as { n: number }).n
}

async function world() {
  const { sqlDb, env } = setup()
  addClient(sqlDb, 'c1', 'Claude', 'https://claude.ai/api/mcp/auth_callback')
  addClient(sqlDb, 'c2', null, 'https://chatgpt.com/connector_platform_oauth_redirect')
  addClient(sqlDb, 'c3', 'Other app', 'https://other.example/cb')
  await connect(sqlDb, env, 'u1', 'c1', NOW - 2 * HOUR_MS)
  await connect(sqlDb, env, 'u1', 'c2', NOW - HOUR_MS)
  await connect(sqlDb, env, 'u2', 'c1', NOW - HOUR_MS / 2)
  await connect(sqlDb, env, 'u2', 'c3', NOW - HOUR_MS / 2)
  return { sqlDb, env }
}

describe('F-4011 M7 연결된 앱 목록', () => {
  it('내 동의만·createdAt 내림차순·clientLabel 이름(client_name 없으면 호스트)·no-store', async () => {
    const { env } = await world()
    const res = await call(env, '/api/connected-apps')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual([
      { id: 'c2', name: 'chatgpt.com', host: 'chatgpt.com', createdAt: NOW - HOUR_MS, lastUsedAt: null },
      { id: 'c1', name: 'Claude', host: 'claude.ai', createdAt: NOW - 2 * HOUR_MS, lastUsedAt: null },
    ])
  })
})

describe('F-4011 M6 목록의 마지막 사용', () => {
  it('관문을 지난 앱은 lastUsedAt 에 그 ms, 한 번도 안 쓴 앱은 null', async () => {
    const { env } = await world()
    vi.setSystemTime(NOW + 5000)
    expect(await authenticate(env, 'at-u1-c1')).not.toBeInstanceOf(Response)
    const list = (await (await call(env, '/api/connected-apps')).json()) as { id: string; lastUsedAt: number | null }[]
    expect(Object.fromEntries(list.map((app) => [app.id, app.lastUsedAt]))).toEqual({ c1: NOW + 5000, c2: null })
  })
})

describe('F-4011 M7 연결 끊기', () => {
  it('204 → 그 토큰 401, 그 (사용자, 클라이언트) 접근·갱신·동의 0, 사용 기록·클라이언트는 남고 다른 행 그대로', async () => {
    const { sqlDb, env } = await world()
    expect(await authenticate(env, 'at-u1-c1')).not.toBeInstanceOf(Response)
    expect(rowsOf(sqlDb, 'oauth_client_use', 'u1', 'c1')).toBe(1)

    const res = await call(env, '/api/connected-apps/c1', { method: 'DELETE' })
    expect(res.status).toBe(204)

    const after = await authenticate(env, 'at-u1-c1')
    expect(after).toBeInstanceOf(Response)
    expect((after as Response).status).toBe(401)
    for (const table of ['oauth_access_tokens', 'oauth_refresh_tokens', 'oauth_consents']) {
      expect(rowsOf(sqlDb, table, 'u1', 'c1'), table).toBe(0)
      expect(rowsOf(sqlDb, table, 'u1', 'c2'), table).toBe(1)
      expect(rowsOf(sqlDb, table, 'u2', 'c1'), table).toBe(1)
      expect(rowsOf(sqlDb, table, 'u2', 'c3'), table).toBe(1)
    }
    expect(rowsOf(sqlDb, 'oauth_client_use', 'u1', 'c1')).toBe(1)
    expect(sqlDb.prepare('SELECT client_id FROM oauth_clients ORDER BY client_id').all()).toEqual([{ client_id: 'c1' }, { client_id: 'c2' }, { client_id: 'c3' }])
    expect(await authenticate(env, 'at-u2-c1')).not.toBeInstanceOf(Response)
  })

  it('동의 없음 404 not_found — 끊은 뒤 다시, 모르는 id, 남의 앱', async () => {
    const { sqlDb, env } = await world()
    expect((await call(env, '/api/connected-apps/c1', { method: 'DELETE' })).status).toBe(204)
    for (const id of ['c1', 'nope', 'c3']) {
      const res = await call(env, `/api/connected-apps/${id}`, { method: 'DELETE' })
      expect(res.status, id).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    expect(rowsOf(sqlDb, 'oauth_consents', 'u2', 'c3')).toBe(1)
  })

  it('막힌 계정도 끊는다 — 204', async () => {
    const { sqlDb, env } = await world()
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(NOW - HOUR_MS, 'u1')
    expect((await call(env, '/api/connected-apps/c2', { method: 'DELETE' })).status).toBe(204)
    expect(rowsOf(sqlDb, 'oauth_consents', 'u1', 'c2')).toBe(0)
  })

  it('로그아웃(세션 없음) → 목록·끊기 401, 아무것도 안 지움', async () => {
    const { sqlDb } = await world()
    const env = {
      DB: asD1(sqlDb),
      BETTER_AUTH_URL: 'https://rawdoc.app',
      BETTER_AUTH_SECRET: 's'.repeat(40),
      DEV_AUTH_EMAIL: '',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: 'github-secret',
    } as unknown as Env
    const list = await worker.fetch(new Request('https://rawdoc.app/api/connected-apps') as never, env, makeCtx().ctx)
    const del = await worker.fetch(
      new Request('https://rawdoc.app/api/connected-apps/c1', { method: 'DELETE', headers: { Origin: 'https://rawdoc.app' } }) as never,
      env,
      makeCtx().ctx,
    )
    expect([list.status, del.status]).toEqual([401, 401])
    expect(rowsOf(sqlDb, 'oauth_consents', 'u1', 'c1')).toBe(1)
  })
})
