// 막힌 계정·막힌 소유자 — worker/index.ts 를 통째로 (specs/features/F-2028.md 9.1 B1~B9)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from './testD1'
import { buildImageBlock } from '../src/lib/imageBlock'

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
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const ATT = '0123456789abcdef'
const MISSING_TOKEN = 'z'.repeat(43)
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeWorld() {
  const sqlDb = openTestDb()
  const DB = asD1(sqlDb)
  const bucketGet = vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]) }))
  const getByName = vi.fn(() => ({
    async revalidateConnections() {},
    async purgeRoom() {},
    async writeText() {
      return { type: 'ok', doc: { title: 't', content: 'c', version: 99, updatedAt: 1 } }
    },
  }))
  const base = {
    DB,
    BETTER_AUTH_URL: ORIGIN,
    BUCKET: { async put() {}, get: bucketGet },
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    DOC_ROOM: { getByName },
  }
  const owner = { ...base, DEV_AUTH_EMAIL: OWNER } as unknown as Env
  const friend = { ...base, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
  return { sqlDb, owner, friend, bucketGet, getByName }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function json(method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit {
  if (body === undefined) return { method, headers }
  return { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }
}

function bearer(token: string, method = 'GET', body?: unknown): RequestInit {
  return json(method, body, { Authorization: `Bearer ${token}` })
}

async function ok<T>(res: Promise<Response>, status = [200, 201]): Promise<T> {
  const r = await res
  expect(status).toContain(r.status)
  return (await r.json()) as T
}

function userRow(sqlDb: DatabaseSync, email: string) {
  return sqlDb.prepare('SELECT id, content_bytes, write_count FROM users WHERE email = ?').get(email) as {
    id: string
    content_bytes: number
    write_count: number
  }
}

function setBlocked(sqlDb: DatabaseSync, email: string, value: number | null) {
  sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE email = ?').run(value, email)
}

function docRow(sqlDb: DatabaseSync, id: string) {
  return sqlDb.prepare('SELECT version, content FROM docs WHERE id = ?').get(id) as { version: number; content: string }
}

async function createToken(env: Env): Promise<string> {
  return (await ok<{ token: string }>(call(env, '/api/tokens', json('POST', { name: '토큰' })))).token
}

async function createDoc(env: Env, title: string, content: string, folderId?: string): Promise<string> {
  const body: Record<string, unknown> = { title, content, lineEnding: 'lf' }
  if (folderId) body.folderId = folderId
  return (await ok<{ id: string }>(call(env, '/api/docs', json('POST', body)))).id
}

// 5.2 P-1~P-8 을 만든다 — 문서 D(첨부)·묶음 E(첨부)·폴더 F 안 문서 G(첨부), D 링크·F 링크
async function setupShares(w: ReturnType<typeof makeWorld>) {
  await ok(call(w.owner, '/api/me'), [200])
  const ownerId = userRow(w.sqlDb, OWNER).id
  w.sqlDb
    .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ownerId, ATT, 'png', 'image/png', 3, 2, 2, 1)
  const image = buildImageBlock({ id: ATT, ext: 'png', alt: '이미지', width: 2 })
  const e = await createDoc(w.owner, 'E', `묶음\n\n${image}`)
  const d = await createDoc(w.owner, 'D', `시작\n\n${image}`)
  const f = (await ok<{ id: string }>(call(w.owner, '/api/folders', json('POST', { name: 'F' })))).id
  const g = await createDoc(w.owner, 'G', `폴더 안\n\n${image}`, f)
  const docToken = (await ok<{ token: string }>(call(w.owner, `/api/docs/${d}/link`, json('POST', { docIds: [e] })))).token
  const folderToken = (await ok<{ token: string }>(call(w.owner, `/api/folders/${f}/link`, json('POST')))).token
  const paths = (dt: string, ft: string) => [
    `/pub/docs/${dt}`,
    `/pub/docs/${dt}/set`,
    `/pub/docs/${dt}/docs/${e}`,
    `/pub/folders/${ft}`,
    `/pub/folders/${ft}/docs/${g}`,
    `/pub/docs/${dt}/attachments/${ATT}.png`,
    `/pub/docs/${dt}/docs/${e}/attachments/${ATT}.png`,
    `/pub/folders/${ft}/docs/${g}/attachments/${ATT}.png`,
  ]
  return { d, e, g, public: paths(docToken, folderToken), missing: paths(MISSING_TOKEN, MISSING_TOKEN) }
}

async function snapshot(res: Response) {
  return { status: res.status, headers: [...res.headers].sort(), body: await res.text() }
}

describe('F-2028 B1 /v1/me 의 blocked·warned', () => {
  it('처음 / warned_at / blocked_at', async () => {
    const w = makeWorld()
    const token = await createToken(w.owner)
    const me = () => ok<Record<string, unknown>>(call(w.owner, '/v1/me', bearer(token)), [200])
    const first = await me()
    expect(Object.keys(first).sort()).toEqual(['blocked', 'email', 'id', 'warned'])
    expect([first.blocked, first.warned]).toEqual([false, false])
    w.sqlDb.prepare('UPDATE users SET warned_at = ? WHERE email = ?').run(Date.now(), OWNER)
    const warned = await me()
    expect([warned.blocked, warned.warned]).toEqual([false, true])
    setBlocked(w.sqlDb, OWNER, Date.now())
    const blocked = await me()
    expect([blocked.blocked, blocked.warned]).toEqual([true, true])
  })
})

describe('F-2028 B2~B4 공개 경로', () => {
  it('B2 안 막힘 → 404 아님 / B3 막힘 → 없는 토큰과 같은 404 / B4 풀면 되돌아온다', async () => {
    const w = makeWorld()
    const s = await setupShares(w)

    for (const path of s.public) expect([path, (await call(w.owner, path)).status]).toEqual([path, 200])
    expect(w.bucketGet).toHaveBeenCalledTimes(3)

    setBlocked(w.sqlDb, OWNER, Date.now())
    for (let i = 0; i < s.public.length; i++) {
      const blocked = await snapshot(await call(w.owner, s.public[i]))
      const missing = await snapshot(await call(w.owner, s.missing[i]))
      expect([s.public[i], blocked.status]).toEqual([s.public[i], 404])
      expect(blocked).toEqual(missing)
    }
    expect(w.bucketGet).toHaveBeenCalledTimes(3)

    setBlocked(w.sqlDb, OWNER, null)
    for (const path of s.public) expect([path, (await call(w.owner, path)).status]).toEqual([path, 200])
    expect(w.bucketGet).toHaveBeenCalledTimes(6)
  })
})

describe('F-2028 B5~B8 막힌 소유자 문서에 남이 쓰기', () => {
  async function setupShared() {
    const w = makeWorld()
    const d = await createDoc(w.owner, 'D', '본문')
    const h = await createDoc(w.owner, 'H', '보기 전용')
    await ok(call(w.owner, `/api/docs/${d}/grants/${FRIEND}`, json('PUT', { role: 'edit' })), [200])
    await ok(call(w.owner, `/api/docs/${h}/grants/${FRIEND}`, json('PUT', { role: 'view' })), [200])
    const ownerToken = await createToken(w.owner)
    const friendToken = await createToken(w.friend)
    setBlocked(w.sqlDb, OWNER, Date.now())
    return { w, d, h, ownerToken, friendToken }
  }

  it('B5 PUT·잠금 잡기는 403 account_blocked, 잠금 놓기는 204, 아무 것도 바뀌지 않는다', async () => {
    const { w, d } = await setupShared()
    const before = docRow(w.sqlDb, d)
    const ownerBytes = userRow(w.sqlDb, OWNER).content_bytes
    const friendWrites = userRow(w.sqlDb, FRIEND).write_count

    const put = await call(w.friend, `/api/docs/${d}`, json('PUT', { content: '본문이 길어진다', baseVersion: before.version }))
    expect(put.status).toBe(403)
    expect(await put.json()).toEqual({ error: 'account_blocked' })

    const lock = await call(w.friend, `/api/docs/${d}/lock`, json('POST', { sessionId: 's1' }))
    expect(lock.status).toBe(403)
    expect(await lock.json()).toEqual({ error: 'account_blocked' })
    expect((w.sqlDb.prepare('SELECT COUNT(*) AS n FROM doc_locks').get() as { n: number }).n).toBe(0)

    const unlock = await call(w.friend, `/api/docs/${d}/lock?session=s1`, json('DELETE'))
    expect(unlock.status).toBe(204)

    expect(docRow(w.sqlDb, d)).toEqual(before)
    expect(userRow(w.sqlDb, OWNER).content_bytes).toBe(ownerBytes)
    expect(userRow(w.sqlDb, FRIEND).write_count).toBe(friendWrites + 1)
  })

  it('B6 /v1 PUT 은 403 account_blocked, DO 를 부르지 않는다', async () => {
    const { w, d, friendToken } = await setupShared()
    const before = docRow(w.sqlDb, d)
    w.getByName.mockClear()
    const res = await call(w.friend, `/v1/docs/${d}`, bearer(friendToken, 'PUT', { content: '바꿈', baseVersion: before.version }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_blocked' })
    expect(w.getByName).not.toHaveBeenCalled()
    expect(docRow(w.sqlDb, d)).toEqual(before)
  })

  it('B7 읽기는 모두 200', async () => {
    const { w, d, ownerToken, friendToken } = await setupShared()
    const reads: [Env, string, RequestInit][] = [
      [w.friend, `/api/docs/${d}`, {}],
      [w.friend, `/v1/docs/${d}`, bearer(friendToken)],
      [w.owner, '/api/docs', {}],
      [w.owner, `/api/docs/${d}`, {}],
      [w.owner, '/v1/docs', bearer(ownerToken)],
    ]
    for (const [env, path, init] of reads) expect([path, (await call(env, path, init)).status]).toEqual([path, 200])
  })

  it('B8 보기 초대는 소유자가 막혀도 지금처럼 403 forbidden', async () => {
    const { w, h } = await setupShared()
    const res = await call(w.friend, `/api/docs/${h}`, json('PUT', { content: '바꿈', baseVersion: docRow(w.sqlDb, h).version }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })
})

describe('F-2028 B9 /v1 안쪽 인증 한 번', () => {
  function countingEnv(env: Env, over: Record<string, unknown> = {}) {
    const preparedSql: string[] = []
    const inner = env.DB as unknown as { prepare(sql: string): unknown; batch: unknown }
    const DB = {
      prepare(sql: string) {
        preparedSql.push(sql)
        return inner.prepare(sql)
      },
      batch: inner.batch,
    }
    const tokenSelects = () => preparedSql.filter((sql) => sql.startsWith('SELECT id, user_id, last_used_at FROM api_tokens')).length
    return { env: { ...env, DB, ...over } as unknown as Env, tokenSelects }
  }

  it('POST /v1/docs, 폴백 PUT /v1/docs/:id 각각 토큰 조회 1번', async () => {
    const w = makeWorld()
    const token = await createToken(w.owner)

    const create = countingEnv(w.owner)
    const created = await ok<{ id: string; version: number }>(
      call(create.env, '/v1/docs', bearer(token, 'POST', { title: '새 문서', content: '본문' })),
      [201],
    )
    expect(create.tokenSelects()).toBe(1)

    const fallback = countingEnv(w.owner, { DOC_ROOM: undefined })
    const res = await call(fallback.env, `/v1/docs/${created.id}`, bearer(token, 'PUT', { content: '고침', baseVersion: created.version }))
    expect(res.status).toBe(200)
    expect(fallback.tokenSelects()).toBe(1)
  })
})
