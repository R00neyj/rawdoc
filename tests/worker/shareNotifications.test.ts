// F-3012 S1~S14 초대 받음 알림함 행 — 마이그레이션·넣기·지우기·목록·정리 (specs/features/F-3012.md 7장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from '../../worker/testD1'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker
let cleanupComments: typeof import('../../worker/commentGc').cleanupComments

beforeAll(async () => {
  worker = (await import('../../worker/index')).default as unknown as Worker
  cleanupComments = (await import('../../worker/commentGc')).cleanupComments
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOC_IN_FOLDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const CHILD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

type Row = Record<string, unknown>

function world(opts: { friend?: boolean; e2ee?: boolean; vapid?: boolean; devEmail?: string } = {}) {
  const { friend = true, e2ee = false, devEmail = OWNER } = opts
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('owner', OWNER, 1)
  if (friend) sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('friend', FRIEND, 1)
  const addDoc = sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, folder_id, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
  addDoc.run(DOC_A, 'owner', '문서 A', 'c', 'lf', 1, 1, 1, null, e2ee ? 'k' : null)
  addDoc.run(DOC_B, 'owner', '문서 B', 'c', 'lf', 1, 1, 1, null, null)
  const addFolder = sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
  addFolder.run(FOLDER, 'owner', '자료실', null, 1, 1, e2ee ? 1 : 0)
  addFolder.run(CHILD, 'owner', '하위', FOLDER, 1, 1, 0)
  addDoc.run(DOC_IN_FOLDER, 'owner', '폴더 문서', 'c', 'lf', 1, 1, 1, CHILD, null)
  const env = { DB: asD1(sqlDb), BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: devEmail, WRITE_LIMITER: { limit: async () => ({ success: true }) } } as unknown as unknown as Env
  return { sqlDb, env }
}

function call(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Origin', ORIGIN)
  if (init.body) headers.set('Content-Type', 'application/json')
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

const put = (env: Env, kind: 'docs' | 'folders', id: string, role: 'view' | 'edit' = 'view', email = FRIEND) =>
  call(env, `/api/${kind}/${id}/grants/${email}`, { method: 'PUT', body: JSON.stringify({ role }) })
const del = (env: Env, kind: 'docs' | 'folders', id: string, email = FRIEND) => call(env, `/api/${kind}/${id}/grants/${email}`, { method: 'DELETE' })

const shares = (sqlDb: DatabaseSync) => sqlDb.prepare("SELECT * FROM notifications WHERE kind = 'share' ORDER BY created_at, id").all() as Row[]
const rev = (sqlDb: DatabaseSync, email: string) => (sqlDb.prepare('SELECT notif_rev AS r FROM users WHERE email = ?').get(email) as { r: number }).r

describe('F-3012 S1 마이그레이션 0021', () => {
  const insert =
    'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, folder_id, role, push_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  const row = (over: Partial<Record<number, unknown>> = {}) => {
    const base: unknown[] = ['i' + Math.random(), 'a@x', 'share', 'd1', null, null, 'o@x', 't', '', 1, null, 'view', null]
    for (const [i, v] of Object.entries(over)) base[Number(i)] = v
    return base
  }

  it('댓글 행이 그대로 옮겨지고 새 열은 NULL', async () => {
    const db = openTestDb('0020')
    db.exec(
      "INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at) VALUES ('n1','a@x','mention','d1','c1','t1','o@x','제목','발췌',5,7,9),('n2','a@x','comment','d2','c2','t2','o@x','제목2','발췌2',6,NULL,NULL)",
    )
    const before = db.prepare('SELECT * FROM notifications ORDER BY id').all() as Row[]
    db.exec(readFileSync('migrations/0021_notifications_share.sql', 'utf-8'))
    const after = db.prepare('SELECT * FROM notifications ORDER BY id').all() as Row[]
    expect(after.map(({ folder_id, role, ...rest }) => ({ ...rest, folder_id, role }))).toEqual(before.map((r) => ({ ...r, folder_id: null, role: null })))
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'notifications' AND type = 'index'").all() as { name: string }[]).map((r) => r.name).sort()
    expect(names).toEqual(['notifications_doc', 'notifications_folder', 'notifications_recipient_order', 'sqlite_autoindex_notifications_1', 'sqlite_autoindex_notifications_2'])
  })

  it('CHECK 가 받는 것 4·거부 9', () => {
    const db = openTestDb()
    const ok = (args: unknown[]) => db.prepare(insert).run(...(args as never[]))
    const bad = (args: unknown[]) => expect(() => ok(args)).toThrow()
    ok(row())
    ok(row({ 0: 'second' }))
    ok(row({ 0: 'folder', 3: null, 10: 'f1' }))
    ok(row({ 0: 'cm', 2: 'comment', 4: 'c1', 5: 't1', 11: null }))
    bad(row({ 0: 'x1', 10: 'f1' }))
    bad(row({ 0: 'x2', 3: null }))
    bad(row({ 0: 'x3', 11: null }))
    bad(row({ 0: 'x4', 11: 'owner' }))
    bad(row({ 0: 'x5', 12: 5 }))
    bad(row({ 0: 'x6', 4: 'c1' }))
    bad(row({ 0: 'x7', 2: 'comment', 3: null, 4: 'c', 5: 't', 11: null }))
    bad(row({ 0: 'x8', 2: 'comment', 4: 'c', 5: 't' }))
    bad(row({ 0: 'x9', 2: 'like' }))
  })
})

describe('F-3012 S2~S4 새 초대 행', () => {
  it('S2 문서 view 초대 — 행 1, 받는 사람 리비전 +1', async () => {
    const { sqlDb, env } = world()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(5_000)
    expect((await put(env, 'docs', DOC_A, 'view')).status).toBe(200)
    vi.useRealTimers()
    const [r] = shares(sqlDb)
    const grant = sqlDb.prepare('SELECT created_at FROM grants').get() as { created_at: number }
    expect(shares(sqlDb)).toHaveLength(1)
    expect(r).toMatchObject({ recipient_email: FRIEND, doc_id: DOC_A, folder_id: null, doc_title: '문서 A', actor_email: OWNER, role: 'view', excerpt: '', created_at: grant.created_at, read_at: null, push_due_at: null, comment_id: null, thread_id: null })
    expect(String(r.id)).toMatch(UUID_RE)
    expect(rev(sqlDb, FRIEND)).toBe(1)
    expect(rev(sqlDb, OWNER)).toBe(0)
  })

  it('S3 폴더 edit 초대 — 폴더 열', async () => {
    const { sqlDb, env } = world()
    await put(env, 'folders', FOLDER, 'edit')
    expect(shares(sqlDb)[0]).toMatchObject({ doc_id: null, folder_id: FOLDER, doc_title: '자료실', role: 'edit' })
  })

  it('S4 역할만 바꾼 PUT — 행·역할·리비전 그대로', async () => {
    const { sqlDb, env } = world()
    await put(env, 'docs', DOC_A, 'view')
    await new Promise((r) => setTimeout(r, 3))
    await put(env, 'docs', DOC_A, 'edit')
    expect(sqlDb.prepare('SELECT role FROM grants').get()).toEqual({ role: 'edit' })
    expect(shares(sqlDb)).toHaveLength(1)
    expect(shares(sqlDb)[0].role).toBe('view')
    expect(rev(sqlDb, FRIEND)).toBe(1)
  })
})

describe('F-3012 S5~S7·S14 넣기 예외', () => {
  it('S5 미가입 이메일 — 행 1, 가입 뒤 목록에 보임', async () => {
    const { sqlDb, env } = world({ friend: false })
    await put(env, 'docs', DOC_A)
    expect(shares(sqlDb)).toHaveLength(1)
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('friend', FRIEND, 1)
    const asFriend = { ...env, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
    const body = (await (await call(asFriend, '/api/notifications?kinds=share')).json()) as { items: { targetId: string }[] }
    expect(body.items.map((i) => i.targetId)).toEqual([DOC_A])
  })

  it('S6 금고 문서·폴더 — 409, 행 0', async () => {
    const { sqlDb, env } = world({ e2ee: true })
    expect((await put(env, 'docs', DOC_A)).status).toBe(409)
    expect((await put(env, 'folders', FOLDER)).status).toBe(409)
    expect(shares(sqlDb)).toHaveLength(0)
  })

  it('S7 1분 안에 문서 둘 — 행 2', async () => {
    const { sqlDb, env } = world()
    await put(env, 'docs', DOC_A)
    await put(env, 'docs', DOC_B)
    expect(shares(sqlDb)).toHaveLength(2)
  })

  it('S14 VAPID 없는 env 에서도 행이 생김', async () => {
    const { sqlDb, env } = world()
    expect((env as unknown as Record<string, unknown>).VAPID_PRIVATE_JWK).toBeUndefined()
    await put(env, 'docs', DOC_A)
    expect(shares(sqlDb)).toHaveLength(1)
  })
})

describe('F-3012 S8 초대 지우기', () => {
  it('문서·폴더 각각 — 그 행만(읽음 포함) 지우고 리비전 +1, 재초대하면 새 행', async () => {
    const { sqlDb, env } = world()
    await put(env, 'docs', DOC_A)
    await put(env, 'docs', DOC_B)
    await put(env, 'folders', FOLDER)
    sqlDb.prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES ('cm', ?, 'mention', ?, 'c', 't', 'x@x', 't', 'e', 1)").run(FRIEND, DOC_A)
    sqlDb.prepare("UPDATE notifications SET read_at = 9 WHERE kind = 'share' AND doc_id = ?").run(DOC_A)
    const before = rev(sqlDb, FRIEND)
    expect((await del(env, 'docs', DOC_A)).status).toBe(204)
    expect(shares(sqlDb).map((r) => r.doc_id ?? r.folder_id).sort()).toEqual([DOC_B, FOLDER].sort())
    expect(rev(sqlDb, FRIEND)).toBe(before + 1)
    expect(sqlDb.prepare("SELECT COUNT(*) AS n FROM notifications WHERE id = 'cm'").get()).toEqual({ n: 1 })
    await del(env, 'folders', FOLDER)
    expect(shares(sqlDb).map((r) => r.doc_id)).toEqual([DOC_B])
    await put(env, 'docs', DOC_A)
    const again = shares(sqlDb).find((r) => r.doc_id === DOC_A)
    expect(again?.read_at).toBeNull()
  })
})

describe('F-3012 S9 폴더·계정 삭제', () => {
  it('폴더 delete-all — 하위 폴더 행과 안 문서 행도 지움', async () => {
    const { sqlDb, env } = world()
    await put(env, 'folders', FOLDER)
    await put(env, 'folders', CHILD)
    await put(env, 'docs', DOC_IN_FOLDER)
    await put(env, 'docs', DOC_A)
    const res = await call(env, `/api/folders/${FOLDER}?contents=delete-all`, { method: 'DELETE' })
    expect(res.status).toBeLessThan(300)
    expect(shares(sqlDb).map((r) => r.doc_id)).toEqual([DOC_A])
  })

  it('계정 삭제 — 보낸 쪽·받은 쪽 모두', async () => {
    const sender = world()
    await put(sender.env, 'docs', DOC_A)
    await put(sender.env, 'folders', FOLDER)
    expect((await call(sender.env, '/api/account', { method: 'DELETE' })).status).toBeLessThan(300)
    expect(shares(sender.sqlDb)).toHaveLength(0)

    const receiver = world()
    await put(receiver.env, 'docs', DOC_A)
    await put(receiver.env, 'folders', FOLDER)
    const asFriend = { ...receiver.env, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
    expect((await call(asFriend, '/api/account', { method: 'DELETE' })).status).toBeLessThan(300)
    expect(shares(receiver.sqlDb)).toHaveLength(0)
  })
})

describe('F-3012 S10·S11 목록', () => {
  it('S10 kinds 없음·옛 조합은 share 를 안 보이고 안 셈', async () => {
    const { sqlDb, env } = world()
    await put(env, 'docs', DOC_A)
    const asFriend = { ...env, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
    for (const q of ['', '?kinds=mention,reply,comment']) {
      const res = await call(asFriend, `/api/notifications${q}`)
      expect(await res.json()).toEqual({ items: [], unread: 0 })
    }
    const etag = (await call(asFriend, '/api/notifications')).headers.get('ETag')
    expect(etag).toBe(`W/"n1-friend-1-30"`)
    expect((await call(asFriend, '/api/notifications?kinds=mention,reply,comment')).headers.get('ETag')).toBe(`W/"n1-friend-1-30-mention.reply.comment"`)
    expect(shares(sqlDb)).toHaveLength(1)
  })

  it('S11 share 항목 키 9개, 섞인 정렬, ETag 꼬리, 304', async () => {
    const { sqlDb, env } = world()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(2_000)
    await put(env, 'docs', DOC_A, 'view')
    vi.setSystemTime(4_000)
    await put(env, 'folders', FOLDER, 'edit')
    vi.useRealTimers()
    sqlDb.prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES ('cm', ?, 'mention', ?, 'c', 't', 'x@x', 't', 'e', 3000)").run(FRIEND, DOC_A)
    const asFriend = { ...env, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
    const only = (await (await call(asFriend, '/api/notifications?kinds=share')).json()) as { items: Row[]; unread: number }
    expect(only.unread).toBe(2)
    expect(only.items.map((i) => Object.keys(i).sort())).toEqual(Array(2).fill(['actorEmail', 'createdAt', 'id', 'kind', 'name', 'readAt', 'role', 'target', 'targetId']))
    expect(only.items[0]).toMatchObject({ kind: 'share', target: 'folder', targetId: FOLDER, name: '자료실', role: 'edit', actorEmail: OWNER, readAt: null })
    expect(only.items[1]).toMatchObject({ target: 'doc', targetId: DOC_A, name: '문서 A', role: 'view' })
    const res = await call(asFriend, '/api/notifications?kinds=mention,reply,comment,share')
    const mixed = (await res.json()) as { items: { id: string; createdAt: number }[] }
    expect(mixed.items.map((i) => i.createdAt)).toEqual([4000, 3000, 2000])
    const etag = res.headers.get('ETag') as string
    expect(etag.endsWith('-mention.reply.comment.share"')).toBe(true)
    const shuffled = await call(asFriend, '/api/notifications?kinds=share,mention,reply,comment')
    expect(shuffled.headers.get('ETag')).toBe(etag)
    const hit = await call(asFriend, '/api/notifications?kinds=share,mention,reply,comment', { headers: { 'If-None-Match': etag } })
    expect(hit.status).toBe(304)
    const miss = await call(asFriend, '/api/notifications?kinds=share', { headers: { 'If-None-Match': etag } })
    expect(miss.status).toBe(200)
  })
})

describe('F-3012 S12 매일 정리', () => {
  it('초대 있는 share 는 남고 없는 것은 지우고 리비전 +1', async () => {
    const { sqlDb, env } = world()
    await put(env, 'docs', DOC_A)
    await put(env, 'folders', FOLDER)
    sqlDb.prepare("DELETE FROM grants WHERE target_type = 'folder'").run()
    sqlDb.prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES ('gone', ?, 'mention', 'nodoc', 'c', 't', 'x@x', 't', 'e', ?)").run(FRIEND, Date.now())
    const before = rev(sqlDb, FRIEND)
    const result = await cleanupComments(env, Date.now())
    expect(result.orphanNotifications).toBe(2)
    expect(shares(sqlDb).map((r) => r.doc_id)).toEqual([DOC_A])
    expect(rev(sqlDb, FRIEND)).toBeGreaterThan(before)
  })
})

describe('F-3012 S13 300개 상한', () => {
  it('300행이 있으면 새 초대 뒤에도 300, 가장 옛 행이 빠짐', async () => {
    const { sqlDb, env } = world()
    const add = sqlDb.prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES (?, ?, 'mention', 'd', ?, 't', 'x@x', 't', 'e', ?)")
    for (let i = 0; i < 300; i++) add.run(`n${String(i).padStart(3, '0')}`, FRIEND, `c${i}`, 10 + i)
    await put(env, 'docs', DOC_A)
    expect(sqlDb.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_email = ?').get(FRIEND)).toEqual({ n: 300 })
    expect(sqlDb.prepare("SELECT COUNT(*) AS n FROM notifications WHERE id = 'n000'").get()).toEqual({ n: 0 })
    expect(shares(sqlDb)).toHaveLength(1)
  })
})
