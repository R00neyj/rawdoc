// GitHub API fetch 도우미 — 사용자 토큰 갱신(token_rev 조건부)·오류 대응 (specs/features/F-3014.md 4장)
import brand from '../brand.config'
import { jsonResponse } from './http'
import { openToken, sealToken } from './githubCrypto'
import type { GithubConfig } from './githubSettings'
import type { GithubErrorCode } from '../src/lib/githubContract'

export type GithubFailure = { code: GithubErrorCode; status: number; retryAfter?: number }

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_API_VERSION = '2022-11-28'
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'

const REFRESH_MARGIN_MS = 300_000
const DEFAULT_RETRY_AFTER = 60
// bad_refresh_token 을 받았는데 행이 그대로면 이긴 쪽이 아직 쓰는 중일 수 있다 — 몇 번 다시 읽는다 (A11)
const RACE_REREAD_DELAYS_MS = [50, 150, 300, 500]

const RECONNECT: GithubFailure = { code: 'github_reconnect', status: 409 }
const UNAVAILABLE: GithubFailure = { code: 'github_unavailable', status: 502 }

type AccountRow = {
  access_token: string
  access_expires_at: number
  refresh_token: string
  refresh_expires_at: number
  token_rev: number
}

export type GithubTokenSet = { access: string; refresh: string; accessExpiresAt: number; refreshExpiresAt: number }
type Access = { token: string; rev: number }

export function isGithubFailure(v: unknown): v is GithubFailure {
  return !(v instanceof Response) && typeof v === 'object' && v !== null && typeof (v as GithubFailure).code === 'string'
}

export function githubFailureResponse(f: GithubFailure): Response {
  const res = jsonResponse(f.retryAfter === undefined ? { error: f.code } : { error: f.code, retryAfter: f.retryAfter }, f.status)
  if (f.retryAfter !== undefined) res.headers.set('Retry-After', String(f.retryAfter))
  return res
}

export function githubApiHeaders(access: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('Authorization', `Bearer ${access}`)
  if (!headers.has('Accept')) headers.set('Accept', 'application/vnd.github+json')
  headers.set('User-Agent', brand.name)
  headers.set('X-GitHub-Api-Version', GITHUB_API_VERSION)
  return headers
}

// 토큰 끝점 — 2xx JSON 몸통만 돌려주고 네트워크·5xx·JSON 아님은 null
export async function postGithubToken(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  let res: Response
  try {
    res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': brand.name },
      body: new URLSearchParams(params).toString(),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  try {
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readTokenSet(body: Record<string, unknown>, now: number): GithubTokenSet | null {
  const { access_token, refresh_token, expires_in, refresh_token_expires_in } = body
  if (typeof access_token !== 'string' || !access_token) return null
  if (typeof refresh_token !== 'string' || !refresh_token) return null
  if (typeof expires_in !== 'number' || typeof refresh_token_expires_in !== 'number') return null
  return {
    access: access_token,
    refresh: refresh_token,
    accessExpiresAt: now + expires_in * 1000,
    refreshExpiresAt: now + refresh_token_expires_in * 1000,
  }
}

function readRow(db: D1Database, userId: string): Promise<AccountRow | null> {
  return db
    .prepare('SELECT access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev FROM github_accounts WHERE user_id = ?')
    .bind(userId)
    .first<AccountRow>()
}

async function markReconnect(db: D1Database, userId: string, rev: number): Promise<GithubFailure> {
  await db.prepare('UPDATE github_accounts SET refresh_expires_at = 0 WHERE user_id = ? AND token_rev = ?').bind(userId, rev).run()
  return RECONNECT
}

async function accessOfRow(config: GithubConfig, userId: string, row: AccountRow | null): Promise<Access | null> {
  if (!row) return null
  const token = await openToken(config.key, userId, 'access', row.access_token)
  return token ? { token, rev: row.token_rev } : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 4장 3~5번 — row 는 방금 읽은 행(token_rev = r)
async function refreshAccess(db: D1Database, config: GithubConfig, userId: string, row: AccountRow): Promise<Access | GithubFailure> {
  const r = row.token_rev
  const refresh = await openToken(config.key, userId, 'refresh', row.refresh_token)
  if (!refresh) return markReconnect(db, userId, r)
  const body = await postGithubToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  })
  const now = Date.now()
  const set = body ? readTokenSet(body, now) : null
  if (set) {
    const result = await db
      .prepare(
        'UPDATE github_accounts SET access_token = ?, access_expires_at = ?, refresh_token = ?, refresh_expires_at = ?, token_rev = ?, updated_at = ? WHERE user_id = ? AND token_rev = ?',
      )
      .bind(
        await sealToken(config.key, userId, 'access', set.access),
        set.accessExpiresAt,
        await sealToken(config.key, userId, 'refresh', set.refresh),
        set.refreshExpiresAt,
        r + 1,
        now,
        userId,
        r,
      )
      .run()
    if (result.meta.changes > 0) return { token: set.access, rev: r + 1 }
    return (await accessOfRow(config, userId, await readRow(db, userId))) ?? RECONNECT
  }
  if (body?.error === 'bad_refresh_token') {
    for (const delay of [0, ...RACE_REREAD_DELAYS_MS]) {
      if (delay) await sleep(delay)
      const latest = await readRow(db, userId)
      if (!latest) return RECONNECT
      if (latest.token_rev > r) return (await accessOfRow(config, userId, latest)) ?? markReconnect(db, userId, latest.token_rev)
    }
    return markReconnect(db, userId, r)
  }
  console.error('github_refresh_failed', typeof body?.error === 'string' ? body.error : body ? 'malformed' : 'no_body')
  return UNAVAILABLE
}

// 4장 1~2번. usedRev 가 있으면 그 토큰이 401 을 받은 뒤 — 남이 이미 바꿨으면 그 토큰을, 아니면 강제로 갱신
export async function githubAccessToken(
  db: D1Database,
  config: GithubConfig,
  userId: string,
  usedRev?: number,
): Promise<Access | GithubFailure> {
  const row = await readRow(db, userId)
  const now = Date.now()
  if (!row || row.refresh_expires_at <= now) return RECONNECT
  const fresh = row.access_expires_at - now >= REFRESH_MARGIN_MS
  if (fresh && (usedRev === undefined || row.token_rev !== usedRev)) {
    return (await accessOfRow(config, userId, row)) ?? markReconnect(db, userId, row.token_rev)
  }
  return refreshAccess(db, config, userId, row)
}

function retryAfterOf(res: Response, now: number): number {
  const header = res.headers.get('retry-after')
  if (header && /^\d+$/.test(header.trim())) return Math.max(1, Number(header.trim()))
  const reset = res.headers.get('x-ratelimit-reset')
  if (reset && /^\d+$/.test(reset.trim())) return Math.max(1, Number(reset.trim()) - Math.floor(now / 1000))
  return DEFAULT_RETRY_AFTER
}

export function classifyGithubResponse(res: Response): Response | GithubFailure {
  const { status } = res
  const limited =
    status === 429 || (status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'))
  if (limited) return { code: 'github_rate_limited', status: 503, retryAfter: retryAfterOf(res, Date.now()) }
  if (status === 403) return { code: 'github_forbidden', status: 403 }
  if (status === 404) return { code: 'github_not_found', status: 404 }
  if (status >= 500) return UNAVAILABLE
  return res
}

async function send(path: string, access: string, init: RequestInit | undefined): Promise<Response | null> {
  try {
    return await fetch(`${GITHUB_API}${path}`, { ...init, headers: githubApiHeaders(access, init?.headers) })
  } catch (err) {
    // 오류 객체에 머리(토큰)가 실릴 수 있어 이름만 남긴다
    console.error('github_fetch_failed', err instanceof Error ? err.name : 'unknown')
    return null
  }
}

export async function githubFetch(
  env: Env,
  config: GithubConfig,
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Response | GithubFailure> {
  const first = await githubAccessToken(env.DB, config, userId)
  if (isGithubFailure(first)) return first
  let res = await send(path, first.token, init)
  if (!res) return UNAVAILABLE
  if (res.status === 401) {
    const second = await githubAccessToken(env.DB, config, userId, first.rev)
    if (isGithubFailure(second)) return second
    res = await send(path, second.token, init)
    if (!res) return UNAVAILABLE
    if (res.status === 401) return markReconnect(env.DB, userId, second.rev)
  }
  return classifyGithubResponse(res)
}
