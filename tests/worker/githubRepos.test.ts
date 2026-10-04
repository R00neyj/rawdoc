// F-3015 A4~A8 저장소 고르기·파일 라우트 넷 — worker/index.ts 를 통째로, 가짜 GitHub fetch (specs/features/F-3015.md 3.2)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asAuthDb, asD1, openTestDb } from '../../worker/testD1'
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
const KEY_TEXT = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))
const ACCESS = 'ghu_access_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const REFRESH = 'ghr_refresh_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SHA = 'a'.repeat(40)
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
const VARS = { GITHUB_APP_CLIENT_ID: 'Iv1.cid', GITHUB_APP_SLUG: 'test-app', GITHUB_APP_CLIENT_SECRET: 'csecret', GITHUB_TOKEN_KEY: KEY_TEXT }

function call(env: Env, path: string, init: RequestInit = {}, base = LOCAL): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin') && init.method && init.method !== 'GET') headers.set('Origin', base)
  return worker.fetch(new Request(`${base}${path}`, { ...init, headers }), env, ctx)
}

const post = (env: Env, path: string, body: unknown) =>
  call(env, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function world(opts: { enabled?: boolean; connected?: boolean; limit?: number | null } = {}) {
  const db = openTestDb()
  if (opts.enabled !== false) db.prepare('UPDATE github_settings SET enabled = 1, monthly_limit = ?').run(opts.limit ?? null)
  const env = { DB: asD1(db), BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: ME, ...VARS } as unknown as Env
  await call(env, '/api/me')
  const id = (db.prepare('SELECT id FROM users WHERE email = ?').get(ME) as { id: string }).id
  if (opts.connected !== false) {
    const key = (await importTokenKey(KEY_TEXT))!
    db.prepare(
      'INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 1, 1, 1)',
    ).run(id, 'octo', await sealToken(key, id, 'access', ACCESS), Date.now() + 3_600_000, await sealToken(key, id, 'refresh', REFRESH), Date.now() + 86_400_000)
  }
  return { db, env, id }
}

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

const nextHeaders = (url: string) => ({ Link: `<${url}>; rel="next", <${url}>; rel="last"` })
const repoItem = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  full_name: `o/r${String(id).padStart(4, '0')}`,
  default_branch: 'main',
  private: false,
  archived: false,
  permissions: { push: true },
  ...over,
})
const usage = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT count FROM github_usage WHERE user_id = ? AND month = ?').get(id, githubMonth(Date.now())) as { count: number } | undefined)?.count ?? 0

type RouteCase = [string, string, unknown?]
const ROUTES: RouteCase[] = [
  ['GET', '/api/github/repos'],
  ['GET', '/api/github/branches?repo=o/r'],
  ['GET', '/api/github/tree?repo=o/r&branch=main'],
  ['POST', '/api/github/file', { repo: 'o/r', branch: 'main', path: 'a.md' }],
]
const hit = (env: Env, [method, path, body]: RouteCase) => (method === 'GET' ? call(env, path) : post(env, path, body))

describe('F-3015 A4·A5 꺼짐·비로그인·연결 없음', () => {
  it('설정 enabled = 0 → 네 라우트 503 github_disabled, GitHub 호출 0', async () => {
    const { env } = await world({ enabled: false })
    const calls = fakeGithub(() => undefined)
    for (const route of ROUTES) {
      const res = await hit(env, route)
      expect([route[1], res.status]).toEqual([route[1], 503])
      expect(await res.json()).toEqual({ error: 'github_disabled' })
    }
    expect(calls).toHaveLength(0)
  })

  it('비밀 값 없음 → 같다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env } = await world()
    const calls = fakeGithub(() => undefined)
    for (const route of ROUTES) {
      expect((await hit({ ...env, GITHUB_TOKEN_KEY: '' } as unknown as Env, route)).status).toBe(503)
    }
    expect(calls).toHaveLength(0)
  })

  it('비로그인 401', async () => {
    const env = { DB: asAuthDb(openTestDb()), BETTER_AUTH_URL: 'https://rawdoc.app', BETTER_AUTH_SECRET: 's'.repeat(40), DEV_AUTH_EMAIL: '', ...VARS } as unknown as Env
    expect((await call(env, '/api/github/repos', {}, 'https://rawdoc.app')).status).toBe(401)
  })

  it('연결 행 없음 → 네 라우트 409 github_reconnect', async () => {
    const { env } = await world({ connected: false })
    fakeGithub(() => undefined)
    for (const route of ROUTES) {
      const res = await hit(env, route)
      expect([route[1], res.status, await res.json()]).toEqual([route[1], 409, { error: 'github_reconnect' }])
    }
  })
})

describe('F-3015 A6 repos', () => {
  it('설치 둘 합치기·정렬·중복 제거·canWrite', async () => {
    const { env } = await world()
    fakeGithub((url) => {
      if (url.pathname === '/user/installations') return Response.json({ installations: [{ id: 1 }, { id: 2 }] })
      if (url.pathname === '/user/installations/1/repositories') {
        if (url.searchParams.get('page') === '2') return Response.json({ repositories: [repoItem(3, { full_name: 'o/Alpha' })] })
        return new Response(JSON.stringify({ repositories: [repoItem(2), repoItem(1, { permissions: { push: false } })] }), {
          headers: { 'Content-Type': 'application/json', ...nextHeaders('https://api.github.com/user/installations/1/repositories?per_page=100&page=2') },
        })
      }
      if (url.pathname === '/user/installations/2/repositories') {
        return Response.json({ repositories: [repoItem(2), repoItem(4, { archived: true, private: true })] })
      }
      return undefined
    })
    const res = await call(env, '/api/github/repos')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      repos: [
        { id: 3, fullName: 'o/Alpha', defaultBranch: 'main', private: false, canWrite: true },
        { id: 1, fullName: 'o/r0001', defaultBranch: 'main', private: false, canWrite: false },
        { id: 2, fullName: 'o/r0002', defaultBranch: 'main', private: false, canWrite: true },
        { id: 4, fullName: 'o/r0004', defaultBranch: 'main', private: true, canWrite: false },
      ],
      truncated: false,
    })
  })

  it('350개 → 300 + truncated', async () => {
    const { env } = await world()
    const calls = fakeGithub((url) => {
      if (url.pathname === '/user/installations') return Response.json({ installations: [{ id: 1 }] })
      const page = Number(url.searchParams.get('page') ?? 1)
      const items = Array.from({ length: page < 4 ? 100 : 50 }, (_, i) => repoItem((page - 1) * 100 + i + 1))
      return new Response(JSON.stringify({ repositories: items }), {
        headers: page < 4 ? nextHeaders(`https://api.github.com/user/installations/1/repositories?per_page=100&page=${page + 1}`) : {},
      })
    })
    const body = (await (await call(env, '/api/github/repos')).json()) as { repos: unknown[]; truncated: boolean }
    expect(body.repos).toHaveLength(300)
    expect(body.truncated).toBe(true)
    expect(calls.filter((c) => c.includes('/repositories'))).toHaveLength(3)
  })

  it('설치 15개 → 목록 호출 10번에서 멈춤, 전체 fetch ≤ 50', async () => {
    const { env } = await world()
    const calls = fakeGithub((url) => {
      if (url.pathname === '/user/installations') return Response.json({ installations: Array.from({ length: 15 }, (_, i) => ({ id: i + 1 })) })
      const id = Number(url.pathname.split('/')[3])
      return Response.json({ repositories: [repoItem(id)] })
    })
    const body = (await (await call(env, '/api/github/repos')).json()) as { repos: unknown[]; truncated: boolean }
    expect(body.truncated).toBe(true)
    expect(body.repos).toHaveLength(10)
    expect(calls.filter((c) => c.includes('/repositories'))).toHaveLength(10)
    expect(calls.length).toBeLessThanOrEqual(50)
  })

  it('설치 0 → 빈 목록', async () => {
    const { env } = await world()
    fakeGithub(() => Response.json({ installations: [] }))
    expect(await (await call(env, '/api/github/repos')).json()).toEqual({ repos: [], truncated: false })
  })

  it('모양이 틀린 2xx → 502 github_unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env } = await world()
    fakeGithub(() => Response.json({ nope: 1 }))
    const res = await call(env, '/api/github/repos')
    expect([res.status, await res.json()]).toEqual([502, { error: 'github_unavailable' }])
  })
})

describe('F-3015 A7 branches·tree', () => {
  it('branches: 이름 배열, rel=next 면 truncated', async () => {
    const { env } = await world()
    const calls = fakeGithub(() => new Response(JSON.stringify([{ name: 'main' }, { name: 'dev' }]), { headers: nextHeaders('https://api.github.com/x?page=2') }))
    expect(await (await call(env, '/api/github/branches?repo=o/r')).json()).toEqual({ branches: ['main', 'dev'], truncated: true })
    expect(calls).toEqual(['https://api.github.com/repos/o/r/branches?per_page=100'])
  })

  it('tree: .md·.MARKDOWN·폴더만, 폴더 먼저, 빈 dir 은 /contents?ref=', async () => {
    const { env } = await world()
    const calls = fakeGithub(() =>
      Response.json([
        { name: 'b.md', type: 'file', size: 5 },
        { name: 'z.txt', type: 'file', size: 1 },
        { name: 'A.MARKDOWN', type: 'file', size: 2 },
        { name: 'sub', type: 'dir', size: 0 },
        { name: 'link.md', type: 'symlink', size: 0 },
        { name: 'mod', type: 'submodule', size: 0 },
        { name: 'Aaa', type: 'dir', size: 0 },
      ]),
    )
    const body = await (await call(env, '/api/github/tree?repo=o/r&branch=main')).json()
    expect(body).toEqual({
      entries: [
        { name: 'Aaa', type: 'dir', size: 0 },
        { name: 'sub', type: 'dir', size: 0 },
        { name: 'A.MARKDOWN', type: 'file', size: 2 },
        { name: 'b.md', type: 'file', size: 5 },
      ],
      truncated: false,
    })
    expect(calls).toEqual(['https://api.github.com/repos/o/r/contents?ref=main'])
  })

  it('tree: 경로가 파일이면 404, 1,000개면 truncated, 한글·공백·#·? 인코딩', async () => {
    const { env } = await world()
    fakeGithub(() => Response.json({ type: 'file' }))
    const res = await call(env, '/api/github/tree?repo=o/r&branch=main&dir=a')
    expect([res.status, await res.json()]).toEqual([404, { error: 'github_not_found' }])

    const calls = fakeGithub(() => Response.json(Array.from({ length: 1000 }, (_, i) => ({ name: `d${i}`, type: 'dir', size: 0 }))))
    const big = (await (await call(env, `/api/github/tree?repo=o/r&branch=${encodeURIComponent('feat/x#1')}&dir=${encodeURIComponent('문서/a b#c?')}`)).json()) as { truncated: boolean }
    expect(big.truncated).toBe(true)
    expect(calls[0]).toBe('https://api.github.com/repos/o/r/contents/%EB%AC%B8%EC%84%9C/a%20b%23c%3F?ref=feat%2Fx%231')
  })

  it('잘못된 repo·branch·dir 400, GitHub 호출 0', async () => {
    const { env } = await world()
    const calls = fakeGithub(() => undefined)
    for (const path of [
      '/api/github/branches?repo=o/..',
      '/api/github/branches',
      '/api/github/tree?repo=o/r&branch=a..b',
      '/api/github/tree?repo=o/r',
      '/api/github/tree?repo=o/r&branch=main&dir=../x',
    ]) {
      const res = await call(env, path)
      expect([path, res.status]).toEqual([path, 400])
      expect(((await res.json()) as { error: string }).error).toBe('invalid')
    }
    expect(calls).toHaveLength(0)
  })
})

const fileBody = (over: Record<string, unknown> = {}) => ({
  type: 'file',
  sha: SHA,
  size: 11,
  encoding: 'base64',
  content: 'aGVsbG8g\nd29ybGQ=\n',
  download_url: 'https://raw.githubusercontent.com/o/r/main/a.md?token=SECRET',
  ...over,
})
const FILE_REQ = { repo: 'o/r', branch: 'main', path: 'docs/a.md' }

describe('F-3015 A8 file', () => {
  it('성공: sha·size·content 그대로, linkedDocId, download_url 없음, 횟수 +1', async () => {
    const { db, env, id } = await world()
    db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1', ?, 't', 'c', 'lf', 1, 1, 1)").run(id)
    const calls = fakeGithub(() => Response.json(fileBody()))
    const res = await post(env, '/api/github/file', FILE_REQ)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('download_url')
    expect(text).not.toContain('SECRET')
    expect(JSON.parse(text)).toEqual({ sha: SHA, size: 11, content: 'aGVsbG8g\nd29ybGQ=\n', linkedDocId: null })
    expect(calls).toEqual(['https://api.github.com/repos/o/r/contents/docs/a.md?ref=main'])
    expect(usage(db, id)).toBe(1)

    db.prepare("INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_bom, created_at) VALUES ('d1', ?, 5, 'o/r', 'main', 'docs/a.md', 0, 1)").run(id)
    const again = (await (await post(env, '/api/github/file', FILE_REQ)).json()) as { linkedDocId: string }
    expect(again.linkedDocId).toBe('d1')
    expect(usage(db, id)).toBe(2)
  })

  it('size 1,000,004·encoding none → 413 too_large, 횟수 그대로', async () => {
    const { db, env, id } = await world()
    for (const over of [{ size: 1_000_004 }, { encoding: 'none', content: '' }]) {
      fakeGithub(() => Response.json(fileBody(over)))
      const res = await post(env, '/api/github/file', FILE_REQ)
      expect([res.status, await res.json()]).toEqual([413, { error: 'too_large', limit: 1_000_000 }])
    }
    expect(usage(db, id)).toBe(0)
  })

  it('디렉터리·404·한도 503·모양 틀림 → 그대로이고 횟수 그대로', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, env, id } = await world()
    const cases: [() => Response, number, string][] = [
      [() => Response.json([]), 404, 'github_not_found'],
      [() => new Response('{}', { status: 404 }), 404, 'github_not_found'],
      [() => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 503, 'github_rate_limited'],
      [() => Response.json(fileBody({ sha: 'xyz' })), 502, 'github_unavailable'],
      [() => new Response('{}', { status: 422 }), 502, 'github_unavailable'],
    ]
    for (const [answer, status, code] of cases) {
      fakeGithub(answer)
      const res = await post(env, '/api/github/file', FILE_REQ)
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([status, code])
    }
    expect(usage(db, id)).toBe(0)
  })

  it('한도 3/3 → 429 github_quota, GitHub 호출 0', async () => {
    const { db, env, id } = await world({ limit: 3 })
    db.prepare('INSERT INTO github_usage (user_id, month, count) VALUES (?, ?, 3)').run(id, githubMonth(Date.now()))
    const calls = fakeGithub(() => Response.json(fileBody()))
    const res = await post(env, '/api/github/file', FILE_REQ)
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toBe('github_quota')
    expect(calls).toHaveLength(0)
  })

  it('잘못된 몸통 400 (path 확장자·repo·branch), 호출 0', async () => {
    const { env } = await world()
    const calls = fakeGithub(() => undefined)
    for (const body of [{ ...FILE_REQ, path: 'a.txt' }, { ...FILE_REQ, repo: 'x' }, { ...FILE_REQ, branch: 'a b' }]) {
      expect((await post(env, '/api/github/file', body)).status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })
})
