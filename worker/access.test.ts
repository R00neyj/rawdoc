import { describe, expect, it } from 'vitest'
import { getDocAccess, getOwnedFolder, isDocAttachmentOwner, resolveDocAccess, roleAtLeast } from './access'

type Doc = { id: string; owner_id: string; folder_id: string | null }
type Folder = { id: string; owner_id: string; parent_id: string | null }
type Grant = { target_type: 'doc' | 'folder'; target_id: string; grantee_email: string; role: 'view' | 'edit' }
type UserRow = { id: string; email: string }

function makeEnv(data: { docs?: Doc[]; folders?: Folder[]; grants?: Grant[]; users?: UserRow[] }): Env {
  const docs = data.docs ?? []
  const folders = data.folders ?? []
  const grants = data.grants ?? []
  const users = data.users ?? []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT role FROM grants')) {
                const [targetType, targetId, email] = args as [string, string, string]
                const row = grants.find(
                  (g) => g.target_type === targetType && g.target_id === targetId && g.grantee_email === email,
                )
                return (row ? { role: row.role } : null) as T | null
              }
              if (sql.startsWith('SELECT parent_id FROM folders')) {
                const [id] = args as [string]
                const row = folders.find((f) => f.id === id)
                return (row ? { parent_id: row.parent_id } : null) as T | null
              }
              if (sql.startsWith('SELECT * FROM folders')) {
                const [id] = args as [string]
                return (folders.find((f) => f.id === id) as T) ?? null
              }
              if (sql.startsWith('SELECT * FROM docs')) {
                const [id] = args as [string]
                return (docs.find((d) => d.id === id) as T) ?? null
              }
              if (sql.startsWith('SELECT email FROM users')) {
                const [id] = args as [string]
                const row = users.find((u) => u.id === id)
                return (row ? { email: row.email } : null) as T | null
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { DB } as unknown as Env
}

const OWNER = { id: 'owner-1', email: 'owner@example.com' }
const GRANTEE = { id: 'grantee-1', email: 'grantee@example.com' }
const STRANGER = { id: 'stranger-1', email: 'stranger@example.com' }

describe('F-212 A1 문서 role 판정', () => {
  it('소유자는 owner', async () => {
    const env = makeEnv({})
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    const access = await resolveDocAccess(env, doc, OWNER)
    expect(access?.role).toBe('owner')
  })

  it('문서에 직접 준 grant', async () => {
    const env = makeEnv({ grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'edit' }] })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    const access = await resolveDocAccess(env, doc, GRANTEE)
    expect(access?.role).toBe('edit')
  })

  it('문서가 속한 폴더에 준 grant', async () => {
    const env = makeEnv({
      folders: [{ id: 'f1', owner_id: OWNER.id, parent_id: null }],
      grants: [{ target_type: 'folder', target_id: 'f1', grantee_email: GRANTEE.email, role: 'view' }],
    })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: 'f1' }
    const access = await resolveDocAccess(env, doc, GRANTEE)
    expect(access?.role).toBe('view')
  })

  it('상위 폴더에 준 grant', async () => {
    const env = makeEnv({
      folders: [
        { id: 'parent', owner_id: OWNER.id, parent_id: null },
        { id: 'child', owner_id: OWNER.id, parent_id: 'parent' },
      ],
      grants: [{ target_type: 'folder', target_id: 'parent', grantee_email: GRANTEE.email, role: 'edit' }],
    })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: 'child' }
    const access = await resolveDocAccess(env, doc, GRANTEE)
    expect(access?.role).toBe('edit')
  })

  it('여러 경로 중 가장 높은 역할을 쓴다', async () => {
    const env = makeEnv({
      folders: [{ id: 'f1', owner_id: OWNER.id, parent_id: null }],
      grants: [
        { target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'view' },
        { target_type: 'folder', target_id: 'f1', grantee_email: GRANTEE.email, role: 'edit' },
      ],
    })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: 'f1' }
    const access = await resolveDocAccess(env, doc, GRANTEE)
    expect(access?.role).toBe('edit')
  })

  it('권한이 전혀 없으면 null', async () => {
    const env = makeEnv({})
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    const access = await resolveDocAccess(env, doc, STRANGER)
    expect(access).toBeNull()
  })

  it('getDocAccess: 문서가 없으면 null', async () => {
    const env = makeEnv({ docs: [] })
    const access = await getDocAccess(env, 'missing', GRANTEE)
    expect(access).toBeNull()
  })
})

describe('F-212 A1 roleAtLeast', () => {
  it('owner 는 항상 통과', () => {
    expect(roleAtLeast('owner', 'edit')).toBe(true)
  })
  it('view 는 edit 최소 조건을 통과하지 못한다', () => {
    expect(roleAtLeast('view', 'edit')).toBe(false)
  })
  it('edit 은 edit 최소 조건을 통과한다', () => {
    expect(roleAtLeast('edit', 'edit')).toBe(true)
  })
})

describe('F-212 A1 getOwnedFolder', () => {
  it('소유자가 아니면 null', async () => {
    const env = makeEnv({ folders: [{ id: 'f1', owner_id: OWNER.id, parent_id: null }] })
    expect(await getOwnedFolder(env, 'f1', GRANTEE)).toBeNull()
  })
  it('소유자면 폴더를 돌려준다', async () => {
    const env = makeEnv({ folders: [{ id: 'f1', owner_id: OWNER.id, parent_id: null }] })
    const folder = await getOwnedFolder(env, 'f1', OWNER)
    expect(folder?.id).toBe('f1')
  })
})

describe('F-212 A1 isDocAttachmentOwner', () => {
  it('문서 소유자의 첨부는 항상 허용', async () => {
    const env = makeEnv({})
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    expect(await isDocAttachmentOwner(env, doc, OWNER.id)).toBe(true)
  })

  it('문서 edit 권한자가 올린 첨부는 허용', async () => {
    const env = makeEnv({
      users: [{ id: GRANTEE.id, email: GRANTEE.email }],
      grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'edit' }],
    })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    expect(await isDocAttachmentOwner(env, doc, GRANTEE.id)).toBe(true)
  })

  it('view 권한자가 올린 첨부는 허용하지 않는다', async () => {
    const env = makeEnv({
      users: [{ id: GRANTEE.id, email: GRANTEE.email }],
      grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'view' }],
    })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    expect(await isDocAttachmentOwner(env, doc, GRANTEE.id)).toBe(false)
  })

  it('아무 관계 없는 사용자의 첨부는 허용하지 않는다', async () => {
    const env = makeEnv({ users: [{ id: STRANGER.id, email: STRANGER.email }] })
    const doc = { id: 'd1', owner_id: OWNER.id, folder_id: null }
    expect(await isDocAttachmentOwner(env, doc, STRANGER.id)).toBe(false)
  })
})
