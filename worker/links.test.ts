// F-259 위키링크 묶음 공유 링크, 묶음 바뀌어도 주소 유지 (specs/features/F-259.md 3장)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleCreateDocLink, handlePublicGetDocSet } from './links'

type LinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  created_at: number
  revoked_at: number | null
}
type DocRow = { id: string; owner_id: string; title: string }

function makeEnv({ docs = [], links = [] }: { docs?: DocRow[]; links?: LinkRow[] } = {}) {
  const shareLinkDocs: { token: string; doc_id: string }[] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT id FROM docs WHERE id = ? AND owner_id = ?')) {
                const [id, ownerId] = args as [string, string]
                const row = docs.find((d) => d.id === id && d.owner_id === ownerId)
                return (row ? { id: row.id } : null) as T
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
              throw new Error(`unhandled run sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { env: { DB } as unknown as Env, links, shareLinkDocs }
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
