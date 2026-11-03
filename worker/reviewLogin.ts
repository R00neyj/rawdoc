// 심사 전용 비밀번호 로그인 — 선택 비밀 둘이 원본, better-auth emailAndPassword 를 안쪽 Request 로 부른다 (specs/features/F-4018.md)
import { getAuth } from './authServer'
import { errorResponse } from './http'
import { loginReturn } from './loginPage'
import { OAUTH_EXPIRED_PATH, isLiveOAuthQuery } from './oauthConsent'
import { consentRedirectAllowed } from './oauthPages'
import { readVar } from './origin'

export type ReviewLoginConfig = { email: string; passwordHash: string }

// D1 auth_accounts.password 에 두는 표지 — 비밀번호 원본은 Worker 비밀뿐 (2장)
export const REVIEW_PASSWORD_MARK = 'worker-secret'

const MAX_FORM_BYTES = 4096
const HASH_PATTERN = /^[0-9a-f]{64}$/

function secretOf(env: Env, name: string): string {
  const value = name in env ? (env as unknown as Record<string, unknown>)[name] : undefined
  return typeof value === 'string' ? value : ''
}

export function reviewLoginConfig(env: Env): ReviewLoginConfig | null {
  const email = secretOf(env, 'REVIEW_LOGIN_EMAIL').trim().toLowerCase()
  const passwordHash = secretOf(env, 'REVIEW_LOGIN_PASSWORD_HASH')
  if (email && HASH_PATTERN.test(passwordHash)) return { email, passwordHash }
  if (email || passwordHash) console.error('review_login_misconfigured')
  return null
}

export function isReviewEmail(env: Env, email: string): boolean {
  const config = reviewLoginConfig(env)
  return config !== null && email.trim().toLowerCase() === config.email
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

export async function reviewPasswordHash(password: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyReviewPassword(env: Env, password: string): Promise<boolean> {
  const config = reviewLoginConfig(env)
  if (!config) return false
  return constantTimeEqual(await reviewPasswordHash(password), config.passwordHash)
}

const TAKEN_SQL =
  "SELECT 1 AS taken FROM auth_accounts a JOIN users u ON u.id = a.user_id WHERE u.email = ?1 AND a.provider_id <> 'credential' LIMIT 1"
const USER_SQL =
  "INSERT INTO users (id, email, created_at, name, email_verified, updated_at) VALUES (?1, ?2, ?3, '', 1, ?4) ON CONFLICT(email) DO NOTHING"
// 실제 Google·GitHub 계정이 붙은 사용자에게는 비밀번호 길을 붙이지 않는다 — 같은 batch 의 TAKEN_SQL 과 같은 조건
const ACCOUNT_SQL =
  "INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password, created_at, updated_at) SELECT ?1, u.id, u.id, 'credential', ?2, ?3, ?3 FROM users u WHERE u.email = ?4 AND NOT EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id AND a.provider_id <> 'credential') ON CONFLICT DO NOTHING"

// 거짓이면 그 이메일이 실제 사용자 계정이다. 가입 관문은 세지 않는다 — 이메일이 고정이라 행은 평생 하나 (2장)
export async function ensureReviewAccount(env: Env, email: string): Promise<boolean> {
  const now = Date.now()
  const iso = new Date(now).toISOString()
  const [taken] = await env.DB.batch([
    env.DB.prepare(TAKEN_SQL).bind(email),
    env.DB.prepare(USER_SQL).bind(crypto.randomUUID(), email, now, iso),
    env.DB.prepare(ACCOUNT_SQL).bind(crypto.randomUUID(), REVIEW_PASSWORD_MARK, iso, email),
  ])
  return (taken.results ?? []).length === 0
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

function withError(url: string, code: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}error=${code}`
}

// 닫힌 쪽으로 실패한다 — 바인딩이 없거나 던져도 막는다. 실패가 아닌 시도마다 센다 (2장)
async function attemptAllowed(request: Request, env: Env): Promise<boolean> {
  const limiter = (env as { LOGIN_LIMITER?: RateLimit }).LOGIN_LIMITER
  if (!limiter || typeof limiter.limit !== 'function') {
    console.error('login limiter missing')
    return false
  }
  try {
    const outcome = await limiter.limit({ key: `login-pw:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}` })
    return outcome.success === true
  } catch (err) {
    console.error(err)
    return false
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

function bodyUrl(body: unknown): string | null {
  return body && typeof body === 'object' && 'url' in body && typeof body.url === 'string' ? body.url : null
}

// POST /api/login/password — Origin 관문은 라우터가 먼저 본다 (2장 1~6)
export async function handleReviewLogin(request: Request, env: Env): Promise<Response> {
  const config = reviewLoginConfig(env)
  if (!config) return errorResponse('not_found', 404)
  const badRequest = redirect(withError('/login', 'bad_request'))
  const length = request.headers.get('Content-Length')
  if (!length || !/^\d+$/.test(length) || Number(length) > MAX_FORM_BYTES) return badRequest
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/x-www-form-urlencoded')) return badRequest
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest
  }
  const rawQuery = form.get('oauth_query')
  const oauthQuery = typeof rawQuery === 'string' ? rawQuery : null
  if (rawQuery !== null && (oauthQuery === null || !(await isLiveOAuthQuery(oauthQuery, env)))) return redirect(OAUTH_EXPIRED_PATH)
  const rawReturn = form.get('return')
  const target = oauthQuery !== null ? null : loginReturn(typeof rawReturn === 'string' ? rawReturn : null)
  const fail = (code: string) => redirect(withError(target ? target.failureUrl : `/login?${oauthQuery}`, code))

  if (!(await attemptAllowed(request, env))) return fail('too_many_attempts')
  // 두 실패가 D1 을 거치지 않는 같은 길이다 — 비밀번호 해시는 늘 비교한다 (2장 4)
  const passwordOk = await verifyReviewPassword(env, field(form, 'password'))
  const emailOk = constantTimeEqual(field(form, 'email').trim().toLowerCase(), config.email)
  if (!passwordOk || !emailOk) return fail('invalid_credentials')
  if (!(await ensureReviewAccount(env, config.email))) {
    console.error('review_email_taken')
    return fail('invalid_credentials')
  }

  const base = readVar(env, 'BETTER_AUTH_URL') ?? ''
  const inner = new Request(new URL('/api/auth/sign-in/email', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: new URL(base).origin },
    body: JSON.stringify({ email: config.email, password: field(form, 'password'), ...(oauthQuery !== null ? { oauth_query: oauthQuery } : {}) }),
  })
  const res = await getAuth(env).handler(inner)
  const body: unknown = res.status === 200 ? await res.json().catch(() => null) : null
  const url = bodyUrl(body)
  const location = target ? (res.status === 200 ? target.successUrl : null) : url && consentRedirectAllowed(url, oauthQuery ?? '') ? url : null
  if (!location) {
    console.error('review login failed', res.status)
    return target ? fail('internal_server_error') : redirect('/oauth/error?error=server_error')
  }
  const out = redirect(location)
  for (const cookie of res.headers.getSetCookie()) out.headers.append('Set-Cookie', cookie)
  return out
}
