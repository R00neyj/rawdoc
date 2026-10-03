// 편집 잠금 제거 — 표·헤더·라우트가 없다 (specs/features/F-309.md 6장 A1~A3)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

function makeEnv() {
  const sqlDb = openTestDb()
  const limit = vi.fn(async () => ({ success: true }))
  const env = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: EMAIL, WRITE_LIMITER: { limit } } as unknown as Env
  return { sqlDb, env, limit }
}

function call(env: Env, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const h = new Headers(headers)
  if (method !== 'GET') h.set('Origin', ORIGIN)
  if (body !== undefined) h.set('Content-Type', 'application/json')
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx)
}

async function seedDoc(sqlDb: DatabaseSync, env: Env) {
  await call(env, '/api/docs', 'GET')
  const user = sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }
  sqlDb
    .prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1', ?, 't', 'a', 'lf', 1, 1, 1)")
    .run(user.id)
  return user.id
}

function writeCount(sqlDb: DatabaseSync): number {
  return (sqlDb.prepare('SELECT write_count AS n FROM users WHERE email = ?').get(EMAIL) as { n: number }).n
}

describe('F-309 A1 표가 없다', () => {
  it('doc_locks 가 없고 DROP 파일을 한 번 더 실행해도 오류가 없다', () => {
    const sqlDb = openTestDb()
    const rows = sqlDb.prepare("SELECT name FROM sqlite_master WHERE name = 'doc_locks'").all()
    expect(rows).toHaveLength(0)
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith('_drop_doc_locks.sql'))
    expect(file).toBeTruthy()
    expect(() => sqlDb.exec(readFileSync(MIGRATIONS + file, 'utf-8'))).not.toThrow()
  })
})

describe('F-309 A2 /api PUT 은 헤더를 안 본다', () => {
  it('헤더 유무와 무관하게 200·version +1, 낡은 baseVersion 은 409', async () => {
    const { sqlDb, env } = makeEnv()
    await seedDoc(sqlDb, env)
    const withHeader = await call(env, '/api/docs/d1', 'PUT', { content: 'b', baseVersion: 1 }, { 'X-Lock-Session': 'x' })
    expect(withHeader.status).toBe(200)
    expect(((await withHeader.json()) as { version: number }).version).toBe(2)
    const without = await call(env, '/api/docs/d1', 'PUT', { content: 'c', baseVersion: 2 })
    expect(without.status).toBe(200)
    expect(((await without.json()) as { version: number }).version).toBe(3)
    const stale = await call(env, '/api/docs/d1', 'PUT', { content: 'd', baseVersion: 1 })
    expect(stale.status).toBe(409)
    expect(((await stale.json()) as { error: string }).error).toBe('conflict')
  })
})

describe('F-309 A3 잠금 라우트가 없다', () => {
  it('POST·DELETE /lock 은 404 not_found, write_count 그대로, 한도 호출 0', async () => {
    const { sqlDb, env, limit } = makeEnv()
    await seedDoc(sqlDb, env)
    const before = writeCount(sqlDb)
    const post = await call(env, '/api/docs/d1/lock', 'POST', { sessionId: 's' })
    expect(post.status).toBe(404)
    expect(await post.json()).toEqual({ error: 'not_found' })
    const del = await call(env, '/api/docs/d1/lock?session=s', 'DELETE')
    expect(del.status).toBe(404)
    expect(await del.json()).toEqual({ error: 'not_found' })
    expect(writeCount(sqlDb)).toBe(before)
    expect(limit).not.toHaveBeenCalled()
  })
})
