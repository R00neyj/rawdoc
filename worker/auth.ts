// 요청 → AuthUser — /v1/ 토큰, 로컬 개발 우회, better-auth 세션 순서 (specs/features/F-2033.md 3장, F-2032.md 2.4)
import { getTokenUser } from './apiTokens'
import { getAuth } from './authServer'
import { isDevBypass, readVar } from './origin'
import { USAGE_COLUMNS, rowToUsage } from './usage'
import type { UserUsage, UsageRow } from './usage'

export type { UserUsage } from './usage'

export interface AuthUser {
  id: string
  email: string
  usage?: UserUsage // getUser 세 경로가 채운다. vi.mock('./auth') 테스트는 비워 둔다 (F-2024 2.1)
}

// better-auth 세션(getUser·getUserRefreshing) 전용 — writeCount 가 숫자일 때만 usage 를 싣는다
export function toAuthUser(user: { id: string; email: string } & Partial<Record<keyof UserUsage, unknown>>): AuthUser {
  const { id, email, writeCount } = user
  if (typeof writeCount !== 'number') return { id, email }
  return {
    id,
    email,
    usage: {
      writeDay: (user.writeDay as string | null | undefined) ?? null,
      writeCount,
      contentBytes: (user.contentBytes as number | undefined) ?? 0,
      docCount: (user.docCount as number | undefined) ?? 0,
      blockedAt: (user.blockedAt as number | null | undefined) ?? null,
      warnedAt: (user.warnedAt as number | null | undefined) ?? null,
    },
  }
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
  const row = await env.DB.prepare(`SELECT id, email, ${USAGE_COLUMNS} FROM users WHERE email = ?`)
    .bind(lower)
    .first<{ id: string; email: string } & UsageRow>()
  if (!row) throw new Error('user_lookup_failed')
  return { id: row.id, email: row.email, usage: rowToUsage(row) }
}

async function devUser(env: Env): Promise<AuthUser | null> {
  try {
    return await findOrCreateDevUser(env, readVar(env, 'DEV_AUTH_EMAIL') ?? '')
  } catch {
    return null
  }
}

// 관문이 인증한 사용자를 같은 요청 안에서 다시 쓴다 — 핸들러가 또 인증하지 않게 (F-2026 6장)
const rememberedUsers = new WeakMap<Request, AuthUser>()

export function rememberUser(request: Request, user: AuthUser): void {
  rememberedUsers.set(request, user)
}

export async function getUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser | null> {
  const remembered = rememberedUsers.get(request)
  if (remembered) return remembered

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

// 계정 삭제 전용 — getUser 와 같은 순서로 찾고 세션 만든 시각(ms)을 같이 준다. 개발 우회면 null (F-2038 4.2)
export async function getUserWithSessionStart(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser; sessionCreatedAt: number | null } | null> {
  if (isDevBypass(env)) {
    const user = await devUser(env)
    return user ? { user, sessionCreatedAt: null } : null
  }

  const auth = getAuth(env)
  try {
    const result = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } })
    if (!result) return null
    const createdAt = new Date(result.session.createdAt).getTime()
    return { user: toAuthUser(result.user), sessionCreatedAt: Number.isFinite(createdAt) ? createdAt : 0 }
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
