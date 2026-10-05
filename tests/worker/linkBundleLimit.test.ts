// F-4002 A1~A6 공유 링크 묶음 상한 (specs/features/F-4002.md 2장·4장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeWorld() {
  const sqlDb = openTestDb()
  const inner = asD1(sqlDb)
  const sqls: string[] = []
  const bindSizes: number[] = []
  const DB = {
    prepare(sql: string) {
      sqls.push(sql)
      const stmt = inner.prepare(sql)
      return new Proxy(stmt, {
        get(target, prop, receiver) {
          if (prop !== 'bind') return Reflect.get(target, prop, receiver)
          return (...args: unknown[]) => {
            bindSizes.push(args.length)
            return target.bind(...args)
          }
        },
      })
    },
    batch: inner.batch.bind(inner),
  }
  const env = {
    DB,
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: 'owner@example.com',
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env
  return { sqlDb, env, sqls, bindSizes }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function post(env: Env, id: string, body: string | undefined): Promise<Response> {
  return call(env, `/api/docs/${id}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
}

async function setup(count: number) {
  const w = makeWorld()
  await call(w.env, '/api/me')
  const ownerId = (w.sqlDb.prepare('SELECT id FROM users WHERE email = ?').get('owner@example.com') as { id: string }).id
  const insert = w.sqlDb.prepare(
    "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,'','lf',1,1,1,?)",
  )
  const ids = Array.from({ length: count + 1 }, () => crypto.randomUUID())
  ids.forEach((id) => insert.run(id, ownerId, id.slice(0, 4), null))
  return { ...w, ownerId, start: ids[0], others: ids.slice(1), insert }
}

function writeCount(sqlDb: DatabaseSync): number {
  return (sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get('owner@example.com') as { write_count: number }).write_count
}

function linkDocCount(sqlDb: DatabaseSync): number {
  return (sqlDb.prepare('SELECT COUNT(*) AS c FROM share_link_docs').get() as { c: number }).c
}

describe('F-4002 A1 101개', () => {
  it('400 bad_request, 소유 검사·쓰기 0', async () => {
    const w = await setup(101)
    const before = writeCount(w.sqlDb)
    w.sqls.length = 0
    const res = await post(w.env, w.start, JSON.stringify({ docIds: w.others }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
    expect(w.sqls.some((s) => s.includes('FROM docs WHERE owner_id'))).toBe(false)
    expect(linkDocCount(w.sqlDb)).toBe(0)
    expect(writeCount(w.sqlDb)).toBe(before)
  })
})

describe('F-4002 A2 100개', () => {
  it('201, 100행, 소유 검사·INSERT prepare 각 1개', async () => {
    const w = await setup(100)
    w.sqls.length = 0
    const res = await post(w.env, w.start, JSON.stringify({ docIds: w.others }))
    expect(res.status).toBe(201)
    expect(linkDocCount(w.sqlDb)).toBe(100)
    expect(w.sqls.filter((s) => s.startsWith('SELECT id, e2ee_key FROM docs WHERE owner_id')).length).toBe(1)
    expect(w.sqls.filter((s) => s.startsWith('INSERT INTO share_link_docs')).length).toBe(1)
  })
})

describe('F-4002 A3 본문 8,193 B', () => {
  it('유효 JSON 이어도 400, 쓰기 0', async () => {
    const w = await setup(1)
    const body = JSON.stringify({ docIds: [], pad: 'x'.repeat(8_193) })
    expect(body.length).toBeGreaterThan(8_192)
    const res = await post(w.env, w.start, body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
    expect(linkDocCount(w.sqlDb)).toBe(0)
  })
})

describe('F-4002 A4 깨진 본문·모양 오류', () => {
  it('깨진 JSON·본문 없음은 단일 링크, 문자열 아닌 원소는 400', async () => {
    const w = await setup(1)
    expect((await post(w.env, w.start, '{broken')).status).toBe(201)
    expect((await post(w.env, w.start, undefined)).status).toBe(200)
    expect((await post(w.env, w.start, JSON.stringify({ docIds: [1] }))).status).toBe(400)
    expect((await post(w.env, w.start, JSON.stringify({ docIds: 'x' }))).status).toBe(400)
  })

  it('묶음이 있는 링크에 docIds 없이 다시 요청해도 묶음이 남는다', async () => {
    const w = await setup(2)
    await post(w.env, w.start, JSON.stringify({ docIds: w.others }))
    expect((await post(w.env, w.start, '{}')).status).toBe(200)
    expect(linkDocCount(w.sqlDb)).toBe(2)
  })
})

describe('F-4002 A5 소유 검사', () => {
  it('남의 문서가 섞이면 400·쓰기 0, 금고 문서는 조용히 빠진다', async () => {
    const w = await setup(2)
    w.sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u2', 'u2@example.com')
    const foreign = crypto.randomUUID()
    w.insert.run(foreign, 'u2', 'f', null)
    const bad = await post(w.env, w.start, JSON.stringify({ docIds: [w.others[0], foreign] }))
    expect(bad.status).toBe(400)
    expect(linkDocCount(w.sqlDb)).toBe(0)

    const vault = crypto.randomUUID()
    w.insert.run(vault, w.ownerId, 'v', 'key')
    const ok = await post(w.env, w.start, JSON.stringify({ docIds: [w.others[0], vault] }))
    expect(ok.status).toBe(201)
    const rows = w.sqlDb.prepare('SELECT doc_id FROM share_link_docs').all() as Array<{ doc_id: string }>
    expect(rows.map((r) => r.doc_id)).toEqual([w.others[0]])
  })
})

describe('F-4002 A6 이미 150개인 묶음 읽기', () => {
  it('151개가 시작 문서부터 순서대로, 모든 bind 인자 ≤ 100', async () => {
    const w = await setup(150)
    const token = 'a'.repeat(43)
    w.sqlDb
      .prepare("INSERT INTO share_links (token, owner_id, target_type, target_id, created_at) VALUES (?,?,'doc',?,1)")
      .run(token, w.ownerId, w.start)
    const link = w.sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)')
    w.others.forEach((id) => link.run(token, id))
    w.bindSizes.length = 0
    const res = await call(w.env, `/pub/docs/${token}/set`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { docs: Array<{ id: string }> }
    expect(body.docs).toHaveLength(151)
    expect(body.docs[0].id).toBe(w.start)
    expect(new Set(body.docs.map((d) => d.id))).toEqual(new Set([w.start, ...w.others]))
    expect(Math.max(...w.bindSizes)).toBeLessThanOrEqual(100)
  })
})
