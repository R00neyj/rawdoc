// F-3007 S1~S5 보내기 한 벌 — 동시성·pushToEmail·백그라운드 (specs/features/F-3007.md 5.1)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { createVapidAuth, importVapidKey } from '../../worker/webPush'
import type { VapidAuth } from '../../worker/webPush'
import type { LivePushSubscription } from '../../worker/pushServer'
import { PUSH_SEND_CONCURRENCY as RUN_CONCURRENCY } from '../../worker/pushRun'
import { PUSH_SEND_CONCURRENCY, pushInBackground, pushToEmail, sendPushJobs } from '../../worker/pushSend'

const NOW = Date.parse('2026-09-30T00:00:00Z')
const payload = { v: 1 as const, title: 't', body: 'b', tag: 'share:x' as never, url: '/#/' }

let keyCache: { p256dh: string; auth: string } | null = null
let authCache: VapidAuth | null = null
let jwkCache = ''

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

async function vapidAuth(): Promise<VapidAuth> {
  if (authCache) return authCache
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  jwkCache = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
  const keys = await importVapidKey(jwkCache)
  authCache = createVapidAuth(keys!, 'http://localhost:8790')
  return authCache
}

async function sub(id: string): Promise<LivePushSubscription> {
  const k = await clientKeys()
  return { id, email: 'a@example.com', endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: k.p256dh, auth: k.auth, lastOkAt: null, failCount: 0 }
}

afterEach(() => vi.restoreAllMocks())

describe('F-3007 S1 동시성·던지지 않음', () => {
  it('동시 fetch 최대 6, reject 는 transient', async () => {
    expect(RUN_CONCURRENCY).toBe(PUSH_SEND_CONCURRENCY)
    expect(PUSH_SEND_CONCURRENCY).toBe(6)
    const auth = await vapidAuth()
    let open = 0
    let peak = 0
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      const mine = calls++
      open++
      peak = Math.max(peak, open)
      await new Promise((r) => setTimeout(r, 5))
      open--
      if (mine === 3) throw new Error('boom')
      return new Response(null, { status: 201 })
    })
    const jobs = await Promise.all(Array.from({ length: 12 }, async (_, i) => ({ sub: await sub(`s${i}`), payload })))
    const results = await sendPushJobs(jobs, auth, NOW, fetchImpl as unknown as typeof fetch)
    expect(results).toHaveLength(12)
    expect(peak).toBe(6)
    expect(results.filter((r) => r.outcome === 'transient')).toHaveLength(1)
    expect(results.filter((r) => r.outcome === 'sent')).toHaveLength(11)
  })
})

function world() {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u1', 'a@example.com', 1)
  const inner = asD1(sqlDb)
  const state = { batches: 0 }
  const db = {
    prepare: (sql: string) => inner.prepare(sql),
    batch: (list: D1PreparedStatement[]) => {
      state.batches++
      return inner.batch(list)
    },
  } as unknown as D1Database
  return { sqlDb, db, state }
}

function addSession(sqlDb: DatabaseSync, id: string, expiresAt: string) {
  sqlDb
    .prepare('INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, 'u1', `tok-${id}`, expiresAt, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
}

async function addSub(sqlDb: DatabaseSync, id: string, sessionId: string | null) {
  const k = await clientKeys()
  sqlDb
    .prepare('INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, 'u1', sessionId, `https://fcm.googleapis.com/fcm/send/${id}`, k.p256dh, k.auth, 1)
}

describe('F-3007 S2·S3 pushToEmail', () => {
  it('S2 산 세션 둘에만 보내고 결과를 반영', async () => {
    const auth = await vapidAuth()
    const w = world()
    addSession(w.sqlDb, 'ok1', '2099-01-01T00:00:00.000Z')
    addSession(w.sqlDb, 'ok2', '2099-01-01T00:00:00.000Z')
    addSession(w.sqlDb, 'old', '2000-01-01T00:00:00.000Z')
    await addSub(w.sqlDb, 'gone', 'ok1')
    await addSub(w.sqlDb, 'fine', 'ok2')
    await addSub(w.sqlDb, 'dead', 'old')
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(null, { status: String(url).endsWith('/gone') ? 410 : 201 }))
    const n = await pushToEmail(w.db, auth, 'a@example.com', payload, NOW, fetchImpl as unknown as typeof fetch)
    expect(n).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const rows = w.sqlDb.prepare('SELECT id, last_ok_at FROM push_subscriptions ORDER BY id').all() as { id: string; last_ok_at: number | null }[]
    expect(rows.map((r) => r.id)).toEqual(['dead', 'fine'])
    expect(rows.find((r) => r.id === 'fine')!.last_ok_at).toBe(NOW)
  })

  it('S3 구독 없음 — fetch 0, 반환 0, batch 0', async () => {
    const auth = await vapidAuth()
    const w = world()
    const fetchImpl = vi.fn()
    expect(await pushToEmail(w.db, auth, 'a@example.com', payload, NOW, fetchImpl as unknown as typeof fetch)).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(w.state.batches).toBe(0)
  })
})

describe('F-3007 S4·S5 pushInBackground', () => {
  it('S4 VAPID 없음 — task·waitUntil·DB 0', async () => {
    const env = {
      get DB(): never {
        throw new Error('DB used')
      },
    } as unknown as Env
    const task = vi.fn(async () => {})
    const waitUntil = vi.fn()
    await pushInBackground(env, { waitUntil } as unknown as ExecutionContext, 'share', task)
    expect(task).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('S5 waitUntil 이 있으면 맡기고 먼저 풀림, 없으면 끝까지 기다림, 던지면 삼킴', async () => {
    await vapidAuth()
    const env = { VAPID_PRIVATE_JWK: jwkCache, BETTER_AUTH_URL: 'http://localhost:8790' } as unknown as Env
    const held: Promise<unknown>[] = []
    const waitUntil = vi.fn((p: Promise<unknown>) => void held.push(p))
    let release!: () => void
    let done = false
    const slow = async () => {
      await new Promise<void>((r) => (release = r))
      done = true
    }
    await pushInBackground(env, { waitUntil } as unknown as ExecutionContext, 'share', slow)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(done).toBe(false)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await Promise.all(held)
    expect(done).toBe(true)

    let finished = false
    await pushInBackground(env, undefined, 'share', async () => {
      await new Promise((r) => setTimeout(r, 5))
      finished = true
    })
    expect(finished).toBe(true)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await pushInBackground(env, undefined, 'share', async () => {
      throw new Error('x')
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
