// F-223 자동 업로드 API '/v1' 단위 테스트 (specs/features/F-223.md 3장)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
  rememberUser: vi.fn(),
}))

// DO 경유 쓰기(F-308) — 기본은 null 이라 D1 직접 쓰기(폴백)를 탄다. F-308 테스트만 결과를 준다
vi.mock('./docRoomRpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./docRoomRpc')>()),
  writeTextInRoom: vi.fn(async () => null),
}))

import {
  handleCreateAttachmentV1,
  handleCreateDocLinkV1,
  handleCreateDocV1,
  handleUpdateDocV1,
} from './v1'
import { handleGetDoc, handleListDocs, handleUpdateDoc } from './docs'
import { writeTextInRoom } from './docRoomRpc'
import type { RoomTextWriteResult } from './docRoomCore'
import { handleCreateFolder, handleDeleteFolder, handleListFolders } from './folders'
import { V1_EXAMPLES } from './v1Contract'
import { DOC_BYTES_QUOTA } from './usage'

type DocRow = {
  id: string
  owner_id: string
  title: string
  content: string
  line_ending: 'crlf' | 'lf'
  folder_id: string | null
  pinned_at: number | null
  version: number
  created_at: number
  updated_at: number
}
type FolderRow = { id: string; owner_id: string; name: string; parent_id: string | null; created_at: number; updated_at: number }
type GrantRow = { target_type: 'doc' | 'folder'; target_id: string; grantee_email: string; role: 'view' | 'edit' }
type LockRow = { doc_id: string; user_id: string; email: string; session_id: string; expires_at: number }
type LinkRow = { token: string; owner_id: string; target_type: 'doc' | 'folder'; target_id: string; created_at: number; revoked_at: number | null }
type AttachmentRow = { owner_id: string; id: string; ext: string; mime: string; size: number; width: number; height: number; created_at: number }
type UserRow = { id: string; write_day?: string | null; write_count?: number; content_bytes?: number; doc_count?: number; blocked_at?: number | null; warned_at?: number | null }

function makeEnv(data: {
  docs?: DocRow[]
  folders?: FolderRow[]
  grants?: GrantRow[]
  locks?: LockRow[]
  links?: LinkRow[]
  attachments?: AttachmentRow[]
  users?: UserRow[]
} = {}) {
  const docs = data.docs ?? []
  const folders = data.folders ?? []
  const grants = data.grants ?? []
  const locks = data.locks ?? []
  const links = data.links ?? []
  const attachments = data.attachments ?? []
  const users = data.users ?? []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                return (docs.find((d) => d.id === id && d.owner_id === ownerId) as T) ?? null
              }
              if (sql.startsWith('SELECT id, e2ee_key FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                const row = docs.find((d) => d.id === id && d.owner_id === ownerId)
                return (row ? { id: row.id, e2ee_key: null } : null) as T | null
              }
              if (sql.startsWith('SELECT * FROM docs WHERE id = ?')) {
                const [id] = args as [string]
                return (docs.find((d) => d.id === id) as T) ?? null
              }
              if (sql.startsWith('SELECT role FROM grants')) {
                const [targetType, targetId, email] = args as [string, string, string]
                const row = grants.find((g) => g.target_type === targetType && g.target_id === targetId && g.grantee_email === email)
                return (row ? { role: row.role } : null) as T | null
              }
              if (sql.startsWith('SELECT parent_id FROM folders')) {
                const [id] = args as [string]
                const row = folders.find((f) => f.id === id)
                return (row ? { parent_id: row.parent_id } : null) as T | null
              }
              if (sql.startsWith('SELECT * FROM folders WHERE id = ?')) {
                const [id] = args as [string]
                return (folders.find((f) => f.id === id) as T) ?? null
              }
              if (sql.startsWith('SELECT * FROM doc_locks WHERE doc_id = ?')) {
                const [docId] = args as [string]
                return (locks.find((l) => l.doc_id === docId) as T) ?? null
              }
              if (sql.startsWith('SELECT * FROM share_links WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL')) {
                const [targetType, targetId] = args as [string, string]
                return (links.find((l) => l.target_type === targetType && l.target_id === targetId && !l.revoked_at) as T) ?? null
              }
              if (sql.startsWith('SELECT COALESCE(SUM(size),0)')) {
                const [ownerId] = args as [string]
                const used = attachments.filter((a) => a.owner_id === ownerId).reduce((sum, a) => sum + a.size, 0)
                return { used } as T
              }
              if (sql.startsWith('SELECT write_day')) {
                const [id] = args as [string]
                const row = users.find((u) => u.id === id)
                if (!row) return null
                return {
                  write_day: row.write_day ?? null,
                  write_count: row.write_count ?? 0,
                  content_bytes: row.content_bytes ?? 0,
                  doc_count: row.doc_count ?? 0,
                  blocked_at: row.blocked_at ?? null,
                  warned_at: row.warned_at ?? null,
                } as T
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key, attachment_refs FROM docs')) {
                const [ownerId] = args as [string]
                return { results: docs.filter((d) => d.owner_id === ownerId) as T[] }
              }
              if (sql.startsWith('SELECT id, name, parent_id FROM folders')) {
                const [ownerId] = args as [string]
                return { results: folders.filter((f) => f.owner_id === ownerId).map((f) => ({ id: f.id, name: f.name, parent_id: f.parent_id })) as T[] }
              }
              if (sql.startsWith('SELECT * FROM folders WHERE owner_id = ?')) {
                const [ownerId] = args as [string]
                return { results: folders.filter((f) => f.owner_id === ownerId) as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO docs')) {
                const [id, ownerId, title, content, lineEnding, folderId, pinnedAt, version, createdAt, updatedAt] = args as [
                  string, string, string, string, 'crlf' | 'lf', string | null, number | null, number, number, number,
                ]
                docs.push({ id, owner_id: ownerId, title, content, line_ending: lineEnding, folder_id: folderId, pinned_at: pinnedAt, version, created_at: createdAt, updated_at: updatedAt })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE docs SET title')) {
                const [title, content, version, updatedAt, id, ownerId, baseVersion] = args as [
                  string, string, number, number, string, string, number,
                ]
                const row = docs.find((d) => d.id === id && d.owner_id === ownerId && d.version === baseVersion)
                if (!row) return { meta: { changes: 0 } }
                row.title = title
                row.content = content
                row.version = version
                row.updated_at = updatedAt
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('INSERT INTO folders')) {
                const [id, ownerId, name, parentId, createdAt, updatedAt] = args as [string, string, string, string | null, number, number]
                folders.push({ id, owner_id: ownerId, name, parent_id: parentId, created_at: createdAt, updated_at: updatedAt })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('INSERT INTO share_links')) {
                const [token, ownerId, targetType, targetId, createdAt] = args as [string, string, 'doc' | 'folder', string, number]
                links.push({ token, owner_id: ownerId, target_type: targetType, target_id: targetId, created_at: createdAt, revoked_at: null })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('INSERT INTO attachments')) {
                const [ownerId, id, ext, mime, size, width, height, createdAt] = args as [
                  string, string, string, string, number, number, number, number,
                ]
                attachments.push({ owner_id: ownerId, id, ext, mime, size, width, height, created_at: createdAt })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE docs SET folder_id = ? WHERE folder_id = ? AND owner_id = ?')) {
                const [parentId, folderId, ownerId] = args as [string | null, string, string]
                for (const d of docs) if (d.folder_id === folderId && d.owner_id === ownerId) d.folder_id = parentId
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND owner_id = ?')) {
                const [parentId, id, ownerId] = args as [string | null, string, string]
                for (const f of folders) if (f.parent_id === id && f.owner_id === ownerId) f.parent_id = parentId
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('DELETE FROM folders WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                const idx = folders.findIndex((f) => f.id === id && f.owner_id === ownerId)
                if (idx >= 0) folders.splice(idx, 1)
                return { meta: { changes: idx >= 0 ? 1 : 0 } }
              }
              if (sql.startsWith('DELETE FROM docs WHERE owner_id = ? AND folder_id IN')) {
                const [ownerId, ...ids] = args as string[]
                let changes = 0
                for (let i = docs.length - 1; i >= 0; i--) {
                  if (docs[i].owner_id === ownerId && ids.includes(docs[i].folder_id as string)) {
                    docs.splice(i, 1)
                    changes++
                  }
                }
                return { meta: { changes } }
              }
              if (sql.startsWith('DELETE FROM folders WHERE owner_id = ? AND id IN')) {
                const [ownerId, ...ids] = args as string[]
                let changes = 0
                for (let i = folders.length - 1; i >= 0; i--) {
                  if (folders[i].owner_id === ownerId && ids.includes(folders[i].id)) {
                    folders.splice(i, 1)
                    changes++
                  }
                }
                return { meta: { changes } }
              }
              if (sql.startsWith('UPDATE users SET')) return { meta: { changes: 1 } }
              throw new Error(`unhandled run sql: ${sql}`)
            },
          }
        },
      }
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      const results = []
      for (const s of statements) results.push(await s.run())
      return results
    },
  }

  const putCalls: string[] = []
  const BUCKET = { async put(key: string) { putCalls.push(key) } }

  return { env: { DB, BUCKET } as unknown as Env, docs, folders, grants, locks, links, attachments, putCalls }
}

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes.set([0, 0, 0, 3], 16)
  bytes.set([0, 0, 0, 2], 20)
  return bytes
}

function svgBytes(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
}

describe('F-223 A1 POST /v1/docs', () => {
  it('원문 그대로 저장하고 CRLF 면 lineEnding 을 crlf 로 판정한다', async () => {
    const { env, docs } = makeEnv()
    const res = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', { method: 'POST', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ title: '제목', content: '# 안녕\r\n본문' }) }),
      env,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { content: string; lineEnding: string; id: string }
    expect(body.content).toBe('# 안녕\r\n본문')
    expect(body.lineEnding).toBe('crlf')
    expect(docs[0].content).toBe('# 안녕\r\n본문')
  })

  it('CRLF 없으면 lf 로 판정한다', async () => {
    const { env } = makeEnv()
    const res = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', { method: 'POST', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ title: '제목', content: '# 안녕\n본문' }) }),
      env,
    )
    const body = (await res.json()) as { lineEnding: string }
    expect(body.lineEnding).toBe('lf')
  })

  it('id 몸통은 400', async () => {
    const { env } = makeEnv()
    const res = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', { method: 'POST', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ title: '제목', content: 'x', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }) }),
      env,
    )
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string; field: string }).toEqual({ error: 'invalid', field: 'id' })
  })

  it('GET 이 돌려주는 content 는 보낸 것과 같다', async () => {
    const { env } = makeEnv()
    const created = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', { method: 'POST', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ title: '제목', content: '줄1\r\n줄2\r\n' }) }),
      env,
    )
    const { id } = (await created.json()) as { id: string }
    const res = await handleGetDoc(new Request(`http://local.test/v1/docs/${id}`, { headers: { 'x-test-user': 'u1' } }), env, {} as ExecutionContext, { id })
    const body = (await res.json()) as { content: string }
    expect(body.content).toBe('줄1\r\n줄2\r\n')
  })
})

describe('F-223 A1 PUT /v1/docs/:id', () => {
  function baseDoc(overrides: Partial<DocRow> = {}): DocRow {
    return {
      id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf',
      folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1,
      ...overrides,
    }
  }

  it('baseVersion 불일치면 409', async () => {
    const { env } = makeEnv({ docs: [baseDoc()] })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', { method: 'PUT', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ content: 'new', baseVersion: 99 }) }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(409)
  })

  it('잠금이 있으면 X-Lock-Session 을 보내도 항상 423', async () => {
    const { env } = makeEnv({ docs: [baseDoc()], locks: [{ doc_id: 'd1', user_id: 'other', email: 'other@example.com', session_id: 'sess-1', expires_at: Date.now() + 60_000 }] })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', { method: 'PUT', headers: { 'x-test-user': 'u1', 'X-Lock-Session': 'sess-1' }, body: JSON.stringify({ content: 'new', baseVersion: 1 }) }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(423)
  })

  it('남의 문서는 404', async () => {
    const { env } = makeEnv({ docs: [baseDoc({ owner_id: 'owner-2' })] })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', { method: 'PUT', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ content: 'new', baseVersion: 1 }) }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(404)
  })

  it('보기 권한만 있으면 403', async () => {
    const { env } = makeEnv({
      docs: [baseDoc({ owner_id: 'owner-2' })],
      grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: 'u1@example.com', role: 'view' }],
    })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', { method: 'PUT', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ content: 'new', baseVersion: 1 }) }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(403)
  })

  it('편집 권한 공유 문서는 고칠 수 있다', async () => {
    const { env, docs } = makeEnv({
      docs: [baseDoc({ owner_id: 'owner-2' })],
      grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: 'u1@example.com', role: 'edit' }],
    })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', { method: 'PUT', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ content: 'new content', baseVersion: 1 }) }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(200)
    expect(docs[0].content).toBe('new content')
  })
})

describe('F-308 A1~A8 /v1 PUT 을 DO 경유로', () => {
  function baseDoc(overrides: Partial<DocRow> = {}): DocRow {
    return {
      id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf',
      folder_id: 'f1', pinned_at: 11, version: 3, created_at: 12, updated_at: 13,
      ...overrides,
    }
  }

  function put(body: unknown, headers: Record<string, string> = {}) {
    return new Request('http://local.test/v1/docs/d1', {
      method: 'PUT',
      headers: { 'x-test-user': 'u1', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  function callV1(env: Env, body: unknown, headers: Record<string, string> = {}) {
    return handleUpdateDocV1(put(body, headers), env, {} as ExecutionContext, { id: 'd1' })
  }

  function watchUpdates(env: Env) {
    const sqls: string[] = []
    const prepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = ((sql: string) => {
      sqls.push(sql)
      return prepare(sql)
    }) as typeof env.DB.prepare
    return () => sqls.filter((s) => s.startsWith('UPDATE'))
  }

  const room = vi.mocked(writeTextInRoom)
  const okResult: RoomTextWriteResult = { type: 'ok', doc: { title: 'T2', content: 'new', version: 4, updatedAt: 99 } }

  beforeEach(() => {
    room.mockReset()
    room.mockImplementation(async () => null)
  })

  afterEach(() => {
    room.mockImplementation(async () => null)
  })

  it('A1 본문 400·413, 남의 문서 404, 보기 권한 403, D1 잠금 423 이 먼저 — writeTextInRoom 호출 0', async () => {
    room.mockImplementation(async () => okResult)
    const view: GrantRow = { target_type: 'doc', target_id: 'd1', grantee_email: 'u1@example.com', role: 'view' }
    const cases: [DocRow[], GrantRow[], unknown, number][] = [
      [[baseDoc()], [], 'not json', 400],
      [[baseDoc()], [], { content: 'x' }, 400],
      [[baseDoc()], [], { content: 'x'.repeat(1_000_001), baseVersion: 3 }, 413],
      [[baseDoc({ owner_id: 'owner-2', folder_id: null })], [], { content: 'x', baseVersion: 3 }, 404],
      [[baseDoc({ owner_id: 'owner-2', folder_id: null })], [view], { content: 'x', baseVersion: 3 }, 403],
    ]
    for (const [docs, grants, body, status] of cases) {
      const { env } = makeEnv({ docs, grants })
      const res = await callV1(env, body)
      expect(res.status).toBe(status)
    }
    const expiresAt = Date.now() + 60_000
    const { env } = makeEnv({ docs: [baseDoc()], locks: [{ doc_id: 'd1', user_id: 'other', email: 'other@example.com', session_id: 's', expires_at: expiresAt }] })
    const locked = await callV1(env, { content: 'x', baseVersion: 3 })
    expect(locked.status).toBe(423)
    expect(await locked.json()).toEqual({ error: 'locked', email: 'other@example.com', expiresAt })
    expect(room).not.toHaveBeenCalled()
  })

  it('A2 낡은 baseVersion + 다른 content → 409(행), 호출 0. content 가 행과 같으면 DO 로 간다', async () => {
    room.mockImplementation(async () => okResult)
    const { env, docs } = makeEnv({ docs: [baseDoc()] })
    const res = await callV1(env, { content: 'other', baseVersion: 1 })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'conflict',
      doc: { id: 'd1', title: 't', content: 'c', lineEnding: 'lf', folderId: 'f1', pinnedAt: 11, version: 3, createdAt: 12, updatedAt: 13 },
    })
    expect(room).not.toHaveBeenCalled()
    expect(docs[0].version).toBe(3)

    await callV1(env, { content: 'c', baseVersion: 1 })
    expect(room).toHaveBeenCalledTimes(1)
  })

  it('A3 줄바꿈을 문서 line_ending 에 맞춰 넘기고, 맞춘 값이 1MB 를 넘으면 413', async () => {
    room.mockImplementation(async () => okResult)
    const crlf = makeEnv({ docs: [baseDoc({ line_ending: 'crlf' })] })
    await callV1(crlf.env, { content: 'a\nb', baseVersion: 3 })
    expect(room).toHaveBeenLastCalledWith(crlf.env, 'd1', { content: 'a\r\nb', baseVersion: 3, docVersion: 3 })

    const lf = makeEnv({ docs: [baseDoc({ line_ending: 'lf' })] })
    await callV1(lf.env, { content: 'a\r\nb', baseVersion: 3 })
    expect(room).toHaveBeenLastCalledWith(lf.env, 'd1', { content: 'a\nb', baseVersion: 3, docVersion: 3 })

    room.mockClear()
    const big = makeEnv({ docs: [baseDoc({ line_ending: 'crlf' })] })
    const res = await callV1(big.env, { content: 'x'.repeat(999_998) + '\n\n', baseVersion: 3 })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large', limit: 1_000_000 })
    expect(room).not.toHaveBeenCalled()
  })

  it('A4 ok → 200, 키 집합이 V1_EXAMPLES.doc, 결과 값 + 행 값, updatedAt 이 null 이면 행 값', async () => {
    room.mockImplementation(async () => okResult)
    const { env } = makeEnv({ docs: [baseDoc()] })
    const res = await callV1(env, { title: 'T2', content: 'new', baseVersion: 3 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(Object.keys(V1_EXAMPLES.doc).sort())
    expect(body).toEqual({ id: 'd1', title: 'T2', content: 'new', lineEnding: 'lf', folderId: 'f1', pinnedAt: 11, version: 4, createdAt: 12, updatedAt: 99 })

    room.mockImplementation(async () => ({ type: 'ok', doc: { title: 't', content: 'new', version: 4, updatedAt: null } }))
    const again = await callV1(env, { content: 'new', baseVersion: 3 })
    expect(((await again.json()) as { updatedAt: number }).updatedAt).toBe(13)
  })

  it('A5 conflict·too_large·not_found·unavailable 매핑, 어느 경우도 D1 UPDATE 0', async () => {
    const cases: [RoomTextWriteResult, number, unknown][] = [
      [
        { type: 'conflict', doc: { title: 't', content: 'live', version: 5, updatedAt: null } },
        409,
        { error: 'conflict', doc: { id: 'd1', title: 't', content: 'live', lineEnding: 'lf', folderId: 'f1', pinnedAt: 11, version: 5, createdAt: 12, updatedAt: 13 } },
      ],
      [{ type: 'too_large', bytes: 1_000_001 }, 413, { error: 'too_large', limit: 1_000_000 }],
      [{ type: 'not_found' }, 404, { error: 'not_found' }],
      [{ type: 'unavailable' }, 503, { error: 'unavailable' }],
    ]
    for (const [result, status, body] of cases) {
      room.mockImplementation(async () => result)
      const { env, docs } = makeEnv({ docs: [baseDoc()] })
      const updates = watchUpdates(env)
      const res = await callV1(env, { content: 'new', baseVersion: 3 })
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual(body)
      expect(updates()).toHaveLength(0)
      expect(docs[0].version).toBe(3)
    }
  })

  it('A6 writeTextInRoom 이 null 이면 D1 직접 쓰기 — 맞춘 본문, version +1', async () => {
    const { env, docs } = makeEnv({ docs: [baseDoc({ line_ending: 'crlf' })] })
    const res = await callV1(env, { content: 'a\nb', baseVersion: 3 })
    expect(res.status).toBe(200)
    expect(docs[0].content).toBe('a\r\nb')
    expect(docs[0].version).toBe(4)
    expect(((await res.json()) as { content: string; version: number })).toMatchObject({ content: 'a\r\nb', version: 4 })
    expect(room).toHaveBeenCalledTimes(1)
  })

  it('A7 423 은 D1 잠금뿐 — /api PUT 은 writeTextInRoom 을 부르지 않는다', async () => {
    const results: (RoomTextWriteResult | null)[] = [
      okResult,
      { type: 'conflict', doc: { title: 't', content: 'c', version: 3, updatedAt: null } },
      { type: 'too_large', bytes: 1 },
      { type: 'not_found' },
      { type: 'unavailable' },
      null,
    ]
    for (const result of results) {
      room.mockImplementation(async () => result)
      const { env } = makeEnv({ docs: [baseDoc()] })
      const res = await callV1(env, { content: 'new', baseVersion: 3 })
      expect(res.status).not.toBe(423)
    }

    room.mockClear()
    const { env, docs } = makeEnv({ docs: [baseDoc()] })
    const res = await handleUpdateDoc(put({ content: 'api', baseVersion: 3 }), env, {} as ExecutionContext, { id: 'd1' })
    expect(res.status).toBe(200)
    expect(docs[0].content).toBe('api')
    expect(room).not.toHaveBeenCalled()
  })

  it('A8 X-Lock-Session 을 보내도 D1 잠금이 있으면 423, DO 를 부르지 않는다', async () => {
    room.mockImplementation(async () => okResult)
    const { env } = makeEnv({ docs: [baseDoc()], locks: [{ doc_id: 'd1', user_id: 'other', email: 'other@example.com', session_id: 'sess-1', expires_at: Date.now() + 60_000 }] })
    const res = await callV1(env, { content: 'new', baseVersion: 3 }, { 'X-Lock-Session': 'sess-1' })
    expect(res.status).toBe(423)
    expect(room).not.toHaveBeenCalled()
  })

  it('V1 소유자 누계 한도에서 늘리는 본문은 413, writeTextInRoom 호출 0 (F-308 A1 과 같은 방식, F-2025 6.3)', async () => {
    room.mockImplementation(async () => okResult)
    const { env } = makeEnv({
      docs: [baseDoc()],
      users: [{ id: 'u1', content_bytes: DOC_BYTES_QUOTA - 1 }],
    })
    const res = await callV1(env, { content: 'ccc', baseVersion: 3 })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'doc_quota_exceeded', resource: 'bytes', used: DOC_BYTES_QUOTA - 1, limit: DOC_BYTES_QUOTA })
    expect(room).not.toHaveBeenCalled()
  })

  it('F-2028 V3 소유자가 막힌 문서에 편집 권한자가 PUT → 403 account_blocked, DO 를 부르지 않는다. 풀면 200', async () => {
    room.mockImplementation(async () => okResult)
    const users: UserRow[] = [{ id: 'u1', blocked_at: 1 }]
    const edit: GrantRow = { target_type: 'doc', target_id: 'd1', grantee_email: 'u2@example.com', role: 'edit' }
    const { env, docs } = makeEnv({ docs: [baseDoc({ folder_id: null })], grants: [edit], users })
    const blocked = await callV1(env, { content: 'new', baseVersion: 3 }, { 'x-test-user': 'u2' })
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ error: 'account_blocked' })
    expect(room).not.toHaveBeenCalled()
    expect(docs[0]).toEqual(baseDoc({ folder_id: null }))

    users[0].blocked_at = null
    const ok = await callV1(env, { content: 'new', baseVersion: 3 }, { 'x-test-user': 'u2' })
    expect(ok.status).toBe(200)
    expect(room).toHaveBeenCalledTimes(1)
  })

  it('V2 같은 상태 + 낡은 baseVersion + 늘리는 본문 → 413 (409 아님 — 6.3 자리)', async () => {
    room.mockImplementation(async () => okResult)
    const { env } = makeEnv({
      docs: [baseDoc()],
      users: [{ id: 'u1', content_bytes: DOC_BYTES_QUOTA - 1 }],
    })
    const res = await callV1(env, { content: 'ccc', baseVersion: 1 })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'doc_quota_exceeded', resource: 'bytes', used: DOC_BYTES_QUOTA - 1, limit: DOC_BYTES_QUOTA })
    expect(room).not.toHaveBeenCalled()
  })
})

describe('F-223 A2 POST /v1/attachments', () => {
  it('PNG 바이트를 올리면 201 + markdown 3줄', async () => {
    const { env, putCalls } = makeEnv()
    const bytes = pngBytes()
    const res = await handleCreateAttachmentV1(
      new Request('http://local.test/v1/attachments', { method: 'POST', headers: { 'x-test-user': 'u1', 'Content-Length': String(bytes.length) }, body: bytes }),
      env,
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; ext: string; markdown: string; width: number }
    expect(body.ext).toBe('png')
    const lines = body.markdown.split('\n')
    expect(lines.length).toBe(3)
    expect(lines[1]).toContain(`attachments/${body.id}.png`)
    expect(putCalls.length).toBe(1)
  })

  it('SVG 는 400', async () => {
    const { env } = makeEnv()
    const bytes = svgBytes()
    const res = await handleCreateAttachmentV1(
      new Request('http://local.test/v1/attachments', { method: 'POST', headers: { 'x-test-user': 'u1', 'Content-Length': String(bytes.length) }, body: bytes }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('계정 한도를 넘으면 507', async () => {
    const { env } = makeEnv({ attachments: [{ owner_id: 'u1', id: 'existing', ext: 'png', mime: 'image/png', size: 314_572_800 - 10, width: 1, height: 1, created_at: 1 }] })
    const bytes = pngBytes()
    const res = await handleCreateAttachmentV1(
      new Request('http://local.test/v1/attachments', { method: 'POST', headers: { 'x-test-user': 'u1', 'Content-Length': String(bytes.length) }, body: bytes }),
      env,
    )
    expect(res.status).toBe(507)
  })
})

describe('F-223 A3 POST /v1/docs/:id/link', () => {
  it('두 번 요청해도 같은 토큰', async () => {
    const { env } = makeEnv({ docs: [{ id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 }] })
    const req = () => new Request('http://local.test/v1/docs/d1/link', { method: 'POST', headers: { 'x-test-user': 'u1' } })
    const res1 = await handleCreateDocLinkV1(req(), env, {} as ExecutionContext, { id: 'd1' })
    const body1 = (await res1.json()) as { token: string; url: string }
    const res2 = await handleCreateDocLinkV1(req(), env, {} as ExecutionContext, { id: 'd1' })
    const body2 = (await res2.json()) as { token: string; url: string }
    expect(body1.token).toBe(body2.token)
    expect(body1.url).toContain(body1.token)
  })

  it('남의 문서는 404', async () => {
    const { env } = makeEnv({ docs: [{ id: 'd1', owner_id: 'owner-2', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 }] })
    const res = await handleCreateDocLinkV1(
      new Request('http://local.test/v1/docs/d1/link', { method: 'POST', headers: { 'x-test-user': 'u1' } }),
      env, {} as ExecutionContext, { id: 'd1' },
    )
    expect(res.status).toBe(404)
  })
})

describe('F-223 A3 폴더', () => {
  it('POST 로 만들고 GET 목록에 보인다', async () => {
    const { env } = makeEnv()
    const created = await handleCreateFolder(
      new Request('http://local.test/v1/folders', { method: 'POST', headers: { 'x-test-user': 'u1' }, body: JSON.stringify({ name: '새 폴더' }) }),
      env,
    )
    expect(created.status).toBe(201)
    const res = await handleListFolders(new Request('http://local.test/v1/folders', { headers: { 'x-test-user': 'u1' } }), env)
    const body = (await res.json()) as { name: string }[]
    expect(body.map((f) => f.name)).toContain('새 폴더')
  })
})

describe('F-242 A7 DELETE /api/folders/:id — contents', () => {
  function baseFolder(overrides: Partial<FolderRow> = {}): FolderRow {
    return { id: 'top', owner_id: 'u1', name: '위', parent_id: null, created_at: 1, updated_at: 1, ...overrides }
  }

  it('질의 문자열이 없으면 move-up — 안의 문서·하위 폴더가 부모로 올라가고 대상 폴더만 지워진다', async () => {
    const { env, docs, folders } = makeEnv({
      folders: [baseFolder(), baseFolder({ id: 'sub', name: '아래', parent_id: 'top' })],
      docs: [{ id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: 'top', pinned_at: null, version: 1, created_at: 1, updated_at: 1 }],
    })
    const res = await handleDeleteFolder(
      new Request('http://local.test/api/folders/top', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }),
      env, {} as ExecutionContext, { id: 'top' },
    )
    expect(res.status).toBe(204)
    expect(folders.find((f) => f.id === 'top')).toBeUndefined()
    expect(folders.find((f) => f.id === 'sub')!.parent_id).toBeNull()
    expect(docs.find((d) => d.id === 'd1')!.folder_id).toBeNull()
  })

  it('contents=delete-all 이면 하위 문서·폴더가 D1 에서 사라진다', async () => {
    const { env, docs, folders } = makeEnv({
      folders: [
        baseFolder(),
        baseFolder({ id: 'sub', name: '아래', parent_id: 'top' }),
        baseFolder({ id: 'sibling', name: '형제', parent_id: null }),
      ],
      docs: [
        { id: 'd-top', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: 'top', pinned_at: null, version: 1, created_at: 1, updated_at: 1 },
        { id: 'd-sub', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: 'sub', pinned_at: null, version: 1, created_at: 1, updated_at: 1 },
        { id: 'd-outside', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 },
      ],
    })
    const res = await handleDeleteFolder(
      new Request('http://local.test/api/folders/top?contents=delete-all', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }),
      env, {} as ExecutionContext, { id: 'top' },
    )
    expect(res.status).toBe(204)
    expect(folders.map((f) => f.id)).toEqual(['sibling'])
    expect(docs.map((d) => d.id)).toEqual(['d-outside'])
  })

  it('잘못된 contents 값은 400', async () => {
    const { env } = makeEnv({ folders: [baseFolder()] })
    const res = await handleDeleteFolder(
      new Request('http://local.test/api/folders/top?contents=wrong', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }),
      env, {} as ExecutionContext, { id: 'top' },
    )
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string; field: string }).toEqual({ error: 'invalid', field: 'contents' })
  })

  it('남의 폴더는 404', async () => {
    const { env } = makeEnv({ folders: [baseFolder({ owner_id: 'owner-2' })] })
    const res = await handleDeleteFolder(
      new Request('http://local.test/api/folders/top?contents=delete-all', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }),
      env, {} as ExecutionContext, { id: 'top' },
    )
    expect(res.status).toBe(404)
  })
})

describe('F-223 A1 GET /v1/docs', () => {
  it('내 문서 요약 목록을 돌려준다', async () => {
    const { env } = makeEnv({ docs: [{ id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 }] })
    const res = await handleListDocs(new Request('http://local.test/v1/docs', { headers: { 'x-test-user': 'u1' } }), env)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((d) => d.id)).toEqual(['d1'])
  })
})

describe('F-223 A4 /v1 라우팅 — 실제 auth 로 확인', () => {
  async function freshWorker() {
    vi.doUnmock('./auth')
    // index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
    vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
    vi.resetModules()
    const mod = await import('./index')
    return mod.default
  }

  function dummyEnv(): Env {
    const DB = { prepare() { throw new Error('should not query DB') } }
    return { DB } as unknown as Env
  }

  it('토큰 없으면 401', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(new Request('https://app.example.com/v1/docs'), dummyEnv(), {} as ExecutionContext)
    expect(res.status).toBe(401)
    expect((await res.json()) as { error: string }).toEqual({ error: 'unauthenticated' })
  })

  it('Access 쿠키만 있으면 401', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(
      new Request('https://app.example.com/v1/docs', { headers: { Cookie: 'CF_Authorization=whatever' } }),
      dummyEnv(),
      {} as ExecutionContext,
    )
    expect(res.status).toBe(401)
  })

  it('OPTIONS 는 405', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(new Request('https://app.example.com/v1/docs', { method: 'OPTIONS' }), dummyEnv(), {} as ExecutionContext)
    expect(res.status).toBe(405)
  })

  it('응답에 Access-Control-Allow-Origin 이 없다', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(new Request('https://app.example.com/v1/docs'), dummyEnv(), {} as ExecutionContext)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

// F-2021 U14 (specs/features/F-2021.md 13.1, 7.1)
describe('F-2021 U14 GET /v1/me — 실제 auth 로 확인', () => {
  type MeApiTokenRow = { id: string; user_id: string; token_hash: string; revoked_at: number | null; last_used_at: number | null }
  type MeUserRow = { id: string; email: string }

  async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  function makeMeEnv(opts: { tokens?: MeApiTokenRow[]; users?: MeUserRow[] } = {}): Env {
    const tokens = opts.tokens ?? []
    const users = opts.users ?? []
    const DB = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>() {
                if (sql.startsWith('SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = ?')) {
                  const [hash] = args as [string]
                  const row = tokens.find((t) => t.token_hash === hash && !t.revoked_at)
                  return (row ? { id: row.id, user_id: row.user_id, last_used_at: row.last_used_at } : null) as T | null
                }
                if (sql.startsWith('SELECT id, email, write_day')) {
                  const [id] = args as [string]
                  const user = users.find((u) => u.id === id)
                  if (!user) return null
                  return {
                    id: user.id,
                    email: user.email,
                    write_day: null,
                    write_count: 0,
                    content_bytes: 0,
                    doc_count: 0,
                    blocked_at: null,
                    warned_at: null,
                  } as T
                }
                throw new Error(`unhandled first sql: ${sql}`)
              },
              async run() {
                if (sql.startsWith('UPDATE api_tokens SET last_used_at')) return { meta: { changes: 1 } }
                throw new Error(`unhandled run sql: ${sql}`)
              },
            }
          },
        }
      },
    }
    return { DB } as unknown as Env
  }

  async function freshWorker() {
    vi.doUnmock('./auth')
    vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
    vi.resetModules()
    const mod = await import('./index')
    return mod.default
  }

  it('토큰 없으면 401', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(new Request('https://app.example.com/v1/me'), makeMeEnv(), {} as ExecutionContext)
    expect(res.status).toBe(401)
    expect((await res.json()) as { error: string }).toEqual({ error: 'unauthenticated' })
  })

  it('Access 쿠키만 있으면 401 — /v1/ 은 Bearer 만 본다', async () => {
    const worker = await freshWorker()
    const res = await worker.fetch(
      new Request('https://app.example.com/v1/me', { headers: { Cookie: 'CF_Authorization=whatever' } }),
      makeMeEnv(),
      {} as ExecutionContext,
    )
    expect(res.status).toBe(401)
  })

  it('올바른 Bearer 토큰이면 { id, email }', async () => {
    const token = `rd_${'a'.repeat(43)}`
    const hash = await sha256Hex(token)
    const env = makeMeEnv({
      tokens: [{ id: 't1', user_id: 'u1', token_hash: hash, revoked_at: null, last_used_at: null }],
      users: [{ id: 'u1', email: 'a@b.com' }],
    })
    const worker = await freshWorker()
    const res = await worker.fetch(
      new Request('https://app.example.com/v1/me', { headers: { Authorization: `Bearer ${token}` } }),
      env,
      {} as ExecutionContext,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'u1', email: 'a@b.com', blocked: false, warned: false })
  })
})

// F-2021 U15 (specs/features/F-2021.md 13.1, 7.2)
describe('F-2021 U15 /v1 응답 키 집합 = V1_EXAMPLES', () => {
  function keysOf(obj: unknown): string[] {
    return Object.keys(obj as object).sort()
  }

  it('POST /v1/docs, GET /v1/docs/:id, GET /v1/docs', async () => {
    const { env } = makeEnv()
    const created = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', {
        method: 'POST',
        headers: { 'x-test-user': 'u1' },
        body: JSON.stringify({ title: 't', content: 'c' }),
      }),
      env,
    )
    const doc = (await created.json()) as Record<string, unknown>
    expect(keysOf(doc)).toEqual(keysOf(V1_EXAMPLES.doc))

    const got = await handleGetDoc(
      new Request(`http://local.test/v1/docs/${doc.id}`, { headers: { 'x-test-user': 'u1' } }),
      env,
      {} as ExecutionContext,
      { id: doc.id as string },
    )
    expect(keysOf(await got.json())).toEqual(keysOf(V1_EXAMPLES.doc))

    const list = await handleListDocs(new Request('http://local.test/v1/docs', { headers: { 'x-test-user': 'u1' } }), env)
    const listBody = (await list.json()) as Record<string, unknown>[]
    expect(keysOf(listBody[0])).toEqual(keysOf(V1_EXAMPLES.docSummary))
  })

  it('PUT /v1/docs/:id', async () => {
    const { env } = makeEnv({
      docs: [{ id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 }],
    })
    const res = await handleUpdateDocV1(
      new Request('http://local.test/v1/docs/d1', {
        method: 'PUT',
        headers: { 'x-test-user': 'u1' },
        body: JSON.stringify({ content: 'new', baseVersion: 1 }),
      }),
      env,
      {} as ExecutionContext,
      { id: 'd1' },
    )
    expect(keysOf(await res.json())).toEqual(keysOf(V1_EXAMPLES.doc))
  })

  it('GET·POST /v1/folders', async () => {
    const { env } = makeEnv()
    const created = await handleCreateFolder(
      new Request('http://local.test/v1/folders', {
        method: 'POST',
        headers: { 'x-test-user': 'u1' },
        body: JSON.stringify({ name: 'f' }),
      }),
      env,
    )
    expect(keysOf(await created.json())).toEqual(keysOf(V1_EXAMPLES.folder))
    const list = await handleListFolders(new Request('http://local.test/v1/folders', { headers: { 'x-test-user': 'u1' } }), env)
    const listBody = (await list.json()) as Record<string, unknown>[]
    expect(keysOf(listBody[0])).toEqual(keysOf(V1_EXAMPLES.folder))
  })

  it('POST /v1/attachments', async () => {
    const { env } = makeEnv()
    const bytes = pngBytes()
    const res = await handleCreateAttachmentV1(
      new Request('http://local.test/v1/attachments', {
        method: 'POST',
        headers: { 'x-test-user': 'u1', 'Content-Length': String(bytes.length) },
        body: bytes,
      }),
      env,
    )
    expect(keysOf(await res.json())).toEqual(keysOf(V1_EXAMPLES.attachment))
  })

  it('POST /v1/docs/:id/link', async () => {
    const { env } = makeEnv({
      docs: [{ id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf', folder_id: null, pinned_at: null, version: 1, created_at: 1, updated_at: 1 }],
    })
    const res = await handleCreateDocLinkV1(
      new Request('http://local.test/v1/docs/d1/link', { method: 'POST', headers: { 'x-test-user': 'u1' } }),
      env,
      {} as ExecutionContext,
      { id: 'd1' },
    )
    expect(keysOf(await res.json())).toEqual(keysOf(V1_EXAMPLES.link))
  })
})
