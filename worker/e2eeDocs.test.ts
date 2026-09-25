// 금고 문서 만들기·쓰기·옮기기·폴더 규칙 — worker/index.ts 를 통째로 (specs/features/F-401.md 3.2~3.6·5장, 10.2~10.4)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from './testD1'
import { DOC_BYTES_QUOTA } from './usage'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
let worker: Worker
let setDocE2eeStatements: typeof import('./e2eeDocs').setDocE2eeStatements

beforeAll(async () => {
  vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('./index')).default as unknown as Worker
  setDocE2eeStatements = (await import('./e2eeDocs')).setDocE2eeStatements
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const OWNER = 'owner@example.com'
const FRIEND = 'friend@example.com'
const KEY = 'A'.repeat(55) + '='
const KEY2 = 'B'.repeat(55) + '='
const TITLE = 'dGl0bGU='
const BODY = 'Ym9keQ=='
const REF = '0123456789abcdef'
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeWorld(opts: { docRoom?: boolean } = {}) {
  const sqlDb = openTestDb()
  const purges: string[] = []
  const purge = { impl: async () => {}, done: 0 }
  const DOC_ROOM = {
    getByName: (id: string) => ({
      async purgeRoom() {
        purges.push(id)
        await purge.impl()
        purge.done++
      },
      async revalidateConnections() {},
    }),
  }
  const base = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    WRITE_LIMITER: { limit: async () => ({ success: true }) },
    ...(opts.docRoom === false ? {} : { DOC_ROOM }),
  }
  const owner = { ...base, DEV_AUTH_EMAIL: OWNER } as unknown as Env
  const friend = { ...base, DEV_AUTH_EMAIL: FRIEND } as unknown as Env
  return { sqlDb, owner, friend, purges, purge }
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function json(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method }
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function userId(env: Env, sqlDb: DatabaseSync, email = OWNER): Promise<string> {
  await call(env, '/api/me')
  return (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
}

async function withKeys(env: Env) {
  const res = await call(env, '/api/e2ee/keys', json('PUT', { bundle: 'B1', baseRev: 0 }))
  expect(res.status).toBe(200)
}

type Usage = { write_count: number; content_bytes: number; doc_count: number }
function usage(sqlDb: DatabaseSync, email = OWNER): Usage {
  return sqlDb.prepare('SELECT write_count, content_bytes, doc_count FROM users WHERE email = ?').get(email) as Usage
}

type DocOver = { folder_id?: string | null; e2ee_key?: string | null; attachment_refs?: string | null; content?: string; title?: string; version?: number }
function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOver = {}) {
  const e2ee = over.e2ee_key !== undefined && over.e2ee_key !== null
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      ownerId,
      over.title ?? (e2ee ? TITLE : 't'),
      over.content ?? (e2ee ? BODY : 'c'),
      'lf',
      over.folder_id ?? null,
      over.version ?? 1,
      1,
      1,
      over.e2ee_key ?? null,
      over.attachment_refs !== undefined ? over.attachment_refs : e2ee ? '[]' : null,
    )
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, over: { parent_id?: string | null; e2ee?: 0 | 1 } = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, `f-${id.slice(-2)}`, over.parent_id ?? null, 1, 1, over.e2ee ?? 0)
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

type DocDbRow = { title: string; content: string; version: number; e2ee_key: string | null; attachment_refs: string | null; folder_id: string | null }
function docRow(sqlDb: DatabaseSync, id: string): DocDbRow | undefined {
  return sqlDb.prepare('SELECT title, content, version, e2ee_key, attachment_refs, folder_id FROM docs WHERE id = ?').get(id) as DocDbRow | undefined
}

function linkRevoked(sqlDb: DatabaseSync, token: string): number | null {
  return (sqlDb.prepare('SELECT revoked_at FROM share_links WHERE token = ?').get(token) as { revoked_at: number | null }).revoked_at
}

function count(sqlDb: DatabaseSync, sql: string, ...args: string[]): number {
  return (sqlDb.prepare(sql).get(...args) as { n: number }).n
}

describe('F-401 D1~D4 POST /api/docs 금고', () => {
  it('D1 금고 문서 만들기 — 응답·행·누계', async () => {
    const { sqlDb, owner } = makeWorld()
    await withKeys(owner)
    const before = usage(sqlDb)
    const res = await call(owner, '/api/docs', json('POST', { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf', attachmentRefs: [REF] }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; e2eeKey: string; attachmentRefs: string[]; title: string }
    expect(body.e2eeKey).toBe(KEY)
    expect(body.attachmentRefs).toEqual([REF])
    expect(body.title).toBe(TITLE)
    const row = docRow(sqlDb, body.id)!
    expect(row.e2ee_key).toBe(KEY)
    expect(row.attachment_refs).toBe(`["${REF}"]`)
    const after = usage(sqlDb)
    expect(after.content_bytes - before.content_bytes).toBe(BODY.length)
    expect(after.doc_count - before.doc_count).toBe(1)
  })

  it('D1 attachmentRefs 없으면 [] 로 저장', async () => {
    const { sqlDb, owner } = makeWorld()
    await withKeys(owner)
    const res = await call(owner, '/api/docs', json('POST', { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; attachmentRefs: string[] }
    expect(body.attachmentRefs).toEqual([])
    expect(docRow(sqlDb, body.id)!.attachment_refs).toBe('[]')
  })

  it('D2 묶음이 없으면 409 no_vault, 행 없음, write_count 그대로', async () => {
    const { sqlDb, owner } = makeWorld()
    await userId(owner, sqlDb)
    const before = usage(sqlDb).write_count
    const res = await call(owner, '/api/docs', json('POST', { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf', attachmentRefs: [REF] }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_vault' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM docs')).toBe(0)
    expect(usage(sqlDb).write_count).toBe(before)
  })

  it('D3 금고 만들기의 400 들, 제목 2,040자는 201', async () => {
    const { owner } = makeWorld()
    await withKeys(owner)
    const base = { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf' }
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, content: '# 제목\n본문' }, 'content'],
      [{ ...base, title: 'A'.repeat(2_041) }, 'title'],
      [{ ...base, title: 'A'.repeat(2_044) }, 'title'],
      [{ ...base, e2eeKey: 'abc' }, 'e2eeKey'],
      [{ ...base, attachmentRefs: ['XYZ'] }, 'attachmentRefs'],
      [{ ...base, attachmentRefs: Array(1_001).fill(REF) }, 'attachmentRefs'],
      [{ title: 't', content: 'c', lineEnding: 'lf', attachmentRefs: [REF] }, 'attachmentRefs'],
    ]
    for (const [body, field] of cases) {
      const res = await call(owner, '/api/docs', json('POST', body))
      expect(res.status, field).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field })
    }
    const ok = await call(owner, '/api/docs', json('POST', { ...base, title: 'A'.repeat(2_040) }))
    expect(ok.status).toBe(201)
  })

  it('D4 금고 폴더에는 금고 문서만, 일반 폴더에는 금고 문서도', async () => {
    const { sqlDb, owner } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(1), id, { e2ee: 1 })
    insertFolder(sqlDb, uuid(2), id)
    const plain = await call(owner, '/api/docs', json('POST', { title: 't', content: 'c', lineEnding: 'lf', folderId: uuid(1) }))
    expect(plain.status).toBe(409)
    expect(await plain.json()).toEqual({ error: 'e2ee_folder' })
    const sealed = await call(owner, '/api/docs', json('POST', { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf', folderId: uuid(1) }))
    expect(sealed.status).toBe(201)
    const inPlain = await call(owner, '/api/docs', json('POST', { e2eeKey: KEY, title: TITLE, content: BODY, lineEnding: 'lf', folderId: uuid(2) }))
    expect(inPlain.status).toBe(201)
  })
})

describe('F-401 D5~D9 PUT /api/docs/:id 금고 표지', () => {
  it('D5 금고 문서에 표지 없이 쓰면 409 e2ee_doc, 행·write_count 그대로', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(10), id, { e2ee_key: KEY })
    const before = usage(sqlDb).write_count
    const res = await call(owner, `/api/docs/${uuid(10)}`, json('PUT', { content: 'QUJD', baseVersion: 1 }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'e2ee_doc' })
    expect(docRow(sqlDb, uuid(10))).toMatchObject({ content: BODY, version: 1 })
    expect(usage(sqlDb).write_count).toBe(before)
  })

  it('D6 일반 문서에 표지를 달면 409 not_e2ee', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(11), id)
    const res = await call(owner, `/api/docs/${uuid(11)}`, json('PUT', { e2ee: true, content: 'QQ==', baseVersion: 1 }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'not_e2ee' })
    expect(docRow(sqlDb, uuid(11))!.content).toBe('c')
  })

  it('D7 표지 달린 쓰기는 잠금을 보지 않고 200, attachmentRefs 는 받았을 때만', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(12), id, { e2ee_key: KEY, attachment_refs: `["${REF}"]` })
    sqlDb
      .prepare('INSERT INTO doc_locks (doc_id, user_id, email, session_id, expires_at) VALUES (?,?,?,?,?)')
      .run(uuid(12), id, OWNER, 'other-session', Date.now() + 60_000)
    const res = await call(owner, `/api/docs/${uuid(12)}`, json('PUT', { e2ee: true, content: 'QUJD', baseVersion: 1 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version: number; content: string; e2eeKey: string; attachmentRefs: string[] }
    expect(body).toMatchObject({ version: 2, content: 'QUJD', e2eeKey: KEY, attachmentRefs: [REF] })
    expect(docRow(sqlDb, uuid(12))).toMatchObject({ version: 2, content: 'QUJD', attachment_refs: `["${REF}"]` })

    const second = await call(owner, `/api/docs/${uuid(12)}`, json('PUT', { e2ee: true, title: 'QUJD', attachmentRefs: [], baseVersion: 2 }))
    expect(second.status).toBe(200)
    expect(docRow(sqlDb, uuid(12))).toMatchObject({ version: 3, title: 'QUJD', attachment_refs: '[]' })
  })

  it('D7 표지 쓰기의 400 들', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(13), id, { e2ee_key: KEY })
    const cases: [Record<string, unknown>, string][] = [
      [{ e2ee: 'yes', content: 'QQ==', baseVersion: 1 }, 'e2ee'],
      [{ e2ee: true, content: '평문', baseVersion: 1 }, 'content'],
      [{ e2ee: true, title: 'A'.repeat(2_044), baseVersion: 1 }, 'title'],
      [{ e2ee: true, attachmentRefs: ['nope'], baseVersion: 1 }, 'attachmentRefs'],
      [{ content: 'c', attachmentRefs: [], baseVersion: 1 }, 'attachmentRefs'],
    ]
    for (const [body, field] of cases) {
      const res = await call(owner, `/api/docs/${uuid(13)}`, json('PUT', body))
      expect(res.status, field).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field })
    }
  })

  it('D8 낡은 baseVersion 은 409 conflict, doc 에 두 필드', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(14), id, { e2ee_key: KEY, attachment_refs: `["${REF}"]`, version: 3 })
    const res = await call(owner, `/api/docs/${uuid(14)}`, json('PUT', { e2ee: true, content: 'QUJD', baseVersion: 2 }))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; doc: { e2eeKey: string; attachmentRefs: string[]; version: number } }
    expect(body.error).toBe('conflict')
    expect(body.doc).toMatchObject({ e2eeKey: KEY, attachmentRefs: [REF], version: 3 })
  })

  it('D9 한도 − 10 에서 20자 늘리면 413 doc_quota_exceeded bytes', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(15), id, { e2ee_key: KEY, content: 'QUJD' })
    sqlDb.prepare('UPDATE users SET content_bytes = ? WHERE id = ?').run(DOC_BYTES_QUOTA - 10, id)
    const res = await call(owner, `/api/docs/${uuid(15)}`, json('PUT', { e2ee: true, content: 'QUJD' + 'A'.repeat(20), baseVersion: 1 }))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'doc_quota_exceeded', resource: 'bytes' })
  })
})

describe('F-401 D10·D11 목록·폴더 옮기기', () => {
  it('D10 GET /api/docs — 금고 원소에만 두 필드, 제목은 봉투 그대로', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(20), id)
    insertDoc(sqlDb, uuid(21), id, { e2ee_key: KEY, attachment_refs: `["${REF}"]` })
    const res = await call(owner, '/api/docs')
    const list = (await res.json()) as Record<string, unknown>[]
    const plain = list.find((d) => d.id === uuid(20))!
    const sealed = list.find((d) => d.id === uuid(21))!
    expect('e2eeKey' in plain).toBe(false)
    expect('attachmentRefs' in plain).toBe(false)
    expect(sealed.e2eeKey).toBe(KEY)
    expect(sealed.attachmentRefs).toEqual([REF])
    expect(sealed.title).toBe(TITLE)
    expect('content' in sealed).toBe(false)
  })

  it('D11 일반 문서 → 금고 폴더 409, 금고 문서 → 일반 폴더 200', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(22), id, { e2ee: 1 })
    insertFolder(sqlDb, uuid(23), id)
    insertDoc(sqlDb, uuid(24), id)
    insertDoc(sqlDb, uuid(25), id, { e2ee_key: KEY })
    const before = usage(sqlDb).write_count
    const bad = await call(owner, `/api/docs/${uuid(24)}/folder`, json('PUT', { folderId: uuid(22) }))
    expect(bad.status).toBe(409)
    expect(await bad.json()).toEqual({ error: 'e2ee_folder' })
    expect(usage(sqlDb).write_count).toBe(before)
    const ok = await call(owner, `/api/docs/${uuid(25)}/folder`, json('PUT', { folderId: uuid(23) }))
    expect(ok.status).toBe(200)
    expect(docRow(sqlDb, uuid(25))!.folder_id).toBe(uuid(23))
    const intoE2ee = await call(owner, `/api/docs/${uuid(25)}/folder`, json('PUT', { folderId: uuid(22) }))
    expect(intoE2ee.status).toBe(200)
  })
})

function moveBody(over: Record<string, unknown> = {}) {
  return { e2eeKey: KEY2, title: TITLE, content: 'QUJDREVG', attachmentRefs: [REF], baseVersion: 1, ...over }
}

describe('F-401 C1~C8 PUT /api/docs/:id/e2ee', () => {
  it('C1 옮기기 — 행, 링크 끊기, 남의 묶음에서 빠짐, 초대 지움, 누계, 응답 전 purge', async () => {
    const { sqlDb, owner, purges, purge } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(30), id, { content: '가나다' })
    insertDoc(sqlDb, uuid(31), id)
    insertDoc(sqlDb, uuid(32), id)
    insertLink(sqlDb, 'L1', id, 'doc', uuid(30))
    insertLink(sqlDb, 'L2', id, 'doc', uuid(31))
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run('L2', uuid(30))
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run('L2', uuid(32))
    insertGrant(sqlDb, 'doc', uuid(30), id, FRIEND, 'edit')
    purge.impl = () => new Promise((resolve) => setTimeout(resolve, 5))

    const before = usage(sqlDb)
    const res = await call(owner, `/api/docs/${uuid(30)}/e2ee`, json('PUT', moveBody()))
    expect(purge.done).toBe(1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { e2eeKey: string; attachmentRefs: string[]; version: number; purged: boolean }
    expect(body).toMatchObject({ e2eeKey: KEY2, attachmentRefs: [REF], version: 2, purged: true })
    expect(docRow(sqlDb, uuid(30))).toMatchObject({ e2ee_key: KEY2, attachment_refs: `["${REF}"]`, version: 2, content: 'QUJDREVG', title: TITLE })
    expect(linkRevoked(sqlDb, 'L1')).not.toBeNull()
    expect(linkRevoked(sqlDb, 'L2')).toBeNull()
    expect(sqlDb.prepare("SELECT doc_id FROM share_link_docs WHERE token = 'L2'").all()).toEqual([{ doc_id: uuid(32) }])
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM grants WHERE target_id = ?", uuid(30))).toBe(0)
    const after = usage(sqlDb)
    expect(after.content_bytes - before.content_bytes).toBe('QUJDREVG'.length - 9)
    expect(after.doc_count).toBe(before.doc_count)
    expect(after.write_count - before.write_count).toBe(1)
    expect(purges).toEqual([uuid(30)])
  })

  it('C2 묶음 없는 사용자의 옮기기 409 no_vault, 링크·초대 그대로', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(33), id)
    insertLink(sqlDb, 'L3', id, 'doc', uuid(33))
    insertGrant(sqlDb, 'doc', uuid(33), id, FRIEND, 'view')
    const before = usage(sqlDb).write_count
    const res = await call(owner, `/api/docs/${uuid(33)}/e2ee`, json('PUT', moveBody()))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_vault' })
    expect(linkRevoked(sqlDb, 'L3')).toBeNull()
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants WHERE target_id = ?', uuid(33))).toBe(1)
    expect(usage(sqlDb).write_count).toBe(before)
  })

  it('C3 낡은 baseVersion 409 conflict, 링크·초대 그대로, purge 0', async () => {
    const { sqlDb, owner, purges } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(34), id, { version: 4 })
    insertLink(sqlDb, 'L4', id, 'doc', uuid(34))
    insertGrant(sqlDb, 'doc', uuid(34), id, FRIEND, 'view')
    const res = await call(owner, `/api/docs/${uuid(34)}/e2ee`, json('PUT', moveBody({ baseVersion: 3 })))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; doc: { version: number } }
    expect(body.error).toBe('conflict')
    expect(body.doc.version).toBe(4)
    expect(linkRevoked(sqlDb, 'L4')).toBeNull()
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants WHERE target_id = ?', uuid(34))).toBe(1)
    expect(purges).toHaveLength(0)
  })

  it('C4 edit 초대를 받은 사람의 옮기기는 404', async () => {
    const { sqlDb, owner, friend } = makeWorld()
    await withKeys(owner)
    await withKeys(friend)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(35), id)
    insertGrant(sqlDb, 'doc', uuid(35), id, FRIEND, 'edit')
    const res = await call(friend, `/api/docs/${uuid(35)}/e2ee`, json('PUT', moveBody()))
    expect(res.status).toBe(404)
    expect(docRow(sqlDb, uuid(35))!.e2ee_key).toBeNull()
  })

  it('C5 금고 문서 옮기기 409 e2ee_doc, 일반 문서 빼기 409 not_e2ee', async () => {
    const { sqlDb, owner } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(36), id, { e2ee_key: KEY })
    insertDoc(sqlDb, uuid(37), id)
    const a = await call(owner, `/api/docs/${uuid(36)}/e2ee`, json('PUT', moveBody()))
    expect(a.status).toBe(409)
    expect(await a.json()).toEqual({ error: 'e2ee_doc' })
    const b = await call(owner, `/api/docs/${uuid(37)}/e2ee`, json('PUT', { e2eeKey: null, title: 't', content: 'c', attachmentRefs: null, baseVersion: 1 }))
    expect(b.status).toBe(409)
    expect(await b.json()).toEqual({ error: 'not_e2ee' })
  })

  it('C6 일반 폴더 안 금고 문서 빼기 200, 금고 폴더 안이면 409 e2ee_folder', async () => {
    const { sqlDb, owner, purges } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(38), id)
    insertFolder(sqlDb, uuid(39), id, { e2ee: 1 })
    insertDoc(sqlDb, uuid(40), id, { e2ee_key: KEY, folder_id: uuid(38), attachment_refs: `["${REF}"]` })
    insertDoc(sqlDb, uuid(41), id, { e2ee_key: KEY, folder_id: uuid(39) })
    const unmove = { e2eeKey: null, title: '제목', content: '# 본문\n', attachmentRefs: null, baseVersion: 1 }
    const res = await call(owner, `/api/docs/${uuid(40)}/e2ee`, json('PUT', unmove))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect('e2eeKey' in body).toBe(false)
    expect('attachmentRefs' in body).toBe(false)
    expect(body).toMatchObject({ title: '제목', content: '# 본문\n', version: 2, purged: true })
    expect(docRow(sqlDb, uuid(40))).toMatchObject({ e2ee_key: null, attachment_refs: null, content: '# 본문\n' })
    expect(purges).toEqual([uuid(40)])

    const blocked = await call(owner, `/api/docs/${uuid(41)}/e2ee`, json('PUT', unmove))
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toEqual({ error: 'e2ee_folder' })
  })

  it('C6 attachmentRefs 없는 빼기도 받는다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(42), id, { e2ee_key: KEY })
    const res = await call(owner, `/api/docs/${uuid(42)}/e2ee`, json('PUT', { e2eeKey: null, title: 't', content: 'c', baseVersion: 1 }))
    expect(res.status).toBe(200)
  })

  it('C7 빼기 제목 501자 400 title, attachmentRefs [] 400', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(43), id, { e2ee_key: KEY })
    const long = await call(owner, `/api/docs/${uuid(43)}/e2ee`, json('PUT', { e2eeKey: null, title: 'x'.repeat(501), content: 'c', attachmentRefs: null, baseVersion: 1 }))
    expect(long.status).toBe(400)
    expect(await long.json()).toEqual({ error: 'invalid', field: 'title' })
    const refs = await call(owner, `/api/docs/${uuid(43)}/e2ee`, json('PUT', { e2eeKey: null, title: 't', content: 'c', attachmentRefs: [], baseVersion: 1 }))
    expect(refs.status).toBe(400)
    expect(await refs.json()).toEqual({ error: 'invalid', field: 'attachmentRefs' })
  })

  it('C7 옮기기의 400 들', async () => {
    const { sqlDb, owner } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(44), id)
    const cases: [Record<string, unknown>, string][] = [
      [moveBody({ e2eeKey: 12 }), 'e2eeKey'],
      [moveBody({ e2eeKey: 'abc' }), 'e2eeKey'],
      [moveBody({ title: '제목' }), 'title'],
      [moveBody({ title: 'A'.repeat(2_044) }), 'title'],
      [moveBody({ content: '# 평문\n' }), 'content'],
      [moveBody({ attachmentRefs: null }), 'attachmentRefs'],
      [moveBody({ baseVersion: '1' }), 'baseVersion'],
    ]
    for (const [body, field] of cases) {
      const res = await call(owner, `/api/docs/${uuid(44)}/e2ee`, json('PUT', body))
      expect(res.status, field).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field })
    }
  })

  it('C8 한도 − 10 에서 늘어나는 옮기기 413, 행·링크 그대로', async () => {
    const { sqlDb, owner, purges } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(45), id, { content: 'ab' })
    insertLink(sqlDb, 'L5', id, 'doc', uuid(45))
    sqlDb.prepare('UPDATE users SET content_bytes = ? WHERE id = ?').run(DOC_BYTES_QUOTA - 10, id)
    const res = await call(owner, `/api/docs/${uuid(45)}/e2ee`, json('PUT', moveBody({ content: 'A'.repeat(40) })))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'doc_quota_exceeded', resource: 'bytes' })
    expect(docRow(sqlDb, uuid(45))).toMatchObject({ e2ee_key: null, content: 'ab' })
    expect(linkRevoked(sqlDb, 'L5')).toBeNull()
    expect(purges).toHaveLength(0)
  })
})

describe('F-401 C9·C10 batch 조건·purge 재시도', () => {
  it('C9 1번 문장이 0행이면 3·4·5 가 아무것도 바꾸지 않는다', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(50), id, { version: 5 })
    insertDoc(sqlDb, uuid(51), id)
    insertLink(sqlDb, 'L6', id, 'doc', uuid(50))
    insertLink(sqlDb, 'L7', id, 'doc', uuid(51))
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run('L7', uuid(50))
    insertGrant(sqlDb, 'doc', uuid(50), id, FRIEND, 'edit')
    const DB = (owner as unknown as { DB: D1Database }).DB
    const statements = setDocE2eeStatements(DB, {
      docId: uuid(50),
      ownerId: id,
      title: TITLE,
      content: BODY,
      e2eeKey: KEY,
      attachmentRefs: [],
      baseVersion: 4,
      now: 2_000,
      deltaBytes: 7,
    })
    const results = await DB.batch(statements)
    expect(results[0].meta.changes).toBe(0)
    expect(docRow(sqlDb, uuid(50))).toMatchObject({ e2ee_key: null, version: 5 })
    expect(linkRevoked(sqlDb, 'L6')).toBeNull()
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM share_link_docs WHERE token = 'L7'")).toBe(1)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants WHERE target_id = ?', uuid(50))).toBe(1)
  })

  it('C10 purge 가 한 번 던지면 다시 불러 purged true', async () => {
    const { sqlDb, owner, purges, purge } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(52), id)
    let n = 0
    purge.impl = async () => {
      n++
      if (n === 1) throw new Error('DO down')
    }
    const res = await call(owner, `/api/docs/${uuid(52)}/e2ee`, json('PUT', moveBody()))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { purged: boolean }).purged).toBe(true)
    expect(purges).toHaveLength(2)
  })

  it('C10 두 번 다 던지면 purged false, console.error, 행은 옮겨진 채', async () => {
    const { sqlDb, owner, purges, purge } = makeWorld()
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(53), id)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    purge.impl = async () => {
      throw new Error('DO down')
    }
    const res = await call(owner, `/api/docs/${uuid(53)}/e2ee`, json('PUT', moveBody()))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { purged: boolean }).purged).toBe(false)
    expect(purges).toHaveLength(2)
    expect(error.mock.calls.some((c) => c[0] === 'e2ee_purge_failed')).toBe(true)
    expect(docRow(sqlDb, uuid(53))!.e2ee_key).toBe(KEY2)
  })

  it('C10 DOC_ROOM 이 없으면 purged true', async () => {
    const { sqlDb, owner } = makeWorld({ docRoom: false })
    await withKeys(owner)
    const id = await userId(owner, sqlDb)
    insertDoc(sqlDb, uuid(54), id)
    const res = await call(owner, `/api/docs/${uuid(54)}/e2ee`, json('PUT', moveBody()))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { purged: boolean }).purged).toBe(true)
  })
})

type FolderBody = { id: string; e2ee?: boolean }

describe('F-401 F1~F7 금고 폴더', () => {
  it('F1 e2ee: true 로 만들기 → 목록에서 그 폴더만 e2ee', async () => {
    const { owner } = makeWorld()
    const made = await call(owner, '/api/folders', json('POST', { name: '금고', e2ee: true }))
    expect(made.status).toBe(201)
    const body = (await made.json()) as FolderBody
    expect(body.e2ee).toBe(true)
    await call(owner, '/api/folders', json('POST', { name: '일반' }))
    const list = (await (await call(owner, '/api/folders')).json()) as FolderBody[]
    expect(list).toHaveLength(2)
    for (const f of list) {
      if (f.id === body.id) expect(f.e2ee).toBe(true)
      else expect('e2ee' in f).toBe(false)
    }
  })

  it('F2 금고 부모 아래 — e2ee 없음 409, e2ee true 201, e2ee 문자열 400', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(60), id, { e2ee: 1 })
    const before = usage(sqlDb).write_count
    const plain = await call(owner, '/api/folders', json('POST', { name: 'x', parentId: uuid(60) }))
    expect(plain.status).toBe(409)
    expect(await plain.json()).toEqual({ error: 'e2ee_folder' })
    expect(usage(sqlDb).write_count).toBe(before)
    const sealed = await call(owner, '/api/folders', json('POST', { name: 'x', parentId: uuid(60), e2ee: true }))
    expect(sealed.status).toBe(201)
    const bad = await call(owner, '/api/folders', json('POST', { name: 'x', e2ee: 'yes' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid', field: 'e2ee' })
  })

  it('F3 일반 폴더를 금고 폴더 아래로 409, e2ee: true 함께면 200', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(61), id, { e2ee: 1 })
    insertFolder(sqlDb, uuid(62), id)
    const bad = await call(owner, `/api/folders/${uuid(62)}`, json('PUT', { parentId: uuid(61) }))
    expect(bad.status).toBe(409)
    expect(await bad.json()).toEqual({ error: 'e2ee_folder' })
    const ok = await call(owner, `/api/folders/${uuid(62)}`, json('PUT', { parentId: uuid(61), e2ee: true }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ parentId: uuid(61), e2ee: true })
  })

  it('F4 켜기 — 바로 아래가 일반이면 409 개수, 모두 금고면 200·링크 끊기·초대 지우기', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(63), id)
    insertFolder(sqlDb, uuid(64), id, { parent_id: uuid(63) })
    insertDoc(sqlDb, uuid(65), id, { folder_id: uuid(63) })
    insertLink(sqlDb, 'LF', id, 'folder', uuid(63))
    insertGrant(sqlDb, 'folder', uuid(63), id, FRIEND, 'view')
    const before = usage(sqlDb).write_count
    const notReady = await call(owner, `/api/folders/${uuid(63)}`, json('PUT', { e2ee: true }))
    expect(notReady.status).toBe(409)
    expect(await notReady.json()).toEqual({ error: 'e2ee_folder_not_ready', docs: 1, folders: 1 })
    expect(usage(sqlDb).write_count).toBe(before)
    expect(linkRevoked(sqlDb, 'LF')).toBeNull()

    sqlDb.prepare('UPDATE folders SET e2ee = 1 WHERE id = ?').run(uuid(64))
    sqlDb.prepare("UPDATE docs SET e2ee_key = ?, attachment_refs = '[]' WHERE id = ?").run(KEY, uuid(65))
    const ok = await call(owner, `/api/folders/${uuid(63)}`, json('PUT', { e2ee: true }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ id: uuid(63), e2ee: true })
    expect(linkRevoked(sqlDb, 'LF')).not.toBeNull()
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM grants WHERE target_type = 'folder' AND target_id = ?", uuid(63))).toBe(0)
    expect(usage(sqlDb).write_count - before).toBe(1)

    const again = await call(owner, `/api/folders/${uuid(63)}`, json('PUT', { e2ee: true, name: '새 이름' }))
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ name: '새 이름', e2ee: true })
  })

  it('F4 사전 검사 뒤 끼어든 평문 — 켜기 0행이면 409, 링크·초대 그대로, 하루는 +1', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(74), id)
    insertLink(sqlDb, 'LR', id, 'folder', uuid(74))
    insertGrant(sqlDb, 'folder', uuid(74), id, FRIEND, 'view')
    const DB = (owner as unknown as { DB: D1Database }).DB
    const batch = DB.batch.bind(DB)
    DB.batch = (async (statements: D1PreparedStatement[]) => {
      insertDoc(sqlDb, uuid(75), id, { folder_id: uuid(74) })
      return batch(statements)
    }) as typeof DB.batch
    const before = usage(sqlDb).write_count
    const res = await call(owner, `/api/folders/${uuid(74)}`, json('PUT', { e2ee: true }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'e2ee_folder_not_ready', docs: 1, folders: 0 })
    expect((sqlDb.prepare('SELECT e2ee FROM folders WHERE id = ?').get(uuid(74)) as { e2ee: number }).e2ee).toBe(0)
    expect(linkRevoked(sqlDb, 'LR')).toBeNull()
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants WHERE target_id = ?', uuid(74))).toBe(1)
    expect(usage(sqlDb).write_count - before).toBe(1)
  })

  it('F5 끄기 — 최상위 200, 금고 부모 아래 409, parentId: null 함께면 200', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(66), id, { e2ee: 1 })
    insertDoc(sqlDb, uuid(67), id, { e2ee_key: KEY, folder_id: uuid(66) })
    const top = await call(owner, `/api/folders/${uuid(66)}`, json('PUT', { e2ee: false }))
    expect(top.status).toBe(200)
    const list = (await (await call(owner, '/api/folders')).json()) as FolderBody[]
    expect('e2ee' in list.find((f) => f.id === uuid(66))!).toBe(false)

    insertFolder(sqlDb, uuid(68), id, { e2ee: 1 })
    insertFolder(sqlDb, uuid(69), id, { e2ee: 1, parent_id: uuid(68) })
    const before = usage(sqlDb).write_count
    const inner = await call(owner, `/api/folders/${uuid(69)}`, json('PUT', { e2ee: false }))
    expect(inner.status).toBe(409)
    expect(await inner.json()).toEqual({ error: 'e2ee_folder' })
    expect(usage(sqlDb).write_count).toBe(before)
    const out = await call(owner, `/api/folders/${uuid(69)}`, json('PUT', { e2ee: false, parentId: null }))
    expect(out.status).toBe(200)
    expect(await out.json()).toMatchObject({ parentId: null })
  })

  it('F6 금고 부모 아래 일반 폴더 move-up — 일반 문서가 있으면 409, 금고 문서뿐이면 204', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(70), id, { e2ee: 1 })
    insertFolder(sqlDb, uuid(71), id, { parent_id: uuid(70) })
    insertDoc(sqlDb, uuid(72), id, { folder_id: uuid(71) })
    const bad = await call(owner, `/api/folders/${uuid(71)}?contents=move-up`, { method: 'DELETE' })
    expect(bad.status).toBe(409)
    expect(await bad.json()).toEqual({ error: 'e2ee_folder' })
    expect(docRow(sqlDb, uuid(72))!.folder_id).toBe(uuid(71))

    sqlDb.prepare("UPDATE docs SET e2ee_key = ?, attachment_refs = '[]' WHERE id = ?").run(KEY, uuid(72))
    const ok = await call(owner, `/api/folders/${uuid(71)}?contents=move-up`, { method: 'DELETE' })
    expect(ok.status).toBe(204)
    expect(docRow(sqlDb, uuid(72))!.folder_id).toBe(uuid(70))
  })

  it('F7 금고 폴더 링크·초대 409 e2ee_folder', async () => {
    const { sqlDb, owner } = makeWorld()
    const id = await userId(owner, sqlDb)
    insertFolder(sqlDb, uuid(73), id, { e2ee: 1 })
    const link = await call(owner, `/api/folders/${uuid(73)}/link`, { method: 'POST' })
    expect(link.status).toBe(409)
    expect(await link.json()).toEqual({ error: 'e2ee_folder' })
    const grant = await call(owner, `/api/folders/${uuid(73)}/grants/a@b.com`, json('PUT', { role: 'view' }))
    expect(grant.status).toBe(409)
    expect(await grant.json()).toEqual({ error: 'e2ee_folder' })
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM share_links')).toBe(0)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM grants')).toBe(0)
  })
})
