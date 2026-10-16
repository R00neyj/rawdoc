// 휴지통 행은 조회에서 사라지고, 열 수 있던 사람에게만 deleted (specs/features/F-3022.md 2·3·5장, A2~A7)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { buildImageBlock } from '../../src/lib/imageBlock'

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
const OWNER = 'owner@example.com'
const VIEWER = 'viewer@example.com'
const EDITOR = 'editor@example.com'
const STRANGER = 'stranger@example.com'
const ATT = '0123456789abcdef'
const KEY = 'A'.repeat(55) + '='
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeWorld() {
  const sqlDb = openTestDb()
  const base = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    BUCKET: { async put() {}, get: async () => ({ body: new Uint8Array([1, 2, 3]) }) },
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    DOC_ROOM: { getByName: () => ({ async revalidateConnections() {}, async purgeRoom() {} }) },
  }
  const as = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  return { sqlDb, owner: as(OWNER), viewer: as(VIEWER), editor: as(EDITOR), stranger: as(STRANGER) }
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

async function ok<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  expect([200, 201]).toContain(r.status)
  return (await r.json()) as T
}

async function reply(res: Promise<Response>) {
  const r = await res
  return { status: r.status, body: (await r.json()) as unknown }
}

async function ownerId(w: ReturnType<typeof makeWorld>): Promise<string> {
  await ok(call(w.owner, '/api/me'))
  return (w.sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(OWNER) as { id: string }).id
}

async function createDoc(env: Env, id: string, content = '본문', folderId?: string): Promise<string> {
  const body: Record<string, unknown> = { id, title: `t-${id.slice(-2)}`, content, lineEnding: 'lf' }
  if (folderId) body.folderId = folderId
  return (await ok<{ id: string }>(call(env, '/api/docs', json('POST', body)))).id
}

async function createFolder(env: Env, name: string): Promise<string> {
  return (await ok<{ id: string }>(call(env, '/api/folders', json('POST', { name })))).id
}

function grant(sqlDb: DatabaseSync, targetType: 'doc' | 'folder', targetId: string, owner: string, email: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(targetType, targetId, owner, email, role, 1)
}

function trash(sqlDb: DatabaseSync, id: string) {
  sqlDb.prepare("UPDATE docs SET deleted_at = ?, deleted_by = 'app' WHERE id = ?").run(Date.now(), id)
}

const ids = (list: unknown) => (list as { id: string }[]).map((d) => d.id)
const deleted = { status: 404, body: { error: 'deleted' } }
const notFound = { status: 404, body: { error: 'not_found' } }

describe('F-3022 A2 0027 마이그레이션', () => {
  it('행 유지, 세 열 NULL, 색인 docs_trashed', () => {
    const sqlDb = openTestDb('0026')
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u1', 'u1@example.com', 1)
    sqlDb
      .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('d1', 'u1', '제목', '본문', 'lf', 3, 1, 2)
    sqlDb.exec(readFileSync(fileURLToPath(new URL('../../migrations/0027_trash.sql', import.meta.url)), 'utf-8'))
    expect(sqlDb.prepare('SELECT id, title, version, deleted_at, deleted_by, deleted_path FROM docs').all()).toEqual([
      { id: 'd1', title: '제목', version: 3, deleted_at: null, deleted_by: null, deleted_path: null },
    ])
    expect(sqlDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'docs_trashed'").all()).toEqual([{ name: 'docs_trashed' }])
  })
})

describe('F-3022 A3 목록·GET /api/docs/:id', () => {
  it('목록에 없음, 소유자·문서 초대·폴더 초대는 deleted, 모르는 사람은 not_found, 산 문서는 그대로', async () => {
    const w = makeWorld()
    const owner = await ownerId(w)
    const folder = await createFolder(w.owner, 'F')
    const gone = await createDoc(w.owner, uuid(1), '본문', folder)
    const live = await createDoc(w.owner, uuid(2))
    grant(w.sqlDb, 'doc', gone, owner, VIEWER, 'view')
    grant(w.sqlDb, 'folder', folder, owner, EDITOR, 'edit')
    trash(w.sqlDb, gone)

    expect(ids(await ok(call(w.owner, '/api/docs')))).toEqual([live])
    for (const env of [w.owner, w.viewer, w.editor]) expect(await reply(call(env, `/api/docs/${gone}`))).toEqual(deleted)
    expect(await reply(call(w.stranger, `/api/docs/${gone}`))).toEqual(notFound)
    expect((await ok<{ id: string }>(call(w.owner, `/api/docs/${live}`))).id).toBe(live)
  })
})

describe('F-3022 A4 휴지통 문서 쓰기', () => {
  it('PUT·폴더 옮기기·고정·DELETE 모두 404, version·folder_id·pinned_at 그대로', async () => {
    const w = makeWorld()
    await ownerId(w)
    const folder = await createFolder(w.owner, 'F')
    const gone = await createDoc(w.owner, uuid(1))
    trash(w.sqlDb, gone)
    const row = () => w.sqlDb.prepare('SELECT version, folder_id, pinned_at FROM docs WHERE id = ?').get(gone)
    const before = row()

    expect((await call(w.owner, `/api/docs/${gone}`, json('PUT', { content: 'x', baseVersion: 1 }))).status).toBe(404)
    expect((await call(w.owner, `/api/docs/${gone}/folder`, json('PUT', { folderId: folder }))).status).toBe(404)
    expect((await call(w.owner, `/api/docs/${gone}/pin`, json('PUT', { pinned: true }))).status).toBe(404)
    expect((await call(w.owner, `/api/docs/${gone}`, { method: 'DELETE' })).status).toBe(404)
    expect(row()).toEqual(before)
  })
})

describe('F-3022 A5 같은 id 로 POST /api/docs', () => {
  it('소유자 404 deleted·행 수 그대로, 다른 사용자 409 id_taken', async () => {
    const w = makeWorld()
    await ownerId(w)
    const gone = await createDoc(w.owner, uuid(1))
    trash(w.sqlDb, gone)
    const count = () => w.sqlDb.prepare('SELECT COUNT(*) AS n FROM docs').get()
    const before = count()
    const body = { id: gone, title: '다시', content: '본문', lineEnding: 'lf' }

    expect(await reply(call(w.owner, '/api/docs', json('POST', body)))).toEqual(deleted)
    expect(count()).toEqual(before)
    expect(await reply(call(w.stranger, '/api/docs', json('POST', body)))).toEqual({ status: 409, body: { error: 'id_taken' } })
  })
})

describe('F-3022 A6 /pub', () => {
  it('문서 링크·묶음·폴더의 휴지통 문서는 목록에서 빠지고 본문 deleted, 트리 밖은 not_found, 공개 첨부 404', async () => {
    const w = makeWorld()
    const owner = await ownerId(w)
    w.sqlDb
      .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(owner, ATT, 'png', 'image/png', 3, 2, 2, 1)
    const image = buildImageBlock({ id: ATT, ext: 'png', alt: '이미지', width: 2 })
    const folder = await createFolder(w.owner, 'F')
    const start = await createDoc(w.owner, uuid(1), `시작\n\n${image}`)
    const bundled = await createDoc(w.owner, uuid(2), `묶음\n\n${image}`)
    const inFolder = await createDoc(w.owner, uuid(3), `폴더 안\n\n${image}`, folder)
    const sibling = await createDoc(w.owner, uuid(4), '폴더 안 둘', folder)
    const outside = await createDoc(w.owner, uuid(5))
    const dt = (await ok<{ token: string }>(call(w.owner, `/api/docs/${start}/link`, json('POST', { docIds: [bundled] })))).token
    const ft = (await ok<{ token: string }>(call(w.owner, `/api/folders/${folder}/link`, json('POST')))).token
    const attachments = [`/pub/docs/${dt}/attachments/${ATT}.png`, `/pub/docs/${dt}/docs/${bundled}/attachments/${ATT}.png`, `/pub/folders/${ft}/docs/${inFolder}/attachments/${ATT}.png`]
    for (const path of attachments) expect((await call(w.stranger, path)).status).toBe(200)

    trash(w.sqlDb, bundled)
    expect(ids((await ok<{ docs: unknown }>(call(w.stranger, `/pub/docs/${dt}/set`))).docs)).toEqual([start])
    expect(await reply(call(w.stranger, `/pub/docs/${dt}/docs/${bundled}`))).toEqual(deleted)
    expect((await call(w.stranger, attachments[1])).status).toBe(404)

    trash(w.sqlDb, inFolder)
    expect(ids((await ok<{ docs: unknown }>(call(w.stranger, `/pub/folders/${ft}`))).docs)).toEqual([sibling])
    expect(await reply(call(w.stranger, `/pub/folders/${ft}/docs/${inFolder}`))).toEqual(deleted)
    expect((await call(w.stranger, attachments[2])).status).toBe(404)

    trash(w.sqlDb, outside)
    expect(await reply(call(w.stranger, `/pub/folders/${ft}/docs/${outside}`))).toEqual(notFound)

    trash(w.sqlDb, start)
    expect(await reply(call(w.stranger, `/pub/docs/${dt}`))).toEqual(deleted)
    expect(await reply(call(w.stranger, `/pub/docs/${dt}/set`))).toEqual(deleted)
    expect((await call(w.stranger, attachments[0])).status).toBe(404)
  })
})

describe('F-3022 A7 공유받은 목록·/v1·금고 초기화', () => {
  it('공유받은 목록에 없음', async () => {
    const w = makeWorld()
    const owner = await ownerId(w)
    const folder = await createFolder(w.owner, 'F')
    const docShared = await createDoc(w.owner, uuid(1))
    const inFolder = await createDoc(w.owner, uuid(2), '본문', folder)
    const live = await createDoc(w.owner, uuid(3), '본문', folder)
    grant(w.sqlDb, 'doc', docShared, owner, VIEWER, 'view')
    grant(w.sqlDb, 'folder', folder, owner, VIEWER, 'edit')
    trash(w.sqlDb, docShared)
    trash(w.sqlDb, inFolder)
    expect(ids(await ok(call(w.viewer, '/api/shared')))).toEqual([live])
  })

  it('/v1 검색에 없고 /v1 GET 은 not_found', async () => {
    const w = makeWorld()
    await ownerId(w)
    const folder = await createFolder(w.owner, 'F')
    const goneTop = await createDoc(w.owner, uuid(1), '찾는말')
    const goneIn = await createDoc(w.owner, uuid(2), '찾는말', folder)
    const live = await createDoc(w.owner, uuid(3), '찾는말', folder)
    trash(w.sqlDb, goneTop)
    trash(w.sqlDb, goneIn)
    const token = (await ok<{ token: string }>(call(w.owner, '/api/tokens', json('POST', { name: '토큰' })))).token
    const auth = { headers: { Authorization: `Bearer ${token}` } }
    const q = encodeURIComponent('찾는말')
    expect(ids((await ok<{ docs: unknown }>(call(w.owner, `/v1/search?q=${q}`, auth))).docs)).toEqual([live])
    expect(ids((await ok<{ docs: unknown }>(call(w.owner, `/v1/search?q=${q}&folder=${folder}`, auth))).docs)).toEqual([live])
    expect(await reply(call(w.owner, `/v1/docs/${goneTop}`, auth))).toEqual(notFound)
  })

  it('휴지통 금고 문서가 남으면 금고 초기화 409 vault_not_empty', async () => {
    const w = makeWorld()
    const owner = await ownerId(w)
    await ok(call(w.owner, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 })))
    w.sqlDb
      .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(uuid(1), owner, 'dA==', 'Yg==', 'lf', 1, 1, 1, KEY, '[]')
    trash(w.sqlDb, uuid(1))
    expect(await reply(call(w.owner, '/api/e2ee/keys', { method: 'DELETE' }))).toEqual({ status: 409, body: { error: 'vault_not_empty', docs: 1, folders: 0 } })
  })
})
