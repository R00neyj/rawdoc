// F-223 자동 업로드 API '/v1' 단위 테스트 (specs/features/F-223.md 3장)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import {
  handleCreateAttachmentV1,
  handleCreateDocLinkV1,
  handleCreateDocV1,
  handleUpdateDocV1,
} from './v1'
import { handleGetDoc, handleListDocs } from './docs'
import { handleCreateFolder, handleDeleteFolder, handleListFolders } from './folders'

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

function makeEnv(data: {
  docs?: DocRow[]
  folders?: FolderRow[]
  grants?: GrantRow[]
  locks?: LockRow[]
  links?: LinkRow[]
  attachments?: AttachmentRow[]
} = {}) {
  const docs = data.docs ?? []
  const folders = data.folders ?? []
  const grants = data.grants ?? []
  const locks = data.locks ?? []
  const links = data.links ?? []
  const attachments = data.attachments ?? []

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
              if (sql.startsWith('SELECT id FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                const row = docs.find((d) => d.id === id && d.owner_id === ownerId)
                return (row ? { id: row.id } : null) as T | null
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
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at FROM docs')) {
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
