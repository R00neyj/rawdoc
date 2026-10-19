// worker 접근 제어·악용 방지 보강 — 실제 SQLite (specs/features/F-4014.md 4장 A1~A4, A6)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { asD1, openTestDb } from '../../worker/testD1'
import { ATTACHMENT_QUOTA_BYTES } from '../../worker/attachments'
import { MAX_TOKENS } from '../../worker/apiTokens'
import { renderPublicPage } from '../../worker/publicPage'
import { E2EE_ATTACHMENT_OVERHEAD, E2EE_FORMAT_VERSION } from '../../src/lib/e2eeLimits'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
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
const PNG100 = new Uint8Array(100)
PNG100.set(PNG)
const USERS = {
  A: { id: 'u-a', email: 'a@example.com' },
  E: { id: 'u-e', email: 'e@example.com' },
  O: { id: 'u-o', email: 'o@example.com' },
}
type UserKey = keyof typeof USERS
const tok = (n: number) => String(n).padStart(43, 't')
const ref = (id: string) => `![a](attachments/${id}.png)`
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const PRECHECK = 'SELECT COALESCE(SUM(size),0)'

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
  const real = asD1(sqlDb)
  // intercept: 사전 검사 질의의 첫 호출만 0 으로 가로챈다(경합 흉내), onIntercept 는 그 순간 끼어드는 다른 요청
  const envFor = (who: UserKey, opts: { intercept?: 'precheck' | 'count'; onIntercept?: () => void } = {}) => {
    let intercepted = false
    const DB = {
      batch: real.batch.bind(real),
      prepare(sql: string) {
        const hit = opts.intercept === 'precheck' ? sql.startsWith(PRECHECK) : opts.intercept === 'count' ? sql.startsWith('SELECT COUNT(*) as count FROM api_tokens') : false
        if (hit && !intercepted) {
          intercepted = true
          opts.onIntercept?.()
          const row = opts.intercept === 'count' ? { count: 0 } : { used: 0 }
          return { bind: () => ({ first: async () => row }) }
        }
        return real.prepare(sql)
      },
    }
    return {
      DB,
      BETTER_AUTH_URL: ORIGIN,
      DEV_AUTH_EMAIL: USERS[who].email,
      BUCKET: bucket,
      ASSETS: { fetch: async () => new Response('<html><head></head></html>') },
      WRITE_LIMITER: { limit: async () => ({ success: true }) },
      DOC_ROOM: { getByName: () => ({ async purgeRoom() {} }) },
    } as unknown as Env
  }
  return { sqlDb, objects, envFor }
}
type World = ReturnType<typeof makeWorld>

function addDoc(w: World, id: string, owner: UserKey, content: string, opts: { folder?: string | null; e2eeKey?: string | null; deletedAt?: number | null } = {}) {
  w.sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, USERS[owner].id, 't', content, 'lf', opts.folder ?? null, 1, 1, 1, opts.e2eeKey ?? null, opts.deletedAt ?? null)
}

function addFolder(w: World, id: string, owner: UserKey) {
  w.sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,1,1)').run(id, USERS[owner].id, 'f', null)
}

function addAttachment(w: World, owner: UserKey, id: string, size = PNG.length) {
  w.sqlDb
    .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?,?,?,?,?,?,?,?,0)')
    .run(USERS[owner].id, id, 'png', 'image/png', size, 2, 2, 1)
  w.objects.set(`att/${USERS[owner].id}/${id}.png`, PNG)
}

function addLink(w: World, token: string, owner: UserKey, type: 'doc' | 'folder', target: string, docs: string[] = []) {
  w.sqlDb.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at) VALUES (?,?,?,?,1)').run(token, USERS[owner].id, type, target)
  for (const d of docs) w.sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)').run(token, d)
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx)
}

function put(env: Env, idext: string, query = '', bytes: Uint8Array = PNG100): Promise<Response> {
  return call(env, `/api/attachments/${idext}${query}`, { method: 'PUT', headers: { 'Content-Length': String(bytes.length) }, body: bytes })
}

function publicStatuses(w: World, who: UserKey) {
  const env = () => w.envFor(who)
  return Promise.all([
    call(env(), `/pub/docs/${tok(1)}`),
    call(env(), `/pub/docs/${tok(1)}/attachments/${X}.png`),
    call(env(), `/pub/docs/${tok(2)}/docs/d2/attachments/${X}.png`),
    call(env(), `/pub/folders/${tok(3)}/docs/d3/attachments/${X}.png`),
  ]).then((res) => res.map((r) => r.status))
}

function linkedWorld() {
  const w = makeWorld()
  addAttachment(w, 'A', X)
  addDoc(w, 'd1', 'A', ref(X))
  addDoc(w, 'd2', 'A', ref(X))
  addFolder(w, 'fa', 'A')
  addDoc(w, 'd3', 'A', ref(X), { folder: 'fa' })
  addLink(w, tok(1), 'A', 'doc', 'd1')
  addLink(w, tok(2), 'A', 'doc', 'd1', ['d2'])
  addLink(w, tok(3), 'A', 'folder', 'fa')
  return w
}

const pageRequest = (path: string) => new Request(`${ORIGIN}${path}`)

describe('F-4014 A1 금고 문서는 공개 질의 다섯 곳에서 막힌다', () => {
  it('평문이면 200 이고, e2ee_key 가 직접 붙으면 JSON·첨부 셋·메타 모두 404/null', async () => {
    const w = linkedWorld()
    expect(await publicStatuses(w, 'A')).toEqual([200, 200, 200, 200])
    expect(await renderPublicPage(pageRequest(`/p/${tok(1)}`), w.envFor('A'), `/p/${tok(1)}`)).not.toBeNull()

    w.sqlDb.prepare("UPDATE docs SET e2ee_key = 'k'").run()
    expect(await publicStatuses(w, 'A')).toEqual([404, 404, 404, 404])
    expect(await renderPublicPage(pageRequest(`/p/${tok(1)}`), w.envFor('A'), `/p/${tok(1)}`)).toBeNull()
  })
})

describe('F-4014 A2 링크 폴더가 없거나 금고면 트리가 비는다', () => {
  const folderCalls = (w: World) => {
    const env = () => w.envFor('A')
    return Promise.all([
      call(env(), `/pub/folders/${tok(3)}/docs/d3`),
      call(env(), `/pub/folders/${tok(3)}/docs/d3/attachments/${X}.png`),
      call(env(), `/pub/folders/${tok(3)}/docs/d3/gh?path=a.png`),
    ])
  }

  it('정상 폴더는 200, 폴더 행을 지우거나 e2ee=1 로 바꾸면 404, 휴지통 문서여도 not_found, 메타 null', async () => {
    const w = linkedWorld()
    const ok = await folderCalls(w)
    expect([ok[0].status, ok[1].status]).toEqual([200, 200])
    expect(await renderPublicPage(pageRequest(`/p/f/${tok(3)}`), w.envFor('A'), `/p/f/${tok(3)}`)).not.toBeNull()

    for (const arrange of [
      () => w.sqlDb.prepare("DELETE FROM folders WHERE id = 'fa'").run(),
      () => {
        w.sqlDb.prepare("INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES ('fa', ?, 'f', NULL, 1, 1, 1)").run(USERS.A.id)
      },
    ]) {
      arrange()
      for (const res of await folderCalls(w)) expect(res.status).toBe(404)
      expect(await renderPublicPage(pageRequest(`/p/f/${tok(3)}`), w.envFor('A'), `/p/f/${tok(3)}`)).toBeNull()
      w.sqlDb.prepare('UPDATE docs SET deleted_at = 5').run()
      const trashed = await call(w.envFor('A'), `/pub/folders/${tok(3)}/docs/d3`)
      expect(await trashed.json()).toEqual({ error: 'not_found' })
      w.sqlDb.prepare('UPDATE docs SET deleted_at = NULL').run()
      w.sqlDb.prepare("DELETE FROM folders WHERE id = 'fa'").run()
    }
  })
})

describe('F-4014 A3 첨부 한도는 넣기 문장이 다시 본다', () => {
  const fill = (w: World, owner: UserKey) => addAttachment(w, owner, 'cccccccccccccccc', ATTACHMENT_QUOTA_BYTES - 150)
  const sum = (w: World, owner: UserKey) => (w.sqlDb.prepare('SELECT COALESCE(SUM(size),0) AS n FROM attachments WHERE owner_id = ?').get(USERS[owner].id) as { n: number }).n
  const linkRows = (w: World) => (w.sqlDb.prepare('SELECT attachment_id FROM attachment_docs').all() as { attachment_id: string }[]).map((r) => r.attachment_id)

  it('사전 검사를 가로채도 둘째는 507, 합계 ≤ 한도, 둘째 R2 키·연결 행 없음 (?doc= edit 판)', async () => {
    const w = makeWorld()
    addDoc(w, 'd1', 'O', 'x')
    w.sqlDb.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc','d1',?,?,'edit',1)").run(USERS.O.id, USERS.E.email)
    fill(w, 'E')
    expect((await put(w.envFor('E', { intercept: 'precheck' }), `${X}.png`, '?doc=d1')).status).toBe(201)
    const second = await put(w.envFor('E', { intercept: 'precheck' }), `${Y}.png`, '?doc=d1')
    expect(second.status).toBe(507)
    expect(((await second.json()) as { used: number }).used).toBe(ATTACHMENT_QUOTA_BYTES - 50)
    expect(sum(w, 'E')).toBeLessThanOrEqual(ATTACHMENT_QUOTA_BYTES)
    expect(w.objects.has(`att/u-e/${Y}.png`)).toBe(false)
    expect(linkRows(w)).toEqual([X])
  })

  it('금고 갈래도 같다', async () => {
    const w = makeWorld()
    fill(w, 'E')
    const bytes = new Uint8Array(100)
    bytes[0] = E2EE_FORMAT_VERSION
    expect(bytes.length).toBeGreaterThan(E2EE_ATTACHMENT_OVERHEAD)
    expect((await put(w.envFor('E', { intercept: 'precheck' }), `${X}.png`, '?e2ee=1&w=2&h=2', bytes)).status).toBe(201)
    expect((await put(w.envFor('E', { intercept: 'precheck' }), `${Y}.png`, '?e2ee=1&w=2&h=2', bytes)).status).toBe(507)
    expect(sum(w, 'E')).toBeLessThanOrEqual(ATTACHMENT_QUOTA_BYTES)
    expect(w.objects.has(`att/u-e/${Y}.png`)).toBe(false)
  })

  it('POST /v1/attachments 도 같다', async () => {
    const w = makeWorld()
    fill(w, 'E')
    const tokenRes = await call(w.envFor('E'), '/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 't' }) })
    const { token } = (await tokenRes.json()) as { token: string }
    const post = () =>
      call(w.envFor('E', { intercept: 'precheck' }), '/v1/attachments', { method: 'POST', headers: { 'Content-Length': '100', Authorization: `Bearer ${token}` }, body: PNG100 })
    expect((await post()).status).toBe(201)
    const objectsBefore = w.objects.size
    expect((await post()).status).toBe(507)
    expect(w.objects.size).toBe(objectsBefore)
    expect(sum(w, 'E')).toBeLessThanOrEqual(ATTACHMENT_QUOTA_BYTES)
  })

  it('같은 id 행이 그 사이 생긴 경합 판에서는 R2 키를 지우지 않는다', async () => {
    const w = makeWorld()
    fill(w, 'E')
    const onIntercept = () => {
      w.sqlDb
        .prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?,?,?,?,?,?,?,?,0)')
        .run(USERS.E.id, X, 'png', 'image/png', 100, 2, 2, 1)
    }
    const res = await put(w.envFor('E', { intercept: 'precheck', onIntercept }), `${X}.png`)
    expect(res.status).toBe(507)
    expect(w.objects.has(`att/u-e/${X}.png`)).toBe(true)
  })
})

describe('F-4014 A4 토큰 한도는 넣기 문장이 다시 본다', () => {
  it('살아 있는 10개 + 사전 COUNT 가로챔 → 409 too_many, 행 10개 그대로', async () => {
    const w = makeWorld()
    for (let i = 0; i < MAX_TOKENS; i++) {
      w.sqlDb.prepare('INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?,?,?,?,?,1)').run(`t${i}`, USERS.E.id, 'n', `h${i}`, 'rd_xxxxxxxx')
    }
    const res = await call(w.envFor('E', { intercept: 'count' }), '/api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'n' }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'too_many', limit: MAX_TOKENS })
    expect((w.sqlDb.prepare('SELECT count(*) AS n FROM api_tokens').get() as { n: number }).n).toBe(MAX_TOKENS)
  })
})

describe('F-4014 A6 공개 질의 문자열', () => {
  it('금고 문서를 거르지 않던 다섯 질의에 e2ee_key IS NULL 이 있다', () => {
    const files = ['worker/links.ts', 'worker/publicPage.ts', 'worker/attachments.ts']
    const bare: string[] = []
    let guarded = 0
    for (const file of files) {
      for (const line of readFileSync(file, 'utf-8').split('\n')) {
        if (!/FROM docs WHERE id = \? AND owner_id = \?/.test(line) || line.includes('e2ee_key FROM')) continue
        if (line.includes('e2ee_key IS NULL')) guarded++
        else bare.push(`${file}: ${line.trim()}`)
      }
    }
    expect(bare).toEqual([])
    expect(guarded).toBeGreaterThanOrEqual(5)
  })
})
