// 첨부↔문서 연결 기록 — worker/index.ts 를 통째로, 실제 SQLite (specs/features/F-4012.md 6장 A1~A7)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { asD1, openTestDb } from '../../worker/testD1'
import { cleanupServerAttachments } from '../../worker/attachmentGc'
import { findDocAttachment } from '../../worker/attachments'
import { E2EE_ATTACHMENT_OVERHEAD, E2EE_FORMAT_VERSION } from '../../src/lib/vault/e2eeLimits'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
type Caller = { user: { id: string; email: string }; clientId: string; clientName: string }
let worker: Worker
let mcpCaller: Caller

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.doMock('../../worker/mcpAuth', () => ({ authenticateMcp: async () => mcpCaller }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'http://localhost:8790'
const X = 'aaaaaaaaaaaaaaaa'
const Y = 'bbbbbbbbbbbbbbbb'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2])
const USERS = {
  V: { id: 'u-v', email: 'v@example.com' },
  A: { id: 'u-a', email: 'a@example.com' },
  E: { id: 'u-e', email: 'e@example.com' },
  O: { id: 'u-o', email: 'o@example.com' },
  P: { id: 'u-p', email: 'p@example.com' },
  W: { id: 'u-w', email: 'w@example.com' },
}
type UserKey = keyof typeof USERS

const tok = (n: number) => String(n).padStart(43, 't')
const ref = (id: string) => `![a](attachments/${id}.png)`

function makeWorld() {
  const sqlDb = openTestDb()
  const objects = new Map<string, Uint8Array>()
  const bucket = {
    async put(key: string, bytes: Uint8Array) {
      objects.set(key, bytes)
    },
    async delete(key: string) {
      objects.delete(key)
    },
    async get(key: string) {
      const bytes = objects.get(key)
      return bytes ? { body: bytes, arrayBuffer: async () => bytes.slice().buffer } : null
    },
  }
  for (const u of Object.values(USERS)) sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)').run(u.id, u.email)
  const envFor = (who: UserKey, over: Record<string, unknown> = {}) =>
    ({
      DB: asD1(sqlDb),
      BETTER_AUTH_URL: ORIGIN,
      DEV_AUTH_EMAIL: USERS[who].email,
      BUCKET: bucket,
      WRITE_LIMITER: { limit: async () => ({ success: true }) },
      DOC_ROOM: { getByName: () => ({ async purgeRoom() {} }) },
      ...over,
    }) as unknown as Env
  return { sqlDb, objects, bucket, envFor }
}
type World = ReturnType<typeof makeWorld>

type DocOpts = { folder?: string | null; e2eeKey?: string | null; deletedAt?: number | null; createdAt?: number }
function addDoc(w: World, id: string, owner: UserKey, content: string, opts: DocOpts = {}) {
  w.sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, USERS[owner].id, 't', content, 'lf', opts.folder ?? null, 1, opts.createdAt ?? 1, 1, opts.e2eeKey ?? null, opts.deletedAt ?? null)
}

function addFolder(w: World, id: string, owner: UserKey, parent: string | null = null) {
  w.sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,1,1)').run(id, USERS[owner].id, 'f', parent)
}

function addGrant(w: World, owner: UserKey, grantee: UserKey, target: string, role: 'view' | 'edit', type: 'doc' | 'folder' = 'doc') {
  w.sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,1)')
    .run(type, target, USERS[owner].id, USERS[grantee].email, role)
}

function addAttachment(w: World, owner: UserKey, id: string, over: { e2ee?: number; createdAt?: number } = {}) {
  w.sqlDb
    .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(USERS[owner].id, id, 'png', 'image/png', PNG.length, 2, 2, over.createdAt ?? 1, over.e2ee ?? 0)
  w.objects.set(`att/${USERS[owner].id}/${id}.png`, PNG)
}

function addLink(w: World, token: string, owner: UserKey, type: 'doc' | 'folder', target: string, docs: string[] = []) {
  w.sqlDb.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at) VALUES (?,?,?,?,1)').run(token, USERS[owner].id, type, target)
  for (const d of docs) w.sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)').run(token, d)
}

function links(w: World): { rows: [string, string][] } {
  const rows = w.sqlDb.prepare('SELECT owner_id, attachment_id, doc_owner_id, doc_id FROM attachment_docs ORDER BY owner_id, attachment_id, doc_owner_id').all() as Record<string, string>[]
  return { rows: rows.map((r) => [`${r.owner_id}/${r.attachment_id}/${r.doc_owner_id}`, r.doc_id]) }
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function put(env: Env, idext: string, query = '', bytes: Uint8Array = PNG): Promise<Response> {
  return call(env, `/api/attachments/${idext}${query}`, { method: 'PUT', headers: { 'Content-Length': String(bytes.length) }, body: bytes })
}

async function postV1(env: Env, query = ''): Promise<Response> {
  const tokenRes = await call(env, '/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '토큰' }) })
  const { token } = (await tokenRes.json()) as { token: string }
  return call(env, `/v1/attachments${query}`, { method: 'POST', headers: { 'Content-Length': String(PNG.length), Authorization: `Bearer ${token}` }, body: PNG })
}

async function mcpFetchImage(w: World, who: UserKey, docId: string, name: string): Promise<'ok' | 'not_found'> {
  mcpCaller = { user: USERS[who], clientId: 'c1', clientName: 'Claude' }
  const res = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: 'Bearer t',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch_image', arguments: { id: docId, image: name } } }),
    }),
    w.envFor(who),
    ctx,
  )
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))!
  const result = (JSON.parse(line.slice(6)) as { result: { isError?: boolean; content: { type: string }[] } }).result
  return result.isError ? 'not_found' : 'ok'
}

// 네 경로(앱 ?doc=·문서 링크·묶음 링크·폴더 링크)와 MCP 가 같은 답을 주는지 — 공격 판의 문서는 A 소유
async function fourPaths(w: World, who: UserKey, d: string, att: string): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {}
  out.doc = (await call(w.envFor(who), `/api/attachments/${att}.png?doc=${d}`)).status
  out.pub = (await call(w.envFor(who), `/pub/docs/${tok(1)}/attachments/${att}.png`)).status
  out.set = (await call(w.envFor(who), `/pub/docs/${tok(2)}/docs/d2/attachments/${att}.png`)).status
  out.folder = (await call(w.envFor(who), `/pub/folders/${tok(3)}/docs/d3/attachments/${att}.png`)).status
  out.mcp = await mcpFetchImage(w, who, d, `${att}.png`)
  return out
}

function attackWorld(xOwner: UserKey) {
  const w = makeWorld()
  addAttachment(w, xOwner, X)
  addDoc(w, 'd1', 'A', `공격\n\n${ref(X)}`)
  addDoc(w, 'd2', 'A', ref(X))
  addFolder(w, 'fa', 'A')
  addDoc(w, 'd3', 'A', ref(X), { folder: 'fa' })
  addLink(w, tok(1), 'A', 'doc', 'd1')
  addLink(w, tok(2), 'A', 'doc', 'd1', ['d2'])
  addLink(w, tok(3), 'A', 'folder', 'fa')
  addGrant(w, 'A', 'V', 'd1', 'edit')
  return w
}

describe('F-4012 A1 초대만으로는 남의 첨부를 받지 못한다', () => {
  it('V 의 첨부 X 를 A 의 문서가 참조하고 V 가 edit 초대돼도 다섯 경로 모두 막힌다', async () => {
    const w = attackWorld('V')
    expect(await fourPaths(w, 'A', 'd1', X)).toEqual({ doc: 404, pub: 404, set: 404, folder: 404, mcp: 'not_found' })
  })

  it('같은 판에서 X 가 문서 소유자 A 의 것이면 다섯 경로 모두 받는다', async () => {
    const w = attackWorld('A')
    expect(await fourPaths(w, 'A', 'd1', X)).toEqual({ doc: 200, pub: 200, set: 200, folder: 200, mcp: 'ok' })
  })
})

describe('F-4012 A2 공동 편집자가 ?doc= 로 올리면 소유자 단위로 연결된다', () => {
  it('행 하나, 보기 권한자·공개 링크·같은 소유자의 다른 문서는 받고 다른 소유자 문서는 못 받는다', async () => {
    const w = makeWorld()
    addDoc(w, 'd1', 'O', ref(Y))
    addDoc(w, 'd2', 'O', ref(Y))
    addDoc(w, 'dp', 'P', ref(Y))
    addGrant(w, 'O', 'E', 'd1', 'edit')
    addGrant(w, 'O', 'W', 'd1', 'view')
    addGrant(w, 'P', 'E', 'dp', 'edit')
    addLink(w, tok(1), 'O', 'doc', 'd1')

    expect((await put(w.envFor('E'), `${Y}.png`, '?doc=d1')).status).toBe(201)
    expect(links(w).rows).toEqual([[`u-e/${Y}/u-o`, 'd1']])

    expect((await call(w.envFor('W'), `/api/attachments/${Y}.png?doc=d1`)).status).toBe(200)
    expect((await call(w.envFor('O'), `/api/attachments/${Y}.png?doc=d2`)).status).toBe(200)
    expect((await call(w.envFor('O'), `/pub/docs/${tok(1)}/attachments/${Y}.png`)).status).toBe(200)
    expect((await call(w.envFor('P'), `/api/attachments/${Y}.png?doc=dp`)).status).toBe(404)
  })
})

describe('F-4012 A3 기록하지 않는 경우는 ?doc= 없을 때와 같은 응답이다', () => {
  const shape = async (res: Response) => ({ status: res.status, body: (await res.text()).replace(/[0-9a-f]{16}/g, '-') })

  async function setup(arrange: (w: World) => void) {
    const w = makeWorld()
    addDoc(w, 'd1', 'O', 'x')
    addGrant(w, 'O', 'E', 'd1', 'edit')
    arrange(w)
    return w
  }

  const cases: [string, UserKey, string, (w: World) => void][] = [
    ['보기 권한', 'W', 'd1', (w) => addGrant(w, 'O', 'W', 'd1', 'view')],
    ['권한 없음', 'P', 'd1', () => {}],
    ['없는 문서', 'E', 'nope', () => {}],
    ['휴지통 문서', 'E', 'd1', (w) => w.sqlDb.prepare("UPDATE docs SET deleted_at = 5 WHERE id = 'd1'").run()],
    ['내 문서', 'O', 'd1', () => {}],
    ['막힌 소유자 문서의 편집자', 'E', 'd1', (w) => w.sqlDb.prepare('UPDATE users SET blocked_at = 5 WHERE id = ?').run(USERS.O.id)],
    ['금고 문서', 'O', 'd1', (w) => w.sqlDb.prepare("UPDATE docs SET e2ee_key = 'k' WHERE id = 'd1'").run()],
  ]

  for (const [name, who, doc, arrange] of cases) {
    it(`${name} — 기록 없음, 응답 같음 (PUT·POST /v1)`, async () => {
      const w = await setup(arrange)
      const plain = await shape(await put(w.envFor(who), `${X}.png`))
      const withDoc = await shape(await put(w.envFor(who), `${Y}.png`, `?doc=${doc}`))
      expect(withDoc).toEqual(plain)
      const v1Plain = await shape(await postV1(w.envFor(who)))
      const v1Doc = await shape(await postV1(w.envFor(who), `?doc=${doc}`))
      expect(v1Doc).toEqual(v1Plain)
      expect(links(w).rows).toEqual([])
    })
  }

  it('금고 첨부 올리기는 ?doc= 가 있어도 기록 없음', async () => {
    const w = await setup(() => {})
    const bytes = new Uint8Array(E2EE_ATTACHMENT_OVERHEAD + 4)
    bytes[0] = E2EE_FORMAT_VERSION
    const res = await put(w.envFor('E'), `${X}.png`, '?e2ee=1&w=2&h=2&doc=d1', bytes)
    expect(res.status).toBe(201)
    expect(links(w).rows).toEqual([])
  })

  it('편집자 올리기는 PUT·POST /v1 둘 다 기록하고, 같은 id 재전송(200)도 기록한다', async () => {
    const w = await setup(() => {})
    expect((await put(w.envFor('E'), `${X}.png`)).status).toBe(201)
    expect(links(w).rows).toEqual([])
    expect((await put(w.envFor('E'), `${X}.png`, '?doc=d1')).status).toBe(200)
    expect(links(w).rows).toEqual([[`u-e/${X}/u-o`, 'd1']])

    const w2 = await setup(() => {})
    const res = await postV1(w2.envFor('E'), '?doc=d1')
    expect(res.status).toBe(201)
    const id = ((await res.json()) as { id: string }).id
    expect(links(w2).rows).toEqual([[`u-e/${id}/u-o`, 'd1']])
  })
})

describe('F-4012 A4 초대를 지워도 연결은 남고 ?doc= 없는 첨부는 인정하지 않는다', () => {
  it('기록 뒤 E 의 초대를 지워도 보기 권한자·공개 링크가 받고, 기록 없이 올린 Z 는 404', async () => {
    const w = makeWorld()
    const Z = 'cccccccccccccccc'
    addDoc(w, 'd1', 'O', `${ref(Y)}${ref(Z)}`)
    addGrant(w, 'O', 'E', 'd1', 'edit')
    addGrant(w, 'O', 'W', 'd1', 'view')
    addLink(w, tok(1), 'O', 'doc', 'd1')
    await put(w.envFor('E'), `${Y}.png`, '?doc=d1')
    await put(w.envFor('E'), `${Z}.png`)
    w.sqlDb.prepare('DELETE FROM grants WHERE grantee_email = ?').run(USERS.E.email)

    expect((await call(w.envFor('W'), `/api/attachments/${Y}.png?doc=d1`)).status).toBe(200)
    expect((await call(w.envFor('O'), `/pub/docs/${tok(1)}/attachments/${Y}.png`)).status).toBe(200)
    expect((await call(w.envFor('W'), `/api/attachments/${Z}.png?doc=d1`)).status).toBe(404)
    expect((await call(w.envFor('O'), `/pub/docs/${tok(1)}/attachments/${Z}.png`)).status).toBe(404)
  })
})

describe('F-4012 A5 연결 행은 첨부·계정과 함께 지운다', () => {
  const NOW = Date.parse('2026-10-19T00:00:00Z')

  it('E 가 첨부를 지우면(204) 그 행 0', async () => {
    const w = makeWorld()
    addDoc(w, 'd1', 'O', 'x')
    addGrant(w, 'O', 'E', 'd1', 'edit')
    await put(w.envFor('E'), `${Y}.png`, '?doc=d1')
    expect(links(w).rows).toHaveLength(1)
    expect((await call(w.envFor('E'), `/api/attachments/${Y}.png`, { method: 'DELETE' })).status).toBe(204)
    expect(links(w).rows).toEqual([])
  })

  it('GC 가 지우면 그 행 0, 남은 첨부의 행은 그대로', async () => {
    const w = makeWorld()
    const keep = 'cccccccccccccccc'
    addAttachment(w, 'E', Y, { createdAt: 1 })
    addAttachment(w, 'E', keep, { createdAt: NOW })
    addDoc(w, 'd1', 'O', ref(keep))
    const insert = w.sqlDb.prepare('INSERT INTO attachment_docs (owner_id, attachment_id, doc_owner_id, doc_id, created_at) VALUES (?,?,?,?,1)')
    insert.run(USERS.E.id, Y, USERS.O.id, 'd1')
    insert.run(USERS.E.id, keep, USERS.O.id, 'd1')
    const result = await cleanupServerAttachments(w.envFor('O'), NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(links(w).rows).toEqual([[`u-e/${keep}/u-o`, 'd1']])
  })

  async function accountWorld() {
    const w = makeWorld()
    const insert = w.sqlDb.prepare('INSERT INTO attachment_docs (owner_id, attachment_id, doc_owner_id, doc_id, created_at) VALUES (?,?,?,?,1)')
    insert.run(USERS.E.id, 'e1', USERS.O.id, 'd1')
    insert.run(USERS.E.id, 'e2', USERS.P.id, 'dp')
    insert.run(USERS.P.id, 'p1', USERS.O.id, 'd1')
    insert.run(USERS.P.id, 'p2', USERS.V.id, 'dv')
    return w
  }

  it('E 계정 삭제 → E 가 올린 행만 없어진다', async () => {
    const w = await accountWorld()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(w.envFor('E'), '/api/account', { method: 'DELETE' })).status).toBe(204)
    expect(links(w).rows.map(([key]) => key)).toEqual([`u-p/p1/u-o`, `u-p/p2/u-v`])
  })

  it('O 계정 삭제 → O 문서에 걸린 행만 없어진다', async () => {
    const w = await accountWorld()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(w.envFor('O'), '/api/account', { method: 'DELETE' })).status).toBe(204)
    expect(links(w).rows.map(([key]) => key)).toEqual([`u-e/e2/u-p`, `u-p/p2/u-v`])
  })
})

describe('F-4012 A6 백필', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../migrations/0029_attachment_docs.sql', import.meta.url)), 'utf-8')

  function backfillWorld(): World {
    const sqlDb = openTestDb('0028')
    const w = { sqlDb, objects: new Map(), bucket: {}, envFor: () => ({}) as Env } as unknown as World
    for (const u of Object.values(USERS)) sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)').run(u.id, u.email)
    return w
  }

  function grantAt(w: World, target: string, role: 'view' | 'edit', createdAt: number, type: 'doc' | 'folder' = 'doc') {
    w.sqlDb
      .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
      .run(type, target, USERS.O.id, USERS.V.email, role, createdAt)
  }

  const id = (n: number) => String(n).padStart(16, '0')

  it('초대·문서가 첨부보다 먼저면 행, 아니면 없음, 두 번 돌려도 같다', () => {
    const w = backfillWorld()
    const att = (n: number, created: number, e2ee = 0) => addAttachment(w, 'V', id(n), { createdAt: created, e2ee })
    addFolder(w, 'ftop', 'O')
    addFolder(w, 'fmid', 'O', 'ftop')
    addFolder(w, 'fleaf', 'O', 'fmid')
    addFolder(w, 'f1', 'O')

    // 정상 — 문서 초대, 폴더 초대, 3단 상위 폴더 초대, 휴지통 문서
    att(1, 10)
    addDoc(w, 'd1', 'O', ref(id(1)), { createdAt: 5 })
    grantAt(w, 'd1', 'edit', 5)
    att(2, 10)
    addDoc(w, 'd2', 'O', ref(id(2)), { createdAt: 5, folder: 'f1' })
    grantAt(w, 'f1', 'edit', 5, 'folder')
    att(3, 10)
    addDoc(w, 'd3', 'O', ref(id(3)), { createdAt: 5, folder: 'fleaf' })
    grantAt(w, 'ftop', 'edit', 5, 'folder')
    att(4, 10)
    addDoc(w, 'd4', 'O', ref(id(4)), { createdAt: 5, deletedAt: 7 })
    grantAt(w, 'd4', 'edit', 5)

    // 제외 — 초대가 첨부 뒤, 문서가 첨부 뒤, view 초대, 금고 문서, e2ee 첨부, 참조 없음
    att(5, 3)
    addDoc(w, 'd5', 'O', ref(id(5)), { createdAt: 1 })
    grantAt(w, 'd5', 'edit', 5)
    att(6, 3)
    addDoc(w, 'd6', 'O', ref(id(6)), { createdAt: 4 })
    grantAt(w, 'd6', 'edit', 1)
    att(7, 10)
    addDoc(w, 'd7', 'O', ref(id(7)), { createdAt: 5 })
    grantAt(w, 'd7', 'view', 5)
    att(8, 10)
    addDoc(w, 'd8', 'O', ref(id(8)), { createdAt: 5, e2eeKey: 'k' })
    grantAt(w, 'd8', 'edit', 5)
    att(9, 10, 1)
    addDoc(w, 'd9', 'O', ref(id(9)), { createdAt: 5 })
    grantAt(w, 'd9', 'edit', 5)
    att(10, 10)
    addDoc(w, 'd10', 'O', '참조 없음', { createdAt: 5 })
    grantAt(w, 'd10', 'edit', 5)

    w.sqlDb.exec(sql)
    const first = links(w).rows
    expect(first).toEqual([
      [`u-v/${id(1)}/u-o`, 'd1'],
      [`u-v/${id(2)}/u-o`, 'd2'],
      [`u-v/${id(3)}/u-o`, 'd3'],
      [`u-v/${id(4)}/u-o`, 'd4'],
    ])
    expect(() => w.sqlDb.exec(sql)).not.toThrow()
    expect(links(w).rows).toEqual(first)
  })
})

describe('F-4012 A7 판정은 한 곳, 한 질의', () => {
  it('isDocAttachmentOwner 가 worker·src·cli 코드에 없다', () => {
    const found = spawnSync('git', ['grep', '--untracked', '-l', 'isDocAttachmentOwner', '--', 'worker', 'src', 'cli/src'], { encoding: 'utf-8' })
    expect([found.status, found.stdout]).toEqual([1, ''])
  })

  it('findDocAttachment 한 번에 D1 질의가 하나다', async () => {
    const w = attackWorld('A')
    const sqlLog: string[] = []
    const inner = asD1(w.sqlDb)
    const DB = { prepare: (s: string) => (sqlLog.push(s), inner.prepare(s)), batch: inner.batch.bind(inner) } as unknown as D1Database
    const env = { DB } as unknown as Env
    const row = await findDocAttachment(env, { id: 'd1', owner_id: USERS.A.id, content: ref(X) }, X, 'png')
    expect(row?.id).toBe(X)
    expect(sqlLog).toHaveLength(1)
  })
})
