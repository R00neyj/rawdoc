// F-3020 N1~N7 권한 요청 알림함 행·푸시·목록·정리 (specs/features/F-3020.md 5장)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from '../../worker/testD1'
import { cleanupComments } from '../../worker/commentGc'
import { accessRequestPushPayload as payloadOf } from '../../src/lib/pushText'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))
vi.mock('../../src/lib/pushText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pushText')>()
  return { ...actual, accessRequestPushPayload: vi.fn(actual.accessRequestPushPayload) }
})

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  worker = (await import('../../worker/index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const THIRD = 'third@example.com'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const tk = (c: string) => c.repeat(43)
const TK_A = tk('a')
const TK_B = tk('b')
const TK_FOLDER = tk('f')
const T0 = Date.parse('2026-10-12T00:00:00Z')

type Row = Record<string, unknown>
type Held = Promise<unknown>[]

let jwk = ''
let keys: { p256dh: string; auth: string } | null = null

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function pushFixtures() {
  if (jwk && keys) return
  const sign = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', sign.privateKey))
  const ecdh = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', ecdh.publicKey)) as ArrayBuffer)
  keys = { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) }
}

async function world(opts: { vapid?: boolean } = {}) {
  const { vapid = true } = opts
  await pushFixtures()
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at, name) VALUES (?,?,?,?)')
  user.run('owner', OWNER, 1, '소유자')
  user.run('friend', FRIEND, 1, '친구')
  user.run('third', THIRD, 1, '셋째')
  const doc = sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, folder_id, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
  doc.run(DOC_A, 'owner', '문서 A', 'c', 'lf', 1, 1, 1, null, null)
  doc.run(DOC_B, 'owner', '문서 B', 'c', 'lf', 1, 1, 1, null, null)
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,NULL,1,1)').run(FOLDER, 'owner', '자료실')
  const link = sqlDb.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,1,NULL)')
  link.run(TK_A, 'owner', 'doc', DOC_A)
  link.run(TK_B, 'owner', 'doc', DOC_B)
  link.run(TK_FOLDER, 'owner', 'folder', FOLDER)
  sqlDb
    .prepare('INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?,?)')
    .run('s1', 'owner', null, 'https://fcm.googleapis.com/fcm/send/s1', keys!.p256dh, keys!.auth, 1)
  const held: Held = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void held.push(p), passThroughOnException() {} } as unknown as ExecutionContext
  const envFor = (email: string) =>
    ({ DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: email, WRITE_LIMITER: { limit: async () => ({ success: true }) }, ...(vapid ? { VAPID_PRIVATE_JWK: jwk } : {}) }) as unknown as Env
  return { sqlDb, held, ctx, envFor }
}
type World = Awaited<ReturnType<typeof world>>

function call(w: World, email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (init.body) headers.set('Content-Type', 'application/json')
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), w.envFor(email), w.ctx)
}

const post = async (w: World, email: string, token: string, role: 'view' | 'edit', docId?: string) => {
  const res = await call(w, email, `/api/access-requests/link/${token}`, { method: 'POST', body: JSON.stringify({ role, ...(docId ? { docId } : {}) }) })
  await Promise.all(w.held)
  return res
}
const cancel = (w: World, email: string, token: string) => call(w, email, `/api/access-requests/link/${token}`, { method: 'DELETE' })

const notifs = (sqlDb: DatabaseSync, where = "kind = 'access_request'") => sqlDb.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at, id`).all() as Row[]
const rev = (sqlDb: DatabaseSync, id: string) => (sqlDb.prepare('SELECT notif_rev AS n FROM users WHERE id = ?').get(id) as { n: number }).n
const requestRows = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT * FROM access_requests ORDER BY created_at, id').all() as Row[]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('F-3020 N1 새 요청의 알림함 행', () => {
  it('문서 — 2장 값 그대로, 소유자 notif_rev +1, 요청자 그대로', async () => {
    const w = await world()
    const res = await post(w, FRIEND, TK_A, 'edit')
    expect(res.status).toBe(201)
    const id = (requestRows(w.sqlDb)[0] as { id: string }).id
    expect(notifs(w.sqlDb)).toMatchObject([
      { id, recipient_email: OWNER, kind: 'access_request', doc_id: DOC_A, folder_id: null, comment_id: null, thread_id: null, actor_email: FRIEND, doc_title: '문서 A', excerpt: '', created_at: T0, read_at: null, role: 'edit', push_due_at: null },
    ])
    expect(rev(w.sqlDb, 'owner')).toBe(1)
    expect(rev(w.sqlDb, 'friend')).toBe(0)
  })

  it('폴더 — folder_id·폴더 이름', async () => {
    const w = await world()
    expect((await post(w, FRIEND, TK_FOLDER, 'view')).status).toBe(201)
    expect(notifs(w.sqlDb)).toMatchObject([{ doc_id: null, folder_id: FOLDER, doc_title: '자료실', role: 'view', actor_email: FRIEND }])
  })
})

describe('F-3020 N2 다시 요청', () => {
  it('같은 권한 — 행·notif_rev 그대로, 푸시 0 / 다른 권한 — role 만 바뀜·read_at 그대로·notif_rev +1·푸시 0', async () => {
    const w = await world()
    await post(w, FRIEND, TK_A, 'view')
    w.sqlDb.prepare("UPDATE notifications SET read_at = 77 WHERE kind = 'access_request'").run()
    fetchMock.mockClear()

    vi.setSystemTime(T0 + 1_000)
    expect((await post(w, FRIEND, TK_A, 'view')).status).toBe(200)
    expect(notifs(w.sqlDb)).toHaveLength(1)
    expect(rev(w.sqlDb, 'owner')).toBe(1)

    vi.setSystemTime(T0 + 2_000)
    expect((await post(w, FRIEND, TK_A, 'edit')).status).toBe(200)
    expect(notifs(w.sqlDb)).toMatchObject([{ role: 'edit', read_at: 77, created_at: T0 }])
    expect(rev(w.sqlDb, 'owner')).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('F-3020 N3 409', () => {
  it('이미 그 권한 이상인 초대 — 행 0·푸시 0', async () => {
    const w = await world()
    w.sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)').run('doc', DOC_A, 'owner', FRIEND, 'edit')
    expect((await post(w, FRIEND, TK_A, 'view')).status).toBe(409)
    expect(notifs(w.sqlDb)).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(rev(w.sqlDb, 'owner')).toBe(0)
  })
})

describe('F-3020 N4 푸시', () => {
  it('구독 1 → fetch 1·페이로드 / 5분 안 둘째 → 0 / 600,001 ms 뒤 → 1', async () => {
    const w = await world()
    expect((await post(w, FRIEND, TK_A, 'edit')).status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(payloadOf).toHaveBeenLastCalledWith({ actorEmail: FRIEND, target: 'doc', targetId: DOC_A, name: '문서 A', role: 'edit' })

    vi.setSystemTime(T0 + 300_000)
    expect((await post(w, THIRD, TK_B, 'view')).status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const later = await world()
    vi.setSystemTime(T0)
    await post(later, FRIEND, TK_A, 'edit')
    fetchMock.mockClear()
    vi.setSystemTime(T0 + 600_001)
    expect((await post(later, THIRD, TK_FOLDER, 'view')).status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(payloadOf).toHaveBeenLastCalledWith({ actorEmail: THIRD, target: 'folder', targetId: FOLDER, name: '자료실', role: 'view' })
    expect(notifs(later.sqlDb)).toHaveLength(2)
  })

  it('VAPID 없음 — 행은 생기고 fetch 0', async () => {
    const w = await world({ vapid: false })
    expect((await post(w, FRIEND, TK_A, 'view')).status).toBe(201)
    expect(notifs(w.sqlDb)).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('F-3020 N5 목록', () => {
  it('kinds=access_request — 키 9개와 값 / 옛 조합은 이 행을 안 보이고 안 세며 ETag 꼬리 그대로', async () => {
    const w = await world()
    await post(w, FRIEND, TK_A, 'edit')
    await post(w, FRIEND, TK_FOLDER, 'view')

    const res = await call(w, OWNER, '/api/notifications?kinds=access_request')
    const body = (await res.json()) as { items: Row[]; unread: number }
    expect(body.unread).toBe(2)
    expect(body.items).toHaveLength(2)
    const doc = body.items.find((i) => i.target === 'doc') as Row
    expect(Object.keys(doc).sort()).toEqual(['actorEmail', 'createdAt', 'id', 'kind', 'name', 'readAt', 'role', 'target', 'targetId'])
    expect(doc).toMatchObject({ kind: 'access_request', target: 'doc', targetId: DOC_A, name: '문서 A', role: 'edit', actorEmail: FRIEND, createdAt: T0, readAt: null })
    expect(body.items.find((i) => i.target === 'folder')).toMatchObject({ targetId: FOLDER, name: '자료실', role: 'view' })

    const old = await call(w, OWNER, '/api/notifications?kinds=mention,reply,comment,share')
    expect(await old.json()).toEqual({ items: [], unread: 0 })
    expect(old.headers.get('ETag')).toBe(`W/"n1-owner-${rev(w.sqlDb, 'owner')}-30-mention.reply.comment.share"`)
    const all = await call(w, OWNER, '/api/notifications?kinds=access_request,share,mention,reply,comment')
    expect(all.headers.get('ETag')).toBe(`W/"n1-owner-${rev(w.sqlDb, 'owner')}-30-mention.reply.comment.share.access_request"`)
  })
})

describe('F-3020 N6 지워질 때', () => {
  it('승인·거절·취소 뒤 행 0, 소유자 notif_rev +1', async () => {
    const w = await world()
    await post(w, FRIEND, TK_A, 'view')
    await post(w, THIRD, TK_A, 'view')
    await post(w, FRIEND, TK_B, 'view')
    const [forApprove, forReject] = requestRows(w.sqlDb).filter((r) => r.target_id === DOC_A).map((r) => r.id as string)
    expect(rev(w.sqlDb, 'owner')).toBe(3)

    expect((await call(w, OWNER, `/api/access-requests/${forApprove}/approve`, { method: 'POST' })).status).toBe(200)
    expect(notifs(w.sqlDb).map((n) => n.id)).not.toContain(forApprove)
    expect(rev(w.sqlDb, 'owner')).toBe(4)

    expect((await call(w, OWNER, `/api/access-requests/${forReject}/reject`, { method: 'POST' })).status).toBe(204)
    expect(notifs(w.sqlDb).map((n) => n.id)).not.toContain(forReject)
    expect(rev(w.sqlDb, 'owner')).toBe(5)

    expect(notifs(w.sqlDb)).toHaveLength(1)
    expect((await cancel(w, FRIEND, TK_B)).status).toBe(204)
    expect(notifs(w.sqlDb)).toHaveLength(0)
    expect(rev(w.sqlDb, 'owner')).toBe(6)
  })
})

describe('F-3020 N7 매일 정리', () => {
  it('대기 요청이 있는 행(폴더 포함)은 남고, 요청이 없거나 거절된 행은 지운다', async () => {
    const w = await world()
    await post(w, FRIEND, TK_A, 'view')
    await post(w, FRIEND, TK_FOLDER, 'view')
    const insert = w.sqlDb.prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, folder_id, actor_email, doc_title, excerpt, created_at, role) VALUES (?,?,'access_request',?,NULL,?,?,'',?,'view')")
    insert.run('no-request', OWNER, DOC_B, THIRD, '문서 B', T0)
    insert.run('rejected', OWNER, DOC_B, THIRD, '문서 B', T0)
    w.sqlDb
      .prepare("INSERT INTO access_requests (id, target_type, target_id, owner_id, token, requester_id, requester_email, requester_name, role, status, created_at, decided_at) VALUES ('rejected','doc',?,'owner',?,'third',?,'n','view','rejected',?,?)")
      .run(DOC_B, TK_B, THIRD, T0, T0)

    await cleanupComments(w.envFor(OWNER), T0)
    const left = notifs(w.sqlDb).map((n) => n.doc_id ?? n.folder_id)
    expect(left.sort()).toEqual([DOC_A, FOLDER].sort())
  })
})
