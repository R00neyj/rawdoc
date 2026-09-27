// '/v1' 삭제·이동·폴더 삭제·공유받은 문서 목록 — worker/index.ts 를 통째로, 실제 SQLite (specs/features/F-2050.md 10.1 V1~V12)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from './testD1'
import type { DatabaseSync } from 'node:sqlite'
import { V1_EXAMPLES, type V1SharedDoc } from './v1Contract'

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
const EMAIL = 'owner@example.com'

function defaultCtx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
}

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, pending }
}

function fakeDocRoom() {
  const purged: string[] = []
  const getByName = vi.fn((name: string) => ({
    async purgeRoom() {
      purged.push(name)
    },
  }))
  return { DOC_ROOM: { getByName }, purged }
}

function makeEnv(over: Record<string, unknown> = {}) {
  const sqlDb = openTestDb()
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put() {}, async delete() {} },
    ...over,
  } as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}, ctx: ExecutionContext = defaultCtx()): Promise<Response> {
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

function usageRow(sqlDb: DatabaseSync, id: string): { write_count: number; content_bytes: number; doc_count: number } {
  return sqlDb.prepare('SELECT write_count, content_bytes, doc_count FROM users WHERE id = ?').get(id) as {
    write_count: number
    content_bytes: number
    doc_count: number
  }
}

async function createToken(env: Env): Promise<string> {
  const res = await call(env, '/api/tokens', jsonInit('POST', { name: '토큰' }))
  const body = (await res.json()) as { token: string }
  return body.token
}

function insertUser(sqlDb: DatabaseSync, id: string, email: string) {
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
}

type DocOverrides = Partial<{
  title: string
  content: string
  folder_id: string | null
  e2ee_key: string | null
  updated_at: number
}>

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOverrides = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      ownerId,
      over.title ?? 't',
      over.content ?? 'c',
      'lf',
      over.folder_id ?? null,
      null,
      1,
      1,
      over.updated_at ?? 1,
      over.e2ee_key ?? null,
    )
}

type FolderOverrides = Partial<{ parent_id: string | null; e2ee: number; name: string }>

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, over: FolderOverrides = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, over.name ?? 'f', over.parent_id ?? null, 1, 1, over.e2ee ?? 0)
}

function insertGrant(sqlDb: DatabaseSync, targetType: 'doc' | 'folder', targetId: string, ownerId: string, email: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(targetType, targetId, ownerId, email, role, 1)
}

function insertLink(sqlDb: DatabaseSync, token: string, ownerId: string, targetType: 'doc' | 'folder', targetId: string) {
  sqlDb
    .prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)')
    .run(token, ownerId, targetType, targetId, 1)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('V1 DELETE /v1/docs/:id — 성공', () => {
  it('200, 행 삭제, 사용량 갱신, purgeRoom 호출 1회', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertDoc(sqlDb, uuid(1), owner, { title: '지울 문서', content: 'hello world' })

    const before = usageRow(sqlDb, owner)
    const rooms = fakeDocRoom()
    const { ctx, pending } = makeCtx()
    const env2 = { ...env, DOC_ROOM: rooms.DOC_ROOM } as unknown as Env

    const res = await call(env2, `/v1/docs/${uuid(1)}`, bearerInit('DELETE', token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body as object).sort()).toEqual(Object.keys(V1_EXAMPLES.deletedDoc).sort())
    expect(body).toEqual({ id: uuid(1), title: '지울 문서' })

    const row = sqlDb.prepare('SELECT 1 FROM docs WHERE id = ?').get(uuid(1))
    expect(row).toBeUndefined()
    const after = usageRow(sqlDb, owner)
    expect(after.doc_count).toBe(before.doc_count - 1)
    expect(before.content_bytes - after.content_bytes).toBe(new TextEncoder().encode('hello world').length)
    expect(after.write_count).toBeGreaterThan(before.write_count)

    await Promise.all(pending)
    expect(rooms.purged).toEqual([uuid(1)])
  })
})

describe('V2 DELETE /v1/docs/:id — 거절', () => {
  it('없는 id·남의 문서·남의 금고 문서 404, 내 금고 문서·편집 초대 403 — 행 그대로, write_count 그대로', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)

    const otherId = 'other-1'
    insertUser(sqlDb, otherId, 'other1@example.com')
    insertDoc(sqlDb, uuid(1), otherId) // 남의 문서(초대 없음)
    insertDoc(sqlDb, uuid(2), otherId, { e2ee_key: 'K' }) // 남의 금고 문서
    insertDoc(sqlDb, uuid(3), owner, { e2ee_key: 'K' }) // 내 금고 문서
    insertDoc(sqlDb, uuid(4), otherId) // 편집 초대받은 문서
    insertGrant(sqlDb, 'doc', uuid(4), otherId, EMAIL, 'edit')

    const before = writeCount(sqlDb)

    expect((await call(env, `/v1/docs/${uuid(99)}`, bearerInit('DELETE', token))).status).toBe(404)
    expect((await call(env, `/v1/docs/${uuid(1)}`, bearerInit('DELETE', token))).status).toBe(404)
    expect((await call(env, `/v1/docs/${uuid(2)}`, bearerInit('DELETE', token))).status).toBe(404)

    const myVault = await call(env, `/v1/docs/${uuid(3)}`, bearerInit('DELETE', token))
    expect(myVault.status).toBe(403)
    expect(await myVault.json()).toEqual({ error: 'e2ee_doc' })

    const editInvited = await call(env, `/v1/docs/${uuid(4)}`, bearerInit('DELETE', token))
    expect(editInvited.status).toBe(403)
    expect(await editInvited.json()).toEqual({ error: 'forbidden' })

    for (const id of [uuid(1), uuid(2), uuid(3), uuid(4)]) {
      expect(sqlDb.prepare('SELECT 1 FROM docs WHERE id = ?').get(id)).toBeTruthy()
    }
    expect(writeCount(sqlDb)).toBe(before)
  })
})

describe('V3 DELETE /v1/docs/:id — 편집 잠금·접속자 무시', () => {
  it('다른 사람 잠금이 살아 있어도 200', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertDoc(sqlDb, uuid(1), owner)
    sqlDb
      .prepare('INSERT INTO doc_locks (doc_id, user_id, email, session_id, expires_at) VALUES (?,?,?,?,?)')
      .run(uuid(1), 'someone', 'someone@example.com', 's1', Date.now() + 60_000)

    const res = await call(env, `/v1/docs/${uuid(1)}`, bearerInit('DELETE', token))
    expect(res.status).toBe(200)
  })
})

describe('V4 PUT /v1/docs/:id/folder — 성공', () => {
  it('일반 → 일반 200(content 없음), folder_id 바뀜, write_count +1, null → 맨 위', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertFolder(sqlDb, uuid(10), owner)
    insertDoc(sqlDb, uuid(1), owner)
    const before = writeCount(sqlDb)

    const res = await call(
      env,
      `/v1/docs/${uuid(1)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: uuid(10) }), { 'Content-Type': 'application/json' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(Object.keys(V1_EXAMPLES.docSummary).sort())
    expect(body.folderId).toBe(uuid(10))
    expect('content' in body).toBe(false)
    expect(writeCount(sqlDb)).toBe(before + 1)
    const row = sqlDb.prepare('SELECT folder_id FROM docs WHERE id = ?').get(uuid(1)) as { folder_id: string | null }
    expect(row.folder_id).toBe(uuid(10))

    insertDoc(sqlDb, uuid(2), owner, { folder_id: uuid(10) })
    const res2 = await call(
      env,
      `/v1/docs/${uuid(2)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: null }), { 'Content-Type': 'application/json' }),
    )
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as Record<string, unknown>
    expect(body2.folderId).toBeNull()
  })
})

describe('V5 PUT /v1/docs/:id/folder — 금고', () => {
  it('금고 문서 → 일반 폴더·null 403 e2ee_doc(대조: /api 는 200), 일반 문서 → 금고 폴더 403 e2ee_folder(대조: /api 는 409)', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertFolder(sqlDb, uuid(10), owner)
    insertFolder(sqlDb, uuid(11), owner, { e2ee: 1 })

    // ① 금고 문서 → 일반 폴더 — /v1 은 403
    insertDoc(sqlDb, uuid(1), owner, { e2ee_key: 'K' })
    const r1 = await call(
      env,
      `/v1/docs/${uuid(1)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: uuid(10) }), { 'Content-Type': 'application/json' }),
    )
    expect(r1.status).toBe(403)
    expect(await r1.json()).toEqual({ error: 'e2ee_doc' })
    expect((sqlDb.prepare('SELECT folder_id FROM docs WHERE id = ?').get(uuid(1)) as { folder_id: string | null }).folder_id).toBeNull()

    // 대조 — 같은 요청을 /api 로 보내면 200
    insertDoc(sqlDb, uuid(2), owner, { e2ee_key: 'K' })
    const apiRes1 = await call(env, `/api/docs/${uuid(2)}/folder`, jsonInit('PUT', { folderId: uuid(10) }))
    expect(apiRes1.status).toBe(200)

    // ② 금고 문서 → null — /v1 은 403
    insertDoc(sqlDb, uuid(3), owner, { e2ee_key: 'K' })
    const r2 = await call(
      env,
      `/v1/docs/${uuid(3)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: null }), { 'Content-Type': 'application/json' }),
    )
    expect(r2.status).toBe(403)
    expect(await r2.json()).toEqual({ error: 'e2ee_doc' })

    // ③ 일반 문서 → 금고 폴더 — /v1 은 403 e2ee_folder
    insertDoc(sqlDb, uuid(4), owner)
    const r3 = await call(
      env,
      `/v1/docs/${uuid(4)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: uuid(11) }), { 'Content-Type': 'application/json' }),
    )
    expect(r3.status).toBe(403)
    expect(await r3.json()).toEqual({ error: 'e2ee_folder' })
    expect((sqlDb.prepare('SELECT folder_id FROM docs WHERE id = ?').get(uuid(4)) as { folder_id: string | null }).folder_id).toBeNull()

    // 대조 — 같은 요청을 /api 로 보내면 409
    insertDoc(sqlDb, uuid(5), owner)
    const apiRes2 = await call(env, `/api/docs/${uuid(5)}/folder`, jsonInit('PUT', { folderId: uuid(11) }))
    expect(apiRes2.status).toBe(409)
  })
})

describe('V6 PUT /v1/docs/:id/folder — 나머지', () => {
  it('folderId 형식 오류·남의 폴더 400, 편집 초대 403 forbidden, 없는 문서 404', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertDoc(sqlDb, uuid(1), owner)

    const r1 = await call(
      env,
      `/v1/docs/${uuid(1)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: 'x' }), { 'Content-Type': 'application/json' }),
    )
    expect(r1.status).toBe(400)
    expect(await r1.json()).toEqual({ error: 'invalid', field: 'folderId' })

    const otherId = 'other-2'
    insertUser(sqlDb, otherId, 'other2@example.com')
    insertFolder(sqlDb, uuid(20), otherId)
    const r2 = await call(
      env,
      `/v1/docs/${uuid(1)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: uuid(20) }), { 'Content-Type': 'application/json' }),
    )
    expect(r2.status).toBe(400)
    expect(await r2.json()).toEqual({ error: 'invalid', field: 'folderId' })

    insertDoc(sqlDb, uuid(2), otherId)
    insertGrant(sqlDb, 'doc', uuid(2), otherId, EMAIL, 'edit')
    const r3 = await call(
      env,
      `/v1/docs/${uuid(2)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: null }), { 'Content-Type': 'application/json' }),
    )
    expect(r3.status).toBe(403)
    expect(await r3.json()).toEqual({ error: 'forbidden' })

    const r4 = await call(
      env,
      `/v1/docs/${uuid(99)}/folder`,
      bearerInit('PUT', token, JSON.stringify({ folderId: null }), { 'Content-Type': 'application/json' }),
    )
    expect(r4.status).toBe(404)
  })
})

describe('V7 DELETE /v1/folders/:id — move-up', () => {
  it('200, docs·folders 개수, parentId, 부모로 옮김. 질의 없이 보내도 같다', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertFolder(sqlDb, uuid(1), owner) // P (top)
    insertFolder(sqlDb, uuid(2), owner, { parent_id: uuid(1) }) // A
    insertFolder(sqlDb, uuid(3), owner, { parent_id: uuid(2) }) // A 의 자식 폴더
    insertDoc(sqlDb, uuid(4), owner, { folder_id: uuid(2) })
    insertDoc(sqlDb, uuid(5), owner, { folder_id: uuid(2) })
    insertDoc(sqlDb, uuid(6), owner, { folder_id: uuid(2) })

    const res = await call(env, `/v1/folders/${uuid(2)}`, bearerInit('DELETE', token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body as object).sort()).toEqual(Object.keys(V1_EXAMPLES.deletedFolder).sort())
    expect(body).toEqual({ id: uuid(2), contents: 'move-up', parentId: uuid(1), docs: 3, folders: 1 })

    for (const id of [uuid(4), uuid(5), uuid(6)]) {
      const row = sqlDb.prepare('SELECT folder_id FROM docs WHERE id = ?').get(id) as { folder_id: string | null }
      expect(row.folder_id).toBe(uuid(1))
    }
    const childRow = sqlDb.prepare('SELECT parent_id FROM folders WHERE id = ?').get(uuid(3)) as { parent_id: string | null }
    expect(childRow.parent_id).toBe(uuid(1))
    expect(sqlDb.prepare('SELECT 1 FROM folders WHERE id = ?').get(uuid(2))).toBeUndefined()

    // 맨 위 폴더면 parentId: null
    insertFolder(sqlDb, uuid(7), owner)
    insertDoc(sqlDb, uuid(8), owner, { folder_id: uuid(7) })
    const res2 = await call(env, `/v1/folders/${uuid(7)}`, bearerInit('DELETE', token))
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { parentId: string | null; docs: number; folders: number }
    expect(body2.parentId).toBeNull()
    expect(body2.docs).toBe(1)
    expect(body2.folders).toBe(0)
  })
})

describe('V8 DELETE /v1/folders/:id?contents=delete-all', () => {
  it('200, 대상 포함 폴더 3개·문서 4개 영구 삭제, doc_count -4', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    insertFolder(sqlDb, uuid(1), owner) // A (top)
    insertFolder(sqlDb, uuid(2), owner, { parent_id: uuid(1) }) // B
    insertFolder(sqlDb, uuid(3), owner, { parent_id: uuid(2) }) // C
    insertDoc(sqlDb, uuid(4), owner, { folder_id: uuid(1) })
    insertDoc(sqlDb, uuid(5), owner, { folder_id: uuid(2) })
    insertDoc(sqlDb, uuid(6), owner, { folder_id: uuid(3) })
    insertDoc(sqlDb, uuid(7), owner, { folder_id: uuid(3) })
    const before = usageRow(sqlDb, owner).doc_count

    const res = await call(env, `/v1/folders/${uuid(1)}?contents=delete-all`, bearerInit('DELETE', token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: uuid(1), contents: 'delete-all', parentId: null, docs: 4, folders: 3 })

    for (const id of [uuid(1), uuid(2), uuid(3)]) {
      expect(sqlDb.prepare('SELECT 1 FROM folders WHERE id = ?').get(id)).toBeUndefined()
    }
    for (const id of [uuid(4), uuid(5), uuid(6), uuid(7)]) {
      expect(sqlDb.prepare('SELECT 1 FROM docs WHERE id = ?').get(id)).toBeUndefined()
    }
    expect(usageRow(sqlDb, owner).doc_count).toBe(before - 4)
  })
})

describe('V9 DELETE /v1/folders/:id — 금고가 낀다', () => {
  it('대상 자신·둘째 단 자손·바로 안의 금고 문서 — 세 경우 각각 move-up·delete-all 모두 403 e2ee_folder', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)

    // ① 대상 자신이 금고 폴더
    insertFolder(sqlDb, uuid(1), owner, { e2ee: 1 })
    // ② 대상 아래 둘째 단에 금고 폴더
    insertFolder(sqlDb, uuid(2), owner)
    insertFolder(sqlDb, uuid(3), owner, { parent_id: uuid(2) })
    insertFolder(sqlDb, uuid(4), owner, { parent_id: uuid(3), e2ee: 1 })
    // ③ 대상 바로 안에 금고 문서 하나(일반 폴더로 옮겨 둔 것)
    insertFolder(sqlDb, uuid(5), owner)
    insertDoc(sqlDb, uuid(6), owner, { folder_id: uuid(5), e2ee_key: 'K' })

    const before = writeCount(sqlDb)
    for (const target of [uuid(1), uuid(2), uuid(5)]) {
      for (const contents of ['move-up', 'delete-all']) {
        const res = await call(env, `/v1/folders/${target}?contents=${contents}`, bearerInit('DELETE', token))
        expect(res.status, `${target} ${contents}`).toBe(403)
        expect(await res.json(), `${target} ${contents}`).toEqual({ error: 'e2ee_folder' })
      }
    }
    expect(writeCount(sqlDb)).toBe(before)
    for (const id of [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]) {
      expect(sqlDb.prepare('SELECT 1 FROM folders WHERE id = ?').get(id)).toBeTruthy()
    }
    expect(sqlDb.prepare('SELECT 1 FROM docs WHERE id = ?').get(uuid(6))).toBeTruthy()
  })
})

describe('V10 DELETE /v1/folders/:id — 나머지', () => {
  it('남의 폴더·초대받은 폴더 404, contents=x 400', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    const token = await createToken(env)
    const otherId = 'other-3'
    insertUser(sqlDb, otherId, 'other3@example.com')
    insertFolder(sqlDb, uuid(1), otherId)

    const r1 = await call(env, `/v1/folders/${uuid(1)}`, bearerInit('DELETE', token))
    expect(r1.status).toBe(404)

    insertGrant(sqlDb, 'folder', uuid(1), otherId, EMAIL, 'edit')
    const r2 = await call(env, `/v1/folders/${uuid(1)}`, bearerInit('DELETE', token))
    expect(r2.status).toBe(404)

    insertFolder(sqlDb, uuid(2), owner)
    const r3 = await call(env, `/v1/folders/${uuid(2)}?contents=x`, bearerInit('DELETE', token))
    expect(r3.status).toBe(400)
    expect(await r3.json()).toEqual({ error: 'invalid', field: 'contents' })
  })
})

describe('V11 GET /v1/shared', () => {
  it('금고·공유 링크 제외, updatedAt 내림차순, /api/shared 와 같은 집합', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const token = await createToken(env)

    const ownerB = 'owner-b'
    insertUser(sqlDb, ownerB, 'ownerb@example.com')
    insertFolder(sqlDb, uuid(1), ownerB) // F
    insertFolder(sqlDb, uuid(2), ownerB, { parent_id: uuid(1) }) // G (F 의 자식)
    insertDoc(sqlDb, uuid(10), ownerB, { folder_id: uuid(1), updated_at: 300 })
    insertDoc(sqlDb, uuid(11), ownerB, { folder_id: uuid(2), updated_at: 200 })
    insertDoc(sqlDb, uuid(12), ownerB, { folder_id: uuid(1), e2ee_key: 'K' }) // 제외 — 금고
    insertGrant(sqlDb, 'folder', uuid(1), ownerB, EMAIL, 'edit')

    const ownerC = 'owner-c'
    insertUser(sqlDb, ownerC, 'ownerc@example.com')
    insertDoc(sqlDb, uuid(20), ownerC, { updated_at: 400 })
    insertGrant(sqlDb, 'doc', uuid(20), ownerC, EMAIL, 'view')
    insertDoc(sqlDb, uuid(21), ownerC, { updated_at: 100 }) // 초대 없음, 공유 링크만 — 제외
    insertLink(sqlDb, 'tok-x', ownerC, 'doc', uuid(21))

    const res = await call(env, '/v1/shared', bearerInit('GET', token))
    expect(res.status).toBe(200)
    const body = (await res.json()) as V1SharedDoc[]
    expect(body.map((d) => d.id)).toEqual([uuid(20), uuid(10), uuid(11)])

    const byId = new Map(body.map((d) => [d.id, d]))
    expect(Object.keys(byId.get(uuid(11)) as object).sort()).toEqual([...Object.keys(V1_EXAMPLES.sharedDoc), 'viaFolder'].sort())
    expect(Object.keys(byId.get(uuid(20)) as object).sort()).toEqual(Object.keys(V1_EXAMPLES.sharedDoc).sort())
    expect(byId.get(uuid(11))?.viaFolder).toEqual({ id: uuid(1), name: 'f' })
    expect(byId.get(uuid(10))?.role).toBe('edit')
    expect(byId.get(uuid(20))?.role).toBe('view')
    expect(byId.get(uuid(20))?.ownerEmail).toBe('ownerc@example.com')

    const apiRes = await call(env, '/api/shared')
    const apiBody = (await apiRes.json()) as { id: string; role: string; ownerEmail: string }[]
    const apiSet = new Set(apiBody.map((d) => `${d.id}:${d.role}:${d.ownerEmail}`))
    const v1Set = new Set(body.map((d) => `${d.id}:${d.role}:${d.ownerEmail}`))
    expect(v1Set).toEqual(apiSet)
  })
})

describe('V12 GET /v1/shared — 인증·쓰기 수', () => {
  it('토큰 없음 401, 쿠키만 401, 200 요청 뒤 write_count 그대로', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const token = await createToken(env)
    const before = writeCount(sqlDb)

    const noAuth = await call(env, '/v1/shared')
    expect(noAuth.status).toBe(401)

    const cookieOnly = await call(env, '/v1/shared', { headers: { Cookie: 'session=x' } })
    expect(cookieOnly.status).toBe(401)

    const ok = await call(env, '/v1/shared', bearerInit('GET', token))
    expect(ok.status).toBe(200)
    expect(writeCount(sqlDb)).toBe(before)
  })
})
