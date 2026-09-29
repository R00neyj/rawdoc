// F-3003 S1~S5·K1 구독 표·켜짐 판정·산 구독·결과 반영·매일 정리·키 스크립트 (specs/features/F-3003.md 7.1)
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { asD1, openTestDb } from '../../worker/testD1'
import { importVapidKey } from '../../worker/webPush'
import {
  PUSH_FAIL_MAX,
  PUSH_LAST_OK_REFRESH_MS,
  cleanupPushSubscriptions,
  findLivePushSubscription,
  listLivePushSubscriptions,
  loadVapid,
  pushResultStatements,
} from '../../worker/pushServer'

async function makeVapidJwk(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
}

const NOW = Date.parse('2026-09-30T00:00:00Z')

function addUser(db: DatabaseSync, id: string, email: string) {
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
}

function addSession(db: DatabaseSync, id: string, userId: string, expiresAt: number) {
  const iso = new Date(NOW).toISOString()
  db.prepare('INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    `t-${id}`,
    new Date(expiresAt).toISOString(),
    iso,
    iso,
  )
}

function addSub(db: DatabaseSync, id: string, userId: string, sessionId: string | null, createdAt: number) {
  db.prepare(
    'INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, userId, sessionId, `https://fcm.googleapis.com/fcm/send/${id}`, 'p', 'a', createdAt)
}

function seedFive(db: DatabaseSync) {
  addUser(db, 'u-a', 'a@example.com')
  addUser(db, 'u-b', 'b@example.com')
  addSession(db, 's-live', 'u-a', NOW + 1000)
  addSession(db, 's-old', 'u-a', NOW - 1000)
  addSub(db, 'live', 'u-a', 's-live', 10)
  addSub(db, 'expired', 'u-a', 's-old', 20)
  addSub(db, 'nosession', 'u-b', 's-missing', 30)
  addSub(db, 'null', 'u-b', null, 40)
  addSub(db, 'nouser', 'u-ghost', null, 50)
}

describe('F-3003 S1 마이그레이션', () => {
  it('열·UNIQUE·색인', () => {
    const db = openTestDb()
    const cols = (db.prepare('PRAGMA table_info(push_subscriptions)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(['id', 'user_id', 'session_id', 'endpoint', 'p256dh', 'auth', 'created_at', 'last_ok_at', 'fail_count'])
    addSub(db, 'x', 'u', null, 1)
    expect(() =>
      db
        .prepare(
          "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES ('y', 'u', 'https://fcm.googleapis.com/fcm/send/x', 'p', 'a', 1)",
        )
        .run(),
    ).toThrow()
    const idx = (db.prepare("PRAGMA index_list('push_subscriptions')").all() as { name: string }[]).map((i) => i.name)
    expect(idx).toContain('push_subscriptions_user')
  })
})

describe('F-3003 S2 loadVapid', () => {
  it('올바른 값이면 subject 는 origin, 아니면 null', async () => {
    const jwk = await makeVapidJwk()
    const ok = await loadVapid({ VAPID_PRIVATE_JWK: jwk, BETTER_AUTH_URL: 'http://localhost:8790' } as unknown as Env)
    expect(ok?.subject).toBe('http://localhost:8790')
    expect(ok?.keys.publicKey).toHaveLength(87)
    const bad = [
      { BETTER_AUTH_URL: 'http://localhost:8790' },
      { VAPID_PRIVATE_JWK: '', BETTER_AUTH_URL: 'http://localhost:8790' },
      { VAPID_PRIVATE_JWK: '{', BETTER_AUTH_URL: 'http://localhost:8790' },
      { VAPID_PRIVATE_JWK: jwk },
      { VAPID_PRIVATE_JWK: jwk, BETTER_AUTH_URL: 'not a url' },
    ]
    for (const env of bad) expect(await loadVapid(env as unknown as Env)).toBeNull()
  })
})

describe('F-3003 S3 산 구독', () => {
  it('산 세션·NULL 만, 정렬, 빈 목록은 D1 안 부름', async () => {
    const db = openTestDb()
    seedFive(db)
    const d1 = asD1(db)
    const list = await listLivePushSubscriptions(d1, ['b@example.com', 'a@example.com', 'ghost@example.com'], NOW)
    expect(list.map((s) => s.id)).toEqual(['live', 'null'])
    expect(list.map((s) => s.email)).toEqual(['a@example.com', 'b@example.com'])
    const prepare = vi.fn()
    expect(await listLivePushSubscriptions({ prepare } as unknown as D1Database, [], NOW)).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
    const ep = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`
    expect((await findLivePushSubscription(d1, 'u-a', ep('live'), NOW))?.id).toBe('live')
    expect(await findLivePushSubscription(d1, 'u-a', ep('expired'), NOW)).toBeNull()
    expect((await findLivePushSubscription(d1, 'u-b', ep('null'), NOW))?.id).toBe('null')
    expect(await findLivePushSubscription(d1, 'u-a', ep('null'), NOW)).toBeNull()
  })

  it('같은 사람 안에서는 created_at 내림차순', async () => {
    const db = openTestDb()
    addUser(db, 'u-a', 'a@example.com')
    addSub(db, 'old', 'u-a', null, 1)
    addSub(db, 'new', 'u-a', null, 2)
    const list = await listLivePushSubscriptions(asD1(db), ['a@example.com'], NOW)
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
  })
})

describe('F-3003 S4 pushResultStatements', () => {
  const HOUR = 3_600_000
  type Row = { last_ok_at: number | null; fail_count: number }

  async function apply(sub: { lastOkAt: number | null; failCount: number }, outcome: 'sent' | 'gone' | 'rejected' | 'transient') {
    const db = openTestDb()
    addSub(db, 's', 'u', null, 1)
    db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fail_count = ? WHERE id = ?').run(sub.lastOkAt, sub.failCount, 's')
    const stmts = pushResultStatements(asD1(db), { id: 's', ...sub }, outcome, NOW)
    for (const st of stmts) await st.run()
    return { n: stmts.length, row: db.prepare('SELECT * FROM push_subscriptions WHERE id = ?').get('s') as Row | undefined }
  }

  it('sent', async () => {
    expect((await apply({ lastOkAt: NOW - HOUR, failCount: 0 }, 'sent')).n).toBe(0)
    expect((await apply({ lastOkAt: NOW - 25 * HOUR, failCount: 0 }, 'sent')).row).toMatchObject({ last_ok_at: NOW, fail_count: 0 })
    expect((await apply({ lastOkAt: NOW - HOUR, failCount: 2 }, 'sent')).row).toMatchObject({ last_ok_at: NOW - HOUR, fail_count: 0 })
    expect((await apply({ lastOkAt: null, failCount: 0 }, 'sent')).row?.last_ok_at).toBe(NOW)
    expect(PUSH_LAST_OK_REFRESH_MS).toBe(86_400_000)
  })

  it('gone·rejected·transient', async () => {
    expect((await apply({ lastOkAt: null, failCount: 0 }, 'gone')).row).toBeUndefined()
    expect((await apply({ lastOkAt: null, failCount: 0 }, 'rejected')).row?.fail_count).toBe(1)
    expect((await apply({ lastOkAt: null, failCount: 1 }, 'rejected')).row?.fail_count).toBe(2)
    expect((await apply({ lastOkAt: null, failCount: 2 }, 'rejected')).row).toBeUndefined()
    expect((await apply({ lastOkAt: null, failCount: 0 }, 'transient')).n).toBe(0)
    expect(PUSH_FAIL_MAX).toBe(3)
  })
})

describe('F-3003 S5 cleanupPushSubscriptions', () => {
  it('죽은 셋을 지운다', async () => {
    const db = openTestDb()
    seedFive(db)
    expect(await cleanupPushSubscriptions({ DB: asD1(db) } as unknown as Env, NOW)).toEqual({ dead: 3 })
    const ids = (db.prepare('SELECT id FROM push_subscriptions ORDER BY id').all() as { id: string }[]).map((r) => r.id)
    expect(ids).toEqual(['live', 'null'])
    expect(await cleanupPushSubscriptions({ DB: asD1(openTestDb()) } as unknown as Env, NOW)).toEqual({ dead: 0 })
  })
})

describe('F-3003 K1 키 스크립트', () => {
  it('JSON 한 줄과 공개 키', async () => {
    const run = () => spawnSync('node', ['scripts/make-vapid-key.mjs'], { encoding: 'utf-8' })
    const [a, b] = [run(), run()]
    for (const r of [a, b]) {
      expect(r.status).toBe(0)
      const out = r.stdout.trim()
      expect(out.split('\n')).toHaveLength(1)
      expect(Object.keys(JSON.parse(out)).sort()).toEqual(['crv', 'd', 'kty', 'x', 'y'])
      const keys = await importVapidKey(out)
      expect(keys).not.toBeNull()
      expect(r.stderr).toContain(keys!.publicKey)
    }
    expect(JSON.parse(a.stdout).d).not.toBe(JSON.parse(b.stdout).d)
  })
})
