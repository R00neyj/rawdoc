// 휴지통 보내기·복원·영구 삭제·비우기·30일 만료 (specs/features/F-3023.md 3~5장, A1~A3·A6~A10)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { TRASH_RETENTION_DAYS, trashActorForMcp, trashPurgeAt } from '../../src/lib/trash'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
  scheduled(event: { cron: string }, env: Env, ctx: ExecutionContext): Promise<void>
}
let worker: Worker
let trashModule: typeof import('../../worker/trash')
let purgeModule: typeof import('../../worker/purgeJobs')

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
  trashModule = await import('../../worker/trash')
  purgeModule = await import('../../worker/purgeJobs')
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const VIEWER = 'viewer@example.com'
const EDITOR = 'editor@example.com'
const STRANGER = 'stranger@example.com'
const KEY = 'A'.repeat(55) + '='
const DAY_MS = 24 * 60 * 60 * 1000
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Room = { closeTrashed: ReturnType<typeof vi.fn>; purgeRoom: ReturnType<typeof vi.fn>; revalidateConnections: ReturnType<typeof vi.fn> }

function makeWorld(opts: { purgeRoom?: () => Promise<void> } = {}) {
  const sqlDb = openTestDb()
  const db = asD1(sqlDb)
  const batches: number[] = []
  const DB = {
    prepare: db.prepare.bind(db),
    batch(statements: D1PreparedStatement[]) {
      batches.push(statements.length)
      return db.batch(statements)
    },
  } as unknown as D1Database
  const room: Room = {
    closeTrashed: vi.fn(async () => {}),
    purgeRoom: vi.fn(opts.purgeRoom ?? (async () => {})),
    revalidateConnections: vi.fn(async () => {}),
  }
  const getByName = vi.fn(() => room)
  const base = {
    DB,
    BETTER_AUTH_URL: ORIGIN,
    BUCKET: { async put() {}, get: async () => null },
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    DOC_ROOM: { getByName },
  }
  const as = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  return { sqlDb, batches, room, getByName, owner: as(OWNER), viewer: as(VIEWER), editor: as(EDITOR), stranger: as(STRANGER) }
}
type World = ReturnType<typeof makeWorld>

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
  return { status: r.status, body: r.status === 204 ? null : ((await r.json()) as unknown) }
}

async function userId(w: World, env: Env, email: string): Promise<string> {
  await ok(call(env, '/api/me'))
  return (w.sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

async function createDoc(env: Env, id: string, content = '본문', folderId?: string): Promise<string> {
  const body: Record<string, unknown> = { id, title: `t-${id.slice(-2)}`, content, lineEnding: 'lf' }
  if (folderId) body.folderId = folderId
  return (await ok<{ id: string }>(call(env, '/api/docs', json('POST', body)))).id
}

async function createFolder(env: Env, name: string, parentId?: string): Promise<string> {
  return (await ok<{ id: string }>(call(env, '/api/folders', json('POST', parentId ? { name, parentId } : { name })))).id
}

function insertVaultDoc(sqlDb: DatabaseSync, id: string, owner: string, folderId: string | null = null) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, owner, 'dA==', 'Yg==', 'lf', folderId, 1, 1, 1, KEY, '[]')
}

function grant(sqlDb: DatabaseSync, targetType: 'doc' | 'folder', targetId: string, owner: string, email: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(targetType, targetId, owner, email, role, 1)
}

function link(sqlDb: DatabaseSync, token: string, owner: string, targetType: 'doc' | 'folder', targetId: string) {
  sqlDb
    .prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)')
    .run(token, owner, targetType, targetId, 1)
}

function bundle(sqlDb: DatabaseSync, token: string, docId: string) {
  sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run(token, docId)
}

function comment(sqlDb: DatabaseSync, docId: string, id: string, bytes: number) {
  sqlDb.prepare("INSERT INTO doc_comments (doc_id, id, body, created_at, bytes, sig, anchor_sig) VALUES (?, ?, 'b', 1, ?, 's', 'a')").run(docId, id, bytes)
  sqlDb
    .prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES (?, ?, 'mention', ?, ?, ?, 'y@example.com', 't', 'e', 1)")
    .run(`${docId}-${id}`, VIEWER, docId, id, id)
}

function folderNotification(sqlDb: DatabaseSync, id: string, folderId: string) {
  sqlDb
    .prepare("INSERT INTO notifications (id, recipient_email, kind, folder_id, role, actor_email, doc_title, excerpt, created_at) VALUES (?, ?, 'share', ?, 'view', ?, 'F', '', 1)")
    .run(id, VIEWER, folderId, OWNER)
}

function github(sqlDb: DatabaseSync, docId: string, owner: string) {
  sqlDb
    .prepare("INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_bom, created_at) VALUES (?, ?, 1, 'o/r', 'main', ?, 0, 1)")
    .run(docId, owner, `${docId}.md`)
  sqlDb
    .prepare("INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES (?, 'x.png', ?, '0123456789abcdef', 'png', 'a', 1)")
    .run(docId, owner)
}

type DocTrash = { deleted_at: number | null; deleted_by: string | null; deleted_path: string | null; folder_id: string | null; updated_at: number; version: number }
const docRow = (sqlDb: DatabaseSync, id: string) =>
  sqlDb.prepare('SELECT deleted_at, deleted_by, deleted_path, folder_id, updated_at, version FROM docs WHERE id = ?').get(id) as DocTrash | undefined
const usage = (sqlDb: DatabaseSync, id: string) =>
  ({ ...(sqlDb.prepare('SELECT content_bytes, doc_count, write_count FROM users WHERE id = ?').get(id) as object) }) as { content_bytes: number; doc_count: number; write_count: number }
const count = (sqlDb: DatabaseSync, sql: string, ...args: (string | number)[]) => (sqlDb.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).get(...args) as { n: number }).n
const sideRows = (sqlDb: DatabaseSync, docId: string) => ({
  grants: count(sqlDb, "grants WHERE target_type = 'doc' AND target_id = ?", docId),
  links: count(sqlDb, "share_links WHERE target_type = 'doc' AND target_id = ? AND revoked_at IS NULL", docId),
  bundles: count(sqlDb, 'share_link_docs WHERE doc_id = ?', docId),
  comments: count(sqlDb, 'doc_comments WHERE doc_id = ?', docId),
  notifications: count(sqlDb, 'notifications WHERE doc_id = ?', docId),
  github: count(sqlDb, 'github_links WHERE doc_id = ?', docId) + count(sqlDb, 'github_images WHERE doc_id = ?', docId),
})

async function token(env: Env): Promise<{ headers: Record<string, string> }> {
  const t = (await ok<{ token: string }>(call(env, '/api/tokens', json('POST', { name: '토큰' })))).token
  return { headers: { Authorization: `Bearer ${t}` } }
}

describe('F-3023 A1 /api 문서 지우기 → 휴지통', () => {
  it('행 남음·deleted_* 채움·누계 그대로·하루 +1·곁 행 그대로·closeTrashed 1번', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const a = await createFolder(w.owner, 'A')
    const b = await createFolder(w.owner, 'B', a)
    const inB = await createDoc(w.owner, uuid(1), '가나다', b)
    const top = await createDoc(w.owner, uuid(2))
    grant(w.sqlDb, 'doc', inB, owner, VIEWER, 'view')
    link(w.sqlDb, 'tok1', owner, 'doc', inB)
    link(w.sqlDb, 'tok2', owner, 'doc', top)
    bundle(w.sqlDb, 'tok2', inB)
    comment(w.sqlDb, inB, 'c1', 5)
    github(w.sqlDb, inB, owner)
    const before = usage(w.sqlDb, owner)
    const sides = sideRows(w.sqlDb, inB)

    const t0 = Date.now()
    expect(await reply(call(w.owner, `/api/docs/${inB}`, { method: 'DELETE' }))).toEqual({ status: 204, body: null })
    const row = docRow(w.sqlDb, inB)!
    expect(row.deleted_at).toBeGreaterThanOrEqual(t0)
    expect(row.deleted_at).toBeLessThanOrEqual(Date.now())
    expect(row).toMatchObject({ deleted_by: 'app', deleted_path: 'A/B', folder_id: b })
    expect(usage(w.sqlDb, owner)).toEqual({ ...before, write_count: before.write_count + 1 })
    expect(sideRows(w.sqlDb, inB)).toEqual(sides)
    expect(w.getByName.mock.calls).toEqual([[inB]])
    expect(w.room.closeTrashed).toHaveBeenCalledTimes(1)

    expect((await reply(call(w.owner, `/api/docs/${top}`, { method: 'DELETE' }))).status).toBe(204)
    expect(docRow(w.sqlDb, top)).toMatchObject({ deleted_by: 'app', deleted_path: null })
  })

  it('금고 문서도 204·방 호출 0, 두 번째 404, 남의 문서 404, 편집 초대 403', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    insertVaultDoc(w.sqlDb, uuid(1), owner)
    const doc = await createDoc(w.owner, uuid(2))
    grant(w.sqlDb, 'doc', doc, owner, EDITOR, 'edit')

    expect((await reply(call(w.owner, `/api/docs/${uuid(1)}`, { method: 'DELETE' }))).status).toBe(204)
    expect(docRow(w.sqlDb, uuid(1))).toMatchObject({ deleted_by: 'app' })
    expect(w.getByName).not.toHaveBeenCalled()

    expect(await reply(call(w.stranger, `/api/docs/${doc}`, { method: 'DELETE' }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(await reply(call(w.editor, `/api/docs/${doc}`, { method: 'DELETE' }))).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(docRow(w.sqlDb, doc)!.deleted_at).toBeNull()
    expect((await reply(call(w.owner, `/api/docs/${doc}`, { method: 'DELETE' }))).status).toBe(204)
    expect(await reply(call(w.owner, `/api/docs/${doc}`, { method: 'DELETE' }))).toEqual({ status: 404, body: { error: 'not_found' } })
  })
})

describe('F-3023 A2 /v1 문서 지우기·MCP 주체', () => {
  it('200 {id,title}·cli, 금고 403 e2ee_doc, 남의 것 404, 편집 초대 403', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const doc = await createDoc(w.owner, uuid(1))
    insertVaultDoc(w.sqlDb, uuid(2), owner)
    grant(w.sqlDb, 'doc', doc, owner, EDITOR, 'edit')
    const auth = await token(w.owner)
    const editorAuth = await token(w.editor)
    const strangerAuth = await token(w.stranger)

    expect(await reply(call(w.stranger, `/v1/docs/${doc}`, { method: 'DELETE', ...strangerAuth }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(await reply(call(w.editor, `/v1/docs/${doc}`, { method: 'DELETE', ...editorAuth }))).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(await reply(call(w.owner, `/v1/docs/${uuid(2)}`, { method: 'DELETE', ...auth }))).toEqual({ status: 403, body: { error: 'e2ee_doc' } })
    expect(docRow(w.sqlDb, uuid(2))!.deleted_at).toBeNull()
    expect(await reply(call(w.owner, `/v1/docs/${doc}`, { method: 'DELETE', ...auth }))).toEqual({ status: 200, body: { id: doc, title: 't-01' } })
    expect(docRow(w.sqlDb, doc)).toMatchObject({ deleted_by: 'cli', deleted_path: null })
  })

  it('trashDoc 을 mcp:Claude 로 부르면 그 값이 남는다', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const doc = await createDoc(w.owner, uuid(1))
    const result = await trashModule.trashDoc(w.owner, ctx, { id: owner, email: OWNER }, doc, { by: trashActorForMcp('Claude'), allowE2ee: false })
    expect(result).toEqual({ ok: true, id: doc, title: 't-01' })
    expect(docRow(w.sqlDb, doc)!.deleted_by).toBe('mcp:Claude')
  })
})

describe('F-3023 A3 폴더 delete-all → 폴더 지우고 문서는 휴지통', () => {
  async function seed(w: World) {
    const owner = await userId(w, w.owner, OWNER)
    const top = await createFolder(w.owner, 'Top')
    const sub = await createFolder(w.owner, 'Sub', top)
    const dTop = await createDoc(w.owner, uuid(1), 'ab', top)
    const dSub = await createDoc(w.owner, uuid(2), 'cde', sub)
    const dOld = await createDoc(w.owner, uuid(3), 'x', sub)
    const dOut = await createDoc(w.owner, uuid(4), 'f')
    w.sqlDb.prepare("UPDATE docs SET deleted_at = 7, deleted_by = 'cli', deleted_path = '옛' WHERE id = ?").run(dOld)
    link(w.sqlDb, 'ftok', owner, 'folder', top)
    grant(w.sqlDb, 'folder', sub, owner, VIEWER, 'view')
    folderNotification(w.sqlDb, 'fn1', top)
    grant(w.sqlDb, 'doc', dSub, owner, EDITOR, 'edit')
    link(w.sqlDb, 'dtok', owner, 'doc', dSub)
    link(w.sqlDb, 'btok', owner, 'doc', dOut)
    bundle(w.sqlDb, 'btok', dSub)
    comment(w.sqlDb, dSub, 'c1', 4)
    return { owner, top, sub, dTop, dSub, dOld, dOut }
  }

  function expectTrashed(w: World, s: Awaited<ReturnType<typeof seed>>, by: string, sides: ReturnType<typeof sideRows>) {
    expect(count(w.sqlDb, 'folders')).toBe(0)
    expect(count(w.sqlDb, "share_links WHERE target_type = 'folder' AND revoked_at IS NULL")).toBe(0)
    expect(count(w.sqlDb, "grants WHERE target_type = 'folder'")).toBe(0)
    expect(count(w.sqlDb, 'notifications WHERE folder_id IS NOT NULL')).toBe(0)
    expect(docRow(w.sqlDb, s.dTop)).toMatchObject({ folder_id: s.top, deleted_by: by, deleted_path: 'Top' })
    expect(docRow(w.sqlDb, s.dSub)).toMatchObject({ folder_id: s.sub, deleted_by: by, deleted_path: 'Top/Sub' })
    expect(docRow(w.sqlDb, s.dOld)).toMatchObject({ deleted_at: 7, deleted_by: 'cli', deleted_path: '옛' })
    expect(docRow(w.sqlDb, s.dOut)!.deleted_at).toBeNull()
    expect(sideRows(w.sqlDb, s.dSub)).toEqual(sides)
    expect(count(w.sqlDb, 'purge_jobs')).toBe(0)
  }

  it('/api 204, 폴더 행·폴더 링크·초대·폴더 알림 0, 문서는 휴지통, 문서 곁 행 그대로', async () => {
    const w = makeWorld()
    const s = await seed(w)
    const sides = sideRows(w.sqlDb, s.dSub)
    const before = usage(w.sqlDb, s.owner)
    expect((await reply(call(w.owner, `/api/folders/${s.top}?contents=delete-all`, { method: 'DELETE' }))).status).toBe(204)
    expectTrashed(w, s, 'app', sides)
    expect(usage(w.sqlDb, s.owner)).toEqual({ ...before, write_count: before.write_count + 1 })
  })

  it('/v1 200 {id,contents,parentId,docs,folders}, 이미 휴지통이던 문서는 docs 에서 빠짐', async () => {
    const w = makeWorld()
    const s = await seed(w)
    const sides = sideRows(w.sqlDb, s.dSub)
    const auth = await token(w.owner)
    expect(await reply(call(w.owner, `/v1/folders/${s.top}?contents=delete-all`, { method: 'DELETE', ...auth }))).toEqual({
      status: 200,
      body: { id: s.top, contents: 'delete-all', parentId: null, docs: 2, folders: 2 },
    })
    expectTrashed(w, s, 'cli', sides)
  })

  it('/v1 금고 하위는 403 e2ee_folder·아무것도 안 바뀜, /api 는 금고 문서도 보낸다', async () => {
    const w = makeWorld()
    const s = await seed(w)
    insertVaultDoc(w.sqlDb, uuid(9), s.owner, s.sub)
    const auth = await token(w.owner)
    const snapshot = () => w.sqlDb.prepare('SELECT id, folder_id, deleted_at FROM docs ORDER BY id').all()
    const docsBefore = snapshot()
    expect(await reply(call(w.owner, `/v1/folders/${s.top}?contents=delete-all`, { method: 'DELETE', ...auth }))).toEqual({ status: 403, body: { error: 'e2ee_folder' } })
    expect(snapshot()).toEqual(docsBefore)
    expect(count(w.sqlDb, 'folders')).toBe(2)

    expect((await reply(call(w.owner, `/api/folders/${s.top}?contents=delete-all`, { method: 'DELETE' }))).status).toBe(204)
    expect(docRow(w.sqlDb, uuid(9))).toMatchObject({ deleted_by: 'app', deleted_path: 'Top/Sub' })
  })
})

describe('F-3023 A6 GET /api/trash', () => {
  it('내 휴지통만, deletedAt 내림차순(같으면 id), purgeAt, 금고 title ""·e2ee', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const other = await userId(w, w.stranger, STRANGER)
    const f = await createFolder(w.owner, 'F')
    await createDoc(w.owner, uuid(1), '본문', f)
    await createDoc(w.owner, uuid(2))
    await createDoc(w.owner, uuid(3))
    await createDoc(w.owner, uuid(4))
    insertVaultDoc(w.sqlDb, uuid(5), owner)
    insertVaultDoc(w.sqlDb, uuid(6), other)
    for (const id of [uuid(1), uuid(2), uuid(3), uuid(5)]) expect((await reply(call(w.owner, `/api/docs/${id}`, { method: 'DELETE' }))).status).toBe(204)
    const at = (id: string, deletedAt: number) => w.sqlDb.prepare('UPDATE docs SET deleted_at = ? WHERE id = ?').run(deletedAt, id)
    at(uuid(1), 100)
    at(uuid(2), 300)
    at(uuid(3), 200)
    at(uuid(5), 300)
    w.sqlDb.prepare("UPDATE docs SET deleted_at = 500, deleted_by = 'app' WHERE id = ?").run(uuid(6))

    expect(await ok(call(w.owner, '/api/trash'))).toEqual([
      { id: uuid(2), title: 't-02', deletedAt: 300, deletedBy: 'app', path: null, purgeAt: trashPurgeAt(300) },
      { id: uuid(5), title: '', e2ee: true, deletedAt: 300, deletedBy: 'app', path: null, purgeAt: trashPurgeAt(300) },
      { id: uuid(3), title: 't-03', deletedAt: 200, deletedBy: 'app', path: null, purgeAt: trashPurgeAt(200) },
      { id: uuid(1), title: 't-01', deletedAt: 100, deletedBy: 'app', path: 'F', purgeAt: trashPurgeAt(100) },
    ])
    expect(await ok(call(w.viewer, '/api/trash'))).toEqual([])
  })
})

describe('F-3023 A7 복원', () => {
  it('같은 폴더로, 열람·공개 링크 되살아남, updated_at·version 그대로, 하루 +1', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const f = await createFolder(w.owner, 'F')
    const doc = await createDoc(w.owner, uuid(1), '본문', f)
    grant(w.sqlDb, 'doc', doc, owner, VIEWER, 'view')
    const { token: pub } = await ok<{ token: string }>(call(w.owner, `/api/docs/${doc}/link`, json('POST', {})))
    expect((await reply(call(w.owner, `/api/docs/${doc}`, { method: 'DELETE' }))).status).toBe(204)
    expect((await reply(call(w.viewer, `/api/docs/${doc}`))).status).toBe(404)
    const before = docRow(w.sqlDb, doc)!
    const writes = usage(w.sqlDb, owner).write_count

    expect(await reply(call(w.owner, `/api/trash/${doc}/restore`, { method: 'POST' }))).toEqual({ status: 200, body: { id: doc, folderId: f } })
    expect(docRow(w.sqlDb, doc)).toEqual({ ...before, deleted_at: null, deleted_by: null, deleted_path: null })
    expect(usage(w.sqlDb, owner).write_count).toBe(writes + 1)
    expect((await reply(call(w.owner, `/api/docs/${doc}`))).status).toBe(200)
    expect((await reply(call(w.viewer, `/api/docs/${doc}`))).status).toBe(200)
    expect((await reply(call(w.stranger, `/pub/docs/${pub}`))).status).toBe(200)
  })

  it('폴더가 지워졌거나 금고 여부가 다르면 최상위', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const gone = await createFolder(w.owner, 'Gone')
    const vault = await createFolder(w.owner, 'Vault')
    const d1 = await createDoc(w.owner, uuid(1), '본문', gone)
    const d2 = await createDoc(w.owner, uuid(2), '본문', vault)
    insertVaultDoc(w.sqlDb, uuid(3), owner, vault)
    for (const id of [d1, d2]) await call(w.owner, `/api/docs/${id}`, { method: 'DELETE' })
    w.sqlDb.prepare('UPDATE docs SET deleted_at = 1 WHERE id = ?').run(uuid(3))
    w.sqlDb.prepare('DELETE FROM folders WHERE id = ?').run(gone)
    w.sqlDb.prepare('UPDATE folders SET e2ee = 1 WHERE id = ?').run(vault)

    expect(await ok(call(w.owner, `/api/trash/${d1}/restore`, { method: 'POST' }))).toEqual({ id: d1, folderId: null })
    expect(await ok(call(w.owner, `/api/trash/${d2}/restore`, { method: 'POST' }))).toEqual({ id: d2, folderId: null })
    expect(await ok(call(w.owner, `/api/trash/${uuid(3)}/restore`, { method: 'POST' }))).toEqual({ id: uuid(3), folderId: vault })
    expect(docRow(w.sqlDb, d2)!.folder_id).toBeNull()
  })

  it('살아 있는 문서·남의 휴지통 404', async () => {
    const w = makeWorld()
    await userId(w, w.owner, OWNER)
    const live = await createDoc(w.owner, uuid(1))
    const mine = await createDoc(w.owner, uuid(2))
    await call(w.owner, `/api/docs/${mine}`, { method: 'DELETE' })
    expect(await reply(call(w.owner, `/api/trash/${live}/restore`, { method: 'POST' }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(await reply(call(w.stranger, `/api/trash/${mine}/restore`, { method: 'POST' }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(docRow(w.sqlDb, mine)!.deleted_at).not.toBeNull()
  })
})

describe('F-3023 A8 DELETE /api/trash/:id', () => {
  it('행·댓글·묶음·초대 0, doc_count −1·content_bytes 줄어듦, notifyPurge 1번. 살아 있는 문서 404', async () => {
    const w = makeWorld()
    const owner = await userId(w, w.owner, OWNER)
    const doc = await createDoc(w.owner, uuid(1), '가나다')
    const live = await createDoc(w.owner, uuid(2), 'x')
    grant(w.sqlDb, 'doc', doc, owner, VIEWER, 'view')
    link(w.sqlDb, 'btok', owner, 'doc', live)
    bundle(w.sqlDb, 'btok', doc)
    comment(w.sqlDb, doc, 'c1', 5)
    w.sqlDb.prepare('UPDATE users SET content_bytes = content_bytes + 5 WHERE id = ?').run(owner)
    await call(w.owner, `/api/docs/${doc}`, { method: 'DELETE' })
    const before = usage(w.sqlDb, owner)

    expect(await reply(call(w.owner, `/api/trash/${live}`, { method: 'DELETE' }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(docRow(w.sqlDb, live)).toBeTruthy()
    expect(await reply(call(w.stranger, `/api/trash/${doc}`, { method: 'DELETE' }))).toEqual({ status: 404, body: { error: 'not_found' } })

    expect(await reply(call(w.owner, `/api/trash/${doc}`, { method: 'DELETE' }))).toEqual({ status: 204, body: null })
    expect(docRow(w.sqlDb, doc)).toBeUndefined()
    expect(sideRows(w.sqlDb, doc)).toEqual({ grants: 0, links: 0, bundles: 0, comments: 0, notifications: 0, github: 0 })
    expect(usage(w.sqlDb, owner)).toEqual({ content_bytes: before.content_bytes - 9 - 5, doc_count: before.doc_count - 1, write_count: before.write_count + 1 })
    expect(w.room.purgeRoom).toHaveBeenCalledTimes(1)
    expect(w.getByName).toHaveBeenLastCalledWith(doc)
  })
})

describe('F-3023 A9 DELETE /api/trash', () => {
  it('휴지통 3개 → {docs:3}, 살아 있는 문서·남의 휴지통 그대로, 누계 맞음, room 작업 3행', async () => {
    const w = makeWorld({ purgeRoom: async () => Promise.reject(new Error('down')) })
    const owner = await userId(w, w.owner, OWNER)
    const other = await userId(w, w.stranger, STRANGER)
    for (const n of [1, 2, 3]) await createDoc(w.owner, uuid(n), 'abc')
    const live = await createDoc(w.owner, uuid(4), 'xy')
    const theirs = await createDoc(w.stranger, uuid(5), 'z')
    comment(w.sqlDb, uuid(1), 'c1', 6)
    w.sqlDb.prepare('UPDATE users SET content_bytes = content_bytes + 6 WHERE id = ?').run(owner)
    for (const n of [1, 2, 3]) await call(w.owner, `/api/docs/${uuid(n)}`, { method: 'DELETE' })
    await call(w.stranger, `/api/docs/${theirs}`, { method: 'DELETE' })
    const before = usage(w.sqlDb, owner)
    const otherBefore = usage(w.sqlDb, other)

    expect(await reply(call(w.owner, '/api/trash', { method: 'DELETE' }))).toEqual({ status: 200, body: { docs: 3 } })
    expect(count(w.sqlDb, 'docs WHERE owner_id = ?', owner)).toBe(1)
    expect(docRow(w.sqlDb, live)!.deleted_at).toBeNull()
    expect(docRow(w.sqlDb, theirs)!.deleted_at).not.toBeNull()
    expect(usage(w.sqlDb, owner)).toEqual({ content_bytes: before.content_bytes - 9 - 6, doc_count: before.doc_count - 3, write_count: before.write_count + 1 })
    expect(usage(w.sqlDb, other)).toEqual(otherBefore)
    expect(count(w.sqlDb, 'doc_comments')).toBe(0)
    const jobs = w.sqlDb.prepare("SELECT target FROM purge_jobs WHERE kind = 'room' ORDER BY target").all()
    expect(jobs).toEqual([1, 2, 3].map((n) => ({ target: uuid(n) })))
  })

  it('금고 문서는 room 작업 없음, 빈 휴지통도 200·하루 +1', async () => {
    const w = makeWorld({ purgeRoom: async () => Promise.reject(new Error('down')) })
    const owner = await userId(w, w.owner, OWNER)
    insertVaultDoc(w.sqlDb, uuid(1), owner)
    await call(w.owner, `/api/docs/${uuid(1)}`, { method: 'DELETE' })
    expect(await ok(call(w.owner, '/api/trash', { method: 'DELETE' }))).toEqual({ docs: 1 })
    expect(count(w.sqlDb, 'purge_jobs')).toBe(0)
    const writes = usage(w.sqlDb, owner).write_count
    expect(await ok(call(w.owner, '/api/trash', { method: 'DELETE' }))).toEqual({ docs: 0 })
    expect(usage(w.sqlDb, owner).write_count).toBe(writes + 1)
  })

  it('문서 1개와 10,000개 모두 batch 문장 16', async () => {
    for (const n of [1, 10_000]) {
      const w = makeWorld()
      const owner = await userId(w, w.owner, OWNER)
      const insert = w.sqlDb.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, deleted_at, deleted_by) VALUES (?,?,'t','c','lf',1,1,1,?,'app')")
      w.sqlDb.exec('BEGIN')
      for (let i = 0; i < n; i++) insert.run(`d${i}`, owner, 1000 + i)
      w.sqlDb.exec('COMMIT')
      w.batches.length = 0
      expect(await ok(call(w.owner, '/api/trash', { method: 'DELETE' }))).toEqual({ docs: n })
      expect(w.batches[0]).toBe(16)
      expect(count(w.sqlDb, 'docs')).toBe(0)
    }
  })
})

describe('F-3023 A10 30일 만료', () => {
  const NOW = Date.parse('2026-10-16T00:00:00Z')
  const RETAIN = TRASH_RETENTION_DAYS * DAY_MS

  function trashed(sqlDb: DatabaseSync, id: string, owner: string, deletedAt: number) {
    sqlDb
      .prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, deleted_at, deleted_by) VALUES (?,?,'t','abc','lf',1,1,1,?,'app')")
      .run(id, owner, deletedAt)
  }

  it('30일+1ms 지난 것만, 두 소유자면 한 번에 한 명(가장 오래된 행 주인), write_count 그대로', async () => {
    const w = makeWorld()
    const a = await userId(w, w.owner, OWNER)
    const b = await userId(w, w.stranger, STRANGER)
    trashed(w.sqlDb, 'a-old', a, NOW - RETAIN - 1)
    trashed(w.sqlDb, 'a-edge', a, NOW - RETAIN)
    trashed(w.sqlDb, 'b-old', b, NOW - RETAIN - 5)
    w.sqlDb.prepare('UPDATE users SET doc_count = 2, content_bytes = 6 WHERE id = ?').run(a)
    w.sqlDb.prepare('UPDATE users SET doc_count = 1, content_bytes = 3 WHERE id = ?').run(b)
    const writesA = usage(w.sqlDb, a).write_count
    const writesB = usage(w.sqlDb, b).write_count

    await trashModule.expireTrash(w.owner, NOW)
    expect(w.sqlDb.prepare('SELECT id FROM docs ORDER BY id').all()).toEqual([{ id: 'a-edge' }, { id: 'a-old' }])
    expect(usage(w.sqlDb, b)).toEqual({ content_bytes: 0, doc_count: 0, write_count: writesB })
    await trashModule.expireTrash(w.owner, NOW)
    expect(w.sqlDb.prepare('SELECT id FROM docs ORDER BY id').all()).toEqual([{ id: 'a-edge' }])
    expect(usage(w.sqlDb, a)).toEqual({ content_bytes: 3, doc_count: 1, write_count: writesA })
    await trashModule.expireTrash(w.owner, NOW)
    expect(count(w.sqlDb, 'docs')).toBe(1)
  })

  it('120개면 99·21 두 번', async () => {
    const w = makeWorld()
    const a = await userId(w, w.owner, OWNER)
    for (let i = 0; i < 120; i++) trashed(w.sqlDb, `d${String(i).padStart(3, '0')}`, a, NOW - RETAIN - 1000 + i)
    await trashModule.expireTrash(w.owner, NOW)
    expect(count(w.sqlDb, 'docs')).toBe(21)
    expect(w.sqlDb.prepare('SELECT MIN(id) AS id FROM docs').get()).toEqual({ id: 'd099' })
    await trashModule.expireTrash(w.owner, NOW)
    expect(count(w.sqlDb, 'docs')).toBe(0)
  })

  it('실패한 소유자는 로그 뒤 건너뛰고 같은 tick 에 다음 소유자를 비운다, 문장 예산 50 안', async () => {
    const w = makeWorld()
    const bad = await userId(w, w.owner, OWNER)
    const good = await userId(w, w.stranger, STRANGER)
    trashed(w.sqlDb, 'bad-1', bad, NOW - RETAIN - 10)
    trashed(w.sqlDb, 'good-1', good, NOW - RETAIN - 5)
    w.sqlDb.exec(`CREATE TRIGGER fail_bad BEFORE DELETE ON docs WHEN OLD.owner_id = '${bad}' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const used = await trashModule.expireTrash(w.owner, NOW)
    expect(w.sqlDb.prepare('SELECT id FROM docs ORDER BY id').all()).toEqual([{ id: 'bad-1' }])
    expect(error).toHaveBeenCalledTimes(1)
    expect(used).toBe(trashModule.EXPIRE_OWNER_TRIES * 17)
    for (const statements of [1, 17, used]) {
      expect(statements + 4 + purgeModule.cronPurgeCalls(statements)).toBeLessThanOrEqual(purgeModule.CRON_SUBREQUEST_LIMIT)
    }
    expect(purgeModule.cronPurgeCalls(17)).toBe(purgeModule.PURGE_CALLS_ON_CRON)
    error.mockRestore()
  })

  it('10분 Cron 의 D1 문장 ≤ 21, 만료가 던져도 비우기는 돈다, 예산 50 안', async () => {
    const w = makeWorld()
    const a = await userId(w, w.owner, OWNER)
    for (let i = 0; i < 5; i++) trashed(w.sqlDb, `d${i}`, a, Date.now() - RETAIN - 1000)
    const sqlDb = w.sqlDb
    const inner = asD1(sqlDb)
    let statements = 0
    let inBatch = false
    const counted = (stmt: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(stmt, {
        get(target, key) {
          if (key === 'bind') return (...args: unknown[]) => counted((target.bind as (...a: unknown[]) => D1PreparedStatement)(...args))
          if (key === 'first' || key === 'all' || key === 'run') {
            return (...args: unknown[]) => {
              if (!inBatch) statements++
              return (target[key] as (...a: unknown[]) => unknown)(...args)
            }
          }
          return Reflect.get(target, key)
        },
      })
    const DB = {
      prepare: (sql: string) => counted(inner.prepare(sql)),
      batch: async (list: D1PreparedStatement[]) => {
        statements += list.length
        inBatch = true
        try {
          return await inner.batch(list)
        } finally {
          inBatch = false
        }
      },
    }
    const env = { ...w.owner, DB } as unknown as Env
    const waits: Promise<unknown>[] = []
    const cronCtx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext
    await worker.scheduled({ cron: '*/10 * * * *' }, env, cronCtx)
    await Promise.all(waits)
    expect(count(sqlDb, 'docs')).toBe(0)
    expect(statements).toBeGreaterThan(17)
    expect(statements).toBeLessThanOrEqual(21)
    expect(purgeModule.PURGE_CALLS_ON_CRON + 21).toBeLessThanOrEqual(50)

    const broken = { ...w.owner, DB: { ...DB, batch: () => Promise.reject(new Error('down')) } } as unknown as Env
    trashed(sqlDb, 'x', a, Date.now() - RETAIN - 1000)
    sqlDb.prepare("INSERT INTO purge_jobs (kind, target, priority, created_at) VALUES ('room', 'r1', 1, 1)").run()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    waits.length = 0
    w.getByName.mockClear()
    await worker.scheduled({ cron: '*/10 * * * *' }, broken, cronCtx)
    await Promise.all(waits)
    expect(w.getByName).toHaveBeenCalledWith('r1')
  })
})
