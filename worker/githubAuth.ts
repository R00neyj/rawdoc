// GitHub 계정 연결 라우트 — status·connect·callback·setup·DELETE account (specs/features/F-3014.md 5장)
import brand from '../brand.config'
import { errorResponse, jsonResponse } from './http'
import { getUser } from './auth'
import { isLocalAuthMode } from './origin'
import { loginReturn } from './loginPage'
import { sealToken } from './githubCrypto'
import { githubUsedThisMonth, loadGithubConfig, loadGithubSettings, type GithubConfig } from './githubSettings'
import {
  GITHUB_API,
  GITHUB_API_VERSION,
  githubAccessToken,
  githubApiHeaders,
  isGithubFailure,
  postGithubToken,
  readTokenSet,
  type GithubTokenSet,
} from './githubClient'
import { GITHUB_ERROR_PARAM, GITHUB_RETURN_PARAM, type GithubConnectError, type GithubStatus } from '../src/lib/githubContract'

const COOKIE = 'gh_oauth'
const COOKIE_PATH = '/api/github/'
const COOKIE_MAX_AGE = 600

type OAuthCookie = { s: string; v: string; r: string; u: string }

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function challengeOf(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

function encodeCookie(value: OAuthCookie): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function readCookie(request: Request): OAuthCookie | null {
  const header = request.headers.get('Cookie') ?? ''
  const pair = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`))
  if (!pair) return null
  try {
    const binary = atob(pair.slice(COOKIE.length + 1).replace(/-/g, '+').replace(/_/g, '/'))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
    const c = parsed as Partial<OAuthCookie>
    if (typeof c.s !== 'string' || typeof c.v !== 'string' || typeof c.r !== 'string' || typeof c.u !== 'string') return null
    if (!c.s || !c.v) return null
    return { s: c.s, v: c.v, r: c.r, u: c.u }
  } catch {
    return null
  }
}

function cookieHeader(env: Env, value: string, maxAge: number): string {
  const secure = isLocalAuthMode(env) ? '' : '; Secure'
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${maxAge}${secure}`
}

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  if (setCookie) headers.append('Set-Cookie', setCookie)
  return new Response(null, { status: 302, headers })
}

// 해시가 아니라 질의에 싣는다 — parseHash 가 해시 끝까지 맞춰 문서 주소가 깨진다 (r5)
function connectedUrl(hash: string): string {
  return `/?app=1&${GITHUB_RETURN_PARAM}=connected${hash}`
}

function errorUrl(code: GithubConnectError, hash: string): string {
  return `/?app=1&${GITHUB_ERROR_PARAM}=${code}${hash}`
}

function callbackUrl(config: GithubConfig): string {
  return `${config.baseUrl}/api/github/callback`
}

async function enabledConfig(env: Env): Promise<GithubConfig | null> {
  const settings = await loadGithubSettings(env.DB)
  return settings.enabled ? loadGithubConfig(env) : null
}

export async function handleGithubStatus(request: Request, env: Env): Promise<Response> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  const now = Date.now()
  const [settings, row, used] = await Promise.all([
    loadGithubSettings(env.DB),
    env.DB.prepare('SELECT login, refresh_expires_at FROM github_accounts WHERE user_id = ?').bind(user.id).first<{ login: string; refresh_expires_at: number }>(),
    githubUsedThisMonth(env.DB, user.id, now),
  ])
  const config = settings.enabled ? await loadGithubConfig(env) : null
  const body: GithubStatus = { enabled: config !== null, connected: row !== null, month: { used, limit: settings.monthlyLimit } }
  if (config) body.installUrl = `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`
  if (row) {
    body.login = row.login
    body.reconnect = row.refresh_expires_at <= now
  }
  return jsonResponse(body)
}

export async function handleGithubConnect(request: Request, env: Env): Promise<Response> {
  const target = loginReturn(new URL(request.url).searchParams.get('return'))
  const user = await getUser(request, env)
  if (!user) return redirect(target.failureUrl)
  const config = await enabledConfig(env)
  if (!config) return redirect(errorUrl('disabled', target.hash))
  const state = randomToken()
  const verifier = randomToken()
  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(config),
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
  }).toString()
  const cookie = encodeCookie({ s: state, v: verifier, r: target.hash, u: user.id })
  return redirect(authorize.toString(), cookieHeader(env, cookie, COOKIE_MAX_AGE))
}

async function getJson(path: string, access: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, { headers: githubApiHeaders(access) })
    if (!res.ok) return null
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const UPSERT_SQL = `INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
ON CONFLICT (user_id) DO UPDATE SET github_id = excluded.github_id, login = excluded.login, access_token = excluded.access_token,
  access_expires_at = excluded.access_expires_at, refresh_token = excluded.refresh_token, refresh_expires_at = excluded.refresh_expires_at,
  token_rev = github_accounts.token_rev + 1, updated_at = excluded.updated_at`

async function saveAccount(env: Env, config: GithubConfig, userId: string, profile: { id: number; login: string }, set: GithubTokenSet, now: number) {
  await env.DB.prepare(UPSERT_SQL)
    .bind(
      userId,
      profile.id,
      profile.login,
      await sealToken(config.key, userId, 'access', set.access),
      set.accessExpiresAt,
      await sealToken(config.key, userId, 'refresh', set.refresh),
      set.refreshExpiresAt,
      now,
    )
    .run()
}

export async function handleGithubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const cookie = readCookie(request)
  const hash = loginReturn(cookie?.r ?? null).hash
  const clear = cookieHeader(env, '', 0)
  const fail = (code: GithubConnectError) => redirect(errorUrl(code, hash), clear)

  const user = await getUser(request, env)
  if (!cookie || !user || url.searchParams.get('state') !== cookie.s || user.id !== cookie.u) return fail('state')
  if (url.searchParams.has('error')) return fail('denied')
  const config = await enabledConfig(env)
  if (!config) return fail('disabled')

  const code = url.searchParams.get('code')
  const body = code
    ? await postGithubToken({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: cookie.v,
        redirect_uri: callbackUrl(config),
      })
    : null
  const now = Date.now()
  const set = body ? readTokenSet(body, now) : null
  if (!set) {
    if (body && typeof body.access_token === 'string') console.error('github_token_no_expiry')
    else console.error('github_exchange_failed', typeof body?.error === 'string' ? body.error : 'no_body')
    return fail('exchange_failed')
  }

  const ghUser = await getJson('/user', set.access)
  if (!ghUser || !Number.isSafeInteger(ghUser.id) || typeof ghUser.login !== 'string') return fail('exchange_failed')
  const profile = { id: ghUser.id as number, login: ghUser.login }

  // 남의 연결을 끊지 않게 grant 는 폐기하지 않는다 — 폐기는 그 GitHub 사용자의 앱 토큰을 전부 지운다 (5장 ⑥)
  const taken = await env.DB.prepare('SELECT 1 AS x FROM github_accounts WHERE github_id = ? AND user_id <> ?').bind(profile.id, user.id).first()
  if (taken) return fail('github_taken')
  try {
    await saveAccount(env, config, user.id, profile, set, now)
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return fail('github_taken')
    throw err
  }

  const installs = await getJson('/user/installations?per_page=1', set.access)
  if (installs && installs.total_count === 0) {
    return redirect(`https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`)
  }
  return redirect(connectedUrl(hash), clear)
}

// 설치 화면이 state 를 돌려주는지 확인하지 않았다 — 질의는 읽지 않고 쿠키만 본다 (5장)
export async function handleGithubSetup(request: Request, env: Env): Promise<Response> {
  const cookie = readCookie(request)
  return redirect(connectedUrl(loginReturn(cookie?.r ?? null).hash), cookieHeader(env, '', 0))
}

async function revokeGrant(env: Env, config: GithubConfig, userId: string): Promise<void> {
  try {
    const access = await githubAccessToken(env.DB, config, userId)
    if (isGithubFailure(access)) return
    const res = await fetch(`${GITHUB_API}/applications/${encodeURIComponent(config.clientId)}/grant`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': brand.name,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      body: JSON.stringify({ access_token: access.token }),
    })
    if (!res.ok) console.error('github_grant_revoke_failed', res.status)
  } catch (err) {
    console.error('github_grant_revoke_failed', err instanceof Error ? err.name : 'unknown')
  }
}

// 쓰기 관문 밖 — 막힌 계정도 끊을 수 있다. 꺼져 있어도 된다 (F-3013 3.4)
export async function handleGithubDeleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  const row = await env.DB.prepare('SELECT 1 AS x FROM github_accounts WHERE user_id = ?').bind(user.id).first()
  if (row) {
    const config = await loadGithubConfig(env)
    if (config) await revokeGrant(env, config, user.id)
    await env.DB.prepare('DELETE FROM github_accounts WHERE user_id = ?').bind(user.id).run()
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
