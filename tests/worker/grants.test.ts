// 공유받음 목록 — 폴더 초대가 모든 자손 폴더 문서를 덮는다 (specs/features/F-2017.md 4.4 S2, F-2058 9장)
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

vi.mock('../../worker/auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'me', email: 'me@example.com' })),
}))

import { handleGetShared, SHARED_DOCS_SQL, SHARED_FOLDERS_SQL } from '../../worker/grants'

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
  e2ee_key?: string | null
}

const ME = 'me@example.com'
const BIND_LIMIT = 100
const OWNERS = ['owner-1', 'owner-2', 'owner-3', 'owner-4']

function makeEnv(data: { grants: Grant[]; folders: FolderRow[]; docs: DocRow[] }) {
  const sqlDb = openTestDb()
  const insertUser = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)')
  for (const id of OWNERS) insertUser.run(id, `${id.replace('-', '')}@example.com`)
  insertUser.run('me', ME)
  const insertFolder = sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)')
  for (const f of data.folders) insertFolder.run(f.id, f.owner_id, f.name, f.parent_id)
  const insertDoc = sqlDb.prepare(
    `INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const d of data.docs) {
    insertDoc.run(d.id, d.owner_id, d.title, d.line_ending, d.folder_id, d.pinned_at, d.version, d.created_at, d.updated_at, d.e2ee_key ?? null)
  }
  const insertGrant = sqlDb.prepare(
    'INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?, ?, ?, ?, ?, 1)',
  )
  for (const g of data.grants) insertGrant.run(g.target_type, g.target_id, g.owner_id, g.grantee_email, g.role)

  const sqlLog: string[] = []
  const d1 = asD1(sqlDb)
  const DB = {
    prepare(sql: string) {
      sqlLog.push(sql)
      const stmt = d1.prepare(sql)
      return {
        ...stmt,
        first: stmt.first.bind(stmt),
        all: stmt.all.bind(stmt),
        run: stmt.run.bind(stmt),
        bind(...args: unknown[]) {
          // D1 한 질의의 바인딩 인자 한도를 흉내 낸다 (F-2017 가정 G2)
          if (args.length > BIND_LIMIT) throw new Error(`too many bindings: ${args.length}`)
          return stmt.bind(...args)
        },
      }
    },
  }
  return { env: { DB } as unknown as Env, sqlLog, sqlDb }
}

function folder(id: string, parentId: string | null, ownerId = 'owner-1'): FolderRow {
  return { id, owner_id: ownerId, name: `이름-${id}`, parent_id: parentId }
}

function doc(id: string, folderId: string | null, ownerId = 'owner-1', extra: Partial<DocRow> = {}): DocRow {
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
    ...extra,
  }
}

function folderGrant(id: string, role: 'view' | 'edit', ownerId = 'owner-1'): Grant {
  return { target_type: 'folder', target_id: id, owner_id: ownerId, grantee_email: ME, role }
}

function docGrant(id: string, role: 'view' | 'edit', ownerId = 'owner-1'): Grant {
  return { target_type: 'doc', target_id: id, owner_id: ownerId, grantee_email: ME, role }
}

type SharedItem = {
  id: string
  title: string
  lineEnding: 'crlf' | 'lf'
  folderId: string | null
  pinnedAt: number | null
  version: number
  createdAt: number
  updatedAt: number
  role: string
  ownerEmail: string
  viaFolder?: { id: string; name: string }
}

async function sharedList(env: Env): Promise<SharedItem[]> {
  const res = await handleGetShared(new Request('http://local.test/api/shared'), env)
  expect(res.status).toBe(200)
  return (await res.json()) as SharedItem[]
}

async function shared(env: Env): Promise<Map<string, SharedItem>> {
  return new Map((await sharedList(env)).map((d) => [d.id, d]))
}

// F › G1 › G2 › G3 한 줄
function chainFolders(depth: number): FolderRow[] {
  return Array.from({ length: depth + 1 }, (_, i) => folder(i === 0 ? 'F' : `G${i}`, i === 0 ? null : i === 1 ? 'F' : `G${i - 1}`))
}

function planOf(sqlDb: DatabaseSync, sql: string): string[] {
  return (sqlDb.prepare('EXPLAIN QUERY PLAN ' + sql).all(ME, 'me') as { detail: string }[]).map((r) => r.detail)
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

describe('F-2058 초대 폴더 하위만 읽기', () => {
  it('A2 같은 결과 표본 — 11개 필드 전부', async () => {
    const { env } = makeEnv({
      grants: [
        folderGrant('F', 'view'),
        docGrant('d-out-granted', 'edit'),
        docGrant('d-c-granted', 'edit'),
        folderGrant('P', 'edit', 'owner-2'),
        docGrant('d-o2-grant', 'edit', 'owner-2'),
        folderGrant('CY1', 'view'),
        folderGrant('GONE', 'edit'),
        folderGrant('MINE', 'edit', 'me'),
      ],
      folders: [
        folder('F', null),
        folder('C', 'F'),
        folder('GC', 'C'),
        folder('OUT', null),
        folder('P', null),
        folder('CY1', 'CY2'),
        folder('CY2', 'CY1'),
        folder('MINE', null, 'me'),
      ],
      docs: [
        doc('d-gc', 'GC', 'owner-1', { pinned_at: 5, version: 3, created_at: 10, updated_at: 20, line_ending: 'crlf' }),
        doc('d-out-granted', 'OUT', 'owner-1', { updated_at: 30 }),
        doc('d-c-granted', 'C', 'owner-1', { updated_at: 40 }),
        doc('d-out-plain', 'OUT'),
        doc('d-c-vault', 'C', 'owner-1', { e2ee_key: 'wrapped' }),
        doc('d-p', 'P'),
        doc('d-o2-grant', 'OUT'),
        doc('d-cy1', 'CY1'),
        doc('d-cy2', 'CY2'),
        doc('d-mine', 'MINE', 'me'),
      ],
    })
    const body = (await sharedList(env)).sort((a, b) => a.id.localeCompare(b.id))
    const base = { title: '', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 2, ownerEmail: 'owner1@example.com' }
    expect(body).toEqual([
      { ...base, id: 'd-c-granted', title: '제목-d-c-granted', folderId: 'C', updatedAt: 40, role: 'edit', viaFolder: { id: 'F', name: '이름-F' } },
      { ...base, id: 'd-cy1', title: '제목-d-cy1', folderId: 'CY1', role: 'view', viaFolder: { id: 'CY1', name: '이름-CY1' } },
      { ...base, id: 'd-cy2', title: '제목-d-cy2', folderId: 'CY2', role: 'view', viaFolder: { id: 'CY1', name: '이름-CY1' } },
      {
        ...base,
        id: 'd-gc',
        title: '제목-d-gc',
        lineEnding: 'crlf',
        folderId: 'GC',
        pinnedAt: 5,
        version: 3,
        createdAt: 10,
        updatedAt: 20,
        role: 'view',
        viaFolder: { id: 'F', name: '이름-F' },
      },
      { ...base, id: 'd-out-granted', title: '제목-d-out-granted', folderId: 'OUT', updatedAt: 30, role: 'edit' },
    ])
    expect(body.find((d) => d.id === 'd-out-granted')).not.toHaveProperty('viaFolder')
  })

  it('A3 색인 둘이 있고 두 질의가 그 색인을 탄다', () => {
    const sqlDb = openTestDb()
    const names = (sqlDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name)
    expect(names).toContain('docs_owner_folder')
    expect(names).toContain('folders_owner_parent')

    const docsPlan = planOf(sqlDb, SHARED_DOCS_SQL)
    expect(docsPlan.join('\n')).toContain('SEARCH d USING INDEX docs_owner_folder (owner_id=? AND folder_id=?)')
    expect(docsPlan.join('\n')).toContain('USING INDEX folders_owner_parent (owner_id=? AND parent_id=?)')
    expect(docsPlan.filter((d) => d.startsWith('SCAN d') || d.startsWith('SCAN f'))).toEqual([])
    expect(docsPlan.join('\n')).not.toContain('USE TEMP B-TREE FOR ORDER BY')

    const foldersPlan = planOf(sqlDb, SHARED_FOLDERS_SQL)
    expect(foldersPlan.join('\n')).toContain('USING INDEX folders_owner_parent (owner_id=? AND parent_id=?)')
    expect(foldersPlan.filter((d) => d.startsWith('SCAN f'))).toEqual([])
  })

  it('A4 초대 소유자의 전체 폴더·문서 목록을 읽지 않는다', async () => {
    const { env, sqlLog } = makeEnv({
      grants: [folderGrant('F', 'view'), docGrant('d-out', 'edit')],
      folders: [...chainFolders(2), folder('OUT', null)],
      docs: [doc('d-in', 'G2'), doc('d-out', 'OUT')],
    })
    expect([...(await shared(env)).keys()].sort()).toEqual(['d-in', 'd-out'])
    expect(sqlLog.filter((sql) => /FROM folders WHERE owner_id = \?\s*$/.test(sql))).toEqual([])
    expect(sqlLog.filter((sql) => sql.includes('WHERE owner_id = ? AND e2ee_key IS NULL'))).toEqual([])
  })

  it('A5 폴더 초대 소유자 1명과 3명의 질의 수 차이는 소유자 이메일 읽기 2번뿐', async () => {
    const one = makeEnv({
      grants: [folderGrant('A', 'view', 'owner-1')],
      folders: [folder('A', null, 'owner-1')],
      docs: [doc('a', 'A', 'owner-1')],
    })
    const three = makeEnv({
      grants: [folderGrant('A', 'view', 'owner-1'), folderGrant('B', 'view', 'owner-2'), folderGrant('C', 'view', 'owner-3')],
      folders: [folder('A', null, 'owner-1'), folder('B', null, 'owner-2'), folder('C', null, 'owner-3')],
      docs: [doc('a', 'A', 'owner-1'), doc('b', 'B', 'owner-2'), doc('c', 'C', 'owner-3')],
    })
    expect((await shared(one.env)).size).toBe(1)
    expect((await shared(three.env)).size).toBe(3)
    const emailReads = (log: string[]) => log.filter((sql) => sql.startsWith('SELECT email FROM users')).length
    expect(emailReads(three.sqlLog) - emailReads(one.sqlLog)).toBe(2)
    expect(three.sqlLog.length - one.sqlLog.length).toBe(2)
  })

  it('A5 문서 초대만 받았으면 폴더·문서 CTE 를 보내지 않는다', async () => {
    const { env, sqlLog } = makeEnv({
      grants: [docGrant('x', 'view', 'owner-2')],
      folders: [],
      docs: [doc('x', null, 'owner-2')],
    })
    expect((await shared(env)).has('x')).toBe(true)
    expect(sqlLog).not.toContain(SHARED_FOLDERS_SQL)
    expect(sqlLog).not.toContain(SHARED_DOCS_SQL)
    expect(sqlLog.filter((sql) => sql.includes('WITH RECURSIVE'))).toEqual([])
  })
})
