// F-4006 O1~O7 권한 요청 승인·거절·정리 (specs/features/F-4006.md 5장)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from '../../worker/testD1'
import { setDocE2eeStatements } from '../../worker/e2eeDocs'
import { purgeAccessRequests } from '../../worker/accessRequests'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOC_V = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DOC_X = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CHILD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const tk = (c: string) => c.repeat(43)
const TK_A = tk('a')
const TK_BUNDLE = tk('b')
const TK_FOLDER = tk('f')
const TK_CHILD = tk('e')
const TK_DEAD = tk('d')
const TK_VAULT = tk('v')
const TK_BLOCKED = tk('k')
const T0 = Date.parse('2026-10-12T00:00:00Z')
const DAY = 24 * 3_600_000
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

type Row = Record<string, unknown>

function world() {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at, name) VALUES (?,?,?,?)')
  user.run('owner', OWNER, 1, '소유자 이름')
  user.run('friend', FRIEND, 1, '친구')
  user.run('third', 'third@example.com', 1, '셋째')
  user.run('other', 'other@example.com', 1, '다른 소유자')
  sqlDb.prepare('UPDATE users SET blocked_at = 1 WHERE id = ?').run('other')
  const doc = sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, folder_id, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
  doc.run(DOC_A, 'owner', '문서 A', 'c', 'lf', 1, 1, 1, null, null)
  doc.run(DOC_B, 'owner', '문서 B', 'c', 'lf', 1, 1, 1, null, null)
  doc.run(DOC_V, 'owner', '금고', 'c', 'lf', 1, 1, 1, null, 'k')
  doc.run(DOC_X, 'other', '남의 문서', 'c', 'lf', 1, 1, 1, null, null)
  const folder = sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,1,1)')
  folder.run(FOLDER, 'owner', '자료실', null)
  folder.run(CHILD, 'owner', '하위', FOLDER)
  const link = sqlDb.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,1,?)')
  link.run(TK_A, 'owner', 'doc', DOC_A, null)
  link.run(TK_BUNDLE, 'owner', 'doc', DOC_A, null)
  link.run(TK_FOLDER, 'owner', 'folder', FOLDER, null)
  link.run(TK_CHILD, 'owner', 'folder', CHILD, null)
  link.run(TK_DEAD, 'owner', 'doc', DOC_B, 5)
  link.run(TK_VAULT, 'owner', 'doc', DOC_V, null)
  link.run(TK_BLOCKED, 'other', 'doc', DOC_X, null)
  sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run(TK_BUNDLE, DOC_B)
  return sqlDb
}

function envFor(sqlDb: DatabaseSync, email: string): Env {
  return { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: email, WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as Env
}

function call(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (init.body) headers.set('Content-Type', 'application/json')
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

const approve = (env: Env, id: string) => call(env, `/api/access-requests/${id}/approve`, { method: 'POST' })
const reject = (env: Env, id: string) => call(env, `/api/access-requests/${id}/reject`, { method: 'POST' })
const del = (env: Env, path: string) => call(env, path, { method: 'DELETE' })

const requests = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT * FROM access_requests ORDER BY created_at, id').all() as Row[]
const requestIds = (sqlDb: DatabaseSync) => requests(sqlDb).map((r) => r.id)
const one = (sqlDb: DatabaseSync, sql: string, ...args: (string | number)[]) => (sqlDb.prepare(sql).get(...args) as { n: number }).n
const writeCount = (sqlDb: DatabaseSync, id = 'owner') => one(sqlDb, 'SELECT write_count AS n FROM users WHERE id = ?', id)
const notifRev = (sqlDb: DatabaseSync, id = 'owner') => one(sqlDb, 'SELECT notif_rev AS n FROM users WHERE id = ?', id)
const notifCount = (sqlDb: DatabaseSync, where: string, ...args: (string | number)[]) => one(sqlDb, `SELECT COUNT(*) AS n FROM notifications WHERE ${where}`, ...args)
const grantRows = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT target_type, target_id, grantee_email, role FROM grants ORDER BY target_id, grantee_email').all() as Row[]

function seedRequest(sqlDb: DatabaseSync, r: Partial<Row> & { requester_id: string }) {
  const row = {
    id: crypto.randomUUID(), target_type: 'doc', target_id: DOC_A, owner_id: 'owner', token: TK_A, requester_email: `${r.requester_id}@example.com`,
    requester_name: 'n', role: 'view', status: 'pending', created_at: T0, decided_at: null, ...r,
  }
  sqlDb
    .prepare('INSERT INTO access_requests (id, target_type, target_id, owner_id, token, requester_id, requester_email, requester_name, role, status, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.target_type, row.target_id, row.owner_id, row.token, row.requester_id, row.requester_email, row.requester_name, row.role, row.status, row.created_at, row.decided_at)
  if (row.status === 'pending') seedNotif(sqlDb, row.id as string, row.target_type as string, row.target_id as string, row.owner_id === 'other' ? 'other@example.com' : OWNER)
  return row.id as string
}

function seedNotif(sqlDb: DatabaseSync, id: string, targetType: string, targetId: string, recipient: string) {
  sqlDb
    .prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, folder_id, actor_email, doc_title, excerpt, created_at, role) VALUES (?,?,'access_request',?,?,?,?,'',?,'view')")
    .run(id, recipient, targetType === 'doc' ? targetId : null, targetType === 'folder' ? targetId : null, FRIEND, '제목', T0)
}

function addGrant(sqlDb: DatabaseSync, targetType: string, targetId: string, email: string, role: string) {
  sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)').run(targetType, targetId, 'owner', email, role)
}

function addUsers(sqlDb: DatabaseSync, ...ids: string[]) {
  for (const id of ids) sqlDb.prepare('INSERT INTO users (id, email, created_at, name) VALUES (?,?,1,?)').run(id, `${id}@example.com`, id)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('F-4006 O1 새 초대가 되는 승인', () => {
  it('grants·share 알림·요청·알림함 행·사용량, 응답 { email, role }', async () => {
    const sqlDb = world()
    const id = seedRequest(sqlDb, { requester_id: 'friend', role: 'edit' })
    const before = writeCount(sqlDb)
    const res = await approve(envFor(sqlDb, OWNER), id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: FRIEND, role: 'edit' })
    expect(grantRows(sqlDb)).toEqual([{ target_type: 'doc', target_id: DOC_A, grantee_email: FRIEND, role: 'edit' }])
    expect(notifCount(sqlDb, "kind = 'share' AND recipient_email = ?", FRIEND)).toBe(1)
    expect(requests(sqlDb)).toHaveLength(0)
    expect(notifCount(sqlDb, "kind = 'access_request'")).toBe(0)
    expect(writeCount(sqlDb)).toBe(before + 1)
  })
})

describe('F-4006 O2 낮추지 않는다', () => {
  it('보기 초대 + 편집 요청 → 편집, 새 share 행 없음 / 편집 초대 + 보기 요청 → 그대로, 응답 edit', async () => {
    const sqlDb = world()
    addGrant(sqlDb, 'doc', DOC_A, FRIEND, 'view')
    addGrant(sqlDb, 'doc', DOC_B, FRIEND, 'edit')
    const raise = seedRequest(sqlDb, { requester_id: 'friend', role: 'edit' })
    const lower = seedRequest(sqlDb, { requester_id: 'friend', target_id: DOC_B, token: TK_BUNDLE, role: 'view' })
    const env = envFor(sqlDb, OWNER)

    expect(await (await approve(env, raise)).json()).toEqual({ email: FRIEND, role: 'edit' })
    expect(notifCount(sqlDb, "kind = 'share'")).toBe(0)
    const res = await approve(env, lower)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: FRIEND, role: 'edit' })
    expect(grantRows(sqlDb)).toEqual([
      { target_type: 'doc', target_id: DOC_A, grantee_email: FRIEND, role: 'edit' },
      { target_type: 'doc', target_id: DOC_B, grantee_email: FRIEND, role: 'edit' },
    ])
    expect(requests(sqlDb)).toHaveLength(0)
  })
})

describe('F-4006 O3 404', () => {
  it('남의 요청·거절·없는 id·링크 끊김·금고·묶음에서 빠진 대상 — 행 그대로, grants 0', async () => {
    const sqlDb = world()
    addUsers(sqlDb, 'r1', 'r2', 'r3', 'r4', 'r5')
    const foreign = seedRequest(sqlDb, { requester_id: 'r1', owner_id: 'other', target_id: DOC_X, token: TK_BLOCKED })
    const rejected = seedRequest(sqlDb, { requester_id: 'r2', status: 'rejected', decided_at: T0 })
    const dead = seedRequest(sqlDb, { requester_id: 'r3', target_id: DOC_B, token: TK_DEAD })
    const vault = seedRequest(sqlDb, { requester_id: 'r4', target_id: DOC_V, token: TK_VAULT })
    const dropped = seedRequest(sqlDb, { requester_id: 'r5', target_id: DOC_B, token: TK_A })
    const before = requests(sqlDb)
    const env = envFor(sqlDb, OWNER)

    for (const id of [foreign, rejected, dead, vault, dropped, crypto.randomUUID()]) {
      const res = await approve(env, id)
      expect(res.status, id).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
      expect((await reject(env, id)).status, id).toBe(404)
    }
    expect(requests(sqlDb)).toEqual(before)
    expect(grantRows(sqlDb)).toHaveLength(0)
  })
})

describe('F-4006 O4 거절', () => {
  it('rejected·decided_at, 알림 행 0, 요청 행 남음, 다시 거절 404', async () => {
    const sqlDb = world()
    const id = seedRequest(sqlDb, { requester_id: 'friend' })
    const env = envFor(sqlDb, OWNER)
    const res = await reject(env, id)
    expect(res.status).toBe(204)
    expect(requests(sqlDb)).toMatchObject([{ id, status: 'rejected', decided_at: T0 }])
    expect(notifCount(sqlDb, "kind = 'access_request'")).toBe(0)
    expect(grantRows(sqlDb)).toHaveLength(0)
    expect((await reject(env, id)).status).toBe(404)
  })
})

describe('F-4006 O5 정리 자리', () => {
  function seedPair(sqlDb: DatabaseSync, target: { type: 'doc' | 'folder'; id: string; token: string }) {
    const mine = seedRequest(sqlDb, { requester_id: 'friend', target_type: target.type, target_id: target.id, token: target.token })
    const keep = seedRequest(sqlDb, { requester_id: 'third', target_id: DOC_B, token: TK_BUNDLE })
    return { mine, keep }
  }
  const expectCleared = (sqlDb: DatabaseSync, pair: { mine: string; keep: string }) => {
    expect(requestIds(sqlDb)).toEqual([pair.keep])
    expect(notifCount(sqlDb, "kind = 'access_request'")).toBe(1)
  }

  it('문서 영구 삭제 — 휴지통 동안은 남고 DELETE /api/trash/:id 에서 정리 (F-3023)', async () => {
    const sqlDb = world()
    const pair = seedPair(sqlDb, { type: 'doc', id: DOC_A, token: TK_A })
    expect((await del(envFor(sqlDb, OWNER), `/api/docs/${DOC_A}`)).status).toBe(204)
    expect(requestIds(sqlDb)).toContain(pair.mine)
    expect((await del(envFor(sqlDb, OWNER), `/api/trash/${DOC_A}`)).status).toBe(204)
    expectCleared(sqlDb, pair)
  })

  it('폴더 삭제', async () => {
    const sqlDb = world()
    const pair = seedPair(sqlDb, { type: 'folder', id: FOLDER, token: TK_FOLDER })
    expect((await del(envFor(sqlDb, OWNER), `/api/folders/${FOLDER}`)).status).toBe(204)
    expectCleared(sqlDb, pair)
  })

  it('문서를 금고로 옮김·폴더를 금고로 켬', async () => {
    const sqlDb = world()
    const pair = seedPair(sqlDb, { type: 'doc', id: DOC_A, token: TK_A })
    const db = asD1(sqlDb)
    await db.batch(setDocE2eeStatements(db, { docId: DOC_A, ownerId: 'owner', title: 't', content: 'c', e2eeKey: 'wrapped', attachmentRefs: [], baseVersion: 1, now: T0, deltaBytes: 0 }))
    expectCleared(sqlDb, pair)

    const folderDb = world()
    const folderPair = seedPair(folderDb, { type: 'folder', id: CHILD, token: TK_CHILD })
    const res = await call(envFor(folderDb, OWNER), `/api/folders/${CHILD}`, { method: 'PUT', body: JSON.stringify({ e2ee: true }) })
    expect(res.status).toBe(200)
    expectCleared(folderDb, folderPair)
  })

  it('링크 끊기 — 그 대상의 끊긴 토큰만, 다른 토큰 행은 그대로', async () => {
    const sqlDb = world()
    const mine = seedRequest(sqlDb, { requester_id: 'friend' })
    const viaBundle = seedRequest(sqlDb, { requester_id: 'third', target_id: DOC_B, token: TK_BUNDLE })
    const folderReq = seedRequest(sqlDb, { requester_id: 'friend', target_type: 'folder', target_id: FOLDER, token: TK_FOLDER })
    const childReq = seedRequest(sqlDb, { requester_id: 'third', target_type: 'folder', target_id: CHILD, token: TK_CHILD })
    const env = envFor(sqlDb, OWNER)
    expect((await del(env, `/api/docs/${DOC_A}/link`)).status).toBe(204)
    expect(requestIds(sqlDb).sort()).toEqual([folderReq, childReq].sort())
    expect(requestIds(sqlDb)).not.toContain(mine)
    expect(requestIds(sqlDb)).not.toContain(viaBundle)
    expect(notifCount(sqlDb, "kind = 'access_request'")).toBe(2)

    expect((await del(env, `/api/folders/${FOLDER}/link`)).status).toBe(204)
    expect(requestIds(sqlDb)).toEqual([childReq])
  })

  it('주인이 같은 사람을 직접 초대 — 대기·거절 모두, 다른 사람·다른 대상은 그대로', async () => {
    for (const status of ['pending', 'rejected'] as const) {
      const sqlDb = world()
      const mine = seedRequest(sqlDb, { requester_id: 'friend', status, decided_at: status === 'rejected' ? T0 : null })
      const otherTarget = seedRequest(sqlDb, { requester_id: 'friend', target_id: DOC_B, token: TK_BUNDLE })
      const otherPerson = seedRequest(sqlDb, { requester_id: 'third' })
      const res = await call(envFor(sqlDb, OWNER), `/api/docs/${DOC_A}/grants/${FRIEND}`, { method: 'PUT', body: JSON.stringify({ role: 'view' }) })
      expect(res.status, status).toBe(200)
      expect(requestIds(sqlDb).sort(), status).toEqual([otherTarget, otherPerson].sort())
      expect(requestIds(sqlDb)).not.toContain(mine)
    }
  })

  it('계정 삭제 — 주인 쪽·요청자 쪽 각각 204', async () => {
    const owner = world()
    seedRequest(owner, { requester_id: 'friend' })
    seedRequest(owner, { requester_id: 'third', target_type: 'folder', target_id: FOLDER, token: TK_FOLDER })
    expect((await del(envFor(owner, OWNER), '/api/account')).status).toBe(204)
    expect(requests(owner)).toHaveLength(0)
    expect(notifCount(owner, "kind = 'access_request'")).toBe(0)

    const requester = world()
    seedRequest(requester, { requester_id: 'friend' })
    const keep = seedRequest(requester, { requester_id: 'third', target_id: DOC_B, token: TK_BUNDLE })
    expect((await del(envFor(requester, FRIEND), '/api/account')).status).toBe(204)
    expect(requestIds(requester)).toEqual([keep])
    expect(notifCount(requester, "kind = 'access_request'")).toBe(1)
  })
})

describe('F-4006 O6 매일 Cron', () => {
  it('30일 지난 대기·7일 지난 거절·묶음에서 빠진 대상 지움, 막힌 주인·기한 안 행 남음, notif_rev +1', async () => {
    const sqlDb = world()
    addUsers(sqlDb, 'r1', 'r2', 'r3', 'r4', 'r5', 'r6')
    const expired = seedRequest(sqlDb, { requester_id: 'r1', created_at: T0 - 31 * DAY })
    const fresh = seedRequest(sqlDb, { requester_id: 'r2', created_at: T0 - 29 * DAY })
    const oldRejected = seedRequest(sqlDb, { requester_id: 'r3', status: 'rejected', decided_at: T0 - 8 * DAY })
    const youngRejected = seedRequest(sqlDb, { requester_id: 'r4', status: 'rejected', decided_at: T0 - 6 * DAY })
    const notLive = seedRequest(sqlDb, { requester_id: 'r5', target_id: DOC_B, token: TK_A })
    const blocked = seedRequest(sqlDb, { requester_id: 'r6', owner_id: 'other', target_id: DOC_X, token: TK_BLOCKED })
    const revBefore = notifRev(sqlDb)
    await purgeAccessRequests(envFor(sqlDb, OWNER), T0)
    expect(requestIds(sqlDb).sort()).toEqual([fresh, youngRejected, blocked].sort())
    expect([expired, oldRejected, notLive].some((id) => requestIds(sqlDb).includes(id))).toBe(false)
    expect(notifCount(sqlDb, "kind = 'access_request' AND recipient_email = ?", OWNER)).toBe(1)
    expect(notifCount(sqlDb, "kind = 'access_request' AND recipient_email = 'other@example.com'")).toBe(1)
    expect(notifRev(sqlDb)).toBeGreaterThan(revBefore)
  })
})

describe('F-4006 O7 GET /api/shares requests', () => {
  it('살아 있는 대기만, 키가 AccessRequestRow 와 같고 createdAt 내림, 거절·남의 것·죽은 것 없음', async () => {
    const sqlDb = world()
    addUsers(sqlDb, 'r1', 'r2', 'r3', 'r4')
    const doc = seedRequest(sqlDb, { requester_id: 'friend', role: 'edit', requester_name: '친구 이름', created_at: T0 - 2 })
    const folder = seedRequest(sqlDb, { requester_id: 'third', target_type: 'folder', target_id: FOLDER, token: TK_FOLDER, created_at: T0 - 1 })
    seedRequest(sqlDb, { requester_id: 'r1', status: 'rejected', decided_at: T0 })
    seedRequest(sqlDb, { requester_id: 'r2', owner_id: 'other', target_id: DOC_X, token: TK_BLOCKED })
    seedRequest(sqlDb, { requester_id: 'r3', target_id: DOC_B, token: TK_A })
    seedRequest(sqlDb, { requester_id: 'r4', target_id: DOC_V, token: TK_VAULT })

    const res = await call(envFor(sqlDb, OWNER), '/api/shares')
    const body = (await res.json()) as { requests: Row[] }
    expect(body.requests.map((r) => r.id)).toEqual([folder, doc])
    expect(Object.keys(body.requests[1]).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role', 'targetId', 'targetName', 'targetType'])
    expect(body.requests[1]).toEqual({ id: doc, targetType: 'doc', targetId: DOC_A, targetName: '문서 A', email: 'friend@example.com', name: '친구 이름', role: 'edit', createdAt: T0 - 2 })
    expect(body.requests[0]).toMatchObject({ targetType: 'folder', targetName: '자료실' })
  })
})
