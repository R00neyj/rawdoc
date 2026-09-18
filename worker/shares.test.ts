// F-243 공유 관리 목록 (specs/features/F-243.md 3.1)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleListShares } from './shares'
import { requireUser } from './auth'

type LinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  created_at: number
  revoked_at: number | null
}
type GrantRow = {
  target_type: 'doc' | 'folder'
  target_id: string
  owner_id: string
  grantee_email: string
  role: 'view' | 'edit'
  created_at: number
}
type DocRow = { id: string; owner_id: string; title: string }
type FolderRow = { id: string; owner_id: string; name: string }

function makeEnv({
  links = [],
  grants = [],
  docs = [],
  folders = [],
}: {
  links?: LinkRow[]
  grants?: GrantRow[]
  docs?: DocRow[]
  folders?: FolderRow[]
} = {}) {
  const docMap = new Map(docs.map((d) => [d.id, d]))
  const folderMap = new Map(folders.map((f) => [f.id, f]))

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              const [ownerId, targetType] = args as [string, 'doc' | 'folder']
              if (sql.includes('FROM share_links')) {
                const results = links
                  .filter((l) => l.owner_id === ownerId && l.target_type === targetType && l.revoked_at === null)
                  .filter((l) => (targetType === 'doc' ? docMap.has(l.target_id) : folderMap.has(l.target_id)))
                  .map((l) => ({
                    token: l.token,
                    target_id: l.target_id,
                    created_at: l.created_at,
                    target_name:
                      targetType === 'doc' ? docMap.get(l.target_id)!.title : folderMap.get(l.target_id)!.name,
                  }))
                return { results: results as T[] }
              }
              if (sql.includes('FROM grants')) {
                const results = grants
                  .filter((g) => g.owner_id === ownerId && g.target_type === targetType)
                  .filter((g) => (targetType === 'doc' ? docMap.has(g.target_id) : folderMap.has(g.target_id)))
                  .map((g) => ({
                    target_id: g.target_id,
                    email: g.grantee_email,
                    role: g.role,
                    created_at: g.created_at,
                    target_name:
                      targetType === 'doc' ? docMap.get(g.target_id)!.title : folderMap.get(g.target_id)!.name,
                  }))
                return { results: results as T[] }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { env: { DB } as unknown as Env }
}

function req(userId = 'u1'): Request {
  return new Request('http://local.test/api/shares', { headers: { 'x-test-user': userId } })
}

describe('F-243 A1 handleListShares', () => {
  it('링크 2개(문서·폴더) + 권한 2개 — targetName 이 채워지고 내림차순', async () => {
    const now = Date.now()
    const { env } = makeEnv({
      docs: [{ id: 'd1', owner_id: 'u1', title: '회의록' }],
      folders: [{ id: 'f1', owner_id: 'u1', name: '업무' }],
      links: [
        { token: 't1', owner_id: 'u1', target_type: 'doc', target_id: 'd1', created_at: now - 1000, revoked_at: null },
        { token: 't2', owner_id: 'u1', target_type: 'folder', target_id: 'f1', created_at: now, revoked_at: null },
      ],
      grants: [
        { target_type: 'doc', target_id: 'd1', owner_id: 'u1', grantee_email: 'a@b.com', role: 'view', created_at: now - 500 },
        { target_type: 'folder', target_id: 'f1', owner_id: 'u1', grantee_email: 'c@d.com', role: 'edit', created_at: now },
      ],
    })

    const res = await handleListShares(req(), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      links: { token: string; targetType: string; targetId: string; targetName: string; createdAt: number }[]
      grants: { targetType: string; targetId: string; targetName: string; email: string; role: string; createdAt: number }[]
    }
    expect(body.links.map((l) => l.token)).toEqual(['t2', 't1'])
    expect(body.links[0]).toMatchObject({ targetType: 'folder', targetId: 'f1', targetName: '업무' })
    expect(body.links[1]).toMatchObject({ targetType: 'doc', targetId: 'd1', targetName: '회의록' })
    expect(body.grants.map((g) => g.email)).toEqual(['c@d.com', 'a@b.com'])
    expect(body.grants[0]).toMatchObject({ targetType: 'folder', targetId: 'f1', targetName: '업무', role: 'edit' })
  })
})

describe('F-243 A2 handleListShares 끊긴 링크', () => {
  it('revoked_at 이 찬 링크는 목록에 없다', async () => {
    const now = Date.now()
    const { env } = makeEnv({
      docs: [{ id: 'd1', owner_id: 'u1', title: '회의록' }],
      links: [{ token: 't1', owner_id: 'u1', target_type: 'doc', target_id: 'd1', created_at: now, revoked_at: now }],
    })
    const res = await handleListShares(req(), env)
    const body = (await res.json()) as { links: unknown[] }
    expect(body.links).toEqual([])
  })
})

describe('F-243 A3 handleListShares 지워진 대상', () => {
  it('문서를 지운 뒤엔 그 링크·권한 줄이 없다', async () => {
    const now = Date.now()
    const { env } = makeEnv({
      docs: [],
      links: [{ token: 't1', owner_id: 'u1', target_type: 'doc', target_id: 'gone', created_at: now, revoked_at: null }],
      grants: [{ target_type: 'doc', target_id: 'gone', owner_id: 'u1', grantee_email: 'a@b.com', role: 'view', created_at: now }],
    })
    const res = await handleListShares(req(), env)
    const body = (await res.json()) as { links: unknown[]; grants: unknown[] }
    expect(body.links).toEqual([])
    expect(body.grants).toEqual([])
  })
})

describe('F-243 A4 handleListShares 남의 것 제외', () => {
  it('다른 사용자의 링크·권한은 안 나온다', async () => {
    const now = Date.now()
    const { env } = makeEnv({
      docs: [{ id: 'd1', owner_id: 'u2', title: '남의 문서' }],
      links: [{ token: 't1', owner_id: 'u2', target_type: 'doc', target_id: 'd1', created_at: now, revoked_at: null }],
      grants: [{ target_type: 'doc', target_id: 'd1', owner_id: 'u2', grantee_email: 'a@b.com', role: 'view', created_at: now }],
    })
    const res = await handleListShares(req('u1'), env)
    const body = (await res.json()) as { links: unknown[]; grants: unknown[] }
    expect(body.links).toEqual([])
    expect(body.grants).toEqual([])
  })
})

describe('F-243 A5 handleListShares 비로그인', () => {
  it('401', async () => {
    vi.mocked(requireUser).mockImplementationOnce(async () => {
      throw new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 })
    })
    const { env } = makeEnv()
    await expect(handleListShares(req(), env)).rejects.toMatchObject({ status: 401 })
  })
})
