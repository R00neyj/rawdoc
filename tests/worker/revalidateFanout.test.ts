// F-4002 B1~B7 권한 회수 뒤 열린 방 재검증 배선 (specs/features/F-4002.md 3.1·4장)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'

function makeWorld(email = OWNER) {
  const sqlDb = openTestDb()
  const inner = asD1(sqlDb)
  const sqls: string[] = []
  const DB = {
    prepare(sql: string) {
      sqls.push(sql)
      return inner.prepare(sql)
    },
    batch: inner.batch.bind(inner),
  }
  const calls: Array<{ doc: string; email: string | undefined }> = []
  const room = { throws: false }
  const getByName = vi.fn((doc: string) => ({
    async revalidateConnections(target?: string) {
      if (room.throws) throw new Error('down')
      calls.push({ doc, email: target })
    },
    async purgeRoom() {},
  }))
  const waits: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  const base = { DB, BETTER_AUTH_URL: ORIGIN, WRITE_LIMITER: { limit: async () => ({ success: true }) }, DOC_ROOM: { getByName } }
  const env = (as: string) => ({ ...base, DEV_AUTH_EMAIL: as }) as unknown as Env
  return { sqlDb, env, owner: env(email), sqls, calls, room, waits, ctx }
}

type World = ReturnType<typeof makeWorld>

async function call(w: World, path: string, init: RequestInit = {}, env: Env = w.owner): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, w.ctx)
  await Promise.all(w.waits)
  return res
}

function send(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function setup() {
  const w = makeWorld()
  await call(w, '/api/me')
  const ownerId = (w.sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(OWNER) as { id: string }).id
  w.sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)').run('u2', 'u2@example.com')
  let tick = 0
  const folder = (id: string, parent: string | null, owner = ownerId) =>
    w.sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,1,1)').run(id, owner, id, parent)
  const doc = (id: string, folderId: string | null, opts: { owner?: string; vault?: boolean; updatedAt?: number } = {}) =>
    w.sqlDb
      .prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,'','lf',?,1,1,?,?)")
      .run(id, opts.owner ?? ownerId, id, folderId, opts.updatedAt ?? ++tick, opts.vault ? 'key' : null)
  const grant = (folderId: string, role: 'view' | 'edit', email = FRIEND) =>
    w.sqlDb
      .prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('folder',?,?,?,?,1)")
      .run(folderId, ownerId, email, role)
  return { ...w, ownerId, folder, doc, grant }
}

const docsCalled = (w: World) => w.calls.map((c) => c.doc).sort()

describe('F-4002 B1 폴더 초대 삭제', () => {
  it('하위 문서 방에 이메일과 함께, 밖·금고·다른 소유자는 0', async () => {
    const w = await setup()
    w.folder('F', null)
    w.folder('G', 'F')
    w.folder('OUT', null)
    w.folder('F2', 'F', 'u2')
    w.doc('dF', 'F')
    w.doc('dG', 'G')
    w.doc('dVault', 'F', { vault: true })
    w.doc('dOut', 'OUT')
    w.doc('dOther', 'F2', { owner: 'u2' })
    w.grant('F', 'edit')
    const res = await call(w, `/api/folders/F/grants/${FRIEND}`, send('DELETE'))
    expect(res.status).toBe(204)
    expect(docsCalled(w)).toEqual(['dF', 'dG'])
    expect(w.calls.every((c) => c.email === FRIEND)).toBe(true)
    expect(w.waits.length).toBeGreaterThan(0)
  })
})

describe('F-4002 B2 상한', () => {
  it('하위 문서 25개 → 20번, updated_at 상위 20개, warn 1번', async () => {
    const w = await setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    w.folder('F', null)
    for (let i = 0; i < 25; i++) w.doc(`d${String(i).padStart(2, '0')}`, 'F', { updatedAt: i + 1 })
    await call(w, `/api/folders/F/grants/${FRIEND}`, send('DELETE'))
    expect(w.calls).toHaveLength(20)
    expect(docsCalled(w)).toEqual(Array.from({ length: 20 }, (_, i) => `d${String(i + 5).padStart(2, '0')}`))
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('F-4002 B3 폴더 초대 PUT', () => {
  it('edit → view 는 알리고, 새 view·edit PUT 은 0번', async () => {
    const w = await setup()
    w.folder('F', null)
    w.doc('d1', 'F')
    w.grant('F', 'edit')
    await call(w, `/api/folders/F/grants/${FRIEND}`, send('PUT', { role: 'view' }))
    expect(docsCalled(w)).toEqual(['d1'])
    expect(w.calls[0].email).toBe(FRIEND)

    w.calls.length = 0
    await call(w, `/api/folders/F/grants/${FRIEND}`, send('PUT', { role: 'edit' }))
    expect(w.calls).toHaveLength(0)

    await call(w, '/api/folders/F/grants/new@example.com', send('PUT', { role: 'view' }))
    expect(w.calls).toHaveLength(0)
  })
})

const [P, F, B, A] = ['a', 'b', 'c', 'd'].map((c) => `00000000-0000-4000-8000-00000000000${c}`)

describe('F-4002 B4 폴더 이동', () => {
  it('초대 있는 상위에서 최상위로 → 이메일 없이 하위 방', async () => {
    const w = await setup()
    w.folder(P, null)
    w.folder(F, P)
    w.doc('d1', F)
    w.grant(P, 'edit')
    const res = await call(w, `/api/folders/${F}`, send('PUT', { parentId: null }))
    expect(res.status).toBe(200)
    expect(w.calls).toEqual([{ doc: 'd1', email: undefined }])
  })

  it('상위에 초대가 없으면 0번, 최상위 → 폴더 안은 grants 질의도 없음', async () => {
    const w = await setup()
    w.folder(P, null)
    w.folder(F, P)
    w.folder(B, null)
    w.doc('d1', F)
    await call(w, `/api/folders/${F}`, send('PUT', { parentId: null }))
    expect(w.calls).toHaveLength(0)

    w.sqls.length = 0
    await call(w, `/api/folders/${F}`, send('PUT', { parentId: B }))
    expect(w.calls).toHaveLength(0)
    expect(w.sqls.some((s) => s.includes('FROM grants'))).toBe(false)
  })
})

describe('F-4002 B5 문서 이동', () => {
  it('/api·/v1 모두 폴더가 바뀌면 1번, 같은 폴더는 0', async () => {
    const w = await setup()
    w.folder(A, null)
    w.folder(B, null)
    w.doc('d1', A)
    const created = await call(w, '/api/tokens', send('POST', { name: 't' }))
    const { token } = (await created.json()) as { token: string }
    const v1 = (id: string, folderId: string | null) =>
      call(w, `/v1/docs/${id}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folderId }),
      })

    expect((await call(w, '/api/docs/d1/folder', send('PUT', { folderId: B }))).status).toBe(200)
    expect(w.calls).toEqual([{ doc: 'd1', email: undefined }])

    w.calls.length = 0
    expect((await call(w, '/api/docs/d1/folder', send('PUT', { folderId: B }))).status).toBe(200)
    expect(w.calls).toHaveLength(0)

    expect((await v1('d1', A)).status).toBe(200)
    expect(w.calls).toEqual([{ doc: 'd1', email: undefined }])
  })

  it('금고 문서 이동은 0', async () => {
    const w = await setup()
    w.folder(A, null)
    w.sqlDb.prepare('UPDATE folders SET e2ee = 1 WHERE id = ?').run(A)
    w.doc('dv', null, { vault: true })
    const res = await call(w, '/api/docs/dv/folder', send('PUT', { folderId: A }))
    expect(res.status).toBe(200)
    expect(w.calls).toHaveLength(0)
  })
})

describe('F-4002 B6 move-up 지우기', () => {
  it('초대 있는 폴더는 지우기 전 하위 문서 방에 이메일 없이', async () => {
    const w = await setup()
    w.folder('F', null)
    w.folder('G', 'F')
    w.doc('d1', 'F')
    w.doc('d2', 'G')
    w.grant('F', 'edit')
    const res = await call(w, '/api/folders/F', send('DELETE'))
    expect(res.status).toBe(204)
    expect(docsCalled(w)).toEqual(['d1', 'd2'])
    expect(w.calls.every((c) => c.email === undefined)).toBe(true)
  })

  it('초대 없으면 0번', async () => {
    const w = await setup()
    w.folder('F', null)
    w.doc('d1', 'F')
    expect((await call(w, '/api/folders/F', send('DELETE'))).status).toBe(204)
    expect(w.calls).toHaveLength(0)
  })
})

describe('F-4002 B7 폴더 나가기·RPC 실패', () => {
  it('폴더 나가기는 0번', async () => {
    const w = await setup()
    w.folder('F', null)
    w.doc('d1', 'F')
    w.grant('F', 'edit', FRIEND)
    const friend = w.env(FRIEND)
    const res = await call(w, '/api/shared/folders/F', send('DELETE'), friend)
    expect(res.status).toBe(204)
    expect(w.calls).toHaveLength(0)
  })

  it('RPC 가 던져도 원래 응답 그대로', async () => {
    const w = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    w.room.throws = true
    w.folder('F', null)
    w.doc('d1', 'F')
    w.grant('F', 'edit')
    const res = await call(w, `/api/folders/F/grants/${FRIEND}`, send('DELETE'))
    expect(res.status).toBe(204)
  })
})
