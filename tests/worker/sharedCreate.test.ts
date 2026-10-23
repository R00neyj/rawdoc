// 공유 폴더에 편집 초대자가 새 문서를 만든다 — 소유자는 폴더 주인 (specs/features/F-4017.md)
import { describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'

const current = { id: 'uB', email: 'b@example.com' }
vi.mock('../../worker/auth', () => ({ requireUser: vi.fn(async () => ({ ...current })) }))

import { handleCreateSharedFolderDoc } from '../../worker/sharedCreate'
import { handleGetShared } from '../../worker/grants'
import { DOC_BYTES_QUOTA, DOC_COUNT_QUOTA } from '../../worker/usage'

const F = '11111111-1111-4111-8111-111111111111'
const G = '22222222-2222-4222-8222-222222222222'
const V = '33333333-3333-4333-8333-333333333333'
const OUT = '44444444-4444-4444-8444-444444444444'
const NEW_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_DOC = '66666666-6666-4666-8666-666666666666'

function setup() {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)')
  user.run('uA', 'a@example.com')
  user.run('uB', 'b@example.com')
  user.run('uC', 'c@example.com')
  const folder = sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, e2ee, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)')
  folder.run(F, 'uA', '공유폴더', null, 0)
  folder.run(G, 'uA', '하위', F, 0)
  folder.run(V, 'uA', '금고', F, 1)
  folder.run(OUT, 'uA', '밖', null, 0)
  const grant = sqlDb.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('folder', ?, 'uA', ?, ?, 1)")
  grant.run(F, 'b@example.com', 'edit')
  grant.run(F, 'c@example.com', 'view')
  const env = { DB: asD1(sqlDb) } as unknown as Env
  return { env, sqlDb }
}

function post(env: Env, folderId: string, body: Record<string, unknown> = {}) {
  const req = new Request(`http://local.test/api/shared/folders/${folderId}/docs`, {
    method: 'POST',
    body: JSON.stringify({ title: '새 문서', content: '본문', lineEnding: 'lf', ...body }),
  })
  return handleCreateSharedFolderDoc(req, env, undefined as unknown as ExecutionContext, { id: folderId })
}

async function sharedAs(env: Env, id: string, email: string) {
  current.id = id
  current.email = email
  const res = await handleGetShared(new Request('http://local.test/api/shared'), env)
  current.id = 'uB'
  current.email = 'b@example.com'
  return (await res.json()) as Array<{ id: string }>
}

type Counts = { docs: number; users: unknown[] }
function snapshot(sqlDb: ReturnType<typeof setup>['sqlDb']): Counts {
  return {
    docs: (sqlDb.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n,
    users: sqlDb.prepare('SELECT id, write_count, content_bytes, doc_count FROM users ORDER BY id').all(),
  }
}

describe('F-4017 handleCreateSharedFolderDoc', () => {
  it('A1 편집 초대자가 만들면 소유자는 폴더 주인', async () => {
    const { env, sqlDb } = setup()
    const res = await post(env, F)
    expect(res.status).toBe(201)
    const item = (await res.json()) as Record<string, unknown>
    expect(item).toMatchObject({ role: 'edit', ownerEmail: 'a@example.com', viaFolder: { id: F, name: '공유폴더' }, folderId: F, pinnedAt: null, version: 1 })
    const row = sqlDb.prepare('SELECT owner_id, folder_id FROM docs WHERE id = ?').get(item.id as string)
    expect(row).toMatchObject({ owner_id: 'uA', folder_id: F })
  })

  it('A2 보기 초대자 공유 목록에 보이고 소유자 문서가 된다', async () => {
    const { env, sqlDb } = setup()
    const item = (await (await post(env, F)).json()) as { id: string }
    expect((await sharedAs(env, 'uC', 'c@example.com')).map((d) => d.id)).toContain(item.id)
    const owned = sqlDb.prepare('SELECT id FROM docs WHERE owner_id = ?').all('uA') as Array<{ id: string }>
    expect(owned.map((d) => d.id)).toContain(item.id)
  })

  it('A3 하위 폴더에 만들면 viaFolder 는 초대 폴더', async () => {
    const { env, sqlDb } = setup()
    const res = await post(env, G)
    expect(res.status).toBe(201)
    const item = (await res.json()) as { id: string; viaFolder: { id: string } }
    expect(item.viaFolder.id).toBe(F)
    expect(sqlDb.prepare('SELECT folder_id FROM docs WHERE id = ?').get(item.id)).toMatchObject({ folder_id: G })
  })

  it('A4 권한 없음 갈래는 D1 불변', async () => {
    const { env, sqlDb } = setup()
    sqlDb.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?, 'uA', 't', '', 'lf', ?, 1, 1, 1)").run(OTHER_DOC, OUT)
    sqlDb.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc', ?, 'uA', 'b@example.com', 'edit', 1)").run(OTHER_DOC)
    const before = snapshot(sqlDb)

    const asView = await (async () => {
      current.id = 'uC'
      current.email = 'c@example.com'
      const r = await post(env, F)
      current.id = 'uB'
      current.email = 'b@example.com'
      return r
    })()
    expect(asView.status).toBe(403)
    expect(await asView.json()).toEqual({ error: 'forbidden' })

    for (const id of [OUT, '77777777-7777-4777-8777-777777777777', 'not-a-uuid']) {
      const res = await post(env, id)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    expect(snapshot(sqlDb)).toEqual(before)
  })

  it('A5 내 폴더는 409, 금고 하위 폴더는 404', async () => {
    const { env } = setup()
    current.id = 'uA'
    current.email = 'a@example.com'
    const mine = await post(env, F)
    current.id = 'uB'
    current.email = 'b@example.com'
    expect(mine.status).toBe(409)
    expect(await mine.json()).toEqual({ error: 'own_folder' })
    expect((await post(env, V)).status).toBe(404)
  })

  it('A6 금지 필드는 400 이고 field 가 그 이름', async () => {
    const { env } = setup()
    for (const [field, value] of [['folderId', F], ['pinnedAt', 5], ['e2eeKey', 'x'], ['attachmentRefs', []]] as const) {
      const res = await post(env, F, { [field]: value })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field })
    }
  })

  it('A7 같은 id 재시도는 200 같은 항목, 남의 문서 id 는 409 불변', async () => {
    const { env, sqlDb } = setup()
    const first = await post(env, F, { id: NEW_ID })
    expect(first.status).toBe(201)
    const firstItem = await first.json()
    const again = await post(env, F, { id: NEW_ID })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(firstItem)
    expect((sqlDb.prepare('SELECT COUNT(*) AS n FROM docs WHERE id = ?').get(NEW_ID) as { n: number }).n).toBe(1)

    sqlDb.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?, 'uC', '남', '남의 본문', 'lf', NULL, 3, 1, 1)").run(OTHER_DOC)
    const taken = await post(env, F, { id: OTHER_DOC })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'id_taken' })
    expect(sqlDb.prepare('SELECT title, content, version FROM docs WHERE id = ?').get(OTHER_DOC)).toEqual({ title: '남', content: '남의 본문', version: 3 })
  })

  it('A8 소유자 한도는 413 owner_quota_exceeded 이고 사용량을 싣지 않는다', async () => {
    const { env, sqlDb } = setup()
    sqlDb.prepare("UPDATE users SET doc_count = ? WHERE id = 'uA'").run(DOC_COUNT_QUOTA)
    const byDocs = await post(env, F)
    expect(byDocs.status).toBe(413)
    expect(await byDocs.json()).toEqual({ error: 'owner_quota_exceeded', resource: 'docs' })

    sqlDb.prepare("UPDATE users SET doc_count = 0, content_bytes = ? WHERE id = 'uA'").run(DOC_BYTES_QUOTA)
    const byBytes = await post(env, F)
    expect(byBytes.status).toBe(413)
    expect(await byBytes.json()).toEqual({ error: 'owner_quota_exceeded', resource: 'bytes' })
  })

  it('A9 소유자 누계는 늘고 보낸 사람은 하루 카운터만', async () => {
    const { env, sqlDb } = setup()
    expect((await post(env, F, { content: '가나다' })).status).toBe(201)
    const usage = (id: string) => sqlDb.prepare('SELECT write_count, content_bytes, doc_count FROM users WHERE id = ?').get(id)
    expect(usage('uA')).toEqual({ write_count: 0, content_bytes: 9, doc_count: 1 })
    expect(usage('uB')).toEqual({ write_count: 1, content_bytes: 0, doc_count: 0 })
  })

  it('A10 소유자가 막혔으면 403 account_blocked 이고 행이 없다', async () => {
    const { env, sqlDb } = setup()
    sqlDb.prepare("UPDATE users SET blocked_at = 1 WHERE id = 'uA'").run()
    const res = await post(env, F)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_blocked' })
    expect((sqlDb.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n).toBe(0)
  })
})
