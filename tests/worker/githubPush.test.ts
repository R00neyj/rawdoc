// F-3016 A1~A13 push-plan·blobs·push — worker/index.ts 를 통째로, 가짜 GitHub fetch (specs/features/F-3016.md 7장)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { importTokenKey, sealToken } from '../../worker/githubCrypto'
import { githubMonth } from '../../src/lib/githubContract'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
let worker: Worker

beforeAll(async () => {
  vi.doUnmock('../../worker/auth')
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
})

// workerd 의 FixedLengthStream 대역 — 길이가 다르면 스트림을 깬다
class FakeFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expected: number) {
    let seen = 0
    super({
      transform(chunk, ctl) {
        seen += chunk.byteLength
        if (seen > expected) ctl.error(new TypeError('too long'))
        else ctl.enqueue(chunk)
      },
      flush(ctl) {
        if (seen !== expected) ctl.error(new TypeError('too short'))
      },
    })
  }
}

beforeEach(() => {
  vi.stubGlobal('FixedLengthStream', FakeFixedLengthStream)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const ME = 'me@example.com'
const FRIEND = 'friend@example.com'
const STRANGER = 'stranger@example.com'
const KEY_TEXT = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
const ACCESS = 'ghu_access_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const OBJECT_ACCEPT = 'application/vnd.github.object+json'
const SHA = 'a'.repeat(40) // 연결의 remote_sha
const SHA2 = 'b'.repeat(40)
const H = 'c'.repeat(40) // 머리 커밋
const T = 'd'.repeat(40) // 머리 트리
const T2 = 'e'.repeat(40)
const C = 'f'.repeat(40)
const MD_SHA = '1'.repeat(40)
const IMG_SHA = '2'.repeat(40)
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const VARS = { GITHUB_APP_CLIENT_ID: 'Iv1.cid', GITHUB_APP_SLUG: 'test-app', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_TOKEN_KEY: KEY_TEXT }

const att = (hex: string, ext: string) => `${hex.padStart(16, '0')}.${ext}`
const A = att('a', 'webp')
const B = att('b', 'png')

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }), env, ctx)
}

const post = (env: Env, path: string, body?: unknown) =>
  call(env, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const plan = (env: Env, attachments: unknown, doc = 'd1') => post(env, `/api/docs/${doc}/github/push-plan`, { attachments })
const push = (env: Env, body: unknown, doc = 'd1') => post(env, `/api/docs/${doc}/github/push`, body)

const BLOB_BYTES = new TextEncoder().encode('{"encoding":"base64","content":"77u/IyDsoJzrqqkNCg=="}')
function blobs(env: Env, bytes: Uint8Array = BLOB_BYTES, length: string | null = String(bytes.length), doc = 'd1') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (length !== null) headers['Content-Length'] = length
  return call(env, `/api/docs/${doc}/github/blobs`, { method: 'POST', headers, body: bytes })
}

async function world(opts: { enabled?: boolean; limit?: number | null } = {}) {
  const db = openTestDb()
  if (opts.enabled !== false) db.prepare('UPDATE github_settings SET enabled = 1, monthly_limit = ?').run(opts.limit ?? null)
  const base = { DB: asD1(db), BETTER_AUTH_URL: LOCAL, ...VARS }
  const envOf = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  const env = envOf(ME)
  const friend = envOf(FRIEND)
  const stranger = envOf(STRANGER)
  const anon = { ...base, BETTER_AUTH_SECRET: 's'.repeat(40) } as unknown as Env
  for (const e of [env, friend, stranger]) await call(e, '/api/me')
  const id = (db.prepare('SELECT id FROM users WHERE email = ?').get(ME) as { id: string }).id
  const key = (await importTokenKey(KEY_TEXT))!
  db.prepare(
    'INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 1, 1, 1)',
  ).run(id, 'octo', await sealToken(key, id, 'access', ACCESS), Date.now() + 3_600_000, await sealToken(key, id, 'refresh', 'ghr_refresh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), Date.now() + 86_400_000)
  return { db, env, friend, stranger, anon, id }
}
type World = Awaited<ReturnType<typeof world>>

function addDoc(w: World, docId: string, e2eeKey: string | null = null) {
  w.db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?, ?, 't', 'c', 'lf', 1, 1, 1, ?)").run(docId, w.id, e2eeKey)
}
function grant(w: World, docId: string, email: string, role: 'view' | 'edit') {
  w.db.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc', ?, ?, ?, ?, 1)").run(docId, w.id, email, role)
}
function addLink(w: World, docId: string, over: Record<string, unknown> = {}) {
  const row = { repo_id: 77, repo: 'o/r', branch: 'main', path: 'docs/a.md', remote_sha: SHA, synced_at: 5, ...over }
  w.db.prepare('INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_sha, remote_bom, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 9)').run(
    docId, w.id, row.repo_id, row.repo, row.branch, row.path, row.remote_sha, row.synced_at,
  )
}
function addAttachment(w: World, name: string, e2ee = 0) {
  const [id, ext] = name.split('.')
  w.db.prepare('INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) VALUES (?, ?, ?, ?, 10, 1, 1, 1, ?)').run(w.id, id, ext, `image/${ext}`, e2ee)
}
const link = (db: DatabaseSync, docId = 'd1') => db.prepare('SELECT * FROM github_links WHERE doc_id = ?').get(docId) as Record<string, unknown>
const usage = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT count FROM github_usage WHERE user_id = ? AND month = ?').get(id, githubMonth(Date.now())) as { count: number } | undefined)?.count ?? 0
const tokenRev = (w: World) => (w.db.prepare('SELECT token_rev FROM github_accounts WHERE user_id = ?').get(w.id) as { token_rev: number }).token_rev

type Call = { method: string; url: string; headers: Headers; text: string | null; bytes: Uint8Array | null; stream: boolean }
type Answer = (c: Call, u: URL) => Response | undefined

function fakeGithub(answer: Answer) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const body = init.body
      const stream = body instanceof ReadableStream
      const bytes = stream ? new Uint8Array(await new Response(body).arrayBuffer()) : null
      const c: Call = { method: init.method ?? 'GET', url: String(input), headers: new Headers(init.headers), text: typeof body === 'string' ? body : null, bytes, stream }
      calls.push(c)
      return answer(c, new URL(c.url)) ?? new Response('unexpected', { status: 599 })
    }),
  )
  return calls
}
const api = (calls: Call[]) => calls.filter((c) => c.url.startsWith('https://api.github.com/'))
const lines = (calls: Call[]) => api(calls).map((c) => `${c.method} ${c.url.slice('https://api.github.com'.length)}`)
const json = (c: Call) => JSON.parse(c.text ?? 'null') as Record<string, unknown>

type Remote = {
  branch?: string
  head?: string
  heads?: string[] // 브랜치 GET 을 차례로 — 다시 볼 때의 머리
  branchStatus?: number
  refStatus?: number // 브랜치 404 뒤 git/ref GET
  md?: { type?: string; sha?: string } | null // null = 404
  folder?: string[] | null | 'file'
  treeStatus?: number
  patchStatus?: number
  onPatch?: () => void
}

function remote(r: Remote = {}): Answer {
  const heads = [...(r.heads ?? [])]
  return (c, u) => {
    const p = decodeURIComponent(u.pathname)
    if (c.method === 'GET' && p.includes('/branches/')) {
      if (r.branchStatus) return Response.json({ message: 'Branch not found' }, { status: r.branchStatus })
      const head = heads.shift() ?? r.head ?? H
      return Response.json({ name: r.branch ?? p.split('/branches/')[1], commit: { sha: head, commit: { tree: { sha: T } } }, protected: false })
    }
    if (c.method === 'GET' && p.includes('/git/ref/heads/')) return Response.json({ message: 'x' }, { status: r.refStatus ?? 404 })
    if (c.method === 'GET' && p.endsWith('/attachments')) {
      if (r.folder === null) return Response.json({ message: 'Not Found' }, { status: 404 })
      if (r.folder === 'file') return Response.json({ type: 'file', name: 'attachments', sha: SHA2, size: 1 })
      const names = r.folder ?? []
      return Response.json({ type: 'dir', name: 'attachments', sha: SHA2, entries: [...names.map((name) => ({ name, type: 'file', sha: SHA2 })), { name: 'sub', type: 'dir', sha: SHA2 }] })
    }
    if (c.method === 'GET' && p.includes('/contents/')) {
      if (r.md === null) return Response.json({ message: 'Not Found' }, { status: 404 })
      const md = { type: 'file', sha: SHA, ...r.md }
      return Response.json(md.type === 'dir' ? { type: 'dir', sha: SHA2, entries: [] } : { ...md, size: 5, content: '', encoding: 'none' })
    }
    if (c.method === 'POST' && p.endsWith('/git/trees')) return r.treeStatus ? Response.json({ message: 'x' }, { status: r.treeStatus }) : Response.json({ sha: T2 }, { status: 201 })
    if (c.method === 'POST' && p.endsWith('/git/commits')) return Response.json({ sha: C, html_url: `https://github.com/o/r/commit/${C}` }, { status: 201 })
    if (c.method === 'PATCH' && p.includes('/git/refs/heads/')) {
      r.onPatch?.()
      const status = r.patchStatus ?? 200
      return Response.json(status === 200 ? { ref: 'refs/heads/x', object: { sha: C } } : { message: 'x' }, { status })
    }
    return undefined
  }
}

const PUSH = { message: '  제목\n\n본문  ', mdSha: MD_SHA, images: [{ name: B, sha: IMG_SHA }] }

describe('F-3016 A1·A2 꺼짐·권한', () => {
  it('꺼짐 → 셋 다 503 github_disabled, 비로그인 401, GitHub 호출 0', async () => {
    const w = await world({ enabled: false })
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(remote())
    for (const res of [await plan(w.env, [A]), await blobs(w.env), await push(w.env, PUSH)]) {
      expect([res.status, await res.json()]).toEqual([503, { error: 'github_disabled' }])
    }
    for (const res of [await plan(w.anon, [A]), await blobs(w.anon), await push(w.anon, PUSH)]) expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('편집자 403, 남 404, 연결 없음 404, 금고 문서 409 e2ee — 셋 다, GitHub 호출 0', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    addDoc(w, 'd2')
    addDoc(w, 'v1', 'A'.repeat(55) + '=')
    addLink(w, 'v1', { path: 'docs/v.md' })
    grant(w, 'd1', FRIEND, 'edit')
    const calls = fakeGithub(remote())
    const routes = [(e: Env, d: string) => plan(e, [A], d), (e: Env, d: string) => blobs(e, BLOB_BYTES, String(BLOB_BYTES.length), d), (e: Env, d: string) => push(e, PUSH, d)]
    for (const route of routes) {
      const editor = await route(w.friend, 'd1')
      expect([editor.status, await editor.json()]).toEqual([403, { error: 'forbidden' }])
      expect((await route(w.stranger, 'd1')).status).toBe(404)
      const none = await route(w.env, 'd2')
      expect([none.status, await none.json()]).toEqual([404, { error: 'not_found' }])
      const vault = await route(w.env, 'v1')
      expect([vault.status, await vault.json()]).toEqual([409, { error: 'e2ee' }])
    }
    expect(calls).toHaveLength(0)
  })
})

describe('F-3016 A3~A5 push-plan', () => {
  it('정상 호출 정확히 3번 — 브랜치 → .md Contents ?ref=H (object) → attachments 폴더 ?ref=H', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    addAttachment(w, B)
    const calls = fakeGithub(remote({ folder: [] }))
    const res = await plan(w.env, [B])
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ missing: [B], skipped: [] })
    expect(lines(calls)).toEqual([
      'GET /repos/o/r/branches/main',
      `GET /repos/o/r/contents/docs/a.md?ref=${H}`,
      `GET /repos/o/r/contents/docs/attachments?ref=${H}`,
    ])
    expect(api(calls)[1].headers.get('Accept')).toBe(OBJECT_ACCEPT)
    expect(api(calls)[2].headers.get('Accept')).toBe(OBJECT_ACCEPT)
    expect(api(calls)[0].headers.get('Authorization')).toBe(`Bearer ${ACCESS}`)
  })

  it('맨 위 .md 면 폴더 주소가 contents/attachments', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { path: 'a.md' })
    addAttachment(w, B)
    const calls = fakeGithub(remote({ folder: [] }))
    expect((await plan(w.env, [B])).status).toBe(200)
    expect(lines(calls)[2]).toBe(`GET /repos/o/r/contents/attachments?ref=${H}`)
  })

  it('첨부: 행·금고·확장자·원격 이름으로 missing·skipped, 입력 순서·중복 하나로', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const [c, d, e] = [att('c', 'gif'), att('d', 'jpg'), att('e', 'png')]
    addAttachment(w, A)
    addAttachment(w, B)
    addAttachment(w, c, 1)
    addAttachment(w, att('e', 'jpg'))
    fakeGithub(remote({ folder: [A] }))
    const res = await plan(w.env, [A, B, B, c, d, e])
    expect(await res.json()).toEqual({ missing: [B], skipped: [c, d, e] })

    fakeGithub(remote({ folder: null }))
    expect(await (await plan(w.env, [B, A, d])).json()).toEqual({ missing: [B, A], skipped: [d] })

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeGithub(remote({ folder: 'file' }))
    const notDir = await plan(w.env, [B])
    expect([notDir.status, await notDir.json()]).toEqual([502, { error: 'github_unavailable' }])
    expect(errors).toHaveBeenCalledWith('github_unexpected', 'push-plan', 'attachments_not_dir')
  })

  it('이름 꼴 틀림·1,001개·배열 아님 → 400 attachments, 호출 0', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(remote())
    const many = Array.from({ length: 1001 }, (_, i) => att(i.toString(16), 'png'))
    for (const bad of [['attachments/' + B], [att('a', 'svg')], ['0123456789ABCDEF.png'], many, 'x', undefined]) {
      const res = await plan(w.env, bad)
      expect([res.status, await res.json()]).toEqual([400, { error: 'invalid', field: 'attachments' }])
    }
    expect(calls).toHaveLength(0)
  })
})

describe('F-3016 A4 원격 확인 (push-plan·push 같음)', () => {
  const cases: { name: string; linkSha: string | null; r: Remote; status: number; body: unknown }[] = [
    { name: 'X·원격 Y', linkSha: SHA, r: { md: { sha: SHA2 } }, status: 409, body: { error: 'github_conflict', remoteSha: SHA2 } },
    { name: 'X·원격 없음', linkSha: SHA, r: { md: null }, status: 409, body: { error: 'github_conflict', remoteSha: null } },
    { name: 'null·원격 Y', linkSha: null, r: { md: { sha: SHA2 } }, status: 409, body: { error: 'github_conflict', remoteSha: SHA2 } },
    { name: '경로가 폴더', linkSha: SHA, r: { md: { type: 'dir' } }, status: 409, body: { error: 'github_conflict', remoteSha: null } },
    { name: '빈 저장소', linkSha: SHA, r: { branchStatus: 404, refStatus: 409 }, status: 409, body: { error: 'github_empty_repo' } },
    { name: '브랜치 없음', linkSha: SHA, r: { branchStatus: 404, refStatus: 404 }, status: 404, body: { error: 'github_not_found' } },
    { name: '이름 바뀐 브랜치', linkSha: SHA, r: { branch: 'master' }, status: 404, body: { error: 'github_not_found' } },
  ]
  for (const k of cases) {
    it(k.name, async () => {
      const w = await world()
      addDoc(w, 'd1')
      addLink(w, 'd1', { remote_sha: k.linkSha })
      addAttachment(w, B)
      for (const send of [() => plan(w.env, [B]), () => push(w.env, PUSH)]) {
        const calls = fakeGithub(remote(k.r))
        const res = await send()
        expect([res.status, await res.json()]).toEqual([k.status, k.body])
        expect(lines(calls).filter((l) => !l.startsWith('GET '))).toEqual([])
      }
      expect(link(w.db).remote_sha).toBe(k.linkSha)
      expect(usage(w.db, w.id)).toBe(0)
    })
  }

  it('null·원격 없음 → 통과', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { remote_sha: null, synced_at: null })
    addAttachment(w, B)
    fakeGithub(remote({ md: null, folder: [] }))
    expect(await (await plan(w.env, [B])).json()).toEqual({ missing: [B], skipped: [] })
    const res = await push(w.env, PUSH)
    expect(res.status).toBe(200)
    expect(link(w.db)).toMatchObject({ remote_sha: MD_SHA, synced_at: expect.any(Number) })
  })
})

describe('F-3016 A6 한도', () => {
  it('3/3 → push-plan·push 429 github_quota, 호출 0. push-plan·blobs 성공은 횟수 그대로', async () => {
    const w = await world({ limit: 3 })
    addDoc(w, 'd1')
    addLink(w, 'd1')
    addAttachment(w, B)
    const calls = fakeGithub(remote({ folder: [] }))
    expect((await plan(w.env, [B])).status).toBe(200)
    fakeGithub((c, u) => (u.pathname.endsWith('/git/blobs') ? Response.json({ sha: IMG_SHA }, { status: 201 }) : undefined))
    expect((await blobs(w.env)).status).toBe(200)
    expect(usage(w.db, w.id)).toBe(0)

    w.db.prepare('INSERT INTO github_usage (user_id, month, count) VALUES (?, ?, 3)').run(w.id, githubMonth(Date.now()))
    const none = fakeGithub(remote())
    for (const res of [await plan(w.env, [B]), await push(w.env, PUSH)]) {
      expect(res.status).toBe(429)
      expect(await res.json()).toMatchObject({ error: 'github_quota', limit: 3 })
    }
    expect(none).toHaveLength(0)
    expect(calls).toHaveLength(3)
  })
})

describe('F-3016 A7·A8 blobs', () => {
  it('몸통 바이트를 스트림 그대로 git/blobs 로, Authorization·Content-Type → 200 { sha }', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub((c, u) => (c.method === 'POST' && u.pathname === '/repos/o/r/git/blobs' ? Response.json({ sha: IMG_SHA, url: 'x' }, { status: 201 }) : undefined))
    const res = await blobs(w.env)
    expect([res.status, await res.json()]).toEqual([200, { sha: IMG_SHA }])
    expect(lines(calls)).toEqual(['POST /repos/o/r/git/blobs'])
    const sent = api(calls)[0]
    expect(sent.stream).toBe(true)
    expect(sent.bytes).toEqual(BLOB_BYTES)
    expect(sent.headers.get('Authorization')).toBe(`Bearer ${ACCESS}`)
    expect(sent.headers.get('Content-Type')).toBe('application/json')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('Content-Length 없음·숫자 아님 411, 7,000,001 413, 둘 다 호출 0', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(() => Response.json({ sha: IMG_SHA }, { status: 201 }))
    for (const length of [null, 'abc', '-1']) {
      const res = await blobs(w.env, BLOB_BYTES, length)
      expect([res.status, await res.json()]).toEqual([411, { error: 'length_required' }])
    }
    const big = await blobs(w.env, BLOB_BYTES, '7000001')
    expect([big.status, await big.json()]).toEqual([413, { error: 'too_large', limit: 7_000_000 }])
    expect((await blobs(w.env, BLOB_BYTES, String(BLOB_BYTES.length))).status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('길이를 속이면 스트림이 깨져 502', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeGithub(() => Response.json({ sha: IMG_SHA }, { status: 201 }))
    const res = await blobs(w.env, BLOB_BYTES, String(BLOB_BYTES.length + 10))
    expect([res.status, await res.json()]).toEqual([502, { error: 'github_unavailable' }])
  })

  it('422 → 400 content, 409 → github_empty_repo, 403 한도 → 503, 모양 틀린 201 → 502', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: [Response, number, unknown][] = [
      [Response.json({ message: 'x' }, { status: 422 }), 400, { error: 'invalid', field: 'content' }],
      [Response.json({ message: 'x' }, { status: 400 }), 400, { error: 'invalid', field: 'content' }],
      [Response.json({ message: 'Git Repository is empty.' }, { status: 409 }), 409, { error: 'github_empty_repo' }],
      [new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) } }), 503, { error: 'github_rate_limited', retryAfter: expect.any(Number) }],
      [Response.json({ sha: 'XYZ' }, { status: 201 }), 502, { error: 'github_unavailable' }],
      [Response.json({ message: 'x' }, { status: 418 }), 502, { error: 'github_unavailable' }],
    ]
    for (const [answer, status, body] of cases) {
      fakeGithub(() => answer)
      const res = await blobs(w.env)
      expect([res.status, await res.json()]).toEqual([status, body])
    }
  })

  it('401 → blob POST 1번뿐 + 갱신 1번(token_rev +1) + 502', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub((c) => {
      if (c.url === TOKEN_URL) return Response.json({ access_token: 'ghu_new', expires_in: 28800, refresh_token: 'ghr_new', refresh_token_expires_in: 15897600 })
      return Response.json({ message: 'Bad credentials' }, { status: 401 })
    })
    const res = await blobs(w.env)
    expect([res.status, await res.json()]).toEqual([502, { error: 'github_unavailable' }])
    expect(lines(calls)).toEqual(['POST /repos/o/r/git/blobs'])
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
    expect(tokenRev(w)).toBe(2)
  })
})

describe('F-3016 A9~A13 push', () => {
  it('성공: 브랜치 → Contents → tree → commit → ref PATCH 정확히 5번, D1·횟수', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(remote())
    const res = await push(w.env, PUSH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sha: MD_SHA, commitSha: C, commitUrl: `https://github.com/o/r/commit/${C}` })
    expect(lines(calls)).toEqual([
      'GET /repos/o/r/branches/main',
      `GET /repos/o/r/contents/docs/a.md?ref=${H}`,
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/main',
    ])
    const [, , tree, commit, ref] = api(calls)
    expect(json(tree)).toEqual({
      base_tree: T,
      tree: [
        { path: 'docs/a.md', mode: '100644', type: 'blob', sha: MD_SHA },
        { path: `docs/attachments/${B}`, mode: '100644', type: 'blob', sha: IMG_SHA },
      ],
    })
    expect(json(commit)).toEqual({ message: PUSH.message, tree: T2, parents: [H] })
    expect(json(ref)).toEqual({ sha: C, force: false })
    expect(link(w.db)).toMatchObject({ remote_sha: MD_SHA, synced_at: expect.any(Number) })
    expect(link(w.db).synced_at as number).toBeGreaterThan(5)
    expect(usage(w.db, w.id)).toBe(1)
  })

  it('슬래시 든 브랜치·한글 경로가 인코딩된다, 맨 위 .md 의 그림은 attachments/', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { branch: 'feat/한', path: '문서/a b.md' })
    const calls = fakeGithub(remote())
    expect((await push(w.env, PUSH)).status).toBe(200)
    expect(lines(calls)).toEqual([
      'GET /repos/o/r/branches/feat/%ED%95%9C',
      `GET /repos/o/r/contents/%EB%AC%B8%EC%84%9C/a%20b.md?ref=${H}`,
      'POST /repos/o/r/git/trees',
      'POST /repos/o/r/git/commits',
      'PATCH /repos/o/r/git/refs/heads/feat/%ED%95%9C',
    ])
    expect((json(api(calls)[2]).tree as { path: string }[]).map((e) => e.path)).toEqual(['문서/a b.md', `문서/attachments/${B}`])

    addDoc(w, 'd2')
    addLink(w, 'd2', { path: 'top.md' })
    const top = fakeGithub(remote())
    expect((await push(w.env, PUSH, 'd2')).status).toBe(200)
    expect((json(api(top)[2]).tree as { path: string }[]).map((e) => e.path)).toEqual(['top.md', `attachments/${B}`])
  })

  it('바뀐 것 없음 → 200 commitSha null, 호출 2번, 횟수 그대로', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { remote_sha: MD_SHA })
    const calls = fakeGithub(remote({ md: { sha: MD_SHA } }))
    const res = await push(w.env, { ...PUSH, images: [] })
    expect([res.status, await res.json()]).toEqual([200, { sha: MD_SHA, commitSha: null, commitUrl: null }])
    expect(api(calls)).toHaveLength(2)
    expect(usage(w.db, w.id)).toBe(0)
    expect(link(w.db).synced_at).toBe(5)
  })

  it('ref 422 + 머리 다름 → 409(remoteSha 없음), 같음 → 403 github_forbidden. D1·횟수 그대로', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const moved = fakeGithub(remote({ patchStatus: 422, heads: [H, SHA2] }))
    const raced = await push(w.env, PUSH)
    expect([raced.status, await raced.json()]).toEqual([409, { error: 'github_conflict' }])
    expect(lines(moved).slice(4)).toEqual(['PATCH /repos/o/r/git/refs/heads/main', 'GET /repos/o/r/branches/main'])

    fakeGithub(remote({ patchStatus: 422, heads: [H, H] }))
    const guarded = await push(w.env, PUSH)
    expect([guarded.status, await guarded.json()]).toEqual([403, { error: 'github_forbidden' }])

    fakeGithub(remote({ patchStatus: 409, heads: [H, SHA2] }))
    expect((await push(w.env, PUSH)).status).toBe(409)

    fakeGithub(remote({ patchStatus: 403 }))
    const denied = await push(w.env, PUSH)
    expect([denied.status, await denied.json()]).toEqual([403, { error: 'github_forbidden' }])

    expect(link(w.db)).toMatchObject({ remote_sha: SHA, synced_at: 5 })
    expect(usage(w.db, w.id)).toBe(0)
  })

  it('ref PATCH 응답 전에 연결이 다른 경로로 바뀜 → 푸시 200, 새 연결의 remote_sha 그대로', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    fakeGithub(remote({ onPatch: () => w.db.prepare("UPDATE github_links SET path = 'docs/other.md', remote_sha = ?, synced_at = 7 WHERE doc_id = 'd1'").run(SHA2) }))
    const res = await push(w.env, PUSH)
    expect(res.status).toBe(200)
    expect(link(w.db)).toMatchObject({ path: 'docs/other.md', remote_sha: SHA2, synced_at: 7 })
  })

  it('몸통 검사 → 400 + field, 호출 0', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(remote())
    const img = (i: number) => ({ name: att(i.toString(16), 'png'), sha: IMG_SHA })
    const cases: [unknown, string][] = [
      [{ ...PUSH, message: '  ' }, 'message'],
      [{ ...PUSH, message: 'x'.repeat(1001) }, 'message'],
      [{ ...PUSH, message: 3 }, 'message'],
      [{ ...PUSH, mdSha: '1'.repeat(39) }, 'mdSha'],
      [{ ...PUSH, mdSha: 'A'.repeat(40) }, 'mdSha'],
      [{ ...PUSH, images: Array.from({ length: 51 }, (_, i) => img(i)) }, 'images'],
      [{ ...PUSH, images: [img(1), img(1)] }, 'images'],
      [{ ...PUSH, images: [{ name: 'attachments/' + B, sha: IMG_SHA }] }, 'images'],
      [{ ...PUSH, images: [{ name: B, sha: 'x' }] }, 'images'],
      [{ ...PUSH, images: 'x' }, 'images'],
    ]
    for (const [body, field] of cases) {
      const res = await push(w.env, body)
      expect([field, res.status, await res.json()]).toEqual([field, 400, { error: 'invalid', field }])
    }
    expect(calls).toHaveLength(0)
    expect((await push(w.env, { ...PUSH, message: 'x'.repeat(1000), images: Array.from({ length: 50 }, (_, i) => img(i)) })).status).toBe(200)
  })

  it('tree 422 → 400 sha, commit·ref 호출 0', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(remote({ treeStatus: 422 }))
    const res = await push(w.env, PUSH)
    expect([res.status, await res.json()]).toEqual([400, { error: 'invalid', field: 'sha' }])
    expect(lines(calls)).toHaveLength(3)
    expect(usage(w.db, w.id)).toBe(0)
  })
})
