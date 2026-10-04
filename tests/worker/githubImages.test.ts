// F-3017 A3~A14 저장소 그림 — 출처 찾기·받기·대응·프록시·첨부 판정·정리 (specs/features/F-3017.md 5장)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { importTokenKey, sealToken } from '../../worker/githubCrypto'
import { cleanupServerAttachments } from '../../worker/attachmentGc'
import { githubMonth } from '../../src/lib/githubContract'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('../../worker/auth')
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const ME = 'me@example.com'
const FRIEND = 'friend@example.com'
const VIEWER = 'viewer@example.com'
const STRANGER = 'stranger@example.com'
const KEY_TEXT = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const REPO = 'zz-owner/zz-repo'
const BRANCH = 'zz-branch'
const ATT_A = 'aaaaaaaaaaaaaaaa'
const ATT_B = 'bbbbbbbbbbbbbbbb'
const DOC_TOKEN = 'D'.repeat(43)
const SET_TOKEN = 'S'.repeat(43)
const FOLDER_TOKEN = 'F'.repeat(43)
const REVOKED_TOKEN = 'R'.repeat(43)
const HOUR = 3_600_000
const VARS = { GITHUB_APP_CLIENT_ID: 'Iv1.cid', GITHUB_APP_SLUG: 'test-app', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_TOKEN_KEY: KEY_TEXT }
const RAW_ACCEPT = 'application/vnd.github.raw+json'
// docs/a.md 기준: docs/img/x.png, assets/logo.svg, docs/x.png
const BODY = '# t\n![x](img/x.png)\n<img src="../assets/logo.svg">\n![top](x.png)\n'
const X = 'docs/img/x.png'
const PROXY_HEADERS = {
  'content-type': 'image/png',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox",
  'cross-origin-resource-policy': 'same-origin',
  'content-disposition': 'inline',
  'cache-control': 'private, max-age=300',
  'referrer-policy': 'no-referrer',
}

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

function makeBucket() {
  const store = new Map<string, Uint8Array>()
  return {
    store,
    async put(key: string, value: Uint8Array) {
      store.set(key, value)
    },
    async get(key: string) {
      const bytes = store.get(key)
      return bytes ? ({ body: bytes } as unknown as R2ObjectBody) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

const pending: Promise<unknown>[] = []
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }), env, ctx)
}

const send = (env: Env, method: string, path: string, body?: unknown) =>
  call(env, path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function world(opts: { enabled?: boolean; connected?: boolean } = {}) {
  const db = openTestDb()
  if (opts.enabled !== false) db.prepare('UPDATE github_settings SET enabled = 1').run()
  const bucket = makeBucket()
  const base = { DB: asD1(db), BUCKET: bucket, BETTER_AUTH_URL: LOCAL, ...VARS }
  const envOf = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  const env = envOf(ME)
  const friend = envOf(FRIEND)
  const viewer = envOf(VIEWER)
  const stranger = envOf(STRANGER)
  const anon = base as unknown as Env
  for (const e of [env, friend, viewer, stranger]) await call(e, '/api/me')
  const idOf = (email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
  const id = idOf(ME)
  if (opts.connected !== false) {
    const key = (await importTokenKey(KEY_TEXT))!
    db.prepare(
      'INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 1, 1, 1)',
    ).run(id, 'zz-login', await sealToken(key, id, 'access', 'ghu_access_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), Date.now() + HOUR, await sealToken(key, id, 'refresh', 'ghr_refresh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), Date.now() + 86_400_000)
  }
  return { db, bucket, env, friend, viewer, stranger, anon, id, friendId: idOf(FRIEND) }
}
type World = Awaited<ReturnType<typeof world>>

function addDoc(w: World, docId: string, content = BODY, folderId: string | null = null) {
  w.db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?, ?, 't', ?, 'lf', ?, 1, 1, 1)").run(docId, w.id, content, folderId)
}
function setBody(w: World, docId: string, content: string) {
  w.db.prepare('UPDATE docs SET content = ? WHERE id = ?').run(content, docId)
}
function grant(w: World, docId: string, email: string, role: 'view' | 'edit') {
  w.db.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc', ?, ?, ?, ?, 1)").run(docId, w.id, email, role)
}
function addLink(w: World, docId: string, path = 'docs/a.md') {
  w.db.prepare('INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_sha, remote_bom, synced_at, created_at) VALUES (?, ?, 77, ?, ?, ?, ?, 0, 5, 9)').run(docId, w.id, REPO, BRANCH, path, SHA)
}
function addMapping(w: World, docId: string, path: string, attachment: string, ext = 'png', createdAt = Date.now()) {
  w.db.prepare('INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(docId, path, w.id, attachment, ext, SHA, createdAt)
}
function addAttachment(w: World, ownerId: string, id: string, ext = 'png', over: { e2ee?: number; created_at?: number } = {}) {
  w.db.prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?, ?, ?, ?, 24, 2, 2, ?, ?)').run(ownerId, id, ext, ext === 'png' ? 'image/png' : `image/${ext}`, over.created_at ?? Date.now(), over.e2ee ?? 0)
}
function storeObject(w: World, ownerId: string, id: string, ext = 'png', bytes: Uint8Array = pngBytes(3, 3)) {
  w.bucket.store.set(`att/${ownerId}/${id}.${ext}`, bytes)
}
function shareLink(w: World, token: string, type: 'doc' | 'folder', targetId: string, revoked = false) {
  w.db.prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?, ?, ?, ?, 1, ?)').run(token, w.id, type, targetId, revoked ? 2 : null)
}
function addFolder(w: World, folderId: string) {
  w.db.prepare("INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?, ?, 'f', NULL, 1, 1, 0)").run(folderId, w.id)
}
const mappings = (db: DatabaseSync) => db.prepare('SELECT doc_id, path, owner_id, attachment_id, ext, blob_sha FROM github_images ORDER BY doc_id, path').all() as Record<string, unknown>[]
const usage = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT count FROM github_usage WHERE user_id = ? AND month = ?').get(id, githubMonth(Date.now())) as { count: number } | undefined)?.count ?? 0

type Call = { url: string; accept: string | null }
type Answer = (url: URL) => Response | undefined
function fakeGithub(answer: Answer) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push({ url: req.url, accept: req.headers.get('Accept') })
      return answer(new URL(req.url)) ?? new Response('unexpected', { status: 599 })
    }),
  )
  return calls
}

function fakeCaches() {
  const store = new Map<string, Response>()
  const log = { match: 0, put: 0 }
  const keyOf = (k: RequestInfo | URL) => (k instanceof Request ? k.url : String(k))
  vi.stubGlobal('caches', {
    default: {
      async match(k: RequestInfo | URL) {
        log.match++
        return store.get(keyOf(k))?.clone()
      },
      async put(k: RequestInfo | URL, res: Response) {
        log.put++
        store.set(keyOf(k), res)
      },
    },
  })
  return { store, log }
}

const contents = (path: string) => `https://api.github.com/repos/${REPO}/contents${path ? `/${path}` : ''}?ref=${BRANCH}`
const listing = (entries: { path: string; type?: string; sha?: string; size?: number }[]) =>
  Response.json(entries.map((e) => ({ name: e.path.split('/').pop(), path: e.path, type: e.type ?? 'file', sha: e.sha ?? SHA2, size: e.size ?? 10 })))
const limited = () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) } })
const svgBytes = (body: string) => new TextEncoder().encode(body)
const headersOf = (res: Response) => Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]))
const NOT_FOUND = { error: 'not_found' }

async function linked(opts: { enabled?: boolean; connected?: boolean } = {}) {
  const w = await world(opts)
  addDoc(w, 'd1')
  addLink(w, 'd1')
  grant(w, 'd1', FRIEND, 'edit')
  grant(w, 'd1', VIEWER, 'view')
  return w
}

describe('F-3017 A3 image-sources', () => {
  const sources = (env: Env, paths: unknown) => send(env, 'POST', '/api/docs/d1/github/image-sources', { paths })

  it('경로 3개(폴더 둘) → 폴더 목록 2번, 요청 경로와 같은 file 항목만', async () => {
    const w = await linked()
    const calls = fakeGithub((url) => {
      if (url.pathname.endsWith('/contents/docs/img')) return listing([{ path: 'docs/img/a.png', sha: SHA, size: 7 }, { path: 'docs/img/b.png', type: 'dir' }, { path: 'docs/img/other.png' }])
      if (url.pathname.endsWith('/contents')) return listing([{ path: 'top.svg', size: 3 }])
      return undefined
    })
    const res = await sources(w.env, ['docs/img/a.png', 'top.svg', 'docs/img/b.png'])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sources: [
        { path: 'docs/img/a.png', sha: SHA, size: 7, mapped: false },
        { path: 'top.svg', sha: SHA2, size: 3, mapped: false },
      ],
      truncated: false,
    })
    expect(calls.map((c) => c.url)).toEqual([contents('docs/img'), contents('')])
    expect(usage(w.db, w.id)).toBe(0)
  })

  it('폴더 21개 → 호출 20번 + truncated', async () => {
    const w = await linked()
    const calls = fakeGithub((url) => listing([{ path: `${decodeURIComponent(url.pathname.split('/contents/')[1])}/x.png` }]))
    const paths = Array.from({ length: 21 }, (_, i) => `d${i}/x.png`)
    const res = await sources(w.env, paths)
    const body = (await res.json()) as { sources: unknown[]; truncated: boolean }
    expect(calls).toHaveLength(20)
    expect(body.truncated).toBe(true)
    expect(body.sources).toHaveLength(20)
  })

  it('한 폴더 404 → 그 폴더만 빠짐, 둘째 폴더 한도 → 모은 것 + truncated, 첫 폴더 한도 → 503', async () => {
    const w = await linked()
    fakeGithub((url) => (url.pathname.endsWith('/a') ? new Response('{}', { status: 404 }) : listing([{ path: 'b/x.png' }])))
    expect(await (await sources(w.env, ['a/x.png', 'b/x.png'])).json()).toEqual({ sources: [{ path: 'b/x.png', sha: SHA2, size: 10, mapped: false }], truncated: false })

    fakeGithub((url) => (url.pathname.endsWith('/b') ? limited() : listing([{ path: 'a/x.png' }])))
    expect(await (await sources(w.env, ['a/x.png', 'b/x.png', 'c/x.png'])).json()).toEqual({ sources: [{ path: 'a/x.png', sha: SHA2, size: 10, mapped: false }], truncated: true })

    const calls = fakeGithub(() => limited())
    const res = await sources(w.env, ['a/x.png', 'b/x.png'])
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe('github_rate_limited')
    expect(calls).toHaveLength(1)
  })

  it('paths 501개·../x.png·빈 배열·앞 / → 400, 호출 0. 편집자 403, 꺼짐 503', async () => {
    const w = await linked()
    const calls = fakeGithub(() => listing([]))
    for (const paths of [Array.from({ length: 501 }, (_, i) => `a/${i}.png`), ['../x.png'], [], ['/x.png'], [''], 'x.png', [3]]) {
      const res = await sources(w.env, paths)
      expect([res.status, await res.json()]).toEqual([400, { error: 'invalid', field: 'paths' }])
    }
    expect((await sources(w.friend, ['a/x.png'])).status).toBe(403)
    expect(calls).toHaveLength(0)
    expect(usage(w.db, w.id)).toBe(0)
    const off = await linked({ enabled: false })
    const res = await sources(off.env, ['a/x.png'])
    expect([res.status, await res.json()]).toEqual([503, { error: 'github_disabled' }])
  })
})

describe('F-2131 A1 image-sources mapped', () => {
  it('같은 sha 대응 → mapped: true, 다른 sha·대응 없음 → false', async () => {
    const w = await linked()
    addMapping(w, 'd1', 'docs/img/a.png', ATT_A)
    addMapping(w, 'd1', 'docs/img/b.png', ATT_B)
    fakeGithub(() => listing([{ path: 'docs/img/a.png', sha: SHA }, { path: 'docs/img/b.png', sha: SHA2 }, { path: 'docs/img/c.png', sha: SHA }]))
    const res = await send(w.env, 'POST', '/api/docs/d1/github/image-sources', { paths: ['docs/img/a.png', 'docs/img/b.png', 'docs/img/c.png'] })
    expect(((await res.json()) as { sources: unknown[] }).sources).toEqual([
      { path: 'docs/img/a.png', sha: SHA, size: 10, mapped: true },
      { path: 'docs/img/b.png', sha: SHA2, size: 10, mapped: false },
      { path: 'docs/img/c.png', sha: SHA, size: 10, mapped: false },
    ])
  })
})

describe('F-3017 A4 raw', () => {
  it('raw Accept, 2.4 머리, 바이트 그대로', async () => {
    const w = await linked()
    const bytes = svgBytes('<html><script>alert(1)</script></html>')
    const calls = fakeGithub(() => new Response(bytes, { headers: { 'Content-Type': 'text/html' } }))
    const res = await call(w.env, `/api/docs/d1/github/raw?path=${encodeURIComponent('any/where.html')}`)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    expect(calls).toEqual([{ url: contents('any/where.html'), accept: RAW_ACCEPT }])
    expect(headersOf(res)).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'no-store',
    })
    expect(usage(w.db, w.id)).toBe(0)
  })

  it('Content-Length 20,000,001 → 413, 읽다가 넘어도 413', async () => {
    const w = await linked()
    fakeGithub(() => new Response(pngBytes(), { headers: { 'Content-Length': '20000001' } }))
    const res = await call(w.env, '/api/docs/d1/github/raw?path=a.png')
    expect([res.status, await res.json()]).toEqual([413, { error: 'too_large', limit: 20_000_000 }])

    const chunk = new Uint8Array(1_000_000)
    fakeGithub(() => {
      let sent = 0
      return new Response(new ReadableStream({ pull(c) { if (sent++ < 21) c.enqueue(chunk); else c.close() } }))
    })
    expect((await call(w.env, '/api/docs/d1/github/raw?path=a.png')).status).toBe(413)
  })

  it('GitHub 404 → 404 github_not_found, 편집자 403, 잘못된 path 400', async () => {
    const w = await linked()
    const calls = fakeGithub(() => new Response('{}', { status: 404 }))
    const res = await call(w.env, '/api/docs/d1/github/raw?path=a.png')
    expect([res.status, await res.json()]).toEqual([404, { error: 'github_not_found' }])
    expect((await call(w.friend, '/api/docs/d1/github/raw?path=a.png')).status).toBe(403)
    expect((await call(w.env, '/api/docs/d1/github/raw?path=../a.png')).status).toBe(400)
    expect((await call(w.env, '/api/docs/d1/github/raw')).status).toBe(400)
    expect(calls).toHaveLength(1)
  })
})

describe('F-3017 A5 images PUT', () => {
  const put = (env: Env, body: unknown) => send(env, 'PUT', '/api/docs/d1/github/images', body)

  it('행 생김, 같은 경로 다시 → 한 행·값 바뀜', async () => {
    const w = await linked()
    addAttachment(w, w.id, ATT_A)
    addAttachment(w, w.id, ATT_B, 'webp')
    const res = await put(w.env, { path: X, blobSha: SHA, attachment: `${ATT_A}.png` })
    expect(res.status).toBe(204)
    expect(mappings(w.db)).toEqual([{ doc_id: 'd1', path: X, owner_id: w.id, attachment_id: ATT_A, ext: 'png', blob_sha: SHA }])
    expect((await put(w.env, { path: X, blobSha: SHA2, attachment: `${ATT_B}.webp` })).status).toBe(204)
    expect(mappings(w.db)).toEqual([{ doc_id: 'd1', path: X, owner_id: w.id, attachment_id: ATT_B, ext: 'webp', blob_sha: SHA2 }])
  })

  it('남의 첨부·금고 첨부·ext 다름 → 404, 잘못된 몸통 400', async () => {
    const w = await linked()
    addAttachment(w, w.friendId, ATT_A)
    addAttachment(w, w.id, ATT_B, 'png', { e2ee: 1 })
    addAttachment(w, w.id, 'cccccccccccccccc')
    for (const attachment of [`${ATT_A}.png`, `${ATT_B}.png`, 'cccccccccccccccc.jpg']) {
      const res = await put(w.env, { path: X, blobSha: SHA, attachment })
      expect([attachment, res.status, await res.json()]).toEqual([attachment, 404, NOT_FOUND])
    }
    const bad: [Record<string, unknown>, string][] = [
      [{ path: '../x.png', blobSha: SHA, attachment: 'cccccccccccccccc.png' }, 'path'],
      [{ path: X, blobSha: 'a'.repeat(39), attachment: 'cccccccccccccccc.png' }, 'blobSha'],
      [{ path: X, blobSha: 'A'.repeat(40), attachment: 'cccccccccccccccc.png' }, 'blobSha'],
      [{ path: X, blobSha: SHA, attachment: 'cccccccccccccccc.svg' }, 'attachment'],
    ]
    for (const [body, field] of bad) {
      const res = await put(w.env, body)
      expect([res.status, await res.json()]).toEqual([400, { error: 'invalid', field }])
    }
    expect(mappings(w.db)).toEqual([])
  })

  it('1,001번째 새 경로 409 too_many, 기존 경로 갱신은 됨', async () => {
    const w = await linked()
    addAttachment(w, w.id, ATT_A)
    const insert = w.db.prepare('INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)')
    for (let i = 0; i < 1000; i++) insert.run('d1', `p/${i}.png`, w.id, ATT_A, 'png', SHA)
    const res = await put(w.env, { path: 'p/new.png', blobSha: SHA, attachment: `${ATT_A}.png` })
    expect([res.status, await res.json()]).toEqual([409, { error: 'too_many', limit: 1000 }])
    expect((await put(w.env, { path: 'p/5.png', blobSha: SHA2, attachment: `${ATT_A}.png` })).status).toBe(204)
    expect((w.db.prepare("SELECT blob_sha FROM github_images WHERE path = 'p/5.png'").get() as { blob_sha: string }).blob_sha).toBe(SHA2)
    expect((w.db.prepare('SELECT COUNT(*) AS n FROM github_images').get() as { n: number }).n).toBe(1000)
  })

  it('연결 없음 404, 편집자 403', async () => {
    const w = await linked()
    addAttachment(w, w.id, ATT_A)
    addDoc(w, 'd2')
    const body = { path: X, blobSha: SHA, attachment: `${ATT_A}.png` }
    expect([(await send(w.env, 'PUT', '/api/docs/d2/github/images', body)).status]).toEqual([404])
    expect((await put(w.friend, body)).status).toBe(403)
    expect(mappings(w.db)).toEqual([])
  })
})

describe('F-3017 A6 images GET', () => {
  it('주인·편집자는 전부, 보기 권한은 본문 경로만, 저장소 이름·브랜치 없음, 꺼져도 200', async () => {
    const w = await linked({ enabled: false })
    addMapping(w, 'd1', X, ATT_A)
    addMapping(w, 'd1', 'docs/img/gone.png', ATT_B, 'webp')
    const calls = fakeGithub(() => undefined)
    for (const env of [w.env, w.friend]) {
      const res = await call(env, '/api/docs/d1/github/images')
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ path: 'docs/a.md', images: { [X]: `${ATT_A}.png`, 'docs/img/gone.png': `${ATT_B}.webp` } })
      for (const secret of ['zz-owner', 'zz-repo', BRANCH, 'zz-login', SHA]) expect(text).not.toContain(secret)
    }
    const res = await call(w.viewer, '/api/docs/d1/github/images')
    expect(await res.json()).toEqual({ path: 'docs/a.md', images: { [X]: `${ATT_A}.png` } })
    expect((await call(w.stranger, '/api/docs/d1/github/images')).status).toBe(404)
    addDoc(w, 'd2')
    expect((await call(w.env, '/api/docs/d2/github/images')).status).toBe(404)
    expect(calls).toHaveLength(0)
  })
})

const pngAnswer: Answer = () => new Response(pngBytes(), { headers: { 'Content-Type': 'text/html' } })

describe('F-3017 A7 프록시 권한', () => {
  it('보기 권한 200, 나머지는 같은 404 몸통이고 GitHub 호출 0', async () => {
    const w = await linked()
    addDoc(w, 'd2')
    const ok = fakeGithub(pngAnswer)
    const res = await call(w.viewer, `/api/docs/d1/github/img?path=${encodeURIComponent(X)}`)
    expect(res.status).toBe(200)
    expect(ok).toEqual([{ url: contents(X), accept: RAW_ACCEPT }])

    const calls = fakeGithub(pngAnswer)
    const cases: [Env, string][] = [
      [w.stranger, `/api/docs/d1/github/img?path=${X}`],
      [w.env, `/api/docs/d2/github/img?path=${X}`],
      [w.env, '/api/docs/d1/github/img?path=docs/img/missing.png'],
      [w.env, '/api/docs/d1/github/img?path=../x.png'],
      [w.env, '/api/docs/d1/github/img?path=/x.png'],
      [w.env, '/api/docs/d1/github/img?path=x.png'],
      [w.env, '/api/docs/d1/github/img?path=%2e%2e/x.png'],
      [w.env, '/api/docs/d1/github/img?path=%252e%252e/x.png'],
      [w.env, '/api/docs/d1/github/img'],
      [w.env, '/api/docs/nope/github/img?path=docs/x.png'],
    ]
    for (const [env, path] of cases) {
      const r = await call(env, path)
      expect([path, r.status, await r.json()]).toEqual([path, 404, NOT_FOUND])
    }
    expect(calls).toHaveLength(0)
  })

  it('공개 셋: 200, 폐기된 링크·묶음 밖·폴더 밖 404', async () => {
    const w = await linked()
    addFolder(w, 'fo1')
    w.db.prepare("UPDATE docs SET folder_id = 'fo1' WHERE id = 'd1'").run()
    addDoc(w, 'd2', 'start')
    addDoc(w, 'd3')
    addLink(w, 'd3', 'docs/c.md')
    shareLink(w, DOC_TOKEN, 'doc', 'd1')
    shareLink(w, SET_TOKEN, 'doc', 'd2')
    w.db.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)').run(SET_TOKEN, 'd1')
    shareLink(w, FOLDER_TOKEN, 'folder', 'fo1')
    shareLink(w, REVOKED_TOKEN, 'doc', 'd3', true)
    const calls = fakeGithub(pngAnswer)
    for (const path of [`/pub/docs/${DOC_TOKEN}/gh`, `/pub/docs/${SET_TOKEN}/docs/d1/gh`, `/pub/folders/${FOLDER_TOKEN}/docs/d1/gh`]) {
      const r = await call(w.anon, `${path}?path=${X}`)
      expect([path, r.status, r.headers.get('Content-Type')]).toEqual([path, 200, 'image/png'])
    }
    expect(calls).toHaveLength(3)
    for (const path of [`/pub/docs/${REVOKED_TOKEN}/gh`, `/pub/docs/${SET_TOKEN}/docs/d3/gh`, `/pub/folders/${FOLDER_TOKEN}/docs/d3/gh`, `/pub/docs/${DOC_TOKEN.slice(1)}/gh`, `/pub/docs/${DOC_TOKEN}/docs/d3/gh`]) {
      const r = await call(w.anon, `${path}?path=${X}`)
      expect([path, r.status, await r.json()]).toEqual([path, 404, NOT_FOUND])
    }
    expect(calls).toHaveLength(3)
  })
})

describe('F-3017 A8 프록시 대응', () => {
  it('대응 있음 → R2 바이트, GitHub 0, 꺼져도 200. R2 에 없으면 GitHub 로', async () => {
    const w = await linked({ enabled: false })
    addAttachment(w, w.id, ATT_A)
    addMapping(w, 'd1', X, ATT_A)
    const stored = pngBytes(5, 5)
    storeObject(w, w.id, ATT_A, 'png', stored)
    const calls = fakeGithub(pngAnswer)
    const res = await call(w.viewer, `/api/docs/d1/github/img?path=${X}`)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(stored)
    expect(headersOf(res)).toEqual(PROXY_HEADERS)
    expect(calls).toHaveLength(0)

    w.db.prepare('UPDATE github_settings SET enabled = 1').run()
    w.bucket.store.clear()
    const fromGithub = await call(w.viewer, `/api/docs/d1/github/img?path=${X}`)
    expect(fromGithub.status).toBe(200)
    expect(new Uint8Array(await fromGithub.arrayBuffer())).toEqual(pngBytes())
    expect(calls).toHaveLength(1)
  })

  it('대응 첨부가 금고·남의 것이면 쓰지 않는다', async () => {
    const w = await linked({ enabled: false })
    addAttachment(w, w.id, ATT_A, 'png', { e2ee: 1 })
    addMapping(w, 'd1', X, ATT_A)
    storeObject(w, w.id, ATT_A)
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
  })
})

describe('F-3017 A9 프록시 GitHub 형식', () => {
  it('PNG → image/png 와 일곱 줄 머리 그대로 (GitHub Content-Type: text/html 이어도)', async () => {
    const w = await linked()
    fakeGithub(pngAnswer)
    const res = await call(w.env, `/api/docs/d1/github/img?path=${X}`)
    expect(res.status).toBe(200)
    expect(headersOf(res)).toEqual(PROXY_HEADERS)
  })

  it('.svg + <svg → image/svg+xml, .svg 인데 <html> 404, .png 이름의 HTML 404', async () => {
    const w = await linked()
    fakeGithub((url) =>
      url.pathname.endsWith('.svg') ? new Response(svgBytes('<?xml version="1.0"?>\n<SVG xmlns="http://www.w3.org/2000/svg"></SVG>')) : new Response(svgBytes('<html><body>hi</body></html>')),
    )
    const svg = await call(w.env, '/api/docs/d1/github/img?path=assets/logo.svg')
    expect(svg.status).toBe(200)
    expect(headersOf(svg)).toEqual({ ...PROXY_HEADERS, 'content-type': 'image/svg+xml' })
    const html = await call(w.env, `/api/docs/d1/github/img?path=${X}`)
    expect([html.status, await html.json()]).toEqual([404, NOT_FOUND])

    fakeGithub(() => new Response(svgBytes('<html><svg></svg></html>'.padStart(5000, ' '))))
    expect((await call(w.env, '/api/docs/d1/github/img?path=assets/logo.svg')).status).toBe(404)
    fakeGithub(() => new Response(svgBytes('<html>nothing</html>')))
    expect((await call(w.env, '/api/docs/d1/github/img?path=assets/logo.svg')).status).toBe(404)
  })

  it('10,000,001 B → 404 (머리·읽기 둘 다), GitHub 404·한도 → 404', async () => {
    const w = await linked()
    fakeGithub(() => new Response(pngBytes(), { headers: { 'Content-Length': '10000001' } }))
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    const chunk = new Uint8Array(1_000_000)
    chunk.set(pngBytes())
    fakeGithub(() => {
      let sent = 0
      return new Response(new ReadableStream({ pull(c) { if (sent++ < 11) c.enqueue(chunk); else c.close() } }))
    })
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    for (const answer of [() => new Response('{}', { status: 404 }), limited]) {
      fakeGithub(answer)
      const res = await call(w.env, `/api/docs/d1/github/img?path=${X}`)
      expect([res.status, await res.json()]).toEqual([404, NOT_FOUND])
    }
  })
})

describe('F-3017 A10 캐시', () => {
  const KEY = `${LOCAL}/api/github-cache/77/${BRANCH}/docs/img/x.png`

  it('같은 그림 두 번 → GitHub 1번, 같은 머리, 넣은 사본은 public', async () => {
    const w = await linked()
    const cache = fakeCaches()
    const calls = fakeGithub(pngAnswer)
    const first = await call(w.viewer, `/api/docs/d1/github/img?path=${X}`)
    await Promise.all(pending)
    const second = await call(w.env, `/api/docs/d1/github/img?path=${X}`)
    expect(calls).toHaveLength(1)
    expect(headersOf(first)).toEqual(PROXY_HEADERS)
    expect(headersOf(second)).toEqual(PROXY_HEADERS)
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(pngBytes())
    expect([...cache.store.keys()]).toEqual([KEY])
    expect(cache.store.get(KEY)!.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('꺼짐·주인 계정 없음·refresh 만료 → 캐시에 있어도 404 이고 match 0. 연결 해제 → 404', async () => {
    const w = await linked()
    const cache = fakeCaches()
    const calls = fakeGithub(pngAnswer)
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(200)
    await Promise.all(pending)
    expect(cache.store.size).toBe(1)
    const matched = cache.log.match

    w.db.prepare('UPDATE github_settings SET enabled = 0').run()
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    w.db.prepare('UPDATE github_settings SET enabled = 1').run()
    w.db.prepare('UPDATE github_accounts SET refresh_expires_at = 0').run()
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    w.db.prepare('DELETE FROM github_accounts').run()
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    expect(cache.log.match).toBe(matched)

    const fresh = await linked()
    fakeCaches()
    fakeGithub(pngAnswer)
    expect((await call(fresh.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(200)
    await send(fresh.env, 'DELETE', '/api/docs/d1/github')
    expect((await call(fresh.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    expect(calls).toHaveLength(1)
  })

  it('404 응답은 캐시에 넣지 않는다', async () => {
    const w = await linked()
    const cache = fakeCaches()
    fakeGithub(() => new Response('{}', { status: 404 }))
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    fakeGithub(() => new Response(svgBytes('<html></html>')))
    expect((await call(w.env, `/api/docs/d1/github/img?path=${X}`)).status).toBe(404)
    await Promise.all(pending)
    expect(cache.log.put).toBe(0)
  })
})

describe('F-3017 A11 첨부 열람 — 대응+본문 경로', () => {
  async function setup() {
    const w = await linked()
    addFolder(w, 'fo1')
    w.db.prepare("UPDATE docs SET folder_id = 'fo1' WHERE id = 'd1'").run()
    addDoc(w, 'd2', 'start')
    shareLink(w, DOC_TOKEN, 'doc', 'd1')
    shareLink(w, SET_TOKEN, 'doc', 'd2')
    w.db.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)').run(SET_TOKEN, 'd1')
    shareLink(w, FOLDER_TOKEN, 'folder', 'fo1')
    addAttachment(w, w.id, ATT_A)
    storeObject(w, w.id, ATT_A)
    addMapping(w, 'd1', X, ATT_A)
    return w
  }
  const routes = [
    `/pub/docs/${DOC_TOKEN}/attachments/${ATT_A}.png`,
    `/pub/docs/${SET_TOKEN}/docs/d1/attachments/${ATT_A}.png`,
    `/pub/folders/${FOLDER_TOKEN}/docs/d1/attachments/${ATT_A}.png`,
  ]

  it('원문에 attachments/ 가 없어도 보기 권한 ?doc= 와 공개 셋 200, 경로가 본문에서 빠지면 넷 다 404', async () => {
    const w = await setup()
    expect(BODY).not.toContain('attachments/')
    expect((await call(w.viewer, `/api/attachments/${ATT_A}.png?doc=d1`)).status).toBe(200)
    for (const path of routes) expect([path, (await call(w.anon, path)).status]).toEqual([path, 200])

    setBody(w, 'd1', '# t\n![top](x.png)\n')
    expect((await call(w.viewer, `/api/attachments/${ATT_A}.png?doc=d1`)).status).toBe(404)
    for (const path of routes) expect([path, (await call(w.anon, path)).status]).toEqual([path, 404])
  })

  it('연결이 없으면 대응 행이 남아 있어도 404', async () => {
    const w = await setup()
    w.db.prepare('DELETE FROM github_links').run()
    expect((await call(w.viewer, `/api/attachments/${ATT_A}.png?doc=d1`)).status).toBe(404)
    expect((await call(w.anon, routes[0])).status).toBe(404)
  })
})

describe('F-3017 A12 첨부 지우기', () => {
  it('대응+본문 경로로 쓰는 첨부 → 409 in_use, 본문에 없는 대응만 → 204 이고 대응 행도 사라짐', async () => {
    const w = await linked()
    addAttachment(w, w.id, ATT_A)
    storeObject(w, w.id, ATT_A)
    addMapping(w, 'd1', X, ATT_A)
    const res = await send(w.env, 'DELETE', `/api/attachments/${ATT_A}.png`)
    expect([res.status, await res.json()]).toEqual([409, { error: 'in_use' }])

    setBody(w, 'd1', 'no images')
    expect((await send(w.env, 'DELETE', `/api/attachments/${ATT_A}.png`)).status).toBe(204)
    expect(mappings(w.db)).toEqual([])
  })
})

describe('F-3017 A13 정리 (C)(D)', () => {
  it('본문 경로 대응 남음, 빠진 대응은 행부터·다음 실행에 첨부, 23시간 행 남음, 연결 없는 행 삭제', async () => {
    const w = await linked()
    const now = Date.now()
    const old = now - 25 * HOUR
    addAttachment(w, w.id, ATT_A, 'png', { created_at: old })
    addAttachment(w, w.id, ATT_B, 'png', { created_at: old })
    addAttachment(w, w.id, 'cccccccccccccccc', 'png', { created_at: old })
    addAttachment(w, w.id, 'dddddddddddddddd', 'png', { created_at: old })
    addMapping(w, 'd1', X, ATT_A, 'png', old)
    addMapping(w, 'd1', 'docs/img/gone.png', ATT_B, 'png', old)
    addMapping(w, 'd1', 'docs/img/recent.png', 'cccccccccccccccc', 'png', now - 23 * HOUR)
    addDoc(w, 'd2')
    addMapping(w, 'd2', X, 'dddddddddddddddd', 'png', now)
    for (const id of [ATT_A, ATT_B, 'cccccccccccccccc', 'dddddddddddddddd']) storeObject(w, w.id, id)
    const env = { DB: asD1(w.db), BUCKET: w.bucket } as unknown as Env
    const ids = () => (w.db.prepare('SELECT id FROM attachments ORDER BY id').all() as { id: string }[]).map((r) => r.id)
    const paths = () => mappings(w.db).map((r) => `${r.doc_id}:${r.path}`)

    await cleanupServerAttachments(env, now)
    expect(ids()).toEqual([ATT_A, ATT_B, 'cccccccccccccccc', 'dddddddddddddddd'])
    expect(paths()).toEqual(['d1:docs/img/recent.png', `d1:${X}`])

    await cleanupServerAttachments(env, now)
    expect(ids()).toEqual([ATT_A, 'cccccccccccccccc'])
    expect(paths()).toEqual(['d1:docs/img/recent.png', `d1:${X}`])
  })

  it('문서 250개 쪽 나누기 — 마지막 쪽 문서의 대응도 지킨다', async () => {
    const w = await world()
    const now = Date.now()
    const old = now - 25 * HOUR
    for (let i = 0; i < 250; i++) {
      const docId = `p${String(i).padStart(3, '0')}`
      const att = i.toString(16).padStart(16, '0')
      addDoc(w, docId, `![](${i}.png)`)
      addLink(w, docId, `p/${i}.md`)
      addAttachment(w, w.id, att, 'png', { created_at: old })
      addMapping(w, docId, `p/${i}.png`, att, 'png', old)
    }
    setBody(w, 'p249', 'gone')
    const env = { DB: asD1(w.db), BUCKET: w.bucket } as unknown as Env
    await cleanupServerAttachments(env, now)
    expect((w.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n).toBe(250)
    expect((w.db.prepare('SELECT COUNT(*) AS n FROM github_images').get() as { n: number }).n).toBe(249)
    await cleanupServerAttachments(env, now)
    expect((w.db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n).toBe(249)
  })
})

describe('F-3017 A14 공개 응답 github 칸', () => {
  it('연결 있는 문서 셋 모두 { path, images }(본문 경로만), 없는 문서는 칸 없음, repo·branch 없음', async () => {
    const w = await linked()
    addFolder(w, 'fo1')
    w.db.prepare("UPDATE docs SET folder_id = 'fo1' WHERE id = 'd1'").run()
    addDoc(w, 'd2', 'start', 'fo1')
    shareLink(w, DOC_TOKEN, 'doc', 'd1')
    shareLink(w, SET_TOKEN, 'doc', 'd2')
    w.db.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?, ?)').run(SET_TOKEN, 'd1')
    shareLink(w, FOLDER_TOKEN, 'folder', 'fo1')
    addMapping(w, 'd1', X, ATT_A)
    addMapping(w, 'd1', 'docs/img/gone.png', ATT_B, 'webp')
    const expected = { path: 'docs/a.md', images: { [X]: `${ATT_A}.png` } }
    for (const path of [`/pub/docs/${DOC_TOKEN}`, `/pub/docs/${SET_TOKEN}/docs/d1`, `/pub/folders/${FOLDER_TOKEN}/docs/d1`]) {
      const res = await call(w.anon, path)
      const text = await res.text()
      expect([path, res.status, (JSON.parse(text) as { github?: unknown }).github]).toEqual([path, 200, expected])
      for (const secret of ['zz-owner', 'zz-repo', BRANCH, 'zz-login']) expect(text).not.toContain(secret)
    }
    for (const path of [`/pub/docs/${SET_TOKEN}`, `/pub/docs/${SET_TOKEN}/docs/d2`, `/pub/folders/${FOLDER_TOKEN}/docs/d2`]) {
      const res = await call(w.anon, path)
      const body = (await res.json()) as object
      expect([path, res.status, 'github' in body]).toEqual([path, 200, false])
    }
  })
})
