// F-4002 B8·B9 재검증 대상 구하기 (specs/features/F-4002.md 3.2)
import { describe, expect, it } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'
import { anyFolderGrant, lostAncestorIds, subtreeRoomDocIds } from '../../worker/revalidateTargets'

const folders = [
  { id: 'a', name: 'a', parentId: null },
  { id: 'b', name: 'b', parentId: 'a' },
  { id: 'c', name: 'c', parentId: 'b' },
  { id: 'x', name: 'x', parentId: 'a' },
  { id: 'top', name: 'top', parentId: null },
]

describe('F-4002 B8 lostAncestorIds', () => {
  it('최상위 → 폴더 = []', () => {
    expect(lostAncestorIds(folders, null, 'a')).toEqual([])
  })
  it('깊은 곳 → 형제 = 공통 조상 뺀 나머지', () => {
    expect(lostAncestorIds(folders, 'c', 'x')).toEqual(['c', 'b'])
  })
  it('깊은 곳 → 최상위 = 모든 조상', () => {
    expect(lostAncestorIds(folders, 'c', null)).toEqual(['c', 'b', 'a'])
  })
  it('같은 부모 = []', () => {
    expect(lostAncestorIds(folders, 'b', 'b')).toEqual([])
  })
  it('순환 표에서 멈춘다', () => {
    const loop = [
      { id: 'p', name: 'p', parentId: 'q' },
      { id: 'q', name: 'q', parentId: 'p' },
    ]
    expect(lostAncestorIds(loop, 'p', null)).toEqual(['p', 'q'])
  })
})

function seed() {
  const sql = openTestDb()
  for (const u of ['u1', 'u2']) {
    sql.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)').run(u, `${u}@example.com`)
  }
  const folder = (id: string, owner: string, parent: string | null) =>
    sql.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,1,1)').run(id, owner, id, parent)
  const doc = (id: string, owner: string, folderId: string | null, updatedAt: number, e2ee: string | null = null) =>
    sql
      .prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,'','lf',?,1,1,?,?)")
      .run(id, owner, id, folderId, updatedAt, e2ee)
  return { sql, folder, doc }
}

describe('F-4002 B9 subtreeRoomDocIds', () => {
  it('하위 4단계 문서를 찾고 금고·다른 소유자는 뺀다', async () => {
    const { sql, folder, doc } = seed()
    folder('f1', 'u1', null)
    folder('f2', 'u1', 'f1')
    folder('f3', 'u1', 'f2')
    folder('f4', 'u1', 'f3')
    folder('other', 'u1', null)
    folder('f2-u2', 'u2', 'f1')
    doc('d1', 'u1', 'f1', 10)
    doc('d4', 'u1', 'f4', 40)
    doc('dv', 'u1', 'f2', 50, 'key')
    doc('dout', 'u1', 'other', 60)
    doc('dx', 'u2', 'f2-u2', 70)
    const env = { DB: asD1(sql) } as unknown as Env
    const r = await subtreeRoomDocIds(env, 'f1', 'u1')
    expect(r).toEqual({ ids: ['d4', 'd1'], capped: false })
  })

  it('20개를 넘으면 updated_at 상위 20개와 capped', async () => {
    const { sql, folder, doc } = seed()
    folder('f1', 'u1', null)
    for (let i = 0; i < 25; i++) doc(`d${i}`, 'u1', 'f1', i)
    const env = { DB: asD1(sql) } as unknown as Env
    const r = await subtreeRoomDocIds(env, 'f1', 'u1')
    expect(r.capped).toBe(true)
    expect(r.ids).toHaveLength(20)
    expect(r.ids[0]).toBe('d24')
    expect(r.ids[19]).toBe('d5')
  })
})

describe('F-4002 anyFolderGrant', () => {
  it('빈 목록은 질의 없이 false, 초대가 있으면 true', async () => {
    const { sql, folder } = seed()
    folder('f1', 'u1', null)
    const prepare = sql.prepare.bind(sql)
    let queries = 0
    sql.prepare = ((q: string) => {
      queries++
      return prepare(q)
    }) as typeof sql.prepare
    const env = { DB: asD1(sql) } as unknown as Env
    expect(await anyFolderGrant(env, 'u1', [])).toBe(false)
    expect(queries).toBe(0)
    expect(await anyFolderGrant(env, 'u1', ['f1'])).toBe(false)
    sql.exec("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('folder','f1','u1','g@example.com','edit',1)")
    expect(await anyFolderGrant(env, 'u1', ['f0', 'f1'])).toBe(true)
    expect(await anyFolderGrant(env, 'u2', ['f1'])).toBe(false)
  })
})
