// GET /v1/search — worker/index.ts 를 통째로, 실제 SQLite (본문 찾기 small change)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'
import type { DatabaseSync } from 'node:sqlite'
import { V1_EXAMPLES, type V1SearchResult } from '../../worker/v1Contract'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
}

function makeEnv() {
  const sqlDb = openTestDb()
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put() {}, async delete() {} },
    DOC_ROOM: { getByName: () => ({ async purgeRoom() {} }) },
  } as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx())
}

const bearer = (token: string, method = 'GET'): RequestInit => ({ method, headers: { Authorization: `Bearer ${token}` } })

async function setup() {
  const { sqlDb, env } = makeEnv()
  await call(env, '/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'seed', content: 'seed', lineEnding: 'lf' }),
  })
  const ownerRow = sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }
  const owner = ownerRow.id
  const tokenRes = await call(env, '/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '토큰' }),
  })
  const tokenBody = (await tokenRes.json()) as { token: string }
  const token = tokenBody.token
  return { sqlDb, env, owner, token }
}

type DocOverrides = Partial<{ title: string; content: string; folder_id: string | null; e2ee_key: string | null; updated_at: number; version: number }>

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOverrides = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, ownerId, over.title ?? 't', over.content ?? 'c', 'lf', over.folder_id ?? null, null, over.version ?? 1, 1, over.updated_at ?? 1, over.e2ee_key ?? null)
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, parentId: string | null = null, e2ee = 0) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, 'f', parentId, 1, 1, e2ee)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function search(env: Env, token: string, query: string): Promise<{ status: number; body: V1SearchResult }> {
  const res = await call(env, `/v1/search?${query}`, bearer(token))
  return { status: res.status, body: (await res.json()) as V1SearchResult }
}

describe('GET /v1/search', () => {
  it('내 문서의 제목·본문에서 찾고, 남의 문서는 빼고, 금고 문서는 개수만 준다', async () => {
    const { sqlDb, env, owner, token } = await setup()
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('other', 'other@example.com', 1)
    insertDoc(sqlDb, uuid(1), owner, { title: '본문 문서', content: 'line one\nThe NEEDLE here\nno', updated_at: 30, version: 4 })
    insertDoc(sqlDb, uuid(2), owner, { title: 'Needle 제목', content: 'nothing', updated_at: 20 })
    insertDoc(sqlDb, uuid(3), owner, { title: 'x', content: 'no match' })
    insertDoc(sqlDb, uuid(4), owner, { title: '', content: 'needle', e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(5), owner, { title: '', content: 'zzz', e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(6), 'other', { title: 'needle', content: 'needle' })

    const { status, body } = await search(env, token, 'q=needle')
    expect(status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(Object.keys(V1_EXAMPLES.searchResult).sort())
    expect(Object.keys(body.docs[0]).sort()).toEqual(Object.keys(V1_EXAMPLES.searchResult.docs[0]).sort())
    expect(body).toEqual({
      docs: [
        { id: uuid(1), title: '본문 문서', folderId: null, version: 4, updatedAt: 30, lines: [{ line: 2, text: 'The NEEDLE here' }], matchedLines: 1 },
        { id: uuid(2), title: 'Needle 제목', folderId: null, version: 1, updatedAt: 20, lines: [], matchedLines: 0 },
      ],
      truncated: false,
      e2eeSkipped: 2,
    })
  })

  it('지운 문서는 나오지 않는다', async () => {
    const { sqlDb, env, owner, token } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { content: 'needle' })
    insertDoc(sqlDb, uuid(2), owner, { content: 'needle' })
    expect((await call(env, `/v1/docs/${uuid(1)}`, bearer(token, 'DELETE'))).status).toBe(200)
    const { body } = await search(env, token, 'q=needle')
    expect(body.docs.map((d) => d.id)).toEqual([uuid(2)])
  })

  it('folder 는 그 폴더와 하위 폴더만, 금고 개수도 그 범위만', async () => {
    const { sqlDb, env, owner, token } = await setup()
    insertFolder(sqlDb, uuid(10), owner)
    insertFolder(sqlDb, uuid(11), owner, uuid(10))
    insertFolder(sqlDb, uuid(12), owner, uuid(11), 1)
    insertFolder(sqlDb, uuid(13), owner)
    insertDoc(sqlDb, uuid(1), owner, { content: 'needle', folder_id: uuid(10), updated_at: 3 })
    insertDoc(sqlDb, uuid(2), owner, { content: 'needle', folder_id: uuid(11), updated_at: 2 })
    insertDoc(sqlDb, uuid(3), owner, { content: 'needle', folder_id: uuid(13) })
    insertDoc(sqlDb, uuid(4), owner, { content: 'needle' })
    insertDoc(sqlDb, uuid(5), owner, { content: 'needle', folder_id: uuid(12), e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(6), owner, { content: 'needle', folder_id: uuid(13), e2ee_key: 'K' })

    const top = await search(env, token, `q=needle&folder=${uuid(10)}`)
    expect(top.status).toBe(200)
    expect(top.body.docs.map((d) => d.id)).toEqual([uuid(1), uuid(2)])
    expect(top.body.e2eeSkipped).toBe(1)

    const child = await search(env, token, `q=needle&folder=${uuid(11)}`)
    expect(child.body.docs.map((d) => d.id)).toEqual([uuid(2)])
  })

  it('없는 폴더·남의 폴더는 404, id 모양이 아니면 400', async () => {
    const { sqlDb, env, token } = await setup()
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('other', 'other@example.com', 1)
    insertFolder(sqlDb, uuid(10), 'other')
    expect((await search(env, token, `q=a&folder=${uuid(10)}`)).status).toBe(404)
    expect((await search(env, token, `q=a&folder=${uuid(99)}`)).status).toBe(404)
    expect(await search(env, token, 'q=a&folder=nope')).toEqual({ status: 400, body: { error: 'invalid', field: 'folder' } })
  })

  it('q 는 1~200자, 벗어나면 400 field q', async () => {
    const { sqlDb, env, owner, token } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { content: 'a'.repeat(200) })
    for (const query of ['', 'q=', `q=${'a'.repeat(201)}`]) {
      expect(await search(env, token, query), query).toEqual({ status: 400, body: { error: 'invalid', field: 'q' } })
    }
    const max = await search(env, token, `q=${'A'.repeat(200)}`)
    expect(max.status).toBe(200)
    expect(max.body.docs.map((d) => d.id)).toEqual([uuid(1)])
  })

  it('정규식이 아니라 글자 그대로', async () => {
    const { sqlDb, env, owner, token } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { content: 'a.b' })
    insertDoc(sqlDb, uuid(2), owner, { content: 'axb 100%' })
    expect((await search(env, token, 'q=a.b')).body.docs.map((d) => d.id)).toEqual([uuid(1)])
    expect((await search(env, token, `q=${encodeURIComponent('%')}`)).body.docs.map((d) => d.id)).toEqual([uuid(2)])
  })

  it('문서는 최근 고친 순 200개까지, 넘으면 truncated', async () => {
    const { sqlDb, env, owner, token } = await setup()
    for (let i = 1; i <= 201; i++) insertDoc(sqlDb, uuid(i), owner, { content: 'needle', updated_at: i })
    const { body } = await search(env, token, 'q=needle')
    expect(body.docs).toHaveLength(200)
    expect(body.docs[0].id).toBe(uuid(201))
    expect(body.truncated).toBe(true)
  })

  it('토큰 없으면 401', async () => {
    const { env } = await setup()
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/search?q=a`), { ...env, DEV_AUTH_EMAIL: undefined } as unknown as Env, ctx())
    expect(res.status).toBe(401)
  })
})
