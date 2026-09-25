import { describe, expect, it } from 'vitest'
import { getDocAccess, getOwnedFolder, isDocAttachmentOwner, resolveDocAccess, roleAtLeast } from './access'

type Doc = { id: string; owner_id: string; folder_id: string | null; e2ee_key?: string | null }
type Folder = { id: string; owner_id: string; parent_id: string | null }
// owner_id 를 비우면 대상 폴더의 소유자로 본다 — 실제로 handlePutGrant 가 대상 소유자를 넣는다
type Grant = { target_type: 'doc' | 'folder'; target_id: string; grantee_email: string; role: 'view' | 'edit'; owner_id?: string }
type UserRow = { id: string; email: string; blocked_at?: number | null }

function makeEnv(
  data: { docs?: Doc[]; folders?: Folder[]; grants?: Grant[]; users?: UserRow[] },
  sqlLog: string[] = [],
  usageIds: string[] = [],
): Env {
  const docs = data.docs ?? []
  const folders = data.folders ?? []
  const grants = data.grants ?? []
  const users = data.users ?? []
  const grantOwner = (g: Grant) => g.owner_id ?? folders.find((f) => f.id === g.target_id)?.owner_id

  const DB = {
    prepare(sql: string) {
      sqlLog.push(sql)
      return {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              if (sql.startsWith('SELECT target_id, role FROM grants')) {
                const [email, ownerId] = args as [string, string]
                const results = grants
                  .filter((g) => g.target_type === 'folder' && g.grantee_email === email && grantOwner(g) === ownerId)
                  .map((g) => ({ target_id: g.target_id, role: g.role }))
                return { results: results as T[] }
              }
              // 가짜 DB 는 SQL 을 돌리지 않는다 — 재귀 사슬 대신 그 소유자의 폴더 전부(사슬의 상위 집합)를 준다 (F-2017 4.3)
              if (sql.startsWith('WITH RECURSIVE')) {
                const ownerId = args[1] as string
                const results = folders.filter((f) => f.owner_id === ownerId).map((f) => ({ id: f.id, parent_id: f.parent_id }))
                return { results: results as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
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
              if (sql.startsWith('SELECT * FROM docs') || sql.endsWith(' FROM docs WHERE id = ?')) {
                const [id] = args as [string]
                return (docs.find((d) => d.id === id) as T) ?? null
              }
              if (sql.startsWith('SELECT write_day')) {
                const [id] = args as [string]
                usageIds.push(id)
                const row = users.find((u) => u.id === id)
                if (!row) return null
                return {
                  write_day: null,
                  write_count: 0,
                  content_bytes: 0,
                  doc_count: 0,
                  blocked_at: row.blocked_at ?? null,
                  warned_at: null,
                } as T
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

describe('F-2017 S1 깊은 폴더 사슬의 초대', () => {
  // f1 › f2 › … › f6
  const chainFolders: Folder[] = Array.from({ length: 6 }, (_, i) => ({
    id: `f${i + 1}`,
    owner_id: OWNER.id,
    parent_id: i === 0 ? null : `f${i}`,
  }))

  it('1단계 폴더 초대가 6단계 폴더 안 문서를 덮는다', async () => {
    const env = makeEnv({
      folders: chainFolders,
      grants: [{ target_type: 'folder', target_id: 'f1', grantee_email: GRANTEE.email, role: 'edit' }],
    })
    const access = await resolveDocAccess(env, { id: 'd1', owner_id: OWNER.id, folder_id: 'f6' }, GRANTEE)
    expect(access?.role).toBe('edit')
  })

  it('사슬 중간 view·위 edit 이면 edit', async () => {
    const env = makeEnv({
      folders: chainFolders,
      grants: [
        { target_type: 'folder', target_id: 'f4', grantee_email: GRANTEE.email, role: 'view' },
        { target_type: 'folder', target_id: 'f2', grantee_email: GRANTEE.email, role: 'edit' },
      ],
    })
    const access = await resolveDocAccess(env, { id: 'd1', owner_id: OWNER.id, folder_id: 'f6' }, GRANTEE)
    expect(access?.role).toBe('edit')
  })

  it('순환 A↔B 사슬에서 끝나고, A 초대가 B 안 문서를 덮는다', async () => {
    const env = makeEnv({
      folders: [
        { id: 'A', owner_id: OWNER.id, parent_id: 'B' },
        { id: 'B', owner_id: OWNER.id, parent_id: 'A' },
      ],
      grants: [{ target_type: 'folder', target_id: 'A', grantee_email: GRANTEE.email, role: 'view' }],
    })
    const access = await resolveDocAccess(env, { id: 'd1', owner_id: OWNER.id, folder_id: 'B' }, GRANTEE)
    expect(access?.role).toBe('view')
  })

  it('이 소유자에게서 받은 폴더 초대가 없으면 사슬 질의를 보내지 않는다', async () => {
    const sqlLog: string[] = []
    const env = makeEnv(
      {
        folders: [...chainFolders, { id: 'other', owner_id: 'owner-2', parent_id: null }],
        grants: [
          { target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'view' },
          { target_type: 'folder', target_id: 'other', grantee_email: GRANTEE.email, role: 'edit' },
        ],
      },
      sqlLog,
    )
    const access = await resolveDocAccess(env, { id: 'd1', owner_id: OWNER.id, folder_id: 'f6' }, GRANTEE)
    expect(access?.role).toBe('view')
    expect(sqlLog.some((sql) => sql.startsWith('WITH RECURSIVE'))).toBe(false)
    expect(sqlLog.filter((sql) => /folders/.test(sql))).toEqual([])
  })

  it('folder_id 가 null 이면 폴더 질의가 없다', async () => {
    const sqlLog: string[] = []
    const env = makeEnv(
      { grants: [{ target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'edit' }] },
      sqlLog,
    )
    const access = await resolveDocAccess(env, { id: 'd1', owner_id: OWNER.id, folder_id: null }, GRANTEE)
    expect(access?.role).toBe('edit')
    expect(sqlLog.filter((sql) => /folder/.test(sql))).toEqual([])
  })

  it('판정 하나에 보내는 질의 수가 사슬 깊이와 무관하다', async () => {
    const grants: Grant[] = [{ target_type: 'folder', target_id: 'f1', grantee_email: GRANTEE.email, role: 'edit' }]
    const shallowLog: string[] = []
    await resolveDocAccess(makeEnv({ folders: chainFolders, grants }, shallowLog), { id: 'd1', owner_id: OWNER.id, folder_id: 'f2' }, GRANTEE)
    const deepLog: string[] = []
    await resolveDocAccess(makeEnv({ folders: chainFolders, grants }, deepLog), { id: 'd1', owner_id: OWNER.id, folder_id: 'f6' }, GRANTEE)
    expect(deepLog.length).toBe(shallowLog.length)
    expect(deepLog.filter((sql) => /folder/.test(sql)).length).toBeLessThanOrEqual(2)
  })

  it('isDocAttachmentOwner 도 깊은 사슬의 edit 초대를 인정한다', async () => {
    const env = makeEnv({
      folders: chainFolders,
      users: [{ id: GRANTEE.id, email: GRANTEE.email }],
      grants: [{ target_type: 'folder', target_id: 'f1', grantee_email: GRANTEE.email, role: 'edit' }],
    })
    expect(await isDocAttachmentOwner(env, { id: 'd1', owner_id: OWNER.id, folder_id: 'f6' }, GRANTEE.id)).toBe(true)
  })
})

describe('F-2028 AC1~AC9 막힘이면 쓰기 역할을 view 로 낮춘다', () => {
  const DOC = { id: 'd1', owner_id: OWNER.id, folder_id: null }
  const usage = (blockedAt: number | null) => ({
    writeDay: null,
    writeCount: 0,
    contentBytes: 0,
    docCount: 0,
    blockedAt,
    warnedAt: null,
  })
  const editGrant: Grant = { target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'edit' }
  const viewGrant: Grant = { target_type: 'doc', target_id: 'd1', grantee_email: GRANTEE.email, role: 'view' }
  const usageSql = (log: string[]) => log.filter((sql) => sql.startsWith('SELECT write_day'))

  it('AC1 소유자, 안 막힘 — owner, blocked 키 없음, 사용량 문장 0', async () => {
    const log: string[] = []
    const access = await resolveDocAccess(makeEnv({}, log), DOC, { ...OWNER, usage: usage(null) })
    expect(access).toStrictEqual({ role: 'owner', doc: DOC })
    expect(usageSql(log)).toEqual([])
  })

  it('AC2 소유자, usage 막힘 — view·blocked, 사용량 문장 0', async () => {
    const log: string[] = []
    const access = await resolveDocAccess(makeEnv({}, log), DOC, { ...OWNER, usage: usage(123) })
    expect(access).toStrictEqual({ role: 'view', doc: DOC, blocked: true })
    expect(usageSql(log)).toEqual([])
  })

  it('AC3 소유자, usage 없음(재검증 모양), 행 막힘 — view·blocked, 소유자 사용량 1번', async () => {
    const log: string[] = []
    const ids: string[] = []
    const env = makeEnv({ users: [{ ...OWNER, blocked_at: 123 }] }, log, ids)
    const access = await resolveDocAccess(env, DOC, OWNER)
    expect(access).toStrictEqual({ role: 'view', doc: DOC, blocked: true })
    expect(usageSql(log).length).toBe(1)
    expect(ids).toEqual([OWNER.id])
  })

  it('AC4 편집 초대, 본인 안 막힘, 소유자 막힘 — view·blocked, 소유자 사용량 1번', async () => {
    const log: string[] = []
    const ids: string[] = []
    const env = makeEnv({ grants: [editGrant], users: [{ ...OWNER, blocked_at: 123 }] }, log, ids)
    const access = await resolveDocAccess(env, DOC, { ...GRANTEE, usage: usage(null) })
    expect(access).toStrictEqual({ role: 'view', doc: DOC, blocked: true })
    expect(usageSql(log).length).toBe(1)
    expect(ids).toEqual([OWNER.id])
  })

  it('AC5 편집 초대, 둘 다 안 막힘 — edit, blocked 키 없음', async () => {
    const env = makeEnv({ grants: [editGrant], users: [{ ...OWNER }] })
    const access = await resolveDocAccess(env, DOC, { ...GRANTEE, usage: usage(null) })
    expect(access).toStrictEqual({ role: 'edit', doc: DOC })
  })

  it('AC6 보기 초대, 소유자 막힘 — view, blocked 키 없음, 사용량 문장 0', async () => {
    const log: string[] = []
    const env = makeEnv({ grants: [viewGrant], users: [{ ...OWNER, blocked_at: 123 }] }, log)
    const access = await resolveDocAccess(env, DOC, { ...GRANTEE, usage: usage(null) })
    expect(access).toStrictEqual({ role: 'view', doc: DOC })
    expect(usageSql(log)).toEqual([])
  })

  it('AC7 권한 없음, 소유자 막힘 — null, 사용량 문장 0', async () => {
    const log: string[] = []
    const env = makeEnv({ users: [{ ...OWNER, blocked_at: 123 }] }, log)
    expect(await resolveDocAccess(env, DOC, STRANGER)).toBeNull()
    expect(usageSql(log)).toEqual([])
  })

  it('AC8 편집 초대, usage 없음, 본인 막힘 — view·blocked, 본인 사용량 1번만', async () => {
    const log: string[] = []
    const ids: string[] = []
    const env = makeEnv({ grants: [editGrant], users: [{ ...GRANTEE, blocked_at: 123 }, { ...OWNER }] }, log, ids)
    const access = await resolveDocAccess(env, DOC, GRANTEE)
    expect(access).toStrictEqual({ role: 'view', doc: DOC, blocked: true })
    expect(usageSql(log).length).toBe(1)
    expect(ids).toEqual([GRANTEE.id])
  })

  it('AC9 편집 초대, 소유자 행 없음 — edit', async () => {
    const env = makeEnv({ grants: [editGrant] })
    const access = await resolveDocAccess(env, DOC, { ...GRANTEE, usage: usage(null) })
    expect(access).toStrictEqual({ role: 'edit', doc: DOC })
  })
})

describe('F-401 E1 금고 문서는 소유자만 (X1)', () => {
  const E2EE_DOC = { id: 'doc-v', owner_id: OWNER.id, folder_id: 'folder-v', e2ee_key: 'A'.repeat(55) + '=' }
  const folders = [{ id: 'folder-v', owner_id: OWNER.id, parent_id: 'folder-top' }, { id: 'folder-top', owner_id: OWNER.id, parent_id: null }]

  it('문서 초대 edit — null, grants 를 읽지 않는다', async () => {
    const log: string[] = []
    const env = makeEnv({ folders, grants: [{ target_type: 'doc', target_id: 'doc-v', grantee_email: GRANTEE.email, role: 'edit', owner_id: OWNER.id }] }, log)
    expect(await resolveDocAccess(env, E2EE_DOC, GRANTEE)).toBeNull()
    expect(log.filter((s) => s.includes('FROM grants'))).toEqual([])
  })

  it('상위 폴더 초대 edit — null, grants 를 읽지 않는다', async () => {
    const log: string[] = []
    const env = makeEnv({ folders, grants: [{ target_type: 'folder', target_id: 'folder-top', grantee_email: GRANTEE.email, role: 'edit' }] }, log)
    expect(await resolveDocAccess(env, E2EE_DOC, GRANTEE)).toBeNull()
    expect(log.filter((s) => s.includes('FROM grants'))).toEqual([])
  })

  it('소유자 — owner', async () => {
    const env = makeEnv({ folders })
    expect((await resolveDocAccess(env, E2EE_DOC, OWNER))?.role).toBe('owner')
  })

  it('getDocAccess 가 열을 골라도 e2ee_key 를 함께 읽는다 (X2)', async () => {
    const log: string[] = []
    const env = makeEnv({ docs: [E2EE_DOC], folders, grants: [{ target_type: 'doc', target_id: 'doc-v', grantee_email: GRANTEE.email, role: 'edit', owner_id: OWNER.id }] }, log)
    expect(await getDocAccess(env, 'doc-v', GRANTEE, 'id, owner_id, folder_id')).toBeNull()
    expect(log.find((s) => s.includes('FROM docs'))).toBe('SELECT id, owner_id, folder_id, e2ee_key FROM docs WHERE id = ?')
  })
})
