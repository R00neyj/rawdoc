// 금고 첨부 올리기·받기·지우기와 정리 Cron — worker/index.ts 를 통째로 (specs/features/F-402.md 7장)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from './testD1'
import { cleanupServerAttachments } from './attachmentGc'
import { extractAttachmentRefs } from '../src/lib/imageBlock'
import { E2EE_ATTACHMENT_OVERHEAD, E2EE_FORMAT_VERSION } from '../src/lib/e2eeLimits'
import { ATTACHMENT_QUOTA_BYTES } from './attachments'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const EMAIL_A = 'a@example.com'
const EMAIL_B = 'b@example.com'
const EMAIL_C = 'c@example.com'
const EMAIL_D = 'd@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

type PutOptions = { httpMetadata?: { contentType?: string } }

function makeBucket() {
  const store = new Map<string, Uint8Array>()
  const meta = new Map<string, PutOptions['httpMetadata']>()
  const putCalls: string[] = []
  const deleteCalls: string[] = []
  let failDelete = false
  return {
    store,
    meta,
    putCalls,
    deleteCalls,
    setFailDelete(v: boolean) {
      failDelete = v
    },
    async put(key: string, value: Uint8Array, options?: PutOptions) {
      putCalls.push(key)
      store.set(key, value)
      meta.set(key, options?.httpMetadata)
    },
    async get(key: string) {
      const bytes = store.get(key)
      if (!bytes) return null
      return { body: bytes } as unknown as R2ObjectBody
    },
    async delete(key: string) {
      deleteCalls.push(key)
      if (failDelete) throw new Error('r2 delete failed')
      store.delete(key)
    },
  }
}
type FakeBucket = ReturnType<typeof makeBucket>

function makeWorld() {
  const sqlDb = openTestDb()
  const bucket = makeBucket()
  const base = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    BUCKET: bucket,
  }
  const A = { ...base, DEV_AUTH_EMAIL: EMAIL_A } as unknown as Env
  const B = { ...base, DEV_AUTH_EMAIL: EMAIL_B } as unknown as Env
  const C = { ...base, DEV_AUTH_EMAIL: EMAIL_C } as unknown as Env
  const D = { ...base, DEV_AUTH_EMAIL: EMAIL_D } as unknown as Env
  return { sqlDb, bucket, A, B, C, D }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

async function ensureUser(env: Env, sqlDb: DatabaseSync, email: string): Promise<string> {
  await call(env, '/api/usage')
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

function writeCount(sqlDb: DatabaseSync, email: string): number {
  const row = sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(email) as { write_count: number } | undefined
  return row?.write_count ?? 0
}

type AttachmentDbRow = {
  owner_id: string
  id: string
  ext: string
  mime: string
  size: number
  width: number
  height: number
  created_at: number
  e2ee: number
}
function attachmentRow(sqlDb: DatabaseSync, ownerId: string, id: string): AttachmentDbRow | undefined {
  return sqlDb.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ?').get(ownerId, id) as AttachmentDbRow | undefined
}

type AttOver = { mime?: string; size?: number; width?: number; height?: number; created_at?: number; e2ee?: 0 | 1 }
function insertAttachment(sqlDb: DatabaseSync, ownerId: string, id: string, ext: string, over: AttOver = {}) {
  sqlDb
    .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(
      ownerId,
      id,
      ext,
      over.mime ?? 'image/png',
      over.size ?? 100,
      over.width ?? 2,
      over.height ?? 2,
      over.created_at ?? 1,
      over.e2ee ?? 0,
    )
}

type DocOver = {
  folder_id?: string | null
  e2ee_key?: string | null
  attachment_refs?: string | null
  content?: string
  title?: string
  version?: number
}
function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOver = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      ownerId,
      over.title ?? 't',
      over.content ?? 'c',
      'lf',
      over.folder_id ?? null,
      over.version ?? 1,
      1,
      1,
      over.e2ee_key ?? null,
      over.attachment_refs ?? null,
    )
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, over: { parent_id?: string | null } = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,0)')
    .run(id, ownerId, `f-${id.slice(-2)}`, over.parent_id ?? null, 1, 1)
}

function insertLink(sqlDb: DatabaseSync, token: string, ownerId: string, targetType: 'doc' | 'folder', targetId: string) {
  sqlDb
    .prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)')
    .run(token, ownerId, targetType, targetId, 1)
}

function insertGrant(sqlDb: DatabaseSync, targetType: 'doc' | 'folder', targetId: string, ownerId: string, email: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(targetType, targetId, ownerId, email, role, 1)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// isValidToken(worker/token.ts) 은 base64url 43자만 받는다
const L_TOKEN = 'L'.repeat(43)
const FL_TOKEN = 'F'.repeat(43)
const SL_TOKEN = 'S'.repeat(43)

function envelope(length: number, firstByte: number = E2EE_FORMAT_VERSION): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes[0] = firstByte
  return bytes
}

const ENV = envelope(100)

function pngBytes(width = 2, height = 2): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const dv = new DataView(bytes.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return bytes
}

function uploadInit(bytes: Uint8Array, extra: RequestInit = {}): RequestInit {
  return { method: 'PUT', headers: { 'Content-Length': String(bytes.length) }, body: bytes, ...extra }
}

// 7.1 올리기
describe('F-402 U1~U9 PUT /api/attachments/:idext?e2ee=1', () => {
  it('U1 새 금고 첨부 — 201, D1·R2·write_count', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    const before = writeCount(sqlDb, EMAIL_A)

    const res = await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png?e2ee=1&w=640&h=480', uploadInit(ENV))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'aaaaaaaaaaaaaaaa', ext: 'png', mime: 'image/png', size: 100, width: 640, height: 480, e2ee: true })

    const row = attachmentRow(sqlDb, owner, 'aaaaaaaaaaaaaaaa')
    expect(row?.e2ee).toBe(1)
    expect(row?.mime).toBe('image/png')
    expect(row?.size).toBe(100)

    const key = `att/${owner}/aaaaaaaaaaaaaaaa.png`
    expect(bucket.store.get(key)).toEqual(ENV)
    expect(bucket.meta.get(key)?.contentType).toBe('application/octet-stream')
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(1)
  })

  it('U2 같은 요청 다시 — 200 같은 몸통, put 추가 0, write_count 그대로', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png?e2ee=1&w=640&h=480', uploadInit(ENV))
    const before = writeCount(sqlDb, EMAIL_A)

    const res = await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png?e2ee=1&w=640&h=480', uploadInit(ENV))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'aaaaaaaaaaaaaaaa', ext: 'png', mime: 'image/png', size: 100, width: 640, height: 480, e2ee: true })
    expect(bucket.putCalls.length).toBe(1)
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(0)
  })

  it('U3 평문·금고 엇갈림 — 둘 다 409 e2ee_mismatch, 행·R2 그대로', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png?e2ee=1&w=640&h=480', uploadInit(ENV))
    await call(A, '/api/attachments/bbbbbbbbbbbbbbbb.png', uploadInit(pngBytes()))
    const before = writeCount(sqlDb, EMAIL_A)

    const plainOverE2ee = await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png', uploadInit(pngBytes()))
    expect(plainOverE2ee.status).toBe(409)
    expect(await plainOverE2ee.json()).toEqual({ error: 'e2ee_mismatch' })

    const e2eeOverPlain = await call(A, '/api/attachments/bbbbbbbbbbbbbbbb.png?e2ee=1&w=1&h=1', uploadInit(ENV))
    expect(e2eeOverPlain.status).toBe(409)
    expect(await e2eeOverPlain.json()).toEqual({ error: 'e2ee_mismatch' })

    expect(bucket.putCalls.length).toBe(2) // 최초 성공한 둘뿐
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(0)
  })

  it('U4 쿼리 400 들', async () => {
    const { A } = makeWorld()
    const cases: [string, string][] = [
      ['aaaaaaaaaaaaaaa1.png?e2ee=true&w=1&h=1', 'e2ee'],
      ['aaaaaaaaaaaaaaa2.png?e2ee=1&h=1', 'w'],
      ['aaaaaaaaaaaaaaa3.png?e2ee=1&w=0&h=1', 'w'],
      ['aaaaaaaaaaaaaaa4.png?e2ee=1&w=012&h=1', 'w'],
      ['aaaaaaaaaaaaaaa5.png?e2ee=1&w=1.5&h=1', 'w'],
      ['aaaaaaaaaaaaaaa6.png?e2ee=1&w=1&h=-3', 'h'],
    ]
    for (const [path, field] of cases) {
      const res = await call(A, `/api/attachments/${path}`, uploadInit(ENV))
      expect(res.status, path).toBe(400)
      expect(await res.json(), path).toEqual({ error: 'invalid', field })
    }
  })

  it('U5 픽셀 상한 — 40,010,000 400 unsupported, 40,000,000 201', async () => {
    const { A } = makeWorld()
    const over = await call(A, '/api/attachments/cccccccccccccc01.png?e2ee=1&w=10000&h=4001', uploadInit(envelope(200)))
    expect(over.status).toBe(400)
    expect(await over.json()).toEqual({ error: 'unsupported' })

    const at = await call(A, '/api/attachments/cccccccccccccc02.png?e2ee=1&w=10000&h=4000', uploadInit(envelope(200)))
    expect(at.status).toBe(201)
  })

  it('U6 봉투 모양 — 68B 400, 69B 201, 100B 인데 PNG 서명 400', async () => {
    const { A } = makeWorld()
    const tooShort = await call(A, '/api/attachments/dddddddddddddd01.png?e2ee=1&w=1&h=1', uploadInit(envelope(E2EE_ATTACHMENT_OVERHEAD - 1)))
    expect(tooShort.status).toBe(400)
    expect(await tooShort.json()).toEqual({ error: 'invalid', field: 'body' })

    const exact = await call(A, '/api/attachments/dddddddddddddd02.png?e2ee=1&w=1&h=1', uploadInit(envelope(E2EE_ATTACHMENT_OVERHEAD)))
    expect(exact.status).toBe(201)

    const plainDisguise = new Uint8Array(100)
    plainDisguise[0] = 0x89
    const disguised = await call(A, '/api/attachments/dddddddddddddd03.png?e2ee=1&w=1&h=1', uploadInit(plainDisguise))
    expect(disguised.status).toBe(400)
    expect(await disguised.json()).toEqual({ error: 'invalid', field: 'body' })
  })

  it('U7 Content-Length 초과는 본문 읽기 전에 413, 딱 맞으면 201', async () => {
    const { A } = makeWorld()
    const over = await call(A, '/api/attachments/eeeeeeeeeeeeee01.png?e2ee=1&w=1&h=1', {
      method: 'PUT',
      headers: { 'Content-Length': '5242881' },
      body: envelope(100),
    })
    expect(over.status).toBe(413)
    expect(await over.json()).toEqual({ error: 'too_large', limit: 5242880 })

    const exact = await call(A, '/api/attachments/eeeeeeeeeeeeee02.png?e2ee=1&w=1&h=1', uploadInit(envelope(5_242_880)))
    expect(exact.status).toBe(201)
  }, 20_000)

  it('U8 계정 한도 초과 — 507, R2 put 0', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, 'ffffffffffffff00', 'png', { size: ATTACHMENT_QUOTA_BYTES - 50 })

    const res = await call(A, '/api/attachments/ffffffffffffff01.png?e2ee=1&w=1&h=1', uploadInit(envelope(100)))
    expect(res.status).toBe(507)
    const body = (await res.json()) as { error: string; used: number; limit: number }
    expect(body.error).toBe('quota_exceeded')
    expect(body.used).toBe(ATTACHMENT_QUOTA_BYTES - 50)
    expect(body.limit).toBe(ATTACHMENT_QUOTA_BYTES)
    expect(bucket.putCalls.length).toBe(0)
  })

  it('U9 평문 올리기는 쿼리를 보지 않는다', async () => {
    const { A } = makeWorld()
    const plain = await call(A, '/api/attachments/1111111111111101.png', uploadInit(pngBytes()))
    expect(plain.status).toBe(201)
    expect('e2ee' in (await plain.json() as Record<string, unknown>)).toBe(false)

    const weirdQuery = await call(A, '/api/attachments/1111111111111102.png?w=abc', uploadInit(pngBytes()))
    expect(weirdQuery.status).toBe(201)
    const body = (await weirdQuery.json()) as Record<string, unknown>
    expect('e2ee' in body).toBe(false)
  })
})

// 7.2 받기
describe('F-402 R1~R7 받기', () => {
  async function setupR() {
    const { sqlDb, A, B, bucket } = makeWorld()
    const ownerA = await ensureUser(A, sqlDb, EMAIL_A)
    const ownerB = await ensureUser(B, sqlDb, EMAIL_B)

    insertAttachment(sqlDb, ownerA, 'eeeeeeeeeeeeeeee', 'png', { e2ee: 1 })
    bucket.store.set(`att/${ownerA}/eeeeeeeeeeeeeeee.png`, ENV)
    insertAttachment(sqlDb, ownerA, '0000000000000001', 'png', { e2ee: 0 })
    bucket.store.set(`att/${ownerA}/0000000000000001.png`, pngBytes())

    const content = 'attachments/eeeeeeeeeeeeeeee.png attachments/0000000000000001.png'
    insertFolder(sqlDb, uuid(900), ownerA)
    insertDoc(sqlDb, uuid(901), ownerA, { content, folder_id: uuid(900) })
    insertGrant(sqlDb, 'doc', uuid(901), ownerA, EMAIL_B, 'edit')
    insertLink(sqlDb, L_TOKEN, ownerA, 'doc', uuid(901))
    insertLink(sqlDb, FL_TOKEN, ownerA, 'folder', uuid(900))
    insertLink(sqlDb, SL_TOKEN, ownerA, 'doc', uuid(901))

    return { sqlDb, A, B, ownerA, ownerB, docId: uuid(901) }
  }

  it('R1 소유자 받기 — octet-stream, 봉투 그대로', async () => {
    const { A } = await setupR()
    const res = await call(A, '/api/attachments/eeeeeeeeeeeeeeee.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ENV)
  })

  it('R2 소유자 평문 받기 — image/png 그대로', async () => {
    const { A } = await setupR()
    const res = await call(A, '/api/attachments/0000000000000001.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('R3 초대받은 B — 금고 404 / 평문 200', async () => {
    const { B, docId } = await setupR()
    const e2eeRes = await call(B, `/api/attachments/eeeeeeeeeeeeeeee.png?doc=${docId}`)
    expect(e2eeRes.status).toBe(404)
    const plainRes = await call(B, `/api/attachments/0000000000000001.png?doc=${docId}`)
    expect(plainRes.status).toBe(200)
    expect(plainRes.headers.get('Content-Type')).toBe('image/png')
  })

  it('R4 로그인 없이 공개 문서 링크 — 금고 404 / 평문 200', async () => {
    const { A } = await setupR()
    const e2eeRes = await call(A, `/pub/docs/${L_TOKEN}/attachments/eeeeeeeeeeeeeeee.png`)
    expect(e2eeRes.status).toBe(404)
    const plainRes = await call(A, `/pub/docs/${L_TOKEN}/attachments/0000000000000001.png`)
    expect(plainRes.status).toBe(200)
  })

  it('R5 공개 폴더 링크 — 금고 404 / 평문 200', async () => {
    const { A, docId } = await setupR()
    const e2eeRes = await call(A, `/pub/folders/${FL_TOKEN}/docs/${docId}/attachments/eeeeeeeeeeeeeeee.png`)
    expect(e2eeRes.status).toBe(404)
    const plainRes = await call(A, `/pub/folders/${FL_TOKEN}/docs/${docId}/attachments/0000000000000001.png`)
    expect(plainRes.status).toBe(200)
  })

  it('R6 묶음 링크 — 금고 404 / 평문 200', async () => {
    const { A, docId } = await setupR()
    const e2eeRes = await call(A, `/pub/docs/${SL_TOKEN}/docs/${docId}/attachments/eeeeeeeeeeeeeeee.png`)
    expect(e2eeRes.status).toBe(404)
    const plainRes = await call(A, `/pub/docs/${SL_TOKEN}/docs/${docId}/attachments/0000000000000001.png`)
    expect(plainRes.status).toBe(200)
  })

  it('R7 금고 문서 자체는 F-401 X1 대로 404', async () => {
    const { sqlDb, A, B } = await setupR()
    const ownerA = (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL_A) as { id: string }).id
    void A
    insertDoc(sqlDb, uuid(902), ownerA, { e2ee_key: 'K', attachment_refs: '["eeeeeeeeeeeeeeee"]' })
    const res = await call(B, `/api/attachments/eeeeeeeeeeeeeeee.png?doc=${uuid(902)}`)
    expect(res.status).toBe(404)
  })
})

// 7.3 지우기
describe('F-402 X1~X9 DELETE /api/attachments/:idext', () => {
  it('X1 참조 없는 평문 첨부 — 204, D1 없음, R2 delete 1번, write_count +1', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, 'aaaaaaaaaaaaaaaa', 'png')
    const before = writeCount(sqlDb, EMAIL_A)

    const res = await call(A, '/api/attachments/aaaaaaaaaaaaaaaa.png', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(attachmentRow(sqlDb, owner, 'aaaaaaaaaaaaaaaa')).toBeUndefined()
    expect(bucket.deleteCalls).toEqual([`att/${owner}/aaaaaaaaaaaaaaaa.png`])
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(1)
  })

  it('X2 404 넷 — 다시 지움 / 확장자 다름 / 남의 것 / idext 모양 오류', async () => {
    const { sqlDb, A, B, bucket } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    await ensureUser(B, sqlDb, EMAIL_B)
    insertAttachment(sqlDb, owner, 'bbbbbbbbbbbbbbbb', 'png')
    const before = writeCount(sqlDb, EMAIL_A)

    const again1 = await call(A, '/api/attachments/cccccccccccccccc.png', { method: 'DELETE' })
    expect(again1.status).toBe(404)
    expect(await again1.json()).toEqual({ error: 'not_found' })

    const wrongExt = await call(A, '/api/attachments/bbbbbbbbbbbbbbbb.jpg', { method: 'DELETE' })
    expect(wrongExt.status).toBe(404)

    const notMine = await call(B, '/api/attachments/bbbbbbbbbbbbbbbb.png', { method: 'DELETE' })
    expect(notMine.status).toBe(404)

    const badShape = await call(A, '/api/attachments/xyz.png', { method: 'DELETE' })
    expect(badShape.status).toBe(404)

    expect(bucket.deleteCalls.length).toBe(0)
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(0)
  })

  it('X3 일반 문서 본문이 참조 — 409 in_use, 행·R2 그대로', async () => {
    const { sqlDb, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, 'dddddddddddddddd', 'png')
    insertDoc(sqlDb, uuid(1), owner, { content: 'attachments/dddddddddddddddd.png' })
    const before = writeCount(sqlDb, EMAIL_A)

    const res = await call(A, '/api/attachments/dddddddddddddddd.png', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'in_use' })
    expect(attachmentRow(sqlDb, owner, 'dddddddddddddddd')).toBeDefined()
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(0)
  })

  it('X4 금고 문서 참조 — 내 것은 409, 남의 것만은 204', async () => {
    const { sqlDb, A, B } = makeWorld()
    const ownerA = await ensureUser(A, sqlDb, EMAIL_A)
    const ownerB = await ensureUser(B, sqlDb, EMAIL_B)

    insertAttachment(sqlDb, ownerA, 'eeeeeeeeeeeeeeef', 'png', { e2ee: 1 })
    insertDoc(sqlDb, uuid(2), ownerA, { e2ee_key: 'K', attachment_refs: '["eeeeeeeeeeeeeeef"]' })
    const mine = await call(A, '/api/attachments/eeeeeeeeeeeeeeef.png', { method: 'DELETE' })
    expect(mine.status).toBe(409)
    expect(await mine.json()).toEqual({ error: 'in_use' })

    insertAttachment(sqlDb, ownerA, 'eeeeeeeeeeeeeeeb', 'png', { e2ee: 1 })
    insertDoc(sqlDb, uuid(3), ownerB, { e2ee_key: 'K', attachment_refs: '["eeeeeeeeeeeeeeeb"]' })
    const others = await call(A, '/api/attachments/eeeeeeeeeeeeeeeb.png', { method: 'DELETE' })
    expect(others.status).toBe(204)
  })

  it('X5 C 가 폴더 편집 초대 — C 의 문서(폴더 밖)가 참조하면 409, view 초대면 204', async () => {
    const { sqlDb, A, C } = makeWorld()
    const ownerA = await ensureUser(A, sqlDb, EMAIL_A)
    const ownerC = await ensureUser(C, sqlDb, EMAIL_C)

    insertFolder(sqlDb, uuid(10), ownerC)
    insertGrant(sqlDb, 'folder', uuid(10), ownerC, EMAIL_A, 'edit')
    insertAttachment(sqlDb, ownerA, 'ffffffffffffffff', 'png')
    insertDoc(sqlDb, uuid(11), ownerC, { content: 'attachments/ffffffffffffffff.png', folder_id: null })

    const edit = await call(A, '/api/attachments/ffffffffffffffff.png', { method: 'DELETE' })
    expect(edit.status).toBe(409)
    expect(await edit.json()).toEqual({ error: 'in_use' })

    // 초대를 view 로 내리면 204
    sqlDb.prepare("UPDATE grants SET role = 'view' WHERE target_type = 'folder' AND target_id = ? AND grantee_email = ?").run(uuid(10), EMAIL_A)
    const view = await call(A, '/api/attachments/ffffffffffffffff.png', { method: 'DELETE' })
    expect(view.status).toBe(204)
  })

  it('X6 초대 관계 없는 D 의 문서만 참조 — 204', async () => {
    const { sqlDb, A, D } = makeWorld()
    const ownerA = await ensureUser(A, sqlDb, EMAIL_A)
    const ownerD = await ensureUser(D, sqlDb, EMAIL_D)
    insertAttachment(sqlDb, ownerA, '1111111111111111', 'png')
    insertDoc(sqlDb, uuid(12), ownerD, { content: 'attachments/1111111111111111.png' })

    const res = await call(A, '/api/attachments/1111111111111111.png', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('X7 instr 은 걸리지만 extractAttachmentRefs 는 안 잡는 모양 — 204', async () => {
    const { sqlDb, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    const content = 'attachments/2222222222222222.bmp'
    expect(extractAttachmentRefs(content).has('2222222222222222')).toBe(false)

    insertAttachment(sqlDb, owner, '2222222222222222', 'png')
    insertDoc(sqlDb, uuid(13), owner, { content })

    const res = await call(A, '/api/attachments/2222222222222222.png', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('X8 R2 delete 실패 → 500, D1 그대로. 되돌리면 204', async () => {
    const { sqlDb, A, bucket } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, '3333333333333333', 'png')
    const before = writeCount(sqlDb, EMAIL_A)
    bucket.setFailDelete(true)

    const failed = await call(A, '/api/attachments/3333333333333333.png', { method: 'DELETE' })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'internal' })
    expect(attachmentRow(sqlDb, owner, '3333333333333333')).toBeDefined()
    expect(writeCount(sqlDb, EMAIL_A) - before).toBe(0)

    bucket.setFailDelete(false)
    const retried = await call(A, '/api/attachments/3333333333333333.png', { method: 'DELETE' })
    expect(retried.status).toBe(204)
  })

  it('X9 참조 없는 금고 첨부 — 204(평문과 같은 규칙)', async () => {
    const { sqlDb, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, '4444444444444444', 'png', { e2ee: 1 })

    const res = await call(A, '/api/attachments/4444444444444444.png', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })
})

describe('F-402 G3 관문 — 막힌 계정', () => {
  it('DELETE 403 account_blocked, 행 그대로', async () => {
    const { sqlDb, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, '5555555555555555', 'png')
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(Date.now(), owner)

    const res = await call(A, '/api/attachments/5555555555555555.png', { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'account_blocked' })
    expect(attachmentRow(sqlDb, owner, '5555555555555555')).toBeDefined()
  })
})

// 7.4 정리 Cron (실제 SQL)
describe('F-402 C1~C5 cleanupServerAttachments', () => {
  const NOW = Date.parse('2026-09-25T00:00:00Z')
  const HOUR = 60 * 60 * 1000
  const OLD = NOW - 25 * HOUR

  function hexId(n: number): string {
    return n.toString(16).padStart(16, '0')
  }

  it('C1 금고 문서가 참조하는 첨부는 남고, 참조 없는 첨부는 지워진다', async () => {
    const { sqlDb, bucket, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, hexId(1), 'png', { e2ee: 1, created_at: OLD })
    insertAttachment(sqlDb, owner, hexId(2), 'png', { e2ee: 1, created_at: OLD })
    insertDoc(sqlDb, uuid(20), owner, { e2ee_key: 'K', attachment_refs: JSON.stringify([hexId(1)]) })

    const env = { DB: asD1(sqlDb), BUCKET: bucket } as unknown as Env
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(attachmentRow(sqlDb, owner, hexId(1))).toBeDefined()
    expect(attachmentRow(sqlDb, owner, hexId(2))).toBeUndefined()
  })

  it('C2 금고 문서 본문(봉투 base64)은 참조를 흉내 낼 수 없다', async () => {
    const { sqlDb, bucket, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertDoc(sqlDb, uuid(21), owner, { e2ee_key: 'K', attachment_refs: '[]', content: 'QUJD' })
    insertAttachment(sqlDb, owner, hexId(3), 'png', { e2ee: 0, created_at: OLD })

    const env = { DB: asD1(sqlDb), BUCKET: bucket } as unknown as Env
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(attachmentRow(sqlDb, owner, hexId(3))).toBeUndefined()
  })

  it('C3 풀지 못하는 attachment_refs 는 그 소유자를 보호한다', async () => {
    const { sqlDb, bucket, A, B } = makeWorld()
    const ownerA = await ensureUser(A, sqlDb, EMAIL_A)
    const ownerB = await ensureUser(B, sqlDb, EMAIL_B)
    const brokenDocId = uuid(22)
    insertDoc(sqlDb, brokenDocId, ownerA, { e2ee_key: 'K', attachment_refs: '[]' })
    sqlDb.prepare('UPDATE docs SET attachment_refs = ? WHERE id = ?').run('not json', brokenDocId)
    insertAttachment(sqlDb, ownerA, hexId(4), 'png', { e2ee: 1, created_at: OLD })
    insertAttachment(sqlDb, ownerA, hexId(5), 'png', { e2ee: 1, created_at: OLD })
    insertAttachment(sqlDb, ownerB, hexId(6), 'png', { e2ee: 1, created_at: OLD })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = { DB: asD1(sqlDb), BUCKET: bucket } as unknown as Env
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(attachmentRow(sqlDb, ownerA, hexId(4))).toBeDefined()
    expect(attachmentRow(sqlDb, ownerA, hexId(5))).toBeDefined()
    expect(attachmentRow(sqlDb, ownerB, hexId(6))).toBeUndefined()
    expect(errorSpy.mock.calls.some((c) => c[0] === 'e2ee_refs_unreadable')).toBe(true)
  })

  it('C4 금고 문서·첨부 250개 — 쪽을 넘겨 끝까지 읽어 모두 남긴다', async () => {
    const { sqlDb, bucket, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    for (let i = 0; i < 250; i++) {
      const id = hexId(1000 + i)
      insertAttachment(sqlDb, owner, id, 'png', { e2ee: 1, created_at: OLD })
      insertDoc(sqlDb, uuid(2000 + i), owner, { e2ee_key: 'K', attachment_refs: JSON.stringify([id]) })
    }
    for (let i = 0; i < 250; i++) {
      insertDoc(sqlDb, uuid(3000 + i), owner, { content: '내용 없음' })
    }

    const env = { DB: asD1(sqlDb), BUCKET: bucket } as unknown as Env
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 0 })
    for (let i = 0; i < 250; i++) {
      expect(attachmentRow(sqlDb, owner, hexId(1000 + i))).toBeDefined()
    }
  })

  it('C5 16진 16자가 아닌 원소는 그 원소만 무시 — 보호되지 않는다', async () => {
    const { sqlDb, bucket, A } = makeWorld()
    const owner = await ensureUser(A, sqlDb, EMAIL_A)
    insertAttachment(sqlDb, owner, hexId(7), 'png', { e2ee: 1, created_at: OLD })
    insertAttachment(sqlDb, owner, hexId(8), 'png', { e2ee: 1, created_at: OLD })
    insertDoc(sqlDb, uuid(23), owner, { e2ee_key: 'K', attachment_refs: JSON.stringify([hexId(7), 'XYZ']) })

    const env = { DB: asD1(sqlDb), BUCKET: bucket } as unknown as Env
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(attachmentRow(sqlDb, owner, hexId(7))).toBeDefined()
    expect(attachmentRow(sqlDb, owner, hexId(8))).toBeUndefined()
  })
})
