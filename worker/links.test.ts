// F-259 위키링크 묶음 공유 링크, 묶음 바뀌어도 주소 유지 (specs/features/F-259.md 3장)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleCreateDocLink, handlePublicGetDocSet, handlePublicGetFolder, handlePublicGetFolderDoc } from './links'

type LinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  created_at: number
  revoked_at: number | null
}
type DocRow = { id: string; owner_id: string; title: string; content?: string; folder_id?: string | null; updated_at?: number }
type FolderRow = { id: string; owner_id: string; name: string; parent_id: string | null }

function makeEnv({ docs = [], links = [], folders = [] }: { docs?: DocRow[]; links?: LinkRow[]; folders?: FolderRow[] } = {}) {
  const shareLinkDocs: { token: string; doc_id: string }[] = []
  const sqls: string[] = []

  const DB = {
    prepare(sql: string) {
      sqls.push(sql)
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT id, e2ee_key FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                const row = docs.find((d) => d.id === id && d.owner_id === ownerId)
                return (row ? { id: row.id, e2ee_key: null } : null) as T
              }
              if (sql.startsWith('SELECT * FROM share_links WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL')) {
                const [targetType, targetId] = args as ['doc' | 'folder', string]
                const row = links.find((l) => l.target_type === targetType && l.target_id === targetId && l.revoked_at === null)
                return (row ?? null) as T
              }
              if (sql.startsWith('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')) {
                const [token] = args as [string]
                const row = links.find((l) => l.token === token && l.revoked_at === null)
                return (row ?? null) as T
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT doc_id FROM share_link_docs WHERE token = ?')) {
                const [token] = args as [string]
                const results = shareLinkDocs.filter((r) => r.token === token).map((r) => ({ doc_id: r.doc_id }))
                return { results: results as T[] }
              }
              if (sql.startsWith('SELECT id, title FROM docs WHERE id IN')) {
                const results = docs.filter((d) => (args as string[]).includes(d.id)).map((d) => ({ id: d.id, title: d.title }))
                return { results: results as T[] }
              }
              if (sql.startsWith('SELECT id, content, folder_id FROM docs WHERE id IN')) {
                const results = docs
                  .filter((d) => (args as string[]).includes(d.id))
                  .map((d) => ({ id: d.id, content: d.content ?? '', folder_id: d.folder_id ?? null }))
                return { results: results as T[] }
              }
              if (sql.startsWith('SELECT id, title, folder_id FROM docs WHERE owner_id = ? ORDER BY updated_at DESC')) {
                const results = docs
                  .filter((d) => d.owner_id === args[0])
                  .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
                  .map((d) => ({ id: d.id, title: d.title, folder_id: d.folder_id ?? null }))
                return { results: results as T[] }
              }
              if (sql.startsWith('SELECT id, name, parent_id FROM folders WHERE owner_id = ?')) {
                return { results: folders.filter((f) => f.owner_id === args[0]) as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO share_links')) {
                const [token, ownerId, targetType, targetId, createdAt] = args as [string, string, 'doc' | 'folder', string, number]
                links.push({ token, owner_id: ownerId, target_type: targetType, target_id: targetId, created_at: createdAt, revoked_at: null })
                return {}
              }
              if (sql.startsWith('DELETE FROM share_link_docs WHERE token = ?')) {
                const [token] = args as [string]
                for (let i = shareLinkDocs.length - 1; i >= 0; i--) {
                  if (shareLinkDocs[i].token === token) shareLinkDocs.splice(i, 1)
                }
                return {}
              }
              if (sql.startsWith('INSERT INTO share_link_docs')) {
                const [token, docId] = args as [string, string]
                shareLinkDocs.push({ token, doc_id: docId })
                return {}
              }
              if (sql.startsWith('UPDATE share_links SET revoked_at')) {
                const [revokedAt, token] = args as [number, string]
                const row = links.find((l) => l.token === token)
                if (row) row.revoked_at = revokedAt
                return {}
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
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }

  return { env: { DB } as unknown as Env, links, shareLinkDocs, sqls }
}

function req(pathname: string, docIds?: string[]): Request {
  const init: RequestInit = { method: 'POST', headers: { 'x-test-user': 'u1' } }
  if (docIds !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify({ docIds })
  }
  return new Request(`http://local.test${pathname}`, init)
}

describe('F-259 A1 묶음이 바뀌어도 토큰 유지', () => {
  it('살아있는 링크가 있는 문서를 다른 docIds 로 다시 호출하면 같은 토큰, 이전 토큰이 계속 살아있다', async () => {
    const { env, links } = makeEnv({
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작' },
        { id: 'd2', owner_id: 'u1', title: '문서2' },
        { id: 'd3', owner_id: 'u1', title: '문서3' },
      ],
    })

    const res1 = await handleCreateDocLink(req('/api/docs/d1/link', ['d2']), env, {} as ExecutionContext, { id: 'd1' })
    expect(res1.status).toBe(201)
    const body1 = (await res1.json()) as { token: string }

    const res2 = await handleCreateDocLink(req('/api/docs/d1/link', ['d3']), env, {} as ExecutionContext, { id: 'd1' })
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { token: string }

    expect(body2.token).toBe(body1.token)
    const tokenRow = links.find((l) => l.token === body1.token)
    expect(tokenRow?.revoked_at).toBeNull()
  })
})

describe('F-259 A2 share_link_docs 갱신', () => {
  it('새 묶음으로 공개 목록을 조회하면 새로 체크한 문서만 나오고 뺀 문서는 없다', async () => {
    const { env } = makeEnv({
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작' },
        { id: 'd2', owner_id: 'u1', title: '문서2' },
        { id: 'd3', owner_id: 'u1', title: '문서3' },
      ],
    })

    const res1 = await handleCreateDocLink(req('/api/docs/d1/link', ['d2']), env, {} as ExecutionContext, { id: 'd1' })
    const { token } = (await res1.json()) as { token: string }

    await handleCreateDocLink(req('/api/docs/d1/link', ['d3']), env, {} as ExecutionContext, { id: 'd1' })

    const setRes = await handlePublicGetDocSet(new Request('http://local.test/pub/docs/' + token + '/set'), env, {} as ExecutionContext, { token })
    const setBody = (await setRes.json()) as { docs: { id: string }[] }
    const ids = setBody.docs.map((d) => d.id)
    expect(ids).toContain('d1')
    expect(ids).toContain('d3')
    expect(ids).not.toContain('d2')
  })

  it('체크 해제로 빈 묶음을 보내면 토큰은 그대로, 묶음만 비워진다', async () => {
    const { env } = makeEnv({
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작' },
        { id: 'd2', owner_id: 'u1', title: '문서2' },
      ],
    })

    const res1 = await handleCreateDocLink(req('/api/docs/d1/link', ['d2']), env, {} as ExecutionContext, { id: 'd1' })
    const { token } = (await res1.json()) as { token: string }

    const res2 = await handleCreateDocLink(req('/api/docs/d1/link', []), env, {} as ExecutionContext, { id: 'd1' })
    const body2 = (await res2.json()) as { token: string }
    expect(body2.token).toBe(token)

    const setRes = await handlePublicGetDocSet(new Request('http://local.test/pub/docs/' + token + '/set'), env, {} as ExecutionContext, { token })
    const setBody = (await setRes.json()) as { docs: { id: string }[] }
    expect(setBody.docs.map((d) => d.id)).toEqual(['d1'])
  })
})

describe('F-259 A3 새 링크는 지금처럼 새 토큰 발급', () => {
  it('살아있는 링크가 없는 문서에 docIds 를 보내면 201 로 새 토큰', async () => {
    const { env } = makeEnv({
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작' },
        { id: 'd2', owner_id: 'u1', title: '문서2' },
      ],
    })
    const res = await handleCreateDocLink(req('/api/docs/d1/link', ['d2']), env, {} as ExecutionContext, { id: 'd1' })
    expect(res.status).toBe(201)
  })
})

describe('F-259 묶음 정보 없는 호출(ShareMenu 단순 링크)', () => {
  it('기존 묶음이 있는 링크를 docIds 없이 다시 요청해도 묶음이 지워지지 않는다', async () => {
    const { env } = makeEnv({
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작' },
        { id: 'd2', owner_id: 'u1', title: '문서2' },
      ],
    })
    const res1 = await handleCreateDocLink(req('/api/docs/d1/link', ['d2']), env, {} as ExecutionContext, { id: 'd1' })
    const { token } = (await res1.json()) as { token: string }

    const res2 = await handleCreateDocLink(req('/api/docs/d1/link'), env, {} as ExecutionContext, { id: 'd1' })
    const body2 = (await res2.json()) as { token: string }
    expect(body2.token).toBe(token)

    const setRes = await handlePublicGetDocSet(new Request('http://local.test/pub/docs/' + token + '/set'), env, {} as ExecutionContext, { token })
    const setBody = (await setRes.json()) as { docs: { id: string }[] }
    expect(setBody.docs.map((d) => d.id)).toEqual(['d1', 'd2'])
  })
})

// ---------- F-2017 S3 공개 폴더 — 모든 자손 폴더 ----------
type TreeFolderRow = { id: string; owner_id: string; name: string; parent_id: string | null }
type TreeDocRow = {
  id: string
  owner_id: string
  title: string
  content: string
  line_ending: 'lf' | 'crlf'
  folder_id: string | null
  updated_at: number
}

const FOLDER_TOKEN = 'F'.repeat(43)

function makeFolderEnv(folders: TreeFolderRow[], docs: TreeDocRow[]) {
  const link: LinkRow = { token: FOLDER_TOKEN, owner_id: 'u1', target_type: 'folder', target_id: 'L', created_at: 1, revoked_at: null }
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          // D1 한 질의의 바인딩 인자 한도를 흉내 낸다 (F-2017 가정 G2)
          if (args.length > 100) throw new Error(`too many bindings: ${args.length}`)
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')) {
                return (args[0] === link.token ? link : null) as T
              }
              if (sql.startsWith('SELECT title, content, line_ending, updated_at, folder_id FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                return (docs.find((d) => d.id === id && d.owner_id === ownerId) ?? null) as T
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT id, name, parent_id FROM folders WHERE owner_id = ?')) {
                return { results: folders.filter((f) => f.owner_id === args[0]) as T[] }
              }
              if (sql.startsWith('SELECT id, title, folder_id, updated_at FROM docs WHERE owner_id = ?')) {
                const rows = docs.filter((d) => d.owner_id === args[0]).sort((a, b) => b.updated_at - a.updated_at)
                return { results: rows as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
          }
        },
      }
    },
  }
  return { DB } as unknown as Env
}

function treeFolder(id: string, parentId: string | null): TreeFolderRow {
  return { id, owner_id: 'u1', name: `이름-${id}`, parent_id: parentId }
}

function treeDoc(id: string, folderId: string | null, updatedAt = 1): TreeDocRow {
  return { id, owner_id: 'u1', title: `제목-${id}`, content: '본문', line_ending: 'lf', folder_id: folderId, updated_at: updatedAt }
}

// L › a › b › c › d, 옆에 밖 폴더 X
const DEEP_FOLDERS = [
  treeFolder('L', null),
  treeFolder('a', 'L'),
  treeFolder('b', 'a'),
  treeFolder('c', 'b'),
  treeFolder('d', 'c'),
  treeFolder('X', null),
]
const DEEP_DOCS = [treeDoc('in-c', 'c', 3), treeDoc('in-d', 'd', 4), treeDoc('in-L', 'L', 1), treeDoc('out', 'X', 9), treeDoc('root', null, 8)]

async function getPublicFolder(env: Env) {
  return handlePublicGetFolder(new Request('http://local.test/pub/folders/x'), env, {} as ExecutionContext, { token: FOLDER_TOKEN })
}

describe('F-2017 S3 공개 폴더 — 모든 자손', () => {
  it('링크 폴더 아래 4단계 폴더 전부가 parentId 와 함께, 증손 문서까지 docs 에', async () => {
    const res = await getPublicFolder(makeFolderEnv(DEEP_FOLDERS, DEEP_DOCS))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string; folders: { id: string; parentId: string }[]; docs: { id: string }[] }
    expect(body.name).toBe('이름-L')
    expect(body.folders.map((f) => [f.id, f.parentId]).sort()).toEqual([
      ['a', 'L'],
      ['b', 'a'],
      ['c', 'b'],
      ['d', 'c'],
    ])
    expect(body.docs.map((d) => d.id)).toEqual(['in-d', 'in-c', 'in-L'])
  })

  it('서브트리 폴더 150개여도 200', async () => {
    const many = [treeFolder('L', null), ...Array.from({ length: 150 }, (_, i) => treeFolder(`s${i}`, i === 0 ? 'L' : `s${Math.floor(i / 2)}`))]
    const res = await getPublicFolder(makeFolderEnv(many, [treeDoc('leaf', 's149')]))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { folders: unknown[]; docs: { id: string }[] }
    expect(body.folders).toHaveLength(150)
    expect(body.docs.map((d) => d.id)).toEqual(['leaf'])
  })

  it('handlePublicGetFolderDoc: 증손 문서 200, 서브트리 밖 문서 404', async () => {
    const env = makeFolderEnv(DEEP_FOLDERS, DEEP_DOCS)
    const ctx = {} as ExecutionContext
    const ok = await handlePublicGetFolderDoc(new Request('http://local.test/'), env, ctx, { token: FOLDER_TOKEN, docId: 'in-d' })
    expect(ok.status).toBe(200)
    const outside = await handlePublicGetFolderDoc(new Request('http://local.test/'), env, ctx, { token: FOLDER_TOKEN, docId: 'out' })
    expect(outside.status).toBe(404)
  })
})

// ---------- F-2018 U20 공개 묶음 링크 표 ----------
describe('F-2018 U20 /pub/docs/:token/set 의 links', () => {
  const TOKEN = 'T'.repeat(43)
  const link: LinkRow = { token: TOKEN, owner_id: 'u1', target_type: 'doc', target_id: 'd1', created_at: 1, revoked_at: null }

  async function getSet(env: Env) {
    const res = await handlePublicGetDocSet(new Request(`http://local.test/pub/docs/${TOKEN}/set`), env, {} as ExecutionContext, { token: TOKEN })
    return { status: res.status, text: await res.text() }
  }

  it('문서 2개 묶음이면 links, 폴더 이름·주석 안 대상은 응답에 없다', async () => {
    const { env, shareLinkDocs } = makeEnv({
      links: [link],
      folders: [
        { id: 'fa', owner_id: 'u1', name: '폴더이름가', parent_id: null },
        { id: 'fb', owner_id: 'u1', name: '폴더이름나', parent_id: null },
      ],
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작', content: '[[1주차]] [[폴더이름나/1주차]] [[밖]] %%[[SECRET]]%% [[#절]]', folder_id: 'fa', updated_at: 1 },
        { id: 'd2', owner_id: 'u1', title: '1주차', content: '[[시작]]', folder_id: 'fa', updated_at: 2 },
        { id: 'd3', owner_id: 'u1', title: 'Secret', content: '', folder_id: null, updated_at: 3 },
        { id: 'd4', owner_id: 'u1', title: '1주차', content: '', folder_id: 'fb', updated_at: 9 },
        { id: 'd5', owner_id: 'u1', title: '밖', content: '', folder_id: null, updated_at: 4 },
      ],
    })
    shareLinkDocs.push({ token: TOKEN, doc_id: 'd2' }, { token: TOKEN, doc_id: 'd3' })

    const { status, text } = await getSet(env)
    expect(status).toBe(200)
    const body = JSON.parse(text) as { docs: { id: string; title: string; links: Record<string, string> }[] }
    expect(body.docs.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(body.docs[0].links).toEqual({ '1주차': 'd2' })
    expect(body.docs[1].links).toEqual({ 시작: 'd1' })
    expect(body.docs[2].links).toEqual({})
    expect(text).not.toContain('폴더이름')
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('d4')
  })

  it('문서 1개면 links: {} 이고 소유자 전체 질의를 부르지 않는다', async () => {
    const { env, sqls } = makeEnv({
      links: [link],
      docs: [
        { id: 'd1', owner_id: 'u1', title: '시작', content: '[[다른]]', folder_id: null, updated_at: 1 },
        { id: 'd2', owner_id: 'u1', title: '다른', content: '', folder_id: null, updated_at: 2 },
      ],
    })
    const { text } = await getSet(env)
    const body = JSON.parse(text) as { docs: { id: string; links: Record<string, string> }[] }
    expect(body.docs).toEqual([{ id: 'd1', title: '시작', links: {} }])
    expect(sqls.some((s) => s.includes('WHERE owner_id'))).toBe(false)
    expect(sqls.some((s) => s.includes('FROM folders'))).toBe(false)
  })
})
