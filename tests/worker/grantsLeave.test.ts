// F-3011 L1~L10 공유에서 나가기 — 받는 쪽 grant 자기 삭제 (specs/features/F-3011.md 6장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const ME = 'me@example.com'
const OTHER = 'other@example.com'
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const D2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function world() {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run('owner', 'owner@example.com', 1)
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run('me', ME, 1)
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run('other', OTHER, 1)
  const calls: Array<{ name: string; email: unknown }> = []
  const getByName = vi.fn((name: string) => ({
    async revalidateConnections(email: unknown) {
      calls.push({ name, email })
    },
  }))
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: ME,
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    DOC_ROOM: { getByName },
  } as unknown as Env
  return { sqlDb, env, getByName, calls }
}
type World = ReturnType<typeof world>

function doc(w: World, id: string, owner = 'owner', folder: string | null = null, e2ee: string | null = null) {
  w.sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, folder_id, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, owner, `t-${id.slice(0, 2)}`, 'c', 'lf', 1, 1, 1, folder, e2ee)
}
function folder(w: World, id: string, owner = 'owner', e2ee = 0) {
  w.sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,NULL,?,?,?)').run(id, owner, 'f', 1, 1, e2ee)
}
function grant(w: World, type: 'doc' | 'folder', id: string, email = ME, role = 'view', owner = 'owner') {
  w.sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)').run(type, id, owner, email, role, 5)
}
const grantCount = (w: World, id: string, email = ME) =>
  (w.sqlDb.prepare('SELECT COUNT(*) AS n FROM grants WHERE target_id = ? AND grantee_email = ?').get(id, email) as { n: number }).n
const writes = (sqlDb: DatabaseSync, id: string) => (sqlDb.prepare('SELECT write_count FROM users WHERE id = ?').get(id) as { write_count: number }).write_count

function leave(w: World, kind: 'docs' | 'folders', id: string) {
  return worker.fetch(new Request(`${ORIGIN}/api/shared/${kind}/${id}`, { method: 'DELETE', headers: { Origin: ORIGIN } }), w.env, ctx)
}
async function shared(w: World) {
  const res = await worker.fetch(new Request(`${ORIGIN}/api/shared`, { headers: { Origin: ORIGIN } }), w.env, ctx)
  return (await res.json()) as Array<{ id: string; role: string; viaFolder?: { id: string } }>
}

describe('F-3011 공유에서 나가기', () => {
  it('L1 문서 직접 grant 삭제, 남의 grant 는 남음', async () => {
    const w = world()
    doc(w, D)
    grant(w, 'doc', D)
    grant(w, 'doc', D, OTHER)
    const res = await leave(w, 'docs', D)
    expect(res.status).toBe(204)
    expect(grantCount(w, D)).toBe(0)
    expect(grantCount(w, D, OTHER)).toBe(1)
    expect((await shared(w)).find((x) => x.id === D)).toBeUndefined()
  })

  it('L2 문서면 revalidateConnections 1회, 소문자 이메일', async () => {
    const w = world()
    doc(w, D)
    grant(w, 'doc', D)
    await leave(w, 'docs', D)
    expect(w.calls).toEqual([{ name: D, email: ME }])
  })

  it('L3 폴더 나가기 — 하위 문서 모두 빠지고 알리지 않음', async () => {
    const w = world()
    folder(w, F)
    doc(w, D, 'owner', F)
    doc(w, D2, 'owner', F)
    grant(w, 'folder', F)
    expect((await shared(w)).length).toBe(2)
    const res = await leave(w, 'folders', F)
    expect(res.status).toBe(204)
    expect(grantCount(w, F)).toBe(0)
    expect(await shared(w)).toEqual([])
    expect(w.getByName).not.toHaveBeenCalled()
  })

  it('L4 행 없음·이미 나감·남의 grant 만 → 404, 쓰기 없음', async () => {
    const w = world()
    doc(w, D)
    doc(w, D2)
    grant(w, 'doc', D2, OTHER)
    const before = writes(w.sqlDb, 'me')
    expect((await leave(w, 'docs', D)).status).toBe(404)
    expect((await leave(w, 'docs', D2)).status).toBe(404)
    grant(w, 'doc', D)
    expect((await leave(w, 'docs', D)).status).toBe(204)
    const mid = writes(w.sqlDb, 'me')
    const again = await leave(w, 'docs', D)
    expect(again.status).toBe(404)
    expect(await again.json()).toEqual({ error: 'not_found' })
    expect(writes(w.sqlDb, 'me')).toBe(mid)
    expect(mid).toBe(before + 1)
    expect(w.getByName).toHaveBeenCalledTimes(1)
  })

  it('L5 폴더 경유로만 받은 문서를 문서 경로로 → 404, 목록 유지', async () => {
    const w = world()
    folder(w, F)
    doc(w, D, 'owner', F)
    grant(w, 'folder', F)
    expect((await leave(w, 'docs', D)).status).toBe(404)
    expect(grantCount(w, F)).toBe(1)
    expect((await shared(w)).find((x) => x.id === D)?.viaFolder?.id).toBe(F)
  })

  it('L6 직접(edit)+폴더(view): 폴더 나가면 직접만 남음', async () => {
    const w = world()
    folder(w, F)
    doc(w, D, 'owner', F)
    grant(w, 'folder', F, ME, 'view')
    grant(w, 'doc', D, ME, 'edit')
    expect((await leave(w, 'folders', F)).status).toBe(204)
    const item = (await shared(w)).find((x) => x.id === D)
    expect(item?.role).toBe('edit')
    expect(item?.viaFolder).toBeUndefined()
  })

  it('L7 직접(edit)+폴더(view): 문서 나가면 폴더 경유 view', async () => {
    const w = world()
    folder(w, F)
    doc(w, D, 'owner', F)
    grant(w, 'folder', F, ME, 'view')
    grant(w, 'doc', D, ME, 'edit')
    expect((await leave(w, 'docs', D)).status).toBe(204)
    const item = (await shared(w)).find((x) => x.id === D)
    expect(item?.role).toBe('view')
    expect(item?.viaFolder?.id).toBe(F)
  })

  it('L8 소유 문서·금고 문서·금고 폴더 → 404, 남 grant 유지', async () => {
    const w = world()
    doc(w, D, 'me')
    grant(w, 'doc', D, OTHER, 'view', 'me')
    doc(w, D2, 'owner', null, 'k')
    folder(w, F, 'owner', 1)
    expect((await leave(w, 'docs', D)).status).toBe(404)
    expect(grantCount(w, D, OTHER)).toBe(1)
    expect((await leave(w, 'docs', D2)).status).toBe(404)
    expect((await leave(w, 'folders', F)).status).toBe(404)
  })

  it('L9 사용량은 받는 쪽만 +1', async () => {
    const w = world()
    doc(w, D)
    grant(w, 'doc', D)
    const me = writes(w.sqlDb, 'me')
    const owner = writes(w.sqlDb, 'owner')
    expect((await leave(w, 'docs', D)).status).toBe(204)
    expect(writes(w.sqlDb, 'me')).toBe(me + 1)
    expect(writes(w.sqlDb, 'owner')).toBe(owner)
  })

  it('L10 막힌 계정은 403 account_blocked, 행 유지', async () => {
    const w = world()
    doc(w, D)
    grant(w, 'doc', D)
    w.sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(1, 'me')
    const res = await leave(w, 'docs', D)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_blocked' })
    expect(grantCount(w, D)).toBe(1)
  })
})
