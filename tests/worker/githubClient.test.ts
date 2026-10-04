// F-3014 A10~A14 GitHub fetch 도우미 — 갱신·경합·오류 대응 (specs/features/F-3014.md 4장)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import brand from '../../brand.config'
import { asD1, openTestDb } from '../../worker/testD1'
import { importTokenKey, openToken, sealToken } from '../../worker/githubCrypto'
import { loadGithubConfig, type GithubConfig } from '../../worker/githubSettings'
import { githubApiHeaders, githubFailureResponse, githubFetch, isGithubFailure, type GithubFailure } from '../../worker/githubClient'

const NOW = Date.UTC(2026, 9, 4, 12, 0)
const KEY_TEXT = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const OLD_ACCESS = 'ghu_old_access_0000000000000000000000'
const OLD_REFRESH = 'ghr_old_refresh_000000000000000000000000000000000000000000000000000000000000'
const NEW_ACCESS = 'ghu_new_access_1111111111111111111111'
const NEW_REFRESH = 'ghr_new_refresh_11111111111111111111111111111111111111111111111111111111111'

type Call = { method: string; url: string; headers: Headers; body: string }

function fakeGithub(handler: (call: Call, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const call = { method: req.method, url: req.url, headers: req.headers, body: req.method === 'GET' ? '' : await req.text() }
      calls.push(call)
      return handler(call, calls)
    }),
  )
  return calls
}

const refreshCalls = (calls: Call[]) => calls.filter((c) => c.url === TOKEN_URL)
const apiCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith('https://api.github.com/'))

function newPair(): Response {
  return Response.json({
    access_token: NEW_ACCESS,
    expires_in: 28800,
    refresh_token: NEW_REFRESH,
    refresh_token_expires_in: 15897600,
    scope: '',
    token_type: 'bearer',
  })
}

let db: DatabaseSync
let env: Env
let config: GithubConfig
let key: CryptoKey

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  db = openTestDb()
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', 1)").run()
  env = {
    DB: asD1(db),
    BETTER_AUTH_URL: 'http://localhost:8790',
    GITHUB_APP_CLIENT_ID: 'Iv1.cid',
    GITHUB_APP_SLUG: 'test-app',
    GITHUB_APP_CLIENT_SECRET: 'csecret',
    GITHUB_TOKEN_KEY: KEY_TEXT,
  } as unknown as Env
  config = (await loadGithubConfig(env))!
  key = (await importTokenKey(KEY_TEXT))!
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Row = { access_token: string; access_expires_at: number; refresh_token: string; refresh_expires_at: number; token_rev: number }
const row = () => db.prepare('SELECT access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev FROM github_accounts WHERE user_id = ?').get('u1') as Row

async function seed(accessLeftMs: number, opts: { refreshExpiresAt?: number; rev?: number; access?: string } = {}) {
  const access = opts.access ?? (await sealToken(key, 'u1', 'access', OLD_ACCESS))
  const refresh = await sealToken(key, 'u1', 'refresh', OLD_REFRESH)
  db.prepare(
    "INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES ('u1', 42, 'octo', ?, ?, ?, ?, ?, 1, 1)",
  ).run(access, NOW + accessLeftMs, refresh, opts.refreshExpiresAt ?? NOW + 86_400_000 * 30, opts.rev ?? 1)
}

function failure(v: Response | GithubFailure): GithubFailure {
  expect(isGithubFailure(v)).toBe(true)
  return v as GithubFailure
}

describe('F-3014 A10 githubFetch 갱신 판정·머리', () => {
  it('남은 시간 ≥ 5분이면 갱신 0, 머리 Authorization·User-Agent·Accept', async () => {
    await seed(300_000)
    const calls = fakeGithub(() => Response.json({ login: 'octo' }))
    const res = await githubFetch(env, config, 'u1', '/user')
    expect(isGithubFailure(res)).toBe(false)
    expect(((await (res as Response).json()) as { login: string }).login).toBe('octo')
    expect(refreshCalls(calls)).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.github.com/user')
    expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${OLD_ACCESS}`)
    expect(calls[0].headers.get('User-Agent')).toBe(brand.name)
    expect(calls[0].headers.get('Accept')).toBe('application/vnd.github+json')
    expect(row().token_rev).toBe(1)
  })

  it('5분 미만이면 갱신 1번, 행 토큰 바뀜, token_rev +1, 만료 = now + 초×1000', async () => {
    await seed(299_999)
    const before = row()
    const calls = fakeGithub((c) => (c.url === TOKEN_URL ? newPair() : Response.json({ ok: true })))
    const res = await githubFetch(env, config, 'u1', '/user', { method: 'GET' })
    expect(isGithubFailure(res)).toBe(false)
    const refreshes = refreshCalls(calls)
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0].method).toBe('POST')
    expect(refreshes[0].headers.get('Accept')).toBe('application/json')
    const form = new URLSearchParams(refreshes[0].body)
    expect(Object.fromEntries(form)).toEqual({ client_id: 'Iv1.cid', client_secret: 'csecret', grant_type: 'refresh_token', refresh_token: OLD_REFRESH })
    expect(apiCalls(calls)[0].headers.get('Authorization')).toBe(`Bearer ${NEW_ACCESS}`)
    const after = row()
    expect(after.token_rev).toBe(2)
    expect(after.access_token).not.toBe(before.access_token)
    expect(after.access_token.startsWith('v1.')).toBe(true)
    expect(await openToken(key, 'u1', 'access', after.access_token)).toBe(NEW_ACCESS)
    expect(await openToken(key, 'u1', 'refresh', after.refresh_token)).toBe(NEW_REFRESH)
    expect(after.access_expires_at).toBe(NOW + 28_800_000)
    expect(after.refresh_expires_at).toBe(NOW + 15_897_600_000)
  })

  it('행 없음 → 409 github_reconnect, fetch 0', async () => {
    const calls = fakeGithub(() => Response.json({}))
    const f = failure(await githubFetch(env, config, 'u1', '/user'))
    expect(f).toEqual({ code: 'github_reconnect', status: 409 })
    expect(calls).toHaveLength(0)
  })

  it('refresh_expires_at 가 지났으면 409 github_reconnect, 갱신 0', async () => {
    await seed(-1000, { refreshExpiresAt: NOW })
    const calls = fakeGithub(() => newPair())
    expect(failure(await githubFetch(env, config, 'u1', '/user')).code).toBe('github_reconnect')
    expect(calls).toHaveLength(0)
  })
})

describe('F-3017 A2 githubApiHeaders Accept', () => {
  it('받은 Accept 는 지키고, 없으면 application/vnd.github+json', () => {
    expect(githubApiHeaders('t', { Accept: 'application/vnd.github.raw+json' }).get('Accept')).toBe('application/vnd.github.raw+json')
    expect(githubApiHeaders('t').get('Accept')).toBe('application/vnd.github+json')
    expect(githubApiHeaders('t', { 'X-Other': '1' }).get('Accept')).toBe('application/vnd.github+json')
  })

  it('githubFetch 가 Accept 를 GitHub 까지 넘긴다', async () => {
    await seed(300_000)
    const calls = fakeGithub(() => new Response('raw'))
    await githubFetch(env, config, 'u1', '/repos/o/r/contents/a.png', { headers: { Accept: 'application/vnd.github.raw+json' } })
    expect(calls[0].headers.get('Accept')).toBe('application/vnd.github.raw+json')
    expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${OLD_ACCESS}`)
  })
})

describe('F-3014 A11 갱신 경합', () => {
  it('같은 refresh 로 둘이 동시에 → 둘 다 성공, 둘 다 새 access, token_rev r+1, refresh_expires_at ≠ 0', async () => {
    await seed(60_000, { rev: 5 })
    const waiting: ((r: Response) => void)[] = []
    const calls = fakeGithub((c) => {
      if (c.url !== TOKEN_URL) return Response.json({ ok: true })
      return new Promise<Response>((resolve) => {
        waiting.push(resolve)
        if (waiting.length === 2) {
          waiting[0](newPair())
          waiting[1](Response.json({ error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' }))
        }
      })
    })
    const [a, b] = await Promise.all([githubFetch(env, config, 'u1', '/a'), githubFetch(env, config, 'u1', '/b')])
    expect(isGithubFailure(a)).toBe(false)
    expect(isGithubFailure(b)).toBe(false)
    expect(refreshCalls(calls)).toHaveLength(2)
    const api = apiCalls(calls)
    expect(api).toHaveLength(2)
    for (const c of api) expect(c.headers.get('Authorization')).toBe(`Bearer ${NEW_ACCESS}`)
    const after = row()
    expect(after.token_rev).toBe(6)
    expect(after.refresh_expires_at).not.toBe(0)
    expect(await openToken(key, 'u1', 'access', after.access_token)).toBe(NEW_ACCESS)
  })
})

describe('F-3014 A12 다시 연결', () => {
  it('경합 없는 bad_refresh_token → refresh_expires_at = 0, 409 github_reconnect', async () => {
    await seed(0)
    const calls = fakeGithub(() => Response.json({ error: 'bad_refresh_token' }))
    expect(failure(await githubFetch(env, config, 'u1', '/user'))).toEqual({ code: 'github_reconnect', status: 409 })
    expect(row().refresh_expires_at).toBe(0)
    expect(row().token_rev).toBe(1)
    expect(apiCalls(calls)).toHaveLength(0)
  })

  it('저장된 access 가 안 풀리면 같다', async () => {
    await seed(3_600_000, { access: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    const calls = fakeGithub(() => Response.json({}))
    expect(failure(await githubFetch(env, config, 'u1', '/user'))).toEqual({ code: 'github_reconnect', status: 409 })
    expect(row().refresh_expires_at).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

describe('F-3014 A13 401 과 갱신 실패', () => {
  it('API 401 → 갱신 1번 + 재시도 1번(새 토큰)', async () => {
    await seed(3_600_000)
    const calls = fakeGithub((c) => {
      if (c.url === TOKEN_URL) return newPair()
      return c.headers.get('Authorization') === `Bearer ${OLD_ACCESS}` ? new Response('{}', { status: 401 }) : Response.json({ ok: true })
    })
    const res = await githubFetch(env, config, 'u1', '/user')
    expect(isGithubFailure(res)).toBe(false)
    expect((res as Response).status).toBe(200)
    expect(refreshCalls(calls)).toHaveLength(1)
    expect(apiCalls(calls).map((c) => c.headers.get('Authorization'))).toEqual([`Bearer ${OLD_ACCESS}`, `Bearer ${NEW_ACCESS}`])
    expect(row().token_rev).toBe(2)
  })

  it('또 401 → refresh_expires_at = 0, 409 github_reconnect', async () => {
    await seed(3_600_000)
    const calls = fakeGithub((c) => (c.url === TOKEN_URL ? newPair() : new Response('{}', { status: 401 })))
    expect(failure(await githubFetch(env, config, 'u1', '/user'))).toEqual({ code: 'github_reconnect', status: 409 })
    expect(refreshCalls(calls)).toHaveLength(1)
    expect(apiCalls(calls)).toHaveLength(2)
    expect(row().refresh_expires_at).toBe(0)
  })

  it('갱신 끝점 5xx → 502 github_unavailable, 행 그대로', async () => {
    await seed(1000)
    const before = row()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeGithub((c) => (c.url === TOKEN_URL ? new Response('oops', { status: 502 }) : Response.json({})))
    expect(failure(await githubFetch(env, config, 'u1', '/user'))).toEqual({ code: 'github_unavailable', status: 502 })
    expect(row()).toEqual(before)
  })

  it('갱신 끝점의 다른 error → 502 github_unavailable, 행 그대로', async () => {
    await seed(1000)
    const before = row()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeGithub(() => Response.json({ error: 'incorrect_client_credentials' }))
    expect(failure(await githubFetch(env, config, 'u1', '/user')).code).toBe('github_unavailable')
    expect(row()).toEqual(before)
    expect(error).toHaveBeenCalledWith('github_refresh_failed', 'incorrect_client_credentials')
  })
})

describe('F-3014 A14 오류 대응', () => {
  async function one(answer: () => Response | Promise<Response>) {
    await seed(3_600_000)
    fakeGithub(answer)
    return githubFetch(env, config, 'u1', '/repos/o/r')
  }

  it('403 + x-ratelimit-remaining 0 + x-ratelimit-reset → 503 github_rate_limited, retryAfter = reset - now', async () => {
    const reset = String(Math.floor(NOW / 1000) + 120)
    const f = failure(await one(() => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } })))
    expect(f).toEqual({ code: 'github_rate_limited', status: 503, retryAfter: 120 })
    const res = githubFailureResponse(f)
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('120')
    expect(await res.json()).toEqual({ error: 'github_rate_limited', retryAfter: 120 })
  })

  it('429 + retry-after 30 → 30, 머리 없는 429 → 60, 지난 reset → 1', async () => {
    expect(failure(await one(() => new Response('', { status: 429, headers: { 'retry-after': '30' } }))).retryAfter).toBe(30)
    db.prepare('DELETE FROM github_accounts').run()
    expect(failure(await one(() => new Response('', { status: 429 }))).retryAfter).toBe(60)
    db.prepare('DELETE FROM github_accounts').run()
    const past = String(Math.floor(NOW / 1000) - 5)
    expect(failure(await one(() => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': past } }))).retryAfter).toBe(1)
    db.prepare('DELETE FROM github_accounts').run()
    expect(failure(await one(() => new Response('', { status: 403, headers: { 'retry-after': '7' } })))).toEqual({ code: 'github_rate_limited', status: 503, retryAfter: 7 })
  })

  it('403 → github_forbidden, 404 → github_not_found, 500 → github_unavailable', async () => {
    expect(failure(await one(() => new Response('{}', { status: 403 })))).toEqual({ code: 'github_forbidden', status: 403 })
    db.prepare('DELETE FROM github_accounts').run()
    expect(failure(await one(() => new Response('{}', { status: 404 })))).toEqual({ code: 'github_not_found', status: 404 })
    db.prepare('DELETE FROM github_accounts').run()
    expect(failure(await one(() => new Response('{}', { status: 500 })))).toEqual({ code: 'github_unavailable', status: 502 })
  })

  it('422·409·304 → Response 그대로', async () => {
    for (const status of [422, 409, 304]) {
      db.prepare('DELETE FROM github_accounts').run()
      const res = await one(() => new Response(status === 304 ? null : '{"message":"x"}', { status }))
      expect(isGithubFailure(res)).toBe(false)
      expect((res as Response).status).toBe(status)
    }
  })

  it('fetch 예외 → github_unavailable, 응답 몸통·console 인자에 토큰 글자 없음', async () => {
    const logged: unknown[][] = []
    for (const level of ['error', 'warn', 'log', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args)
      })
    }
    await seed(1000)
    fakeGithub((c) => {
      if (c.url === TOKEN_URL) return newPair()
      throw new TypeError(`network down ${c.headers.get('Authorization')}`)
    })
    const f = failure(await githubFetch(env, config, 'u1', '/user'))
    expect(f).toEqual({ code: 'github_unavailable', status: 502 })
    const text = await githubFailureResponse(f).text()
    const seen = JSON.stringify(logged.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : a)))) + text
    for (const token of [OLD_ACCESS, OLD_REFRESH, NEW_ACCESS, NEW_REFRESH, 'ghu_', 'ghr_']) {
      expect(seen).not.toContain(token)
    }
  })
})
