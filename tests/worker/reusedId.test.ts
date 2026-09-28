// 지운 문서·폴더 id 를 남이 다시 만들어도 옛 공개 링크·초대가 따라오지 않는다 (리뷰 W2·W4) — worker/index.ts 를 통째로
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
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
const VICTIM = 'victim@example.com'
const MALLORY = 'mallory@example.com'
const FRIEND = 'friend@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeWorld() {
  const sqlDb = openTestDb()
  const DOC_ROOM = {
    getByName: () => ({
      async purgeRoom() {},
      async revalidateConnections() {},
    }),
  }
  const base = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    DOC_ROOM,
  }
  const as = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  return { sqlDb, victim: as(VICTIM), mallory: as(MALLORY), friend: as(FRIEND), anon: base as unknown as Env }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function json(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method }
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function userId(env: Env, sqlDb: DatabaseSync, email: string): Promise<string> {
  await call(env, '/api/me')
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

async function createDoc(env: Env, id: string, title: string, folderId: string | null = null) {
  const res = await call(env, '/api/docs', json('POST', { id, title, content: `${title} 본문`, lineEnding: 'lf', folderId }))
  expect(res.status).toBe(201)
}

async function createFolder(env: Env, id: string, name: string, parentId: string | null = null) {
  const res = await call(env, '/api/folders', json('POST', { id, name, parentId }))
  expect(res.status).toBe(201)
}

async function linkOf(env: Env, kind: 'docs' | 'folders', id: string): Promise<string> {
  const res = await call(env, `/api/${kind}/${id}/link`, json('POST'))
  expect([200, 201]).toContain(res.status)
  return ((await res.json()) as { token: string }).token
}

async function grant(env: Env, kind: 'docs' | 'folders', id: string, email: string) {
  const res = await call(env, `/api/${kind}/${id}/grants/${encodeURIComponent(email)}`, json('PUT', { role: 'edit' }))
  expect(res.status).toBe(200)
}

function activeLinks(sqlDb: DatabaseSync, id: string): number {
  return (sqlDb.prepare('SELECT COUNT(*) AS n FROM share_links WHERE target_id = ? AND revoked_at IS NULL').get(id) as { n: number }).n
}

function grantRows(sqlDb: DatabaseSync, id: string): number {
  return (sqlDb.prepare('SELECT COUNT(*) AS n FROM grants WHERE target_id = ?').get(id) as { n: number }).n
}

describe('리뷰 W2·W4 삭제 경로가 링크·초대를 정리한다', () => {
  it('문서 삭제 — 공개 링크는 폐기, 문서 초대는 삭제', async () => {
    const w = makeWorld()
    const X = uuid(1)
    await createDoc(w.victim, X, '피해자 문서')
    await linkOf(w.victim, 'docs', X)
    await grant(w.victim, 'docs', X, FRIEND)

    expect((await call(w.victim, `/api/docs/${X}`, json('DELETE'))).status).toBe(204)
    expect(activeLinks(w.sqlDb, X)).toBe(0)
    expect(grantRows(w.sqlDb, X)).toBe(0)
  })

  it('폴더 전체 삭제 — 안의 문서·폴더 링크와 초대가 모두 정리된다', async () => {
    const w = makeWorld()
    const F = uuid(10)
    const S = uuid(11)
    const D = uuid(12)
    await createFolder(w.victim, F, '위')
    await createFolder(w.victim, S, '아래', F)
    await createDoc(w.victim, D, '안 문서', S)
    await linkOf(w.victim, 'folders', F)
    await linkOf(w.victim, 'folders', S)
    await linkOf(w.victim, 'docs', D)
    await grant(w.victim, 'folders', F, FRIEND)
    await grant(w.victim, 'folders', S, FRIEND)
    await grant(w.victim, 'docs', D, FRIEND)

    expect((await call(w.victim, `/api/folders/${F}?contents=delete-all`, json('DELETE'))).status).toBe(204)
    for (const id of [F, S, D]) {
      expect(activeLinks(w.sqlDb, id)).toBe(0)
      expect(grantRows(w.sqlDb, id)).toBe(0)
    }
  })

  it('폴더 삭제(내용 위로) — 지운 폴더의 링크·초대만 정리되고 올라간 문서의 것은 남는다', async () => {
    const w = makeWorld()
    const F = uuid(20)
    const D = uuid(21)
    await createFolder(w.victim, F, '지울 폴더')
    await createDoc(w.victim, D, '올라갈 문서', F)
    await linkOf(w.victim, 'folders', F)
    await grant(w.victim, 'folders', F, FRIEND)
    await linkOf(w.victim, 'docs', D)
    await grant(w.victim, 'docs', D, FRIEND)

    expect((await call(w.victim, `/api/folders/${F}`, json('DELETE'))).status).toBe(204)
    expect(activeLinks(w.sqlDb, F)).toBe(0)
    expect(grantRows(w.sqlDb, F)).toBe(0)
    expect(activeLinks(w.sqlDb, D)).toBe(1)
    expect(grantRows(w.sqlDb, D)).toBe(1)
  })
})

// 수정 전에 지워져 남은 행(링크·초대)은 그대로 있다 — 읽는 쪽이 소유자를 대조해 막는다
describe('리뷰 W2·W4 남은 행이 다른 소유자의 같은 id 에 붙지 않는다', () => {
  async function staleWorld() {
    const w = makeWorld()
    const victimId = await userId(w.victim, w.sqlDb, VICTIM)
    await userId(w.mallory, w.sqlDb, MALLORY)
    await userId(w.friend, w.sqlDb, FRIEND)
    const X = uuid(30)
    const Y = uuid(31)
    const token = 't'.repeat(43)
    const folderToken = 'u'.repeat(43)
    w.sqlDb.prepare("INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, ?, 'doc', ?, 1, NULL)").run(token, victimId, X)
    w.sqlDb.prepare("INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, ?, 'folder', ?, 1, NULL)").run(folderToken, victimId, Y)
    w.sqlDb.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc', ?, ?, ?, 'edit', 1)").run(X, victimId, FRIEND)
    w.sqlDb.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('folder', ?, ?, ?, 'edit', 1)").run(Y, victimId, FRIEND)
    await createFolder(w.mallory, Y, '공격자 폴더')
    await createDoc(w.mallory, X, '공격자 문서', Y)
    return { ...w, X, Y, token, folderToken }
  }

  it('옛 공개 링크로 새 문서·폴더가 보이지 않는다', async () => {
    const w = await staleWorld()
    expect((await call(w.anon, `/pub/docs/${w.token}`)).status).toBe(404)
    expect((await call(w.anon, `/pub/docs/${w.token}/docs/${w.X}`)).status).toBe(404)
    const set = await call(w.anon, `/pub/docs/${w.token}/set`)
    expect(await set.text()).not.toContain('공격자 문서')
    expect((await call(w.anon, `/pub/folders/${w.folderToken}`)).status).toBe(404)
  })

  it('옛 링크 주인의 공유 목록에 새 문서 제목이 뜨지 않는다', async () => {
    const w = await staleWorld()
    const res = await call(w.victim, '/api/shares')
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain('공격자')
  })

  it('새 주인이 링크를 만들면 옛 토큰이 아니라 새 토큰을 받는다', async () => {
    const w = await staleWorld()
    const token = await linkOf(w.mallory, 'docs', w.X)
    expect(token).not.toBe(w.token)
  })

  it('옛 초대로 새 문서에 접근하지 못하고 공유받은 목록에도 없다', async () => {
    const w = await staleWorld()
    expect((await call(w.friend, `/api/docs/${w.X}`)).status).toBe(404)
    const shared = await call(w.friend, '/api/shared')
    expect(await shared.json()).toEqual([])
    expect((await call(w.friend, `/api/folders/${w.Y}/grants`)).status).toBe(404)
  })

  it('새 주인에게 옛 초대 이메일이 보이지 않는다', async () => {
    const w = await staleWorld()
    const docGrants = await call(w.mallory, `/api/docs/${w.X}/grants`)
    expect(await docGrants.json()).toEqual([])
    const folderGrants = await call(w.mallory, `/api/folders/${w.Y}/grants`)
    expect(await folderGrants.json()).toEqual([])
  })

  it('새 주인이 같은 사람을 초대하면 그 초대는 새 주인 것으로 효력이 있다', async () => {
    const w = await staleWorld()
    await grant(w.mallory, 'docs', w.X, FRIEND)
    expect((await call(w.friend, `/api/docs/${w.X}`)).status).toBe(200)
    const list = await call(w.mallory, `/api/docs/${w.X}/grants`)
    expect(((await list.json()) as { email: string }[]).map((g) => g.email)).toEqual([FRIEND])
  })
})
