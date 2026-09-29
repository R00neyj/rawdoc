// F-3006 P1~P12 문서 방 알람의 모아 보내기 — 모으기·빼기·예산·보내기·결과 batch·"열어 둠" (specs/features/F-3006.md 8.1)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

vi.mock('../../src/lib/pushText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pushText')>()
  return { ...actual, commentPushPayload: vi.fn(actual.commentPushPayload) }
})

import { asD1, openTestDb } from '../../worker/testD1'
import { createVapidAuth, importVapidKey } from '../../worker/webPush'
import type { VapidAuth } from '../../worker/webPush'
import { commentPushPayload } from '../../src/lib/pushText'
import { PUSH_SENDS_PER_RUN_MAX, PUSH_TTL_SEC } from '../../src/lib/pushPayload'
import { readPresence } from '../../worker/docRoomCore'
import {
  PUSH_READ_ROWS_MAX,
  PUSH_SEND_CONCURRENCY,
  packSends,
  presentEmails,
  runDocPush,
  splitRecipients,
} from '../../worker/pushRun'
import type { PendingPushRow } from '../../worker/pushRun'
import type { LivePushSubscription } from '../../worker/pushServer'

const DOC_ID = '33333333-3333-4333-8333-333333333333'
const TOPIC = DOC_ID.replace(/-/g, '')
const NOW = Date.parse('2026-09-30T00:00:00Z')
const OWNER = 'owner@example.com'

let keyCache: { p256dh: string; auth: string } | null = null
let authCache: VapidAuth | null = null

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
  const keys = await importVapidKey(JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)))
  authCache = createVapidAuth(keys!, 'http://localhost:8790')
  return authCache
}

type World = { sqlDb: DatabaseSync; db: D1Database; batches: number }

function world(opts: { e2ee?: boolean } = {}): World {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('owner', OWNER, 1)
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(DOC_ID, 'owner', '회의록', 'x', 'lf', 1, 1, 1, opts.e2ee ? 'k' : null)
  const inner = asD1(sqlDb)
  const w: World = {
    sqlDb,
    batches: 0,
    db: {
      prepare: (sql: string) => inner.prepare(sql),
      batch: (list: D1PreparedStatement[]) => {
        w.batches++
        return inner.batch(list)
      },
    } as unknown as D1Database,
  }
  return w
}

function addUser(w: World, id: string, email: string) {
  w.sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
}

async function addSub(w: World, id: string, userId: string, opts: { sessionId?: string; endpoint?: string; lastOkAt?: number } = {}) {
  const keys = await clientKeys()
  w.sqlDb
    .prepare('INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, last_ok_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, opts.sessionId ?? null, opts.endpoint ?? `https://fcm.googleapis.com/fcm/send/${id}`, keys.p256dh, keys.auth, 1, opts.lastOkAt ?? null)
}

let noteSeq = 0
function addNote(w: World, recipient: string, dueAt: number | null, over: { readAt?: number; kind?: string; createdAt?: number } = {}): string {
  const id = `n${++noteSeq}`
  w.sqlDb
    .prepare(
      'INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, push_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, recipient, over.kind ?? 'comment', DOC_ID, `c${noteSeq}`, `t${noteSeq}`, 'bob@example.com', '회의록', `발췌 ${noteSeq}`, over.createdAt ?? NOW - 60_000, over.readAt ?? null, dueAt)
  return id
}

const dueOf = (w: World, id: string) => (w.sqlDb.prepare('SELECT push_due_at AS p FROM notifications WHERE id = ?').get(id) as { p: number | null }).p

function okFetch(status: (url: string) => number = () => 201) {
  return vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (url) => new Response(null, { status: status(String(url)) }))
}

async function run(w: World, fetchImpl: typeof fetch, present: ReadonlySet<string> = new Set(), now = NOW) {
  return runDocPush({ db: w.db, docId: DOC_ID, now, auth: await vapidAuth(), present, fetchImpl })
}

beforeEach(() => {
  vi.mocked(commentPushPayload).mockClear()
})

describe('F-3006 P1~P6 모으기·빼기', () => {
  it('P1 3분 안 행 셋을 하나로 — fetch 1번, Topic·TTL, 세 행 NULL', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const ids = [addNote(w, OWNER, NOW - 10_000), addNote(w, OWNER, NOW + 60_000), addNote(w, OWNER, NOW + 170_000)]
    const fetchImpl = okFetch()
    const result = await run(w, fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ type: 'done', next: null, followUp: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Topic).toBe(TOPIC)
    expect(headers.TTL).toBe(String(PUSH_TTL_SEC))
    expect(vi.mocked(commentPushPayload).mock.calls[0][1]).toHaveLength(3)
    expect(ids.map((id) => dueOf(w, id))).toEqual([null, null, null])
  })

  it('P2 열어 둠 — fetch 0, 행 NULL', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const ids = [addNote(w, OWNER, NOW - 1_000), addNote(w, OWNER, NOW + 5_000)]
    const fetchImpl = okFetch()
    await run(w, fetchImpl as unknown as typeof fetch, new Set([OWNER]))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(ids.map((id) => dueOf(w, id))).toEqual([null, null])
  })

  it('P3 읽음 — 푸시 1건(행 하나 문구), 두 행 NULL', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const read = addNote(w, OWNER, NOW - 1_000, { readAt: NOW - 500 })
    const unread = addNote(w, OWNER, NOW - 900)
    const fetchImpl = okFetch()
    await run(w, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const rows = vi.mocked(commentPushPayload).mock.calls[0][1]
    expect(rows).toHaveLength(1)
    expect(rows[0].excerpt).toBe(`발췌 ${noteSeq}`)
    expect([dueOf(w, read), dueOf(w, unread)]).toEqual([null, null])
  })

  it('P4 로그아웃한 세션의 구독 — fetch 0, 행 NULL', async () => {
    const w = world()
    const iso = new Date(NOW).toISOString()
    w.sqlDb
      .prepare('INSERT INTO auth_sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .run('sess', 'owner', 'tok', new Date(NOW + 86_400_000).toISOString(), iso, iso)
    await addSub(w, 's1', 'owner', { sessionId: 'sess' })
    w.sqlDb.prepare("DELETE FROM auth_sessions WHERE id = 'sess'").run()
    const id = addNote(w, OWNER, NOW - 1_000)
    const fetchImpl = okFetch()
    await run(w, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(dueOf(w, id)).toBeNull()
  })

  it('P5 아직 차례 아님 — fetch 0, 행 그대로, next = 그 값, batch 0', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const id = addNote(w, OWNER, NOW + 30_000)
    const fetchImpl = okFetch()
    const result = await run(w, fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({ type: 'done', next: NOW + 30_000, followUp: false })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(dueOf(w, id)).toBe(NOW + 30_000)
    expect(w.batches).toBe(0)
  })

  it('P6 1시간 넘은 행 — 새 행만 보내고 옛 행도 NULL, 옛 행만이면 SELECT 0행·batch 0', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const old = addNote(w, OWNER, NOW - 7_200_000)
    const fresh = addNote(w, OWNER, NOW - 1_000)
    const fetchImpl = okFetch()
    await run(w, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(vi.mocked(commentPushPayload).mock.calls[0][1]).toHaveLength(1)
    expect([dueOf(w, old), dueOf(w, fresh)]).toEqual([null, null])

    const onlyOld = world()
    await addSub(onlyOld, 's1', 'owner')
    const lone = addNote(onlyOld, OWNER, NOW - 7_200_000)
    const again = okFetch()
    expect(await run(onlyOld, again as unknown as typeof fetch)).toEqual({ type: 'done', next: null, followUp: false })
    expect(again).not.toHaveBeenCalled()
    expect(onlyOld.batches).toBe(0)
    expect(dueOf(onlyOld, lone)).toBe(NOW - 7_200_000)
  })
})

describe('F-3006 P7~P10 예산·결과·실패·금고', () => {
  it('P7 8명 × 기기 5 → 첫 호출 35(7명), 8번째 행 그대로·followUp, 다시 부르면 나머지 5', async () => {
    const w = world()
    const ids: string[] = []
    for (let i = 1; i <= 8; i++) {
      addUser(w, `u${i}`, `r${i}@example.com`)
      for (let d = 0; d < 5; d++) await addSub(w, `u${i}d${d}`, `u${i}`)
      ids.push(addNote(w, `r${i}@example.com`, NOW - 1_000))
    }
    const first = okFetch()
    expect(await run(w, first as unknown as typeof fetch)).toEqual({ type: 'done', next: null, followUp: true })
    expect(first).toHaveBeenCalledTimes(35)
    expect(ids.slice(0, 7).map((id) => dueOf(w, id))).toEqual(Array(7).fill(null))
    expect(dueOf(w, ids[7])).toBe(NOW - 1_000)

    const second = okFetch()
    expect(await run(w, second as unknown as typeof fetch)).toEqual({ type: 'done', next: null, followUp: false })
    expect(second).toHaveBeenCalledTimes(5)
    expect(dueOf(w, ids[7])).toBeNull()
  })

  it('P7 모으기가 200행을 꽉 채우면 followUp', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    for (let i = 0; i < PUSH_READ_ROWS_MAX + 1; i++) addNote(w, OWNER, NOW - 1_000)
    const result = await run(w, okFetch() as unknown as typeof fetch)
    expect(result).toEqual({ type: 'done', next: null, followUp: true })
    const left = (w.sqlDb.prepare('SELECT COUNT(*) AS n FROM notifications WHERE push_due_at IS NOT NULL').get() as { n: number }).n
    expect(left).toBe(1)
  })

  it('P8 응답 410·400·201 → 구독 지움·fail_count 1·last_ok_at', async () => {
    const w = world()
    await addSub(w, 'gone', 'owner', { endpoint: 'https://fcm.googleapis.com/fcm/send/410' })
    await addSub(w, 'bad', 'owner', { endpoint: 'https://fcm.googleapis.com/fcm/send/400' })
    await addSub(w, 'ok', 'owner', { endpoint: 'https://fcm.googleapis.com/fcm/send/201' })
    addNote(w, OWNER, NOW - 1_000)
    const fetchImpl = okFetch((url) => Number(url.slice(url.lastIndexOf('/') + 1)))
    await run(w, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const subs = w.sqlDb.prepare('SELECT id, fail_count, last_ok_at FROM push_subscriptions ORDER BY id').all()
    expect(subs).toEqual([
      { id: 'bad', fail_count: 1, last_ok_at: null },
      { id: 'ok', fail_count: 0, last_ok_at: NOW },
    ])
  })

  it('P9 결과 batch 가 던지면 failed, 행 그대로', async () => {
    const w = world()
    await addSub(w, 's1', 'owner')
    const id = addNote(w, OWNER, NOW - 1_000)
    w.db = { prepare: w.db.prepare, batch: async () => Promise.reject(new Error('D1 down')) } as unknown as D1Database
    expect(await run(w, okFetch() as unknown as typeof fetch)).toEqual({ type: 'failed' })
    expect(dueOf(w, id)).toBe(NOW - 1_000)
  })

  it('P9 모으기 SELECT 가 던지면 failed', async () => {
    const w = world()
    w.db = {
      prepare: () => ({ bind: () => ({ all: async () => Promise.reject(new Error('D1 down')) }) }),
      batch: w.db.batch,
    } as unknown as D1Database
    expect(await run(w, okFetch() as unknown as typeof fetch)).toEqual({ type: 'failed' })
  })

  it('P10 금고 문서 → 0행, fetch 0', async () => {
    const w = world({ e2ee: true })
    await addSub(w, 's1', 'owner')
    const id = addNote(w, OWNER, NOW - 1_000)
    const fetchImpl = okFetch()
    expect(await run(w, fetchImpl as unknown as typeof fetch)).toEqual({ type: 'done', next: null, followUp: false })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(w.batches).toBe(0)
    expect(dueOf(w, id)).toBe(NOW - 1_000)
  })
})

describe('F-3006 P11 presentEmails', () => {
  const at = (age: number) => NOW - age
  it('90초 경계, lastPing 만·connectedAt 만·둘 다 null, 소문자, 빈 이메일 무시', () => {
    const got = presentEmails(
      [
        { email: 'In@Example.com', connectedAt: at(89_999), lastPing: null },
        { email: 'out@example.com', connectedAt: at(90_001), lastPing: null },
        { email: 'ping@example.com', connectedAt: null, lastPing: at(1_000) },
        { email: 'stale@example.com', connectedAt: at(200_000), lastPing: at(100_000) },
        { email: 'late-ping@example.com', connectedAt: at(200_000), lastPing: at(5_000) },
        { email: 'none@example.com', connectedAt: null, lastPing: null },
        { email: '', connectedAt: at(1), lastPing: at(1) },
      ],
      NOW,
    )
    expect([...got].sort()).toEqual(['in@example.com', 'late-ping@example.com', 'ping@example.com'])
  })

  it('readPresence — 상태를 못 읽는 연결은 null, connectedAt 은 상태에서, 역할은 보지 않는다', () => {
    expect(readPresence(null, 5)).toBeNull()
    expect(readPresence({ userId: 'u', email: 'a@example.com', role: 'nope' }, 5)).toBeNull()
    expect(readPresence({ userId: 'u', email: 'A@example.com', role: 'view', connectedAt: 7 }, null)).toEqual({
      email: 'A@example.com',
      connectedAt: 7,
      lastPing: null,
    })
    expect(readPresence({ userId: 'u', email: 'a@example.com', role: 'edit', connectedAt: 'x' }, 9)).toEqual({
      email: 'a@example.com',
      connectedAt: null,
      lastPing: 9,
    })
  })
})

describe('F-3006 P12 동시성', () => {
  it('36건 보낼 때 동시에 떠 있는 fetch 최대 6', async () => {
    const w = world()
    for (let i = 1; i <= 9; i++) {
      addUser(w, `u${i}`, `r${i}@example.com`)
      for (let d = 0; d < 4; d++) await addSub(w, `u${i}d${d}`, `u${i}`)
      addNote(w, `r${i}@example.com`, NOW - 1_000)
    }
    let inFlight = 0
    let peak = 0
    const fetchImpl = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight--
      return new Response(null, { status: 201 })
    })
    await run(w, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(36)
    expect(peak).toBe(PUSH_SEND_CONCURRENCY)
  })
})

describe('F-3006 순수 함수 — 받는 사람 나누기·예산', () => {
  const row = (id: string, email: string, over: Partial<PendingPushRow> = {}): PendingPushRow => ({
    id,
    recipient_email: email,
    kind: 'comment',
    thread_id: 't',
    actor_email: 'bob@example.com',
    doc_title: 'd',
    excerpt: 'e',
    created_at: 1,
    read_at: null,
    push_due_at: 1,
    ...over,
  })
  const sub = (id: string, email: string): LivePushSubscription => ({ id, email, endpoint: `https://fcm.googleapis.com/${id}`, p256dh: 'k', auth: 'a', lastOkAt: null, failCount: 0 })

  it('열어 둠·읽음·남은 행 0 은 빼는 행, 나머지는 이메일 오름차순 받는 사람', () => {
    const split = splitRecipients(
      [row('1', 'z@example.com'), row('2', 'a@example.com', { read_at: 5 }), row('3', 'p@example.com'), row('4', 'm@example.com'), row('5', 'm@example.com', { read_at: 1 })],
      new Set(['p@example.com']),
    )
    expect(split.skipped.sort()).toEqual(['2', '3'])
    expect(split.recipients.map((r) => [r.email, r.rows.map((x) => x.id), r.ids])).toEqual([
      ['m@example.com', ['4'], ['4', '5']],
      ['z@example.com', ['1'], ['1']],
    ])
  })

  it('사람 단위로 36 까지, 구독 0 인 사람은 다룬 행, 넘으면 뒤는 그대로', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((p) => ({ email: `${p}@x`, rows: [row(p, `${p}@x`)], ids: [p] }))
    const subs = people.flatMap((p, i) => (i === 1 ? [] : [0, 1, 2, 3, 4].map((d) => sub(`${p.email}${d}`, p.email))))
    const packed = packSends(people, subs, PUSH_SENDS_PER_RUN_MAX)
    expect(packed.sends.map((s) => s.recipient.email)).toEqual(['a@x', 'c@x', 'd@x', 'e@x', 'f@x', 'g@x', 'h@x'])
    expect(packed.sends.reduce((n, s) => n + s.subs.length, 0)).toBe(35)
    expect(packed.handled.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(packed.deferred).toBe(false)

    const tight = packSends(people, subs, 12)
    expect(tight.sends.map((s) => s.recipient.email)).toEqual(['a@x', 'c@x'])
    expect(tight.handled.sort()).toEqual(['a', 'b', 'c'])
    expect(tight.deferred).toBe(true)
  })

  it('첫 사람은 상한보다 기기가 많아도 들어간다', () => {
    const packed = packSends([{ email: 'a@x', rows: [row('1', 'a@x')], ids: ['1'] }], [sub('1', 'a@x'), sub('2', 'a@x')], 1)
    expect(packed.sends).toHaveLength(1)
    expect(packed.deferred).toBe(false)
  })
})
