// F-4005 R1~R7 권한 요청 표와 요청자 라우트 (specs/features/F-4005.md 6장)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

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

const status = (env: Env, token: string, docId?: string) => call(env, `/api/access-requests/link/${token}${docId ? `?docId=${docId}` : ''}`)
const post = (env: Env, token: string, role: unknown, docId?: string) =>
  call(env, `/api/access-requests/link/${token}`, { method: 'POST', body: JSON.stringify({ role, ...(docId ? { docId } : {}) }) })
const cancel = (env: Env, token: string, docId?: string) =>
  call(env, `/api/access-requests/link/${token}${docId ? `?docId=${docId}` : ''}`, { method: 'DELETE' })

const requests = (sqlDb: DatabaseSync) => sqlDb.prepare('SELECT * FROM access_requests ORDER BY created_at, id').all() as Row[]
const writeCount = (sqlDb: DatabaseSync, id = 'friend') => (sqlDb.prepare('SELECT write_count AS c FROM users WHERE id = ?').get(id) as { c: number }).c

function seedRequest(sqlDb: DatabaseSync, r: Partial<Row> & { requester_id: string }) {
  const row = {
    id: crypto.randomUUID(), target_type: 'doc', target_id: DOC_A, owner_id: 'owner', token: TK_A, requester_email: `${r.requester_id}@example.com`,
    requester_name: 'n', role: 'view', status: 'pending', created_at: T0, decided_at: null, ...r,
  }
  sqlDb
    .prepare('INSERT INTO access_requests (id, target_type, target_id, owner_id, token, requester_id, requester_email, requester_name, role, status, created_at, decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(row.id, row.target_type, row.target_id, row.owner_id, row.token, row.requester_id, row.requester_email, row.requester_name, row.role, row.status, row.created_at, row.decided_at)
  return row.id as string
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('F-4005 R1 마이그레이션 0025', () => {
  const insertNotif =
    'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, folder_id, role, push_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'

  it('댓글·share 행 그대로, 색인 이름 셋, access_request 허용·위반 거부, 요청 표 CHECK·유일 키', () => {
    const sqlDb = openTestDb('0024')
    sqlDb.prepare(insertNotif).run('n1', 'a@x', 'mention', 'd1', 'c1', 't1', 'o@x', '제목', '발췌', 5, null, null, 9)
    sqlDb.prepare(insertNotif).run('n2', 'a@x', 'share', 'd2', null, null, 'o@x', '제목2', '', 6, null, 'edit', null)
    const before = sqlDb.prepare('SELECT * FROM notifications ORDER BY id').all()
    sqlDb.exec(readFileSync(fileURLToPath(new URL('../../migrations/0025_access_requests.sql', import.meta.url)), 'utf-8'))
    expect(sqlDb.prepare('SELECT * FROM notifications ORDER BY id').all()).toEqual(before)
    const idx = sqlDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    expect(idx.map((r) => (r as Row).name)).toEqual(['notifications_doc', 'notifications_folder', 'notifications_recipient_order'])

    sqlDb.prepare(insertNotif).run('a1', 'o@x', 'access_request', 'd1', null, null, 'f@x', '제목', '', 7, null, 'view', null)
    sqlDb.prepare(insertNotif).run('a2', 'o@x', 'access_request', null, null, null, 'f@x', '폴더', '', 7, 'fo1', 'edit', null)
    expect(() => sqlDb.prepare(insertNotif).run('a3', 'o@x', 'access_request', 'd1', null, null, 'f@x', 't', '', 7, null, null, null)).toThrow()
    expect(() => sqlDb.prepare(insertNotif).run('a4', 'o@x', 'access_request', 'd1', null, null, 'f@x', 't', '', 7, 'fo1', 'view', null)).toThrow()
    expect(() => sqlDb.prepare(insertNotif).run('a5', 'o@x', 'access_request', 'd1', 'c9', null, 'f@x', 't', '', 7, null, 'view', null)).toThrow()

    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,?)').run('u1', 'u1@x', 1)
    const ins = (id: string, status: string, decided: number | null, target = 'd1') =>
      sqlDb
        .prepare("INSERT INTO access_requests (id, target_type, target_id, owner_id, token, requester_id, requester_email, requester_name, role, status, created_at, decided_at) VALUES (?, 'doc', ?, 'u1', 't', 'u1', 'u1@x', 'n', 'view', ?, 1, ?)")
        .run(id, target, status, decided)
    expect(() => ins('r1', 'pending', 5)).toThrow()
    expect(() => ins('r2', 'rejected', null)).toThrow()
    ins('r3', 'pending', null)
    expect(() => ins('r4', 'pending', null)).toThrow()
    ins('r5', 'rejected', 5, 'd2')
  })
})

describe('F-4005 R2 상태', () => {
  it('로그아웃 401', async () => {
    const sqlDb = world()
    const anon = { DB: asAuthDb(sqlDb), BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 's'.repeat(40) } as unknown as Env
    const res = await status(anon, TK_A)
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthenticated' }])
  })

  it('끊긴·없는·형식 틀린 토큰, 막힌 주인, 묶음 밖 docId, 금고 문서는 404', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    for (const [token, docId] of [[TK_DEAD], [tk('z')], ['short'], [TK_BLOCKED], [TK_A, DOC_B], [TK_BUNDLE, DOC_X], [TK_VAULT]] as [string, string?][]) {
      const res = await status(env, token, docId)
      expect([token.slice(0, 2), res.status, await res.json()]).toEqual([token.slice(0, 2), 404, { error: 'not_found' }])
    }
  })

  it('금고 문서를 묶음에 넣은 링크도 404', async () => {
    const sqlDb = world()
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run(TK_BUNDLE, DOC_V)
    expect((await status(envFor(sqlDb, FRIEND), TK_BUNDLE, DOC_V)).status).toBe(404)
  })

  it('주인은 owner:true + targetId', async () => {
    const sqlDb = world()
    const res = await status(envFor(sqlDb, OWNER), TK_A)
    expect([res.status, await res.json()]).toEqual([200, { target: 'doc', owner: true, memberRole: null, targetId: DOC_A, request: null }])
  })

  it('문서 초대·폴더 사슬 초대는 memberRole + targetId, 없으면 null', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    expect(await (await status(env, TK_A)).json()).toEqual({ target: 'doc', owner: false, memberRole: null, targetId: null, request: null })
    const grant = sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)')
    grant.run('doc', DOC_A, 'owner', FRIEND, 'edit')
    expect(await (await status(env, TK_A)).json()).toEqual({ target: 'doc', owner: false, memberRole: 'edit', targetId: DOC_A, request: null })
    grant.run('folder', FOLDER, 'owner', FRIEND, 'view')
    expect(await (await status(env, TK_CHILD)).json()).toEqual({ target: 'folder', owner: false, memberRole: 'view', targetId: CHILD, request: null })
    expect(await (await status(env, TK_FOLDER)).json()).toMatchObject({ memberRole: 'view', targetId: FOLDER })
  })

  it('대기·거절 retryAt, 응답에 주인 이메일·이름 없음', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    const id = seedRequest(sqlDb, { requester_id: 'friend', role: 'edit' })
    const pending = await status(env, TK_A)
    const text = await pending.text()
    expect(JSON.parse(text)).toEqual({ target: 'doc', owner: false, memberRole: null, targetId: null, request: { state: 'pending', role: 'edit', retryAt: null } })
    expect(text).not.toContain(OWNER)
    expect(text).not.toContain('소유자 이름')
    sqlDb.prepare("UPDATE access_requests SET status = 'rejected', decided_at = ? WHERE id = ?").run(T0 - DAY, id)
    expect((await (await status(env, TK_A)).json()) as Row).toMatchObject({ request: { state: 'rejected', role: 'edit', retryAt: T0 - DAY + 7 * DAY } })
  })

  it('끊긴 링크의 옛 요청은 request null', async () => {
    const sqlDb = world()
    seedRequest(sqlDb, { requester_id: 'friend', token: TK_DEAD, target_id: DOC_B })
    expect(((await (await status(envFor(sqlDb, FRIEND), TK_BUNDLE, DOC_B)).json()) as Row).request).toBeNull()
  })
})

describe('F-4005 R3 만들기', () => {
  it('새 요청 201·행 1·이름·write_count +1, 같은 권한 200·행 1, 다른 권한 200·role 바뀜·id 그대로', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    const first = await post(env, TK_A, 'view')
    expect([first.status, await first.json()]).toEqual([201, { target: 'doc', owner: false, memberRole: null, targetId: null, request: { state: 'pending', role: 'view', retryAt: null } }])
    const [row] = requests(sqlDb)
    expect(requests(sqlDb)).toHaveLength(1)
    expect(row).toMatchObject({ target_type: 'doc', target_id: DOC_A, owner_id: 'owner', token: TK_A, requester_id: 'friend', requester_email: FRIEND, requester_name: '친구', role: 'view', status: 'pending', created_at: T0, decided_at: null })
    expect(writeCount(sqlDb)).toBe(1)

    expect((await post(env, TK_A, 'view')).status).toBe(200)
    expect(requests(sqlDb)).toHaveLength(1)
    const changed = await post(env, TK_A, 'edit')
    expect([changed.status, ((await changed.json()) as Row).request]).toEqual([200, { state: 'pending', role: 'edit', retryAt: null }])
    expect(requests(sqlDb)).toEqual([{ ...row, role: 'edit' }])
  })

  it('role 이 틀리면 400 invalid+field, 행 0', async () => {
    const sqlDb = world()
    const res = await post(envFor(sqlDb, FRIEND), TK_A, 'owner')
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid', field: 'role' }])
    expect(requests(sqlDb)).toHaveLength(0)
  })

  it('요청자 이름은 100자에서 자른다', async () => {
    const sqlDb = world()
    sqlDb.prepare('UPDATE users SET name = ? WHERE id = ?').run('가'.repeat(150), 'friend')
    await post(envFor(sqlDb, FRIEND), TK_A, 'view')
    expect((requests(sqlDb)[0].requester_name as string).length).toBe(100)
  })
})

describe('F-4005 R4 409', () => {
  it('주인 / 이미 권한이 같거나 높음', async () => {
    const sqlDb = world()
    const owner = await post(envFor(sqlDb, OWNER), TK_A, 'view')
    expect([owner.status, await owner.json()]).toEqual([409, { error: 'owner' }])
    const env = envFor(sqlDb, FRIEND)
    const grant = sqlDb.prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)')
    grant.run('doc', DOC_A, 'owner', FRIEND, 'edit')
    const member = await post(env, TK_A, 'view')
    expect([member.status, await member.json()]).toEqual([409, { error: 'already_member' }])
    sqlDb.prepare('UPDATE grants SET role = ?').run('view')
    expect((await post(env, TK_A, 'view')).status).toBe(409)
    expect((await post(env, TK_A, 'edit')).status).toBe(201)
    expect(requests(sqlDb)).toHaveLength(1)
  })

  it('거절 6일 뒤 409 cooldown+retryAt, 7일 뒤 201·새 id', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    const oldId = seedRequest(sqlDb, { requester_id: 'friend', status: 'rejected', decided_at: T0 })
    vi.setSystemTime(T0 + 6 * DAY)
    const early = await post(env, TK_A, 'view')
    expect([early.status, await early.json()]).toEqual([409, { error: 'cooldown', retryAt: T0 + 7 * DAY }])
    vi.setSystemTime(T0 + 7 * DAY)
    expect((await post(env, TK_A, 'view')).status).toBe(201)
    const rows = requests(sqlDb)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(oldId)
    expect(rows[0].status).toBe('pending')
  })

  it('요청자 대기 20개면 too_many_pending, 끊긴 링크의 대기는 세지 않는다', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    const doc = sqlDb.prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,1,1)')
    const link = sqlDb.prepare("INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, 'owner', 'doc', ?, 1, ?)")
    for (let i = 0; i < 20; i++) {
      const token = `${'x'.repeat(41)}${String(i).padStart(2, '0')}`
      doc.run(`doc-${i}`, 'owner', `d${i}`, 'c', 'lf', 1)
      link.run(token, `doc-${i}`, i === 19 ? 5 : null)
      seedRequest(sqlDb, { requester_id: 'friend', target_id: `doc-${i}`, token })
    }
    expect((await post(env, TK_A, 'view')).status).toBe(201)
    const full = await post(env, TK_BUNDLE, 'view', DOC_B)
    expect([full.status, await full.json()]).toEqual([409, { error: 'too_many_pending' }])
  })

  it('소유자 대기 100개면 owner_full, 끊긴 링크의 대기는 세지 않는다', async () => {
    const sqlDb = world()
    const user = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?,?,1)')
    for (let i = 0; i < 100; i++) {
      user.run(`r${i}`, `r${i}@example.com`)
      seedRequest(sqlDb, { requester_id: `r${i}`, token: i === 0 ? TK_DEAD : TK_A, target_id: i === 0 ? DOC_B : DOC_A })
    }
    expect((await post(envFor(sqlDb, FRIEND), TK_A, 'view')).status).toBe(201)
    const full = await post(envFor(sqlDb, THIRD), TK_A, 'view')
    expect([full.status, await full.json()]).toEqual([409, { error: 'owner_full' }])
  })
})

describe('F-4005 R5 묶음·폴더 링크', () => {
  it('묶음 링크 둘째 문서 docId → 대상이 그 문서', async () => {
    const sqlDb = world()
    const res = await post(envFor(sqlDb, FRIEND), TK_BUNDLE, 'view', DOC_B)
    expect(res.status).toBe(201)
    expect(requests(sqlDb)[0]).toMatchObject({ target_type: 'doc', target_id: DOC_B, token: TK_BUNDLE })
    expect((await post(envFor(sqlDb, FRIEND), TK_BUNDLE, 'view', DOC_X)).status).toBe(404)
  })

  it('폴더 링크는 docId 를 무시하고 그 폴더가 대상', async () => {
    const sqlDb = world()
    const res = await post(envFor(sqlDb, FRIEND), TK_FOLDER, 'edit', DOC_A)
    expect(res.status).toBe(201)
    expect(requests(sqlDb)[0]).toMatchObject({ target_type: 'folder', target_id: FOLDER, role: 'edit' })
  })
})

describe('F-4005 R6 취소', () => {
  it('대기 204·행 0, 거절 행 404·그대로, 대기 없음 404', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    expect((await cancel(env, TK_A)).status).toBe(404)
    await post(env, TK_A, 'view')
    const before = writeCount(sqlDb)
    expect((await cancel(env, TK_A)).status).toBe(204)
    expect(requests(sqlDb)).toHaveLength(0)
    expect(writeCount(sqlDb)).toBe(before + 1)
    seedRequest(sqlDb, { requester_id: 'friend', status: 'rejected', decided_at: T0 })
    const rows = requests(sqlDb)
    expect((await cancel(env, TK_A)).status).toBe(404)
    expect(requests(sqlDb)).toEqual(rows)
  })

  it('취소는 받는 사람 알림 행·리비전도 같이 지운다', async () => {
    const sqlDb = world()
    const env = envFor(sqlDb, FRIEND)
    await post(env, TK_A, 'view')
    const id = requests(sqlDb)[0].id as string
    sqlDb
      .prepare("INSERT INTO notifications (id, recipient_email, kind, doc_id, actor_email, doc_title, excerpt, created_at, role) VALUES (?,?, 'access_request', ?, ?, 't', '', 1, 'view')")
      .run(id, OWNER, DOC_A, FRIEND)
    await cancel(env, TK_A)
    expect(sqlDb.prepare('SELECT COUNT(*) AS c FROM notifications').get()).toEqual({ c: 0 })
    expect(sqlDb.prepare("SELECT notif_rev AS r FROM users WHERE id = 'owner'").get()).toEqual({ r: 1 })
  })
})

describe('F-4005 R7 쓰기 관문', () => {
  it('막힌 요청자 POST 는 403 account_blocked, 행 0', async () => {
    const sqlDb = world()
    sqlDb.prepare('UPDATE users SET blocked_at = 1 WHERE id = ?').run('friend')
    const res = await post(envFor(sqlDb, FRIEND), TK_A, 'view')
    expect([res.status, await res.json()]).toEqual([403, { error: 'account_blocked' }])
    expect(requests(sqlDb)).toHaveLength(0)
  })
})
