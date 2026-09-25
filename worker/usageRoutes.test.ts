// worker/index.ts 를 통째로 — 쓰기 라우트마다 사용량 줄이 정확히 도는지 (specs/features/F-2025.md 8.1 R1~R4)
import { beforeAll, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { asD1, openTestDb } from './testD1'
import type { DatabaseSync } from 'node:sqlite'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
})

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function makeEnv() {
  const sqlDb = openTestDb()
  const putCalls: string[] = []
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put(key: string) { putCalls.push(key) } },
  } as unknown as Env
  return { sqlDb, env, putCalls }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function jsonInit(method: string, body?: unknown, headers: Record<string, string> = {}): RequestInit {
  const init: RequestInit = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return init
}

function bearerInit(method: string, token: string, body?: BodyInit, headers: Record<string, string> = {}): RequestInit {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...headers } }
  if (body !== undefined) init.body = body
  return init
}

function userId(sqlDb: DatabaseSync): string {
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }).id
}

function writeCount(sqlDb: DatabaseSync): number {
  const row = sqlDb.prepare('SELECT write_count FROM users WHERE email = ?').get(EMAIL) as { write_count: number } | undefined
  return row?.write_count ?? 0
}

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: Partial<{ folder_id: string | null }> = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .run(id, ownerId, 't', 'c', 'lf', over.folder_id ?? null, 1, 1, 1)
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,NULL,?,?)')
    .run(id, ownerId, 'f', 1, 1)
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

function pngBytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes.set([0, 0, 0, 2], 16)
  bytes.set([0, 0, 0, 2], 20)
  return bytes
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('F-2025 R1 쓰기 라우트마다 write_count +1', () => {
  it('/api 21개 + 폴더 delete-all 변형 + /v1 5개 + 금고 3개 (F-401 G2)', async () => {
    const { sqlDb, env } = makeEnv()

    async function expectPlusOne(label: string, run: () => Promise<Response>, okStatuses: number[]) {
      const before = writeCount(sqlDb)
      const res = await run()
      expect(okStatuses, `${label} status`).toContain(res.status)
      const after = writeCount(sqlDb)
      expect(after - before, `${label} write_count delta`).toBe(1)
    }

    // 문서 5
    await expectPlusOne('POST /api/docs', () => call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' })), [201])
    const owner = userId(sqlDb)

    insertDoc(sqlDb, uuid(1), owner)
    await expectPlusOne(
      'PUT /api/docs/:id',
      () => call(env, `/api/docs/${uuid(1)}`, jsonInit('PUT', { content: 'new', baseVersion: 1 })),
      [200],
    )

    insertDoc(sqlDb, uuid(2), owner)
    await expectPlusOne('DELETE /api/docs/:id', () => call(env, `/api/docs/${uuid(2)}`, { method: 'DELETE' }), [204])

    insertDoc(sqlDb, uuid(3), owner)
    await expectPlusOne(
      'PUT /api/docs/:id/folder',
      () => call(env, `/api/docs/${uuid(3)}/folder`, jsonInit('PUT', { folderId: null })),
      [200],
    )

    insertDoc(sqlDb, uuid(4), owner)
    await expectPlusOne('PUT /api/docs/:id/pin', () => call(env, `/api/docs/${uuid(4)}/pin`, jsonInit('PUT', { pinned: true })), [200])

    // 잠금 2
    insertDoc(sqlDb, uuid(5), owner)
    await expectPlusOne(
      'POST /api/docs/:id/lock',
      () => call(env, `/api/docs/${uuid(5)}/lock`, jsonInit('POST', { sessionId: 's1' })),
      [200],
    )

    insertDoc(sqlDb, uuid(6), owner)
    await expectPlusOne(
      'DELETE /api/docs/:id/lock?session=',
      () => call(env, `/api/docs/${uuid(6)}/lock?session=s1`, { method: 'DELETE' }),
      [204],
    )

    // 링크 4
    insertDoc(sqlDb, uuid(7), owner)
    await expectPlusOne('POST /api/docs/:id/link', () => call(env, `/api/docs/${uuid(7)}/link`, { method: 'POST' }), [201])

    insertDoc(sqlDb, uuid(8), owner)
    insertLink(sqlDb, 'tok-doc-del', owner, 'doc', uuid(8))
    await expectPlusOne('DELETE /api/docs/:id/link', () => call(env, `/api/docs/${uuid(8)}/link`, { method: 'DELETE' }), [204])

    insertFolder(sqlDb, uuid(9), owner)
    await expectPlusOne('POST /api/folders/:id/link', () => call(env, `/api/folders/${uuid(9)}/link`, { method: 'POST' }), [201])

    insertFolder(sqlDb, uuid(10), owner)
    insertLink(sqlDb, 'tok-folder-del', owner, 'folder', uuid(10))
    await expectPlusOne('DELETE /api/folders/:id/link', () => call(env, `/api/folders/${uuid(10)}/link`, { method: 'DELETE' }), [204])

    // 폴더 3 (+delete-all 변형)
    await expectPlusOne('POST /api/folders', () => call(env, '/api/folders', jsonInit('POST', { name: 'f' })), [201])

    insertFolder(sqlDb, uuid(11), owner)
    await expectPlusOne('PUT /api/folders/:id', () => call(env, `/api/folders/${uuid(11)}`, jsonInit('PUT', { name: 'new' })), [200])

    insertFolder(sqlDb, uuid(12), owner)
    await expectPlusOne('DELETE /api/folders/:id (move-up)', () => call(env, `/api/folders/${uuid(12)}?contents=move-up`, { method: 'DELETE' }), [204])

    insertFolder(sqlDb, uuid(13), owner)
    await expectPlusOne('DELETE /api/folders/:id (delete-all)', () => call(env, `/api/folders/${uuid(13)}?contents=delete-all`, { method: 'DELETE' }), [204])

    // 초대 4
    insertDoc(sqlDb, uuid(14), owner)
    await expectPlusOne(
      'PUT /api/docs/:id/grants/:email',
      () => call(env, `/api/docs/${uuid(14)}/grants/friend@example.com`, jsonInit('PUT', { role: 'view' })),
      [200],
    )

    insertDoc(sqlDb, uuid(15), owner)
    insertGrant(sqlDb, 'doc', uuid(15), owner, 'friend@example.com', 'view')
    await expectPlusOne(
      'DELETE /api/docs/:id/grants/:email',
      () => call(env, `/api/docs/${uuid(15)}/grants/friend@example.com`, { method: 'DELETE' }),
      [204],
    )

    insertFolder(sqlDb, uuid(16), owner)
    await expectPlusOne(
      'PUT /api/folders/:id/grants/:email',
      () => call(env, `/api/folders/${uuid(16)}/grants/friend@example.com`, jsonInit('PUT', { role: 'view' })),
      [200],
    )

    insertFolder(sqlDb, uuid(17), owner)
    insertGrant(sqlDb, 'folder', uuid(17), owner, 'friend@example.com', 'view')
    await expectPlusOne(
      'DELETE /api/folders/:id/grants/:email',
      () => call(env, `/api/folders/${uuid(17)}/grants/friend@example.com`, { method: 'DELETE' }),
      [204],
    )

    // 토큰 2
    let createdTokenId = ''
    let plainToken = ''
    await expectPlusOne('POST /api/tokens', async () => {
      const res = await call(env, '/api/tokens', jsonInit('POST', { name: '토큰1' }))
      const body = (await res.clone().json()) as { id: string; token: string }
      createdTokenId = body.id
      plainToken = body.token
      return res
    }, [201])

    let deleteTokenId = ''
    const beforeSecondToken = writeCount(sqlDb)
    const secondTokenRes = await call(env, '/api/tokens', jsonInit('POST', { name: '토큰2' }))
    expect(writeCount(sqlDb) - beforeSecondToken).toBe(1)
    deleteTokenId = ((await secondTokenRes.json()) as { id: string }).id
    await expectPlusOne('DELETE /api/tokens/:id', () => call(env, `/api/tokens/${deleteTokenId}`, { method: 'DELETE' }), [204])

    // 첨부 1
    await expectPlusOne(
      'PUT /api/attachments/:idext',
      () => call(env, '/api/attachments/aaaaaaaaaaaaaaaa.png', { method: 'PUT', headers: { 'Content-Length': String(pngBytes().length) }, body: pngBytes() }),
      [201],
    )

    // /v1 5개 — 방금 만든 토큰을 쓴다
    await expectPlusOne(
      'POST /v1/docs',
      () => call(env, '/v1/docs', bearerInit('POST', plainToken, JSON.stringify({ title: 't', content: 'c' }), { 'Content-Type': 'application/json' })),
      [201],
    )

    insertDoc(sqlDb, uuid(18), owner)
    await expectPlusOne(
      'PUT /v1/docs/:id',
      () =>
        call(
          env,
          `/v1/docs/${uuid(18)}`,
          bearerInit('PUT', plainToken, JSON.stringify({ content: 'new', baseVersion: 1 }), { 'Content-Type': 'application/json' }),
        ),
      [200],
    )

    await expectPlusOne(
      'POST /v1/folders',
      () => call(env, '/v1/folders', bearerInit('POST', plainToken, JSON.stringify({ name: 'vf' }), { 'Content-Type': 'application/json' })),
      [201],
    )

    await expectPlusOne(
      'POST /v1/attachments',
      () =>
        call(env, '/v1/attachments', bearerInit('POST', plainToken, pngBytes(), { 'Content-Length': String(pngBytes().length) })),
      [201],
    )

    insertDoc(sqlDb, uuid(19), owner)
    await expectPlusOne('POST /v1/docs/:id/link', () => call(env, `/v1/docs/${uuid(19)}/link`, bearerInit('POST', plainToken)), [201])

    // 금고 3 (F-401 G2) — 묶음 만들기, 금고로 옮기기, 빈 금고의 묶음 지우기
    await expectPlusOne('PUT /api/e2ee/keys', () => call(env, '/api/e2ee/keys', jsonInit('PUT', { bundle: 'B1', baseRev: 0 })), [200])

    insertDoc(sqlDb, uuid(20), owner)
    await expectPlusOne(
      'PUT /api/docs/:id/e2ee',
      () =>
        call(
          env,
          `/api/docs/${uuid(20)}/e2ee`,
          jsonInit('PUT', { e2eeKey: 'A'.repeat(55) + '=', title: 'dA==', content: 'Yw==', attachmentRefs: [], baseVersion: 1 }),
        ),
      [200],
    )
    sqlDb.prepare('DELETE FROM docs WHERE id = ?').run(uuid(20))
    await expectPlusOne('DELETE /api/e2ee/keys', () => call(env, '/api/e2ee/keys', { method: 'DELETE' }), [204])

    void createdTokenId
  })
})

describe('F-2025 R2 GET 라우트는 write_count 그대로', () => {
  it('목록·문서·폴더·링크·초대·공유·토큰·사용량·/v1', async () => {
    const { sqlDb, env } = makeEnv()
    // 사용자 행을 만든다
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    insertDoc(sqlDb, uuid(30), owner)
    insertFolder(sqlDb, uuid(31), owner)
    insertLink(sqlDb, 'tok-get-doc', owner, 'doc', uuid(30))
    insertLink(sqlDb, 'tok-get-folder', owner, 'folder', uuid(31))
    insertGrant(sqlDb, 'doc', uuid(30), owner, 'friend@example.com', 'view')
    insertGrant(sqlDb, 'folder', uuid(31), owner, 'friend@example.com', 'view')
    const tokenRes = await call(env, '/api/tokens', jsonInit('POST', { name: 't' }))
    const { token } = (await tokenRes.json()) as { token: string }

    const gets: [string, RequestInit?][] = [
      ['/api/docs', undefined],
      [`/api/docs/${uuid(30)}`, undefined],
      ['/api/folders', undefined],
      [`/api/docs/${uuid(30)}/link`, undefined],
      [`/api/folders/${uuid(31)}/link`, undefined],
      [`/api/docs/${uuid(30)}/grants`, undefined],
      [`/api/folders/${uuid(31)}/grants`, undefined],
      ['/api/shared', undefined],
      ['/api/shares', undefined],
      ['/api/tokens', undefined],
      ['/api/usage', undefined],
      ['/v1/docs', bearerInit('GET', token)],
      [`/v1/docs/${uuid(30)}`, bearerInit('GET', token)],
      ['/v1/folders', bearerInit('GET', token)],
      ['/v1/me', bearerInit('GET', token)],
    ]

    for (const [path, init] of gets) {
      const before = writeCount(sqlDb)
      const res = await call(env, path, init)
      expect(res.status, `${path} status`).toBeLessThan(500)
      const after = writeCount(sqlDb)
      expect(after, `${path} write_count 그대로`).toBe(before)
    }
  })
})

describe('F-2025 R3 D1 에 쓰지 않고 끝나는 쓰기 요청', () => {
  it('write_count 그대로', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    const owner = userId(sqlDb)
    insertDoc(sqlDb, uuid(40), owner)

    async function expectNoChange(label: string, run: () => Promise<Response>) {
      const before = writeCount(sqlDb)
      await run()
      const after = writeCount(sqlDb)
      expect(after, `${label} write_count 그대로`).toBe(before)
    }

    // 400 몸통 (content 없음)
    await expectNoChange('POST /api/docs 400', () => call(env, '/api/docs', jsonInit('POST', { title: 't', lineEnding: 'lf' })))
    // 남의 문서 404
    await expectNoChange('PUT 남의 문서 404', () =>
      call(env, `/api/docs/${uuid(999)}`, jsonInit('PUT', { content: 'x', baseVersion: 1 })),
    )
    // 살아 있는 링크 다시 받기(묶음 없음)
    insertDoc(sqlDb, uuid(41), owner)
    await call(env, `/api/docs/${uuid(41)}/link`, { method: 'POST' })
    await expectNoChange('POST 링크 다시 받기', () => call(env, `/api/docs/${uuid(41)}/link`, { method: 'POST' }))
    // session 없는 잠금 놓기
    insertDoc(sqlDb, uuid(42), owner)
    await expectNoChange('DELETE 잠금 session 없음', () => call(env, `/api/docs/${uuid(42)}/lock`, { method: 'DELETE' }))
    // 같은 id 다시 만들기
    const dup = uuid(43)
    await call(env, '/api/docs', jsonInit('POST', { id: dup, title: 't', content: 'c', lineEnding: 'lf' }))
    await expectNoChange('POST 같은 id 다시 만들기', () =>
      call(env, '/api/docs', jsonInit('POST', { id: dup, title: 't', content: 'c', lineEnding: 'lf' })),
    )
  })
})

describe('F-2025 R4 GET /api/usage', () => {
  it('docs·writes 필드, today 가 요청 수와 같다', async () => {
    const { sqlDb, env } = makeEnv()
    await call(env, '/api/docs', jsonInit('POST', { title: 't', content: 'c', lineEnding: 'lf' }))
    await call(env, '/api/folders', jsonInit('POST', { name: 'f' }))
    const before = writeCount(sqlDb)

    const res = await call(env, '/api/usage')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      used: number
      limit: number
      docs: { bytes: number; bytesLimit: number; count: number; countLimit: number }
      writes: { today: number; limit: number }
    }
    expect(body.docs.bytesLimit).toBe(104_857_600)
    expect(body.docs.countLimit).toBe(10_000)
    expect(body.writes.limit).toBe(5_000)
    expect(body.writes.today).toBe(before)
  })
})
