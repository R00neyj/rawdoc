// 요청 → AuthUser — /v1/ 토큰, 로컬 개발 우회, better-auth 세션 순서 (specs/features/F-2033.md 3장, F-2032.md 2.4)
import { getTokenUser } from './apiTokens'
import { getAuth } from './authServer'
import { isDevBypass, readVar } from './origin'

export interface AuthUser {
  id: string
  email: string
}

// F-2025 가 AuthUser.usage 를 더할 자리 (2.5)
export function toAuthUser(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email }
}

// better-auth 를 거치지 않는다 — 우회 사용자는 인증된 이메일로 본다 (3.2 2번)
async function findOrCreateDevUser(env: Env, email: string): Promise<AuthUser> {
  const lower = email.toLowerCase()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at, email_verified, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
  )
    .bind(crypto.randomUUID(), lower, now, 1, new Date(now).toISOString())
    .run()
  const row = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(lower)
    .first<{ id: string; email: string }>()
  if (!row) throw new Error('user_lookup_failed')
  return row
}

async function devUser(env: Env): Promise<AuthUser | null> {
  try {
    return await findOrCreateDevUser(env, readVar(env, 'DEV_AUTH_EMAIL') ?? '')
  } catch {
    return null
  }
}

export async function getUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser | null> {
  // /v1/ 은 Bearer 토큰만 본다 — 쿠키·DEV_AUTH_EMAIL 은 무시한다 (F-222 2.3)
  if (new URL(request.url).pathname.startsWith('/v1/')) {
    return getTokenUser(request, env, ctx)
  }
  if (isDevBypass(env)) return devUser(env)

  // AuthConfigError 는 그대로 던진다 — 라우트 catch 가 500 으로 바꾼다 (3.2 3번)
  const auth = getAuth(env)
  try {
    const result = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })
    return result ? toAuthUser(result.user) : null
  } catch {
    return null
  }
}

// GET /api/me 전용 — 연장이 일어나면 better-auth 가 준 Set-Cookie 를 응답에 싣는다 (3.3)
export async function getUserRefreshing(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser | null; setCookies: string[] }> {
  if (isDevBypass(env)) return { user: await devUser(env), setCookies: [] }

  const auth = getAuth(env)
  try {
    const { headers, response } = await auth.api.getSession({ headers: request.headers, returnHeaders: true })
    return { user: response ? toAuthUser(response.user) : null, setCookies: headers.getSetCookie() }
  } catch {
    return { user: null, setCookies: [] }
  }
}

export async function requireUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser> {
  const user = await getUser(request, env, ctx)
  if (!user) {
    throw new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
  return user
}
