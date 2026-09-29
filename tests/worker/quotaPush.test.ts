// F-3008 Q1~Q3 순수·문장, W1~W9 Worker 자리 (specs/features/F-3008.md 5.1·5.2)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

vi.mock('../../worker/auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'owner'
    return { id, email: `${id}@example.com` }
  }),
  rememberUser: vi.fn(),
}))

vi.mock('../../src/lib/pushText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pushText')>()
  return { ...actual, quotaPushPayload: vi.fn(actual.quotaPushPayload) }
})

import { asD1, openTestDb } from '../../worker/testD1'
import { createVapidAuth, importVapidKey } from '../../worker/webPush'
import { ATTACHMENT_QUOTA_BYTES, handleUploadAttachment } from '../../worker/attachments'
import { handleCreateDoc, handleUpdateDoc } from '../../worker/docs'
import { handleCreateAttachmentV1, handleCreateDocV1 } from '../../worker/v1'
import { DOC_BYTES_QUOTA, claimQuotaPush, quotaOver, sendQuotaPush } from '../../worker/usage'
import { quotaPushPayload } from '../../src/lib/pushText'
import { PUSH_QUOTA_REPEAT_MS } from '../../src/lib/pushPayload'

const NOW = Date.parse('2026-09-30T00:00:00Z')
const DOC_ID = '33333333-3333-4333-8333-333333333333'
const gauge = (used: number, limit: number) => ({ used, limit })

describe('F-3008 Q1 quotaOver 경계', () => {
  it('정확히 90% 는 남고 1 적으면 빠진다, 이미지만 넘으면 images 만', () => {
    expect(quotaOver({ docBytes: gauge(90, 100) })).toEqual({ docBytes: gauge(90, 100) })
    expect(quotaOver({ docBytes: gauge(89, 100) })).toBeNull()
    expect(quotaOver({ images: gauge(1, 10), docBytes: gauge(1, 100), docCount: gauge(1, 100) })).toBeNull()
    expect(quotaOver({ images: gauge(9, 10), docBytes: gauge(1, 100) })).toEqual({ images: gauge(9, 10) })
  })
})

let keys: { p256dh: string; auth: string } | null = null
let jwk = ''

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function clientKeys() {
  if (keys) return keys
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  keys = { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) }
  return keys
}

async function vapidJwk() {
  if (jwk) return jwk
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
  return jwk
}

async function subscribe(sqlDb: DatabaseSync, userId: string) {
  const k = await clientKeys()
  sqlDb
    .prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)')
    .run(`s-${userId}`, userId, `https://fcm.googleapis.com/fcm/send/${userId}`, k.p256dh, k.auth, 1)
}

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 24))
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2])
  return bytes
}

function fakeCtx() {
  const promises: Promise<unknown>[] = []
  const ctx = { waitUntil: vi.fn((p: Promise<unknown>) => void promises.push(p)), passThroughOnException() {} } as unknown as ExecutionContext
  return { ctx, settle: () => Promise.all(promises) }
}

async function world(opts: { vapid?: boolean } = {}) {
  const sqlDb = openTestDb()
  const users = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
  for (const id of ['owner', 'u2', 'u3', 'editor']) users.run(id, `${id}@example.com`, 1)
  const env = {
    DB: asD1(sqlDb),
    BUCKET: { async put() {}, async delete() {} },
    ...(opts.vapid === false ? {} : { VAPID_PRIVATE_JWK: await vapidJwk(), BETTER_AUTH_URL: 'http://localhost:8790' }),
  } as unknown as Env
  return { sqlDb, env }
}

const setBytes = (sqlDb: DatabaseSync, id: string, n: number) => sqlDb.prepare('UPDATE users SET content_bytes = ? WHERE id = ?').run(n, id)
const quotaAt = (sqlDb: DatabaseSync, id: string) => (sqlDb.prepare('SELECT push_quota_at AS n FROM users WHERE id = ?').get(id) as { n: number | null }).n

function createRequest(user: string, content: string): Request {
  return new Request('http://local.test/api/docs', {
    method: 'POST',
    headers: { 'x-test-user': user, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 't', content, lineEnding: 'lf' }),
  })
}

describe('F-3008 Q2·Q3 claimQuotaPush·sendQuotaPush', () => {
  it('Q2 처음 → 이메일, 곧바로·정확히 7일 → null, 7일 + 1ms → 이메일, 없는 id → null', async () => {
    const { sqlDb, env } = await world()
    expect(await claimQuotaPush(env.DB, 'owner', NOW)).toBe('owner@example.com')
    expect(quotaAt(sqlDb, 'owner')).toBe(NOW)
    expect(await claimQuotaPush(env.DB, 'owner', NOW + 1)).toBeNull()
    expect(await claimQuotaPush(env.DB, 'owner', NOW + PUSH_QUOTA_REPEAT_MS)).toBeNull()
    expect(await claimQuotaPush(env.DB, 'owner', NOW + PUSH_QUOTA_REPEAT_MS + 1)).toBe('owner@example.com')
    expect(await claimQuotaPush(env.DB, 'nobody', NOW)).toBeNull()
  })

  it('Q3 구독이 없으면 fetch 0, 반환 0, 표지는 찍힘', async () => {
    const { sqlDb, env } = await world()
    const auth = createVapidAuth((await importVapidKey(await vapidJwk()))!, 'http://localhost:8790')
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }))
    const sent = await sendQuotaPush(env.DB, auth, 'owner', { docBytes: gauge(95, 100) }, NOW, fetchImpl as unknown as typeof fetch)
    expect(sent).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(quotaAt(sqlDb, 'owner')).toBe(NOW)
  })
})

describe('F-3008 W1~W9 Worker 자리', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(quotaPushPayload).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('W1·W2 문서 만들기로 90% 를 넘기면 푸시 1 — 응답 201 그대로, 이어서 한 번 더는 없음', async () => {
    const { sqlDb, env } = await world()
    await subscribe(sqlDb, 'owner')
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9 - 10)
    const { ctx, settle } = fakeCtx()
    const res = await handleCreateDoc(createRequest('owner', 'x'.repeat(20)), env, ctx)
    await settle()
    expect(res.status).toBe(201)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.mocked(quotaPushPayload).mock.calls[0][0]).toEqual({ docBytes: { used: DOC_BYTES_QUOTA * 0.9 + 10, limit: DOC_BYTES_QUOTA } })

    fetchMock.mockClear()
    const again = fakeCtx()
    await handleCreateDoc(createRequest('owner', 'y'), env, again.ctx)
    await again.settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('W3 90% 미만이면 waitUntil 0, 표지 NULL', async () => {
    const { sqlDb, env } = await world()
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9 - 100)
    const { ctx } = fakeCtx()
    await handleCreateDoc(createRequest('owner', 'x'.repeat(20)), env, ctx)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
    expect(quotaAt(sqlDb, 'owner')).toBeNull()
  })

  it('W4 올리기 — 평문 PUT·금고 PUT·/v1 각각 90% 를 넘기면 푸시 1, images 만', async () => {
    const { sqlDb, env } = await world()
    const base = ATTACHMENT_QUOTA_BYTES * 0.9 - 100
    for (const id of ['owner', 'u2', 'u3']) {
      await subscribe(sqlDb, id)
      sqlDb
        .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, 'seed', 'png', 'image/png', base, 1, 1, 1)
    }
    const bytes = pngBytes(200)
    const headers = (user: string) => ({ 'x-test-user': user, 'Content-Length': String(bytes.length) })

    const plain = fakeCtx()
    const r1 = await handleUploadAttachment(
      new Request('http://local.test/api/attachments/x', { method: 'PUT', headers: headers('owner'), body: bytes }),
      env,
      plain.ctx,
      { idext: 'aaaaaaaaaaaaaaaa.png' },
    )
    await plain.settle()
    expect(r1.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const vault = fakeCtx()
    const sealed = new Uint8Array(200)
    sealed[0] = 1
    const r2 = await handleUploadAttachment(
      new Request('http://local.test/api/attachments/x?e2ee=1&w=2&h=2', { method: 'PUT', headers: headers('u2'), body: sealed }),
      env,
      vault.ctx,
      { idext: 'bbbbbbbbbbbbbbbb.png' },
    )
    await vault.settle()
    expect(r2.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const v1 = fakeCtx()
    const r3 = await handleCreateAttachmentV1(
      new Request('http://local.test/v1/attachments', { method: 'POST', headers: headers('u3'), body: bytes }),
      env,
      v1.ctx,
    )
    await v1.settle()
    expect(r3.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const expected = { images: { used: base + 200, limit: ATTACHMENT_QUOTA_BYTES } }
    expect(vi.mocked(quotaPushPayload).mock.calls.map((c) => c[0])).toEqual([expected, expected, expected])
  })

  it('W5 /v1/docs 만들기는 받은 ctx 로 waitUntil 1', async () => {
    const { sqlDb, env } = await world()
    await subscribe(sqlDb, 'owner')
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9)
    const { ctx, settle } = fakeCtx()
    const res = await handleCreateDocV1(
      new Request('http://local.test/v1/docs', {
        method: 'POST',
        headers: { 'x-test-user': 'owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 't', content: 'abc' }),
      }),
      env,
      ctx,
    )
    await settle()
    expect(res.status).toBe(201)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  function seedSharedDoc(sqlDb: DatabaseSync) {
    sqlDb
      .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(DOC_ID, 'owner', 't', 'abc', 'lf', 1, 1, 1)
    sqlDb
      .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
      .run('doc', DOC_ID, 'owner', 'editor@example.com', 'edit', 1)
  }

  const putRequest = (user: string, content: string, baseVersion: number) =>
    new Request(`http://local.test/api/docs/${DOC_ID}`, {
      method: 'PUT',
      headers: { 'x-test-user': user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, baseVersion }),
    })

  it('W6 남이 늘린 PUT — 소유자 구독으로만 1, 줄이는 PUT 은 waitUntil 0', async () => {
    const { sqlDb, env } = await world()
    seedSharedDoc(sqlDb)
    await subscribe(sqlDb, 'owner')
    await subscribe(sqlDb, 'editor')
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9)
    const grow = fakeCtx()
    const res = await handleUpdateDoc(putRequest('editor', 'abcdef', 1), env, grow.ctx, { id: DOC_ID })
    await grow.settle()
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/owner')

    const shrink = fakeCtx()
    const res2 = await handleUpdateDoc(putRequest('editor', 'a', 2), env, shrink.ctx, { id: DOC_ID })
    expect(res2.status).toBe(200)
    expect(shrink.ctx.waitUntil).not.toHaveBeenCalled()
  })

  it('W7 VAPID 없음 — waitUntil 0, 표지 NULL, 응답 본문은 있을 때와 같다', async () => {
    const withKey = await world()
    const without = await world({ vapid: false })
    for (const w of [withKey, without]) {
      await subscribe(w.sqlDb, 'owner')
      setBytes(w.sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9)
    }
    const a = fakeCtx()
    const b = fakeCtx()
    const req = () =>
      new Request('http://local.test/api/docs', {
        method: 'POST',
        headers: { 'x-test-user': 'owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: DOC_ID, title: 't', content: 'abc', lineEnding: 'lf', createdAt: 5, updatedAt: 5 }),
      })
    const ra = await handleCreateDoc(req(), withKey.env, a.ctx)
    const rb = await handleCreateDoc(req(), without.env, b.ctx)
    await a.settle()
    expect(b.ctx.waitUntil).not.toHaveBeenCalled()
    expect(quotaAt(without.sqlDb, 'owner')).toBeNull()
    expect(await rb.json()).toEqual(await ra.json())
  })

  it('W8 fetch 가 reject 해도 201, 약속은 reject 없이 풀린다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('network'))
    const { sqlDb, env } = await world()
    await subscribe(sqlDb, 'owner')
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA * 0.9)
    const { ctx, settle } = fakeCtx()
    const res = await handleCreateDoc(createRequest('owner', 'abc'), env, ctx)
    expect(res.status).toBe(201)
    await expect(settle()).resolves.toBeDefined()
  })

  it('W9 한도 초과 413·507 은 waitUntil 0', async () => {
    const { sqlDb, env } = await world()
    await subscribe(sqlDb, 'owner')
    setBytes(sqlDb, 'owner', DOC_BYTES_QUOTA)
    const doc = fakeCtx()
    const r1 = await handleCreateDoc(createRequest('owner', 'abc'), env, doc.ctx)
    expect(r1.status).toBe(413)
    sqlDb
      .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('owner', 'seed', 'png', 'image/png', ATTACHMENT_QUOTA_BYTES, 1, 1, 1)
    const bytes = pngBytes(100)
    const att = fakeCtx()
    const r2 = await handleUploadAttachment(
      new Request('http://local.test/api/attachments/x', { method: 'PUT', headers: { 'x-test-user': 'owner', 'Content-Length': String(bytes.length) }, body: bytes }),
      env,
      att.ctx,
      { idext: 'cccccccccccccccc.png' },
    )
    expect(r2.status).toBe(507)
    expect(doc.ctx.waitUntil).not.toHaveBeenCalled()
    expect(att.ctx.waitUntil).not.toHaveBeenCalled()
  })
})
