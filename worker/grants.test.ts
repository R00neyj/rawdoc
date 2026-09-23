// 공유받음 목록 — 폴더 초대가 모든 자손 폴더 문서를 덮는다 (specs/features/F-2017.md 4.4, S2)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'me', email: 'me@example.com' })),
}))

import { handleGetShared } from './grants'

type Grant = {
  target_type: 'doc' | 'folder'
  target_id: string
  owner_id: string
  grantee_email: string
  role: 'view' | 'edit'
}
type FolderRow = { id: string; owner_id: string; name: string; parent_id: string | null }
type DocRow = {
  id: string
  owner_id: string
  title: string
  line_ending: 'crlf' | 'lf'
  folder_id: string | null
  pinned_at: number | null
  version: number
  created_at: number
  updated_at: number
}

const ME = 'me@example.com'
const BIND_LIMIT = 100

function makeEnv(data: { grants: Grant[]; folders: FolderRow[]; docs: DocRow[] }) {
  const sqlLog: string[] = []
  const users = [
    { id: 'owner-1', email: 'owner1@example.com' },
    { id: 'owner-2', email: 'owner2@example.com' },
    { id: 'me', email: ME },
  ]
  const DB = {
    prepare(sql: string) {
      sqlLog.push(sql)
      return {
        bind(...args: unknown[]) {
          // D1 한 질의의 바인딩 인자 한도를 흉내 낸다 (가정 G2)
          if (args.length > BIND_LIMIT) throw new Error(`too many bindings: ${args.length}`)
          return {
            async first<T>() {
              if (sql.startsWith('SELECT email FROM users WHERE id = ?')) {
                const row = users.find((u) => u.id === args[0])
                return (row ? { email: row.email } : null) as T | null
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT target_type, target_id, role, owner_id FROM grants WHERE grantee_email = ?')) {
                return { results: data.grants.filter((g) => g.grantee_email === args[0]) as T[] }
              }
              if (sql.startsWith('SELECT id, name, parent_id FROM folders WHERE owner_id = ?')) {
                return { results: data.folders.filter((f) => f.owner_id === args[0]) as T[] }
              }
              if (sql.startsWith('SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at, owner_id FROM docs WHERE owner_id = ?')) {
                return { results: data.docs.filter((d) => d.owner_id === args[0]) as T[] }
              }
              if (sql.startsWith('SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at, owner_id FROM docs WHERE id IN')) {
                return { results: data.docs.filter((d) => (args as string[]).includes(d.id)) as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
          }
        },
      }
    },
  }
  return { env: { DB } as unknown as Env, sqlLog }
}

function folder(id: string, parentId: string | null, ownerId = 'owner-1'): FolderRow {
  return { id, owner_id: ownerId, name: `이름-${id}`, parent_id: parentId }
}

function doc(id: string, folderId: string | null, ownerId = 'owner-1'): DocRow {
  return {
    id,
    owner_id: ownerId,
    title: `제목-${id}`,
    line_ending: 'lf',
    folder_id: folderId,
    pinned_at: null,
    version: 1,
    created_at: 1,
    updated_at: 2,
  }
}

function folderGrant(id: string, role: 'view' | 'edit', ownerId = 'owner-1'): Grant {
  return { target_type: 'folder', target_id: id, owner_id: ownerId, grantee_email: ME, role }
}

function docGrant(id: string, role: 'view' | 'edit', ownerId = 'owner-1'): Grant {
  return { target_type: 'doc', target_id: id, owner_id: ownerId, grantee_email: ME, role }
}

type SharedItem = { id: string; role: string; ownerEmail: string; viaFolder?: { id: string; name: string } }

async function shared(env: Env): Promise<Map<string, SharedItem>> {
  const res = await handleGetShared(new Request('http://local.test/api/shared'), env)
  expect(res.status).toBe(200)
  const body = (await res.json()) as SharedItem[]
  return new Map(body.map((d) => [d.id, d]))
}

// F › G1 › G2 › G3 한 줄
function chainFolders(depth: number): FolderRow[] {
  return Array.from({ length: depth + 1 }, (_, i) => folder(i === 0 ? 'F' : `G${i}`, i === 0 ? null : i === 1 ? 'F' : `G${i - 1}`))
}

describe('F-2017 S2 handleGetShared', () => {
  it('폴더 초대 F 아래 손자·증손 폴더 문서가 목록에 든다', async () => {
    const { env } = makeEnv({
      grants: [folderGrant('F', 'view')],
      folders: chainFolders(3),
      docs: [doc('d-g2', 'G2'), doc('d-g3', 'G3')],
    })
    const out = await shared(env)
    expect([...out.keys()].sort()).toEqual(['d-g2', 'd-g3'])
    expect(out.get('d-g3')?.role).toBe('view')
    expect(out.get('d-g3')?.ownerEmail).toBe('owner1@example.com')
    expect(out.get('d-g3')?.viaFolder).toEqual({ id: 'F', name: '이름-F' })
  })

  it('viaFolder 는 가장 가까운 초대 폴더, 역할은 사슬 최고값', async () => {
    const { env } = makeEnv({
      grants: [folderGrant('F', 'edit'), folderGrant('G2', 'view')],
      folders: chainFolders(3),
      docs: [doc('d-g1', 'G1'), doc('d-g3', 'G3')],
    })
    const out = await shared(env)
    expect(out.get('d-g3')?.viaFolder).toEqual({ id: 'G2', name: '이름-G2' })
    expect(out.get('d-g3')?.role).toBe('edit')
    expect(out.get('d-g1')?.viaFolder).toEqual({ id: 'F', name: '이름-F' })
  })

  it('다른 소유자·초대 밖 문서·내 문서는 없다', async () => {
    const { env } = makeEnv({
      grants: [folderGrant('F', 'view')],
      folders: [...chainFolders(2), folder('outside', null), folder('F2', null, 'owner-2'), folder('mine', null, 'me')],
      docs: [doc('in', 'G2'), doc('out', 'outside'), doc('root', null), doc('other', 'F2', 'owner-2'), doc('my', 'mine', 'me')],
    })
    const out = await shared(env)
    expect([...out.keys()]).toEqual(['in'])
  })

  it('문서 초대와 폴더 초대가 같이 있으면 높은 역할, 폴더 초대가 사슬에 있으면 viaFolder', async () => {
    const { env } = makeEnv({
      grants: [folderGrant('F', 'view'), docGrant('d-g1', 'edit')],
      folders: chainFolders(1),
      docs: [doc('d-g1', 'G1')],
    })
    const out = await shared(env)
    expect(out.get('d-g1')?.role).toBe('edit')
    expect(out.get('d-g1')?.viaFolder).toEqual({ id: 'F', name: '이름-F' })
  })

  it('문서 초대만 있는 문서 120개도 동작한다(100개씩 나눔)', async () => {
    const docs = Array.from({ length: 120 }, (_, i) => doc(`only-${i}`, null, 'owner-2'))
    const { env } = makeEnv({
      grants: docs.map((d) => docGrant(d.id, 'view', 'owner-2')),
      folders: [],
      docs,
    })
    const out = await shared(env)
    expect(out.size).toBe(120)
    expect(out.get('only-119')?.viaFolder).toBeUndefined()
  })

  it('폴더 깊이 3 과 30 에서 보낸 질의 수가 같다', async () => {
    const shallow = makeEnv({ grants: [folderGrant('F', 'view')], folders: chainFolders(3), docs: [doc('deep', 'G3')] })
    const deep = makeEnv({ grants: [folderGrant('F', 'view')], folders: chainFolders(30), docs: [doc('deep', 'G30')] })
    expect((await shared(shallow.env)).has('deep')).toBe(true)
    expect((await shared(deep.env)).has('deep')).toBe(true)
    expect(deep.sqlLog.length).toBe(shallow.sqlLog.length)
  })
})
