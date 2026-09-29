// F-3007 G1~G9·T1 초대 PUT 의 공유 푸시 — 새 초대 판정·겹침 막기·백그라운드 (specs/features/F-3007.md 5.2)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))
vi.mock('../../src/lib/pushText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pushText')>()
  return { ...actual, sharePushPayload: vi.fn(actual.sharePushPayload) }
})

import worker from '../../worker/index'
import { asD1, openTestDb } from '../../worker/testD1'
import { sharePushPayload } from '../../src/lib/pushText'

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const DOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const T0 = Date.parse('2026-09-30T00:00:00Z')

let keyCache: { p256dh: string; auth: string } | null = null
let jwk = ''

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function clientKeys() {
  if (keyCache) return keyCache
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  keyCache = { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) }
  return keyCache
}

type Held = Promise<unknown>[]
type Setup = { sqlDb: DatabaseSync; env: Env; held: Held; ctx: ExecutionContext; sqls: string[]; waitUntil: ReturnType<typeof vi.fn> }

async function setup(opts: { vapid?: boolean; friend?: 'sub' | 'nosub' | 'none'; failSql?: string; e2ee?: boolean } = {}): Promise<Setup> {
  const { vapid = true, friend = 'sub' } = opts
  if (!jwk) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
    jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
  }
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('owner', OWNER, 1)
  for (const [id, title] of [[DOC_A, '문서 A'], [DOC_B, '문서 B'], [DOC_C, '문서 C']]) {
    sqlDb
      .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, 'owner', title, 'c', 'lf', 1, 1, 1, opts.e2ee ? 'k' : null)
  }
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,NULL,?,?)').run(FOLDER, 'owner', '자료실', 1, 1)
  if (friend !== 'none') {
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('friend', FRIEND, 1)
  }
  if (friend === 'sub') {
    const k = await clientKeys()
    sqlDb
      .prepare('INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('s1', 'friend', null, 'https://fcm.googleapis.com/fcm/send/s1', k.p256dh, k.auth, 1)
  }
  const inner = asD1(sqlDb)
  const sqls: string[] = []
  const DB = {
    prepare: (sql: string) => {
      sqls.push(sql)
      if (opts.failSql && sql.includes(opts.failSql)) throw new Error('d1 down')
      return inner.prepare(sql)
    },
    batch: (list: D1PreparedStatement[]) => inner.batch(list),
  }
  const env = { DB, BETTER_AUTH_URL: ORIGIN, DEV_AUTH_EMAIL: OWNER, ...(vapid ? { VAPID_PRIVATE_JWK: jwk } : {}) } as unknown as Env
  const held: Held = []
  const waitUntil = vi.fn((p: Promise<unknown>) => void held.push(p))
  const ctx = { waitUntil, passThroughOnException() {} } as unknown as ExecutionContext
  return { sqlDb, env, held, ctx, sqls, waitUntil }
}

function put(s: Setup, kind: 'docs' | 'folders', id: string, role: 'view' | 'edit' = 'edit') {
  return worker.fetch(
    new Request(`${ORIGIN}/api/${kind}/${id}/grants/${FRIEND}`, {
      method: 'PUT',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
    s.env,
    s.ctx,
  )
}

async function settle(s: Setup) {
  await Promise.all(s.held)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.mocked(sharePushPayload).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('F-3007 G 초대 푸시', () => {
  it('G1 새 문서 초대 — 응답 그대로, 푸시 1건, 인자 확인', async () => {
    const s = await setup()
    const res = await put(s, 'docs', DOC_A)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: FRIEND, role: 'edit' })
    await settle(s)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Topic).toBeUndefined()
    expect(headers.TTL).toBe('86400')
    expect(vi.mocked(sharePushPayload).mock.calls[0][0]).toEqual({ actorEmail: OWNER, target: 'doc', targetId: DOC_A, name: '문서 A', role: 'edit' })
  })

  it('G2 역할만 바꿈 — 푸시·겹침 SQL 0', async () => {
    const s = await setup()
    await put(s, 'docs', DOC_A, 'edit')
    await settle(s)
    fetchMock.mockClear()
    s.sqls.length = 0
    vi.setSystemTime(T0 + 1_000)
    await put(s, 'docs', DOC_A, 'view')
    await settle(s)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.sqls.some((q) => q.includes('created_at >'))).toBe(false)
  })

  it('G3 폴더 초대 — 폴더 이름, waitUntil 1번', async () => {
    const s = await setup()
    const res = await put(s, 'folders', FOLDER)
    expect(res.status).toBe(200)
    expect(s.waitUntil).toHaveBeenCalledTimes(1)
    await settle(s)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sharePushPayload).mock.calls[0][0]).toEqual({ actorEmail: OWNER, target: 'folder', targetId: FOLDER, name: '자료실', role: 'edit' })
  })

  it('G4 겹침 — 10분 경계', async () => {
    const s = await setup()
    await put(s, 'docs', DOC_A)
    await settle(s)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.setSystemTime(T0 + 300_000)
    await put(s, 'docs', DOC_B)
    await settle(s)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const s2 = await setup()
    vi.setSystemTime(T0)
    await put(s2, 'docs', DOC_A)
    await settle(s2)
    fetchMock.mockClear()
    vi.setSystemTime(T0 + 600_001)
    await put(s2, 'docs', DOC_C)
    await settle(s2)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const s3 = await setup()
    vi.setSystemTime(T0)
    await put(s3, 'docs', DOC_A)
    await settle(s3)
    fetchMock.mockClear()
    vi.setSystemTime(T0 + 600_000)
    await put(s3, 'docs', DOC_B)
    await settle(s3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('G5 이번 초대보다 늦은 행은 세지 않음', async () => {
    const s = await setup()
    s.sqlDb
      .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
      .run('doc', DOC_B, 'owner', FRIEND, 'view', T0 + 5)
    await put(s, 'docs', DOC_A)
    await settle(s)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('G6 계정 없음·구독 없음 — 보내기 0, 예외 없음', async () => {
    for (const friend of ['none', 'nosub'] as const) {
      const s = await setup({ friend })
      const res = await put(s, 'docs', DOC_A)
      expect(res.status).toBe(200)
      await settle(s)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('G7 VAPID 없음 — 보내기·waitUntil 0, 푸시 SQL 0', async () => {
    const s = await setup({ vapid: false })
    await put(s, 'docs', DOC_A)
    await settle(s)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.waitUntil).not.toHaveBeenCalled()
    expect(s.sqls.filter((q) => q.includes('push_subscriptions') || (q.includes('FROM grants') && q.includes('created_at >')))).toHaveLength(0)
  })

  it('G8 실패 — 응답 200, 약속은 reject 없이 풀림', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = await setup({ failSql: 'created_at >' })
    expect((await put(s, 'docs', DOC_A)).status).toBe(200)
    await expect(Promise.all(s.held)).resolves.toBeDefined()
    fetchMock.mockRejectedValue(new Error('net'))
    const s2 = await setup()
    expect((await put(s2, 'docs', DOC_A)).status).toBe(200)
    await expect(Promise.all(s2.held)).resolves.toBeDefined()
  })

  it('G9 금고 문서 — 409, 푸시 0', async () => {
    const s = await setup({ e2ee: true })
    expect((await put(s, 'docs', DOC_A)).status).toBe(409)
    await settle(s)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('F-3007 T1 testD1 batch 결과', () => {
  it('RETURNING 은 results 를 담고 둘 다 changes 1', async () => {
    const sqlDb = openTestDb()
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u', 'u@example.com', 1)
    const db = asD1(sqlDb)
    const results = (await db.batch([
      db.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc','d','u','x@example.com','view',?) RETURNING created_at").bind(5),
      db.prepare("UPDATE users SET email = 'v@example.com' WHERE id = 'u'"),
    ])) as unknown as { results?: { created_at: number }[]; meta: { changes: number } }[]
    expect(results[0].results).toEqual([{ created_at: 5 }])
    expect(results[0].meta.changes).toBe(1)
    expect(results[1].meta.changes).toBe(1)
  })
})
