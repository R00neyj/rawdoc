// F-3015 A4·A5·A9~A11 문서 연결 라우트 다섯 — worker/index.ts 를 통째로, 가짜 GitHub fetch (specs/features/F-3015.md 3.3)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const LOCAL = 'http://localhost:8790'
const ME = 'me@example.com'
const FRIEND = 'friend@example.com'
const STRANGER = 'stranger@example.com'
const KEY_TEXT = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const VARS = { GITHUB_APP_CLIENT_ID: 'Iv1.cid', GITHUB_APP_SLUG: 'test-app', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_TOKEN_KEY: KEY_TEXT }

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', LOCAL)
  return worker.fetch(new Request(`${LOCAL}${path}`, { ...init, headers }), env, ctx)
}

const send = (env: Env, method: string, path: string, body?: unknown) =>
  call(env, path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

async function world(opts: { enabled?: boolean; connected?: boolean; limit?: number | null } = {}) {
  const db = openTestDb()
  if (opts.enabled !== false) db.prepare('UPDATE github_settings SET enabled = 1, monthly_limit = ?').run(opts.limit ?? null)
  const base = { DB: asD1(db), BETTER_AUTH_URL: LOCAL, ...VARS }
  const envOf = (email: string) => ({ ...base, DEV_AUTH_EMAIL: email }) as unknown as Env
  const env = envOf(ME)
  const friend = envOf(FRIEND)
  const stranger = envOf(STRANGER)
  for (const e of [env, friend, stranger]) await call(e, '/api/me')
  const idOf = (email: string) => (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id
  const id = idOf(ME)
  if (opts.connected !== false) {
    const key = (await importTokenKey(KEY_TEXT))!
    db.prepare(
      'INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 1, 1, 1)',
    ).run(id, 'octo', await sealToken(key, id, 'access', 'ghu_access_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), Date.now() + 3_600_000, await sealToken(key, id, 'refresh', 'ghr_refresh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), Date.now() + 86_400_000)
  }
  return { db, env, friend, stranger, id }
}
type World = Awaited<ReturnType<typeof world>>

function addDoc(w: World, docId: string, e2eeKey: string | null = null) {
  w.db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?, ?, 't', 'c', 'lf', 1, 1, 1, ?)").run(docId, w.id, e2eeKey)
}
function grant(w: World, docId: string, email: string, role: 'view' | 'edit') {
  w.db.prepare("INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES ('doc', ?, ?, ?, ?, 1)").run(docId, w.id, email, role)
}
function addLink(w: World, docId: string, over: Record<string, unknown> = {}) {
  const row = { repo_id: 77, repo: 'o/r', branch: 'main', path: 'docs/a.md', remote_sha: SHA, remote_bom: 0, synced_at: 5, created_at: 9, ...over }
  w.db.prepare('INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_sha, remote_bom, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    docId, w.id, row.repo_id, row.repo, row.branch, row.path, row.remote_sha, row.remote_bom, row.synced_at, row.created_at,
  )
}
const links = (db: DatabaseSync) => db.prepare('SELECT * FROM github_links ORDER BY doc_id').all() as Record<string, unknown>[]
const images = (db: DatabaseSync, docId: string) => db.prepare('SELECT path, attachment_id, ext FROM github_images WHERE doc_id = ?').all(docId) as { path: string; attachment_id: string; ext: string }[]
const usage = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT count FROM github_usage WHERE user_id = ? AND month = ?').get(id, githubMonth(Date.now())) as { count: number } | undefined)?.count ?? 0

type Answer = (url: URL) => Response | undefined
function fakeGithub(answer: Answer) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push(req.url)
      return answer(new URL(req.url)) ?? new Response('unexpected', { status: 599 })
    }),
  )
  return calls
}

const repoBody = (over: Record<string, unknown> = {}) => ({ id: 77, full_name: 'Octo/Repo', archived: false, permissions: { push: true }, ...over })
const fileBody = (over: Record<string, unknown> = {}) => ({ type: 'file', sha: SHA2, size: 5, encoding: 'base64', content: 'aGVsbG8=\n', ...over })
const PUT_BODY = { repo: 'octo/repo', branch: 'main', path: 'docs/a.md', sha: SHA, bom: true }
const githubRepoOk: Answer = (url) => (url.pathname.startsWith('/repos/') ? Response.json(repoBody()) : undefined)

describe('F-3015 A4·A5 꺼짐·연결 행 없음', () => {
  it('꺼짐 → 다섯 라우트 503 github_disabled, GitHub 호출 0', async () => {
    const w = await world({ enabled: false })
    addDoc(w, 'd1')
    const calls = fakeGithub(() => undefined)
    const cases: [string, string, unknown?][] = [
      ['GET', '/api/docs/d1/github'],
      ['PUT', '/api/docs/d1/github', PUT_BODY],
      ['DELETE', '/api/docs/d1/github'],
      ['POST', '/api/docs/d1/github/pull', {}],
      ['POST', '/api/docs/d1/github/synced', { sha: SHA, bom: false }],
    ]
    for (const [method, path, body] of cases) {
      const res = await send(w.env, method, path, body)
      expect([method, path, res.status, await res.json()]).toEqual([method, path, 503, { error: 'github_disabled' }])
    }
    expect(calls).toHaveLength(0)
  })

  it('연결 행 없음 → PUT·pull 은 409 github_reconnect, GET·DELETE·synced 는 D1 만', async () => {
    const w = await world({ connected: false })
    addDoc(w, 'd1')
    addLink(w, 'd1')
    const calls = fakeGithub(() => undefined)
    for (const [method, path, body] of [['PUT', '/api/docs/d1/github', PUT_BODY], ['POST', '/api/docs/d1/github/pull', {}]] as const) {
      const res = await send(w.env, method, path, body)
      expect([path, res.status, await res.json()]).toEqual([path, 409, { error: 'github_reconnect' }])
    }
    expect((await send(w.env, 'GET', '/api/docs/d1/github')).status).toBe(200)
    expect((await send(w.env, 'POST', '/api/docs/d1/github/synced', { sha: SHA2, bom: false })).status).toBe(204)
    expect((await send(w.env, 'DELETE', '/api/docs/d1/github')).status).toBe(204)
    expect(calls).toHaveLength(0)
  })
})

describe('F-3015 A9 PUT', () => {
  it('GitHub id·full_name 으로 저장, sha 있음 → synced_at 있음, null → null', async () => {
    const w = await world()
    addDoc(w, 'd1')
    const calls = fakeGithub(githubRepoOk)
    const res = await send(w.env, 'PUT', '/api/docs/d1/github', PUT_BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      repo: 'Octo/Repo',
      branch: 'main',
      path: 'docs/a.md',
      remoteSha: SHA,
      remoteBom: true,
      syncedAt: expect.any(Number),
      htmlUrl: 'https://github.com/Octo/Repo/blob/main/docs/a.md',
      images: {},
    })
    expect(calls).toEqual(['https://api.github.com/repos/octo/repo'])
    expect(links(w.db)[0]).toMatchObject({ doc_id: 'd1', owner_id: w.id, repo_id: 77, repo: 'Octo/Repo', remote_bom: 1 })
    expect(usage(w.db, w.id)).toBe(0)
    expect((w.db.prepare('SELECT write_count FROM users WHERE id = ?').get(w.id) as { write_count: number }).write_count).toBeGreaterThan(0)

    addDoc(w, 'd2')
    const none = await send(w.env, 'PUT', '/api/docs/d2/github', { ...PUT_BODY, path: 'docs/b.md', sha: null, bom: false })
    expect(await none.json()).toMatchObject({ remoteSha: null, syncedAt: null, remoteBom: false })
  })

  it('push false·archived → 403 github_forbidden, 행 없음', async () => {
    const w = await world()
    addDoc(w, 'd1')
    for (const body of [repoBody({ permissions: { push: false } }), repoBody({ archived: true })]) {
      fakeGithub(() => Response.json(body))
      const res = await send(w.env, 'PUT', '/api/docs/d1/github', PUT_BODY)
      expect([res.status, await res.json()]).toEqual([403, { error: 'github_forbidden' }])
    }
    expect(links(w.db)).toHaveLength(0)
  })

  it('금고 문서 → 409 e2ee, GitHub 호출 0', async () => {
    const w = await world()
    addDoc(w, 'v1', 'A'.repeat(55) + '=')
    const calls = fakeGithub(githubRepoOk)
    const res = await send(w.env, 'PUT', '/api/docs/v1/github', PUT_BODY)
    expect([res.status, await res.json()]).toEqual([409, { error: 'e2ee' }])
    expect(calls).toHaveLength(0)
    expect(links(w.db)).toHaveLength(0)
  })

  it('다른 문서가 같은 대상 → 409 github_target_taken', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addDoc(w, 'd2')
    fakeGithub(githubRepoOk)
    expect((await send(w.env, 'PUT', '/api/docs/d1/github', PUT_BODY)).status).toBe(200)
    const res = await send(w.env, 'PUT', '/api/docs/d2/github', PUT_BODY)
    expect([res.status, await res.json()]).toEqual([409, { error: 'github_target_taken' }])
    expect(links(w.db)).toHaveLength(1)
  })

  it('같은 문서 다른 경로로 다시 → 행 하나·created_at 유지·images 비움, 같은 대상 → images 남음', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { repo_id: 77, path: 'docs/a.md', created_at: 9 })
    w.db.prepare("INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES ('d1', 'docs/x.png', ?, '0123456789abcdef', 'png', ?, 1)").run(w.id, SHA)
    fakeGithub(githubRepoOk)

    const same = await send(w.env, 'PUT', '/api/docs/d1/github', PUT_BODY)
    expect(same.status).toBe(200)
    expect(images(w.db, 'd1')).toHaveLength(1)
    expect(((await same.json()) as { images: Record<string, string> }).images).toEqual({ 'docs/x.png': '0123456789abcdef.png' })

    const moved = await send(w.env, 'PUT', '/api/docs/d1/github', { ...PUT_BODY, path: 'docs/other.md' })
    expect(moved.status).toBe(200)
    expect(links(w.db)).toHaveLength(1)
    expect(links(w.db)[0]).toMatchObject({ path: 'docs/other.md', created_at: 9 })
    expect(images(w.db, 'd1')).toHaveLength(0)
  })

  it('편집자 403, 남 404, 잘못된 몸통 400', async () => {
    const w = await world()
    addDoc(w, 'd1')
    grant(w, 'd1', FRIEND, 'edit')
    const calls = fakeGithub(githubRepoOk)
    expect((await send(w.friend, 'PUT', '/api/docs/d1/github', PUT_BODY)).status).toBe(403)
    expect((await send(w.stranger, 'PUT', '/api/docs/d1/github', PUT_BODY)).status).toBe(404)
    for (const body of [{ ...PUT_BODY, path: 'a.txt' }, { ...PUT_BODY, sha: 'abc' }, { ...PUT_BODY, bom: 'no' }, { ...PUT_BODY, branch: 'a..b' }, { ...PUT_BODY, repo: 'x' }]) {
      expect((await send(w.env, 'PUT', '/api/docs/d1/github', body)).status).toBe(400)
    }
    expect(calls).toHaveLength(0)
    expect(links(w.db)).toHaveLength(0)
  })
})

describe('F-3015 A10 GET·DELETE', () => {
  it('GET: 주인·편집자 200, 보기 403, 연결 없음 404', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addDoc(w, 'd2')
    addLink(w, 'd1', { repo: 'o/r', path: '문서/a b.md' })
    w.db.prepare("INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES ('d1', 'x.png', ?, '0123456789abcdef', 'png', ?, 1)").run(w.id, SHA)
    grant(w, 'd1', FRIEND, 'edit')
    grant(w, 'd1', STRANGER, 'view')
    const calls = fakeGithub(() => undefined)
    for (const env of [w.env, w.friend]) {
      const res = await send(env, 'GET', '/api/docs/d1/github')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        repo: 'o/r',
        branch: 'main',
        path: '문서/a b.md',
        remoteSha: SHA,
        remoteBom: false,
        syncedAt: 5,
        htmlUrl: 'https://github.com/o/r/blob/main/%EB%AC%B8%EC%84%9C/a%20b.md',
        images: { 'x.png': '0123456789abcdef.png' },
      })
    }
    expect((await send(w.stranger, 'GET', '/api/docs/d1/github')).status).toBe(403)
    expect((await send(w.env, 'GET', '/api/docs/d2/github')).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('DELETE: 연결·대응 행 삭제 204, 다시 204, 편집자 403', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1')
    w.db.prepare("INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at) VALUES ('d1', 'x.png', ?, '0123456789abcdef', 'png', ?, 1)").run(w.id, SHA)
    grant(w, 'd1', FRIEND, 'edit')
    expect((await send(w.friend, 'DELETE', '/api/docs/d1/github')).status).toBe(403)
    expect(links(w.db)).toHaveLength(1)
    expect((await send(w.env, 'DELETE', '/api/docs/d1/github')).status).toBe(204)
    expect(links(w.db)).toHaveLength(0)
    expect(images(w.db, 'd1')).toHaveLength(0)
    expect((await send(w.env, 'DELETE', '/api/docs/d1/github')).status).toBe(204)
  })
})

describe('F-3015 A11 pull·synced', () => {
  it('pull: 연결의 repo·branch·path 로 부름, 응답 모양, 횟수 +1, remote_sha 그대로', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addLink(w, 'd1', { repo: 'o/r', branch: 'dev', path: 'docs/a.md' })
    const calls = fakeGithub(() => Response.json(fileBody()))
    const res = await send(w.env, 'POST', '/api/docs/d1/github/pull', { repo: 'x/y', branch: 'zzz', path: 'q.md' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sha: SHA2, size: 5, content: 'aGVsbG8=\n' })
    expect(calls).toEqual(['https://api.github.com/repos/o/r/contents/docs/a.md?ref=dev'])
    expect(usage(w.db, w.id)).toBe(1)
    expect(links(w.db)[0]).toMatchObject({ remote_sha: SHA })
  })

  it('pull: 연결 없음 404, 편집자 403', async () => {
    const w = await world()
    addDoc(w, 'd1')
    grant(w, 'd1', FRIEND, 'edit')
    const calls = fakeGithub(() => Response.json(fileBody()))
    expect((await send(w.env, 'POST', '/api/docs/d1/github/pull', {})).status).toBe(404)
    expect((await send(w.friend, 'POST', '/api/docs/d1/github/pull', {})).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('synced: remote_sha·remote_bom·synced_at 갱신, 39자 sha 400, 연결 없음 404', async () => {
    const w = await world()
    addDoc(w, 'd1')
    addDoc(w, 'd2')
    addLink(w, 'd1', { synced_at: null, remote_sha: null })
    expect((await send(w.env, 'POST', '/api/docs/d1/github/synced', { sha: SHA2, bom: true })).status).toBe(204)
    expect(links(w.db)[0]).toMatchObject({ remote_sha: SHA2, remote_bom: 1, synced_at: expect.any(Number) })
    expect((await send(w.env, 'POST', '/api/docs/d1/github/synced', { sha: 'b'.repeat(39), bom: true })).status).toBe(400)
    expect((await send(w.env, 'POST', '/api/docs/d2/github/synced', { sha: SHA2, bom: true })).status).toBe(404)
  })
})
