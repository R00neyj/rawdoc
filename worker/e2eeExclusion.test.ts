// 금고를 빼는 자리 — 초대·공유받은 목록·링크·묶음·공개 폴더·/v1 (specs/features/F-401.md 6장, 10.5 E2~E9·E12~E15)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from './testD1'
import { V1_EXAMPLES } from './v1Contract'

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
const OWNER2 = 'second@example.com'
const FRIEND = 'friend@example.com'
const KEY = 'A'.repeat(55) + '='
const TITLE = 'dGl0bGU='
const BODY = 'Ym9keQ=='
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeWorld() {
  const sqlDb = openTestDb()
  const writeTexts: unknown[] = []
  const DOC_ROOM = {
    getByName: () => ({
      async purgeRoom() {},
      async revalidateConnections() {},
      async writeText(input: unknown) {
        writeTexts.push(input)
        return { type: 'ok', doc: { title: 't', content: 'c', version: 99, updatedAt: 1 } }
      },
    }),
  }
  const base = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) }, DOC_ROOM }
  const owner = { ...base, DEV_AUTH_EMAIL: OWNER } as unknown as Env
  const owner2 = { ...base, DEV_AUTH_EMAIL: OWNER2 } as unknown as Env
  const friend = { ...base, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
  return { sqlDb, owner, owner2, friend, writeTexts }
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

async function userId(env: Env, sqlDb: DatabaseSync, email: string): Promise<string> {
  await call(env, '/api/me')
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

async function apiToken(env: Env): Promise<string> {
  const res = await call(env, '/api/tokens', json('POST', { name: '토큰' }))
  return ((await res.json()) as { token: string }).token
}

type DocOver = { folder_id?: string | null; e2ee?: boolean; title?: string; content?: string }
function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOver = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      ownerId,
      over.title ?? (over.e2ee ? TITLE : `t-${id.slice(-2)}`),
      over.content ?? (over.e2ee ? BODY : 'c'),
      'lf',
      over.folder_id ?? null,
      1,
      1,
      Number(id.slice(-2)),
      over.e2ee ? KEY : null,
      over.e2ee ? '[]' : null,
    )
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, over: { parent_id?: string | null; e2ee?: boolean } = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, `f-${id.slice(-2)}`, over.parent_id ?? null, 1, 1, over.e2ee ? 1 : 0)
}

function insertGrant(sqlDb: DatabaseSync, targetType: 'doc' | 'folder', targetId: string, ownerId: string, email: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(targetType, targetId, ownerId, email, role, 1)
}

function count(sqlDb: DatabaseSync, sql: string): number {
  return (sqlDb.prepare(sql).get() as { n: number }).n
}

describe('F-401 E2 폴더 초대(edit)를 받은 사람과 금고 문서', () => {
  it('GET·PUT 모두 404, 행 그대로', async () => {
    const { sqlDb, owner, friend } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertFolder(sqlDb, uuid(1), id)
    insertDoc(sqlDb, uuid(2), id, { folder_id: uuid(1), e2ee: true })
    insertGrant(sqlDb, 'folder', uuid(1), id, FRIEND, 'edit')
    expect((await call(friend, `/api/docs/${uuid(2)}`)).status).toBe(404)
    const put = await call(friend, `/api/docs/${uuid(2)}`, json('PUT', { e2ee: true, content: 'QQ==', baseVersion: 1 }))
    expect(put.status).toBe(404)
    expect(sqlDb.prepare('SELECT content, version FROM docs WHERE id = ?').get(uuid(2))).toEqual({ content: BODY, version: 1 })
  })
})

describe('F-401 E3 금고 문서 초대', () => {
  it('409 e2ee_doc, grants 0행', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(3), id, { e2ee: true })
    const res = await call(owner, `/api/docs/${uuid(3)}/grants/b@x.com`, json('PUT', { role: 'edit' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'e2ee_doc' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants')).toBe(0)
  })
})

describe('F-401 E4 공유받은 목록', () => {
  it('일반 문서만 나온다 — 폴더 초대 안 금고 문서, 문서 초대만 받은 금고 문서 모두 빠짐', async () => {
    const { sqlDb, owner, owner2, friend } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    const id2 = await userId(owner2, sqlDb, OWNER2)
    insertFolder(sqlDb, uuid(4), id)
    insertGrant(sqlDb, 'folder', uuid(4), id, FRIEND, 'view')
    insertDoc(sqlDb, uuid(5), id, { folder_id: uuid(4) })
    insertDoc(sqlDb, uuid(6), id, { folder_id: uuid(4), e2ee: true })
    insertDoc(sqlDb, uuid(7), id, { e2ee: true })
    insertGrant(sqlDb, 'doc', uuid(7), id, FRIEND, 'view')
    insertDoc(sqlDb, uuid(8), id2, { e2ee: true })
    insertGrant(sqlDb, 'doc', uuid(8), id2, FRIEND, 'view')
    const res = await call(friend, '/api/shared')
    const list = (await res.json()) as { id: string }[]
    expect(list.map((d) => d.id)).toEqual([uuid(5)])
  })
})

describe('F-401 E5 금고 문서 링크', () => {
  it('/api·/v1 모두 409 e2ee_doc, share_links 0행', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(9), id, { e2ee: true })
    const api = await call(owner, `/api/docs/${uuid(9)}/link`, { method: 'POST' })
    expect(api.status).toBe(409)
    expect(await api.json()).toEqual({ error: 'e2ee_doc' })
    const token = await apiToken(owner)
    const v1 = await call(owner, `/v1/docs/${uuid(9)}/link`, bearer(token, 'POST'))
    expect(v1.status).toBe(409)
    expect(await v1.json()).toEqual({ error: 'e2ee_doc' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM share_links')).toBe(0)
  })
})

describe('F-401 E6 묶음 docIds 의 금고 문서', () => {
  it('조용히 빠진다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(10), id)
    insertDoc(sqlDb, uuid(11), id)
    insertDoc(sqlDb, uuid(12), id, { e2ee: true })
    const res = await call(owner, `/api/docs/${uuid(10)}/link`, json('POST', { docIds: [uuid(11), uuid(12)] }))
    expect(res.status).toBe(201)
    expect(sqlDb.prepare('SELECT doc_id FROM share_link_docs').all()).toEqual([{ doc_id: uuid(11) }])
  })
})

describe('F-401 E7 묶음 미리보기', () => {
  it('금고 문서는 노드에 없고, 금고 문서에서 시작하면 409', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(13), id, { content: '[[QUJD]] [[일반]]' })
    insertDoc(sqlDb, uuid(14), id, { e2ee: true, title: 'QUJD' })
    insertDoc(sqlDb, uuid(15), id, { title: '일반' })
    const res = await call(owner, `/api/docs/${uuid(13)}/share-set`)
    expect(res.status).toBe(200)
    const nodes = ((await res.json()) as { nodes: { id: string }[] }).nodes.map((n) => n.id)
    expect(nodes).toContain(uuid(15))
    expect(nodes).not.toContain(uuid(14))
    const fromE2ee = await call(owner, `/api/docs/${uuid(14)}/share-set`)
    expect(fromE2ee.status).toBe(409)
    expect(await fromE2ee.json()).toEqual({ error: 'e2ee_doc' })
  })
})

describe('F-401 E8 공개 폴더 링크', () => {
  it('금고 폴더 가지가 잘리고 금고 문서는 목록·본문에서 빠진다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertFolder(sqlDb, uuid(20), id)
    insertFolder(sqlDb, uuid(21), id, { parent_id: uuid(20), e2ee: true })
    insertFolder(sqlDb, uuid(22), id, { parent_id: uuid(21), e2ee: true })
    insertDoc(sqlDb, uuid(23), id, { folder_id: uuid(20), e2ee: true })
    insertDoc(sqlDb, uuid(24), id, { folder_id: uuid(21), e2ee: true })
    insertDoc(sqlDb, uuid(25), id, { folder_id: uuid(22), e2ee: true })
    insertDoc(sqlDb, uuid(26), id, { folder_id: uuid(20) })
    const link = await call(owner, `/api/folders/${uuid(20)}/link`, { method: 'POST' })
    expect(link.status).toBe(201)
    const { token } = (await link.json()) as { token: string }

    const pub = (await (await call(owner, `/pub/folders/${token}`)).json()) as { folders: { id: string }[]; docs: { id: string }[] }
    expect(pub.folders).toEqual([])
    expect(pub.docs.map((d) => d.id)).toEqual([uuid(26)])
    expect((await call(owner, `/pub/folders/${token}/docs/${uuid(23)}`)).status).toBe(404)
    expect((await call(owner, `/pub/folders/${token}/docs/${uuid(25)}`)).status).toBe(404)
    expect((await call(owner, `/pub/folders/${token}/docs/${uuid(26)}`)).status).toBe(200)
  })
})

describe('F-401 E9 묶음 링크와 옮기기', () => {
  it('묶음 문서를 옮기면 빠지고, 시작 문서를 옮기면 링크가 끊긴다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    await call(owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
    insertDoc(sqlDb, uuid(30), id)
    insertDoc(sqlDb, uuid(31), id)
    const link = await call(owner, `/api/docs/${uuid(30)}/link`, json('POST', { docIds: [uuid(31)] }))
    const { token } = (await link.json()) as { token: string }
    const move = (docId: string) =>
      call(owner, `/api/docs/${docId}/e2ee`, json('PUT', { e2eeKey: KEY, title: TITLE, content: BODY, attachmentRefs: [], baseVersion: 1 }))

    expect((await move(uuid(31))).status).toBe(200)
    const set = (await (await call(owner, `/pub/docs/${token}/set`)).json()) as { docs: { id: string }[] }
    expect(set.docs.map((d) => d.id)).toEqual([uuid(30)])
    expect((await call(owner, `/pub/docs/${token}/docs/${uuid(31)}`)).status).toBe(404)

    expect((await move(uuid(30))).status).toBe(200)
    expect((await call(owner, `/pub/docs/${token}`)).status).toBe(404)
  })

  it('X14 두 번째 벽 — 묶음 행이 남아 있어도 금고 문서는 공개되지 않는다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(32), id)
    insertDoc(sqlDb, uuid(33), id)
    const link = await call(owner, `/api/docs/${uuid(32)}/link`, json('POST', { docIds: [uuid(33)] }))
    const { token } = (await link.json()) as { token: string }
    sqlDb.prepare("UPDATE docs SET e2ee_key = ?, attachment_refs = '[]', title = ? WHERE id = ?").run(KEY, TITLE, uuid(33))
    const set = (await (await call(owner, `/pub/docs/${token}/set`)).json()) as { docs: { id: string }[] }
    expect(set.docs.map((d) => d.id)).toEqual([uuid(32)])
    expect((await call(owner, `/pub/docs/${token}/docs/${uuid(33)}`)).status).toBe(404)
  })
})

describe('F-401 E12~E15 /v1', () => {
  it('E12 GET /v1/docs — 금고 원소는 title 빈 문자열·e2ee true, 키 없음. 일반 원소는 예시와 같은 키', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(40), id)
    insertDoc(sqlDb, uuid(41), id, { e2ee: true })
    const token = await apiToken(owner)
    const res = await call(owner, '/v1/docs', bearer(token))
    expect(res.status).toBe(200)
    const list = (await res.json()) as Record<string, unknown>[]
    const plain = list.find((d) => d.id === uuid(40))!
    const sealed = list.find((d) => d.id === uuid(41))!
    expect(Object.keys(plain).sort()).toEqual(Object.keys(V1_EXAMPLES.docSummary).sort())
    expect(sealed.title).toBe('')
    expect(sealed.e2ee).toBe(true)
    expect('e2eeKey' in sealed).toBe(false)
    expect('attachmentRefs' in sealed).toBe(false)
  })

  it('E13 금고 문서 GET·PUT /v1/docs/:id 403 e2ee_doc, writeText 0번, 행 그대로', async () => {
    const { sqlDb, owner, writeTexts } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertDoc(sqlDb, uuid(42), id, { e2ee: true })
    insertDoc(sqlDb, uuid(43), id)
    const token = await apiToken(owner)
    const get = await call(owner, `/v1/docs/${uuid(42)}`, bearer(token))
    expect(get.status).toBe(403)
    expect(await get.json()).toEqual({ error: 'e2ee_doc' })
    const put = await call(owner, `/v1/docs/${uuid(42)}`, bearer(token, 'PUT', { content: '평문', baseVersion: 1 }))
    expect(put.status).toBe(403)
    expect(await put.json()).toEqual({ error: 'e2ee_doc' })
    expect(writeTexts).toHaveLength(0)
    expect(sqlDb.prepare('SELECT content, version FROM docs WHERE id = ?').get(uuid(42))).toEqual({ content: BODY, version: 1 })
    const plain = await call(owner, `/v1/docs/${uuid(43)}`, bearer(token))
    expect(plain.status).toBe(200)
    expect(Object.keys((await plain.json()) as object).sort()).toEqual(Object.keys(V1_EXAMPLES.doc).sort())
  })

  it('E14 POST /v1/docs — e2eeKey 400, 금고 폴더 안 409', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertFolder(sqlDb, uuid(44), id, { e2ee: true })
    const token = await apiToken(owner)
    const withKey = await call(owner, '/v1/docs', bearer(token, 'POST', { title: 't', content: 'c', e2eeKey: KEY }))
    expect(withKey.status).toBe(400)
    expect(await withKey.json()).toEqual({ error: 'invalid', field: 'e2eeKey' })
    const withRefs = await call(owner, '/v1/docs', bearer(token, 'POST', { title: 't', content: 'c', attachmentRefs: [] }))
    expect(withRefs.status).toBe(400)
    expect(await withRefs.json()).toEqual({ error: 'invalid', field: 'attachmentRefs' })
    const inE2ee = await call(owner, '/v1/docs', bearer(token, 'POST', { title: 't', content: 'c', folderId: uuid(44) }))
    expect(inE2ee.status).toBe(409)
    expect(await inE2ee.json()).toEqual({ error: 'e2ee_folder' })
  })

  it('E15 POST /v1/folders — e2ee 400, 금고 부모 409, GET /v1/folders 에 e2ee true', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb, OWNER)
    insertFolder(sqlDb, uuid(45), id, { e2ee: true })
    const token = await apiToken(owner)
    const withFlag = await call(owner, '/v1/folders', bearer(token, 'POST', { name: 'x', e2ee: true }))
    expect(withFlag.status).toBe(400)
    expect(await withFlag.json()).toEqual({ error: 'invalid', field: 'e2ee' })
    const underE2ee = await call(owner, '/v1/folders', bearer(token, 'POST', { name: 'x', parentId: uuid(45) }))
    expect(underE2ee.status).toBe(409)
    expect(await underE2ee.json()).toEqual({ error: 'e2ee_folder' })
    const ok = await call(owner, '/v1/folders', bearer(token, 'POST', { name: 'y' }))
    expect(ok.status).toBe(201)
    const list = (await (await call(owner, '/v1/folders', bearer(token))).json()) as { id: string; e2ee?: boolean }[]
    expect(list.find((f) => f.id === uuid(45))!.e2ee).toBe(true)
    expect(list.filter((f) => f.e2ee === true)).toHaveLength(1)
  })
})
