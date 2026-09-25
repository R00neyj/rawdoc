// 금고 마이그레이션·키 묶음 라우트 — worker/index.ts 를 통째로 (specs/features/F-401.md 2장·3.1, 10.1 M1·K1~K8)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { asAuthDb, asD1, openTestDb } from './testD1'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const OTHER = 'other@example.com'
const KEY = 'A'.repeat(55) + '='
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeWorld() {
  const sqlDb = openTestDb()
  const base = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) } }
  const owner = { ...base, DEV_AUTH_EMAIL: OWNER } as unknown as Env
  const other = { ...base, DEV_AUTH_EMAIL: OTHER } as unknown as Env
  return { sqlDb, owner, other }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function json(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method }
  return { method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }
}

async function userId(env: Env, sqlDb: DatabaseSync, email: string): Promise<string> {
  await call(env, '/api/me')
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

function writeCount(sqlDb: DatabaseSync, email = OWNER): number {
  const row = sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(email) as { write_count: number } | undefined
  return row?.write_count ?? 0
}

describe('F-401 M1 마이그레이션 0011', () => {
  it('기존 행은 모두 일반, e2ee_keys 는 비어 있다', () => {
    const db = openTestDb('0010')
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run('u1', 'u1@example.com', 1)
    db.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,NULL,1,1)').run('f1', 'u1', 'f')
    db.prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,1,1,1)',
    ).run('d1', 'u1', 't', 'c', 'lf', 'f1')
    db.prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      'u1', '0123456789abcdef', 'png', 'image/png', 1, 1, 1, 1,
    )
    db.exec(readFileSync(fileURLToPath(new URL('../migrations/0011_e2ee.sql', import.meta.url)), 'utf-8'))
    expect(db.prepare('SELECT e2ee_key, attachment_refs FROM docs').get()).toEqual({ e2ee_key: null, attachment_refs: null })
    expect(db.prepare('SELECT e2ee FROM folders').get()).toEqual({ e2ee: 0 })
    expect(db.prepare('SELECT e2ee FROM attachments').get()).toEqual({ e2ee: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM e2ee_keys').get()).toEqual({ n: 0 })
  })
})

describe('F-401 K1~K3 GET·PUT /api/e2ee/keys', () => {
  it('K1 묶음 없으면 404 no_vault', async () => {
    const { owner } = makeWorld()
    const res = await call(owner, '/api/e2ee/keys')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no_vault' })
  })

  it('K2 baseRev 0 으로 만들고 읽는다, write_count +1, no-store', async () => {
    const { sqlDb, owner } = makeWorld()
    await userId(owner, sqlDb, OWNER)
    const before = writeCount(sqlDb)
    const put = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({ rev: 1 })
    expect(writeCount(sqlDb) - before).toBe(1)
    const get = await call(owner, '/api/e2ee/keys')
    expect(get.status).toBe(200)
    expect(get.headers.get('Cache-Control')).toBe('no-store')
    expect(await get.json()).toEqual({ bundle: 'B1', rev: 1 })
  })

  it('K3 낡은 baseRev 는 409 conflict(지금 rev), 맞으면 +1', async () => {
    const { sqlDb, owner } = makeWorld()
    await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    const before = writeCount(sqlDb)
    const stale = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B2', baseRev: 0 }))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'conflict', rev: 1 })
    expect(writeCount(sqlDb)).toBe(before)

    const ok = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B2', baseRev: 1 }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ rev: 2 })
    const again = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B3', baseRev: 1 }))
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'conflict', rev: 2 })
    expect(((await (await call(owner, '/api/e2ee/keys')).json()) as { bundle: string }).bundle).toBe('B2')
  })

  it('K3 행이 없는데 baseRev 가 0 이 아니면 409 conflict rev 0', async () => {
    const { owner } = makeWorld()
    const res = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 3 }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'conflict', rev: 0 })
  })
})

describe('F-401 K4·K5 PUT 크기·모양', () => {
  it('K4 묶음 4,097 B 413 / 4,096 B 200 / 몸통 16,385 B 413', async () => {
    const { owner } = makeWorld()
    const big = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'x'.repeat(4_097), baseRev: 0 }))
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'too_large', limit: 4096 })

    const multi = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: '가'.repeat(1_366), baseRev: 0 }))
    expect(multi.status).toBe(413)

    const exact = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'x'.repeat(4_096), baseRev: 0 }))
    expect(exact.status).toBe(200)

    const prefix = JSON.stringify({ bundle: 'B', baseRev: 1, pad: '' })
    const body = JSON.stringify({ bundle: 'B', baseRev: 1, pad: 'y'.repeat(16_385 - prefix.length) })
    expect(new TextEncoder().encode(body).length).toBe(16_385)
    const huge = await call(owner, '/api/e2ee/keys', json('PUT', body))
    expect(huge.status).toBe(413)
    expect(await huge.json()).toEqual({ error: 'too_large', limit: 4096 })
  })

  it('K5 bundle·baseRev 400, write_count 그대로', async () => {
    const { sqlDb, owner } = makeWorld()
    await userId(owner, sqlDb, OWNER)
    const before = writeCount(sqlDb)
    for (const bundle of ['', 12]) {
      const res = await call(owner, '/api/e2ee/keys', json('PUT', { bundle, baseRev: 0 }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field: 'bundle' })
    }
    for (const baseRev of [-1, 1.5, undefined]) {
      const res = await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B', baseRev }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field: 'baseRev' })
    }
    expect(writeCount(sqlDb)).toBe(before)
  })
})

describe('F-401 K6 DELETE /api/e2ee/keys', () => {
  it('금고가 비어야 지운다, 행이 없으면 D1 에 쓰지 않고 204', async () => {
    const { sqlDb, owner } = makeWorld()
    await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    const id = await userId(owner, sqlDb, OWNER)
    sqlDb
      .prepare(
        "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES ('vd', ?, 'dA==', 'Yg==', 'lf', 1, 1, 1, ?, '[]')",
      )
      .run(id, KEY)
    sqlDb.prepare("INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES ('vf', ?, 'f', NULL, 1, 1, 1)").run(id)

    const before = writeCount(sqlDb)
    const busy = await call(owner, '/api/e2ee/keys', { method: 'DELETE' })
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({ error: 'vault_not_empty', docs: 1, folders: 1 })
    expect(writeCount(sqlDb)).toBe(before)

    sqlDb.prepare("DELETE FROM docs WHERE id = 'vd'").run()
    sqlDb.prepare("DELETE FROM folders WHERE id = 'vf'").run()
    const done = await call(owner, '/api/e2ee/keys', { method: 'DELETE' })
    expect(done.status).toBe(204)
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM e2ee_keys').get()).toEqual({ n: 0 })
    expect(writeCount(sqlDb) - before).toBe(1)

    const again = await call(owner, '/api/e2ee/keys', { method: 'DELETE' })
    expect(again.status).toBe(204)
    expect(writeCount(sqlDb) - before).toBe(1)
  })
})

describe('F-401 K6 조건부 DELETE (r5)', () => {
  it('사전 검사 뒤 끼어든 금고 문서가 있으면 409, 묶음은 남는다', async () => {
    const { sqlDb, owner } = makeWorld()
    await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    const id = await userId(owner, sqlDb, OWNER)
    const DB = (owner as unknown as { DB: D1Database }).DB
    const batch = DB.batch.bind(DB)
    DB.batch = (async (statements: D1PreparedStatement[]) => {
      sqlDb
        .prepare(
          "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES ('late', ?, 'dA==', 'Yg==', 'lf', 1, 1, 1, ?, '[]')",
        )
        .run(id, KEY)
      return batch(statements)
    }) as typeof DB.batch
    const res = await call(owner, '/api/e2ee/keys', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'vault_not_empty', docs: 1, folders: 0 })
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM e2ee_keys').get()).toEqual({ n: 1 })
  })
})

describe('F-401 K7·K8 남의 묶음·관문', () => {
  it('K7 다른 사용자는 A 의 묶음을 못 본다', async () => {
    const { owner, other } = makeWorld()
    await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    const res = await call(other, '/api/e2ee/keys')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no_vault' })
  })

  it('K8 막힌 계정 PUT·DELETE 403, 세션 없는 GET 401', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(Date.now(), id)
    for (const init of [json('PUT', { bundle: 'B1', baseRev: 0 }), { method: 'DELETE' }]) {
      const res = await call(owner, '/api/e2ee/keys', init)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'account_blocked' })
    }

    const noSession = {
      DB: asAuthDb(openTestDb()),
      BETTER_AUTH_URL: 'https://rawdoc.app',
      BETTER_AUTH_SECRET: 's'.repeat(40),
      DEV_AUTH_EMAIL: '',
    } as unknown as Env
    const res = await worker.fetch(new Request('https://rawdoc.app/api/e2ee/keys'), noSession, ctx)
    expect(res.status).toBe(401)
  })
})
