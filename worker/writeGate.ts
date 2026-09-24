// 쓰기 관문 — 401 unauthenticated → 403 account_blocked → 429 day → 429 minute (specs/features/F-2026.md 4장)
import { errorResponse, jsonResponse } from './http'
import { getUser, rememberUser } from './auth'
import { DAILY_WRITE_LIMIT, isDailyLimitReached, secondsUntilUtcMidnight, usageOf } from './usage'

export const MINUTE_WRITE_LIMIT = 120 // wrangler.jsonc WRITE_LIMITER 의 simple.limit 과 같은 값 (G10)
export const MINUTE_RETRY_AFTER = 60 // 초. 바인딩이 남은 시간을 주지 않는다

export type RateLimitedBody = { error: 'rate_limited'; scope: 'minute' | 'day'; limit: number; retryAfter: number }
export type BlockedBody = { error: 'account_blocked' }

// 라우트 표의 패턴(:id 그대로)을 본다 — 요청 경로가 아니다 (4.1)
export function isWriteRoute(method: string, routePath: string): boolean {
  if (method === 'GET') return false
  if (!routePath.startsWith('/api/') && !routePath.startsWith('/v1/')) return false
  if (routePath === '/api/login') return false
  if (routePath.startsWith('/api/auth/')) return false
  return true
}

function rateLimitedResponse(scope: 'minute' | 'day', limit: number, retryAfter: number): Response {
  const body: RateLimitedBody = { error: 'rate_limited', scope, limit, retryAfter }
  const res = jsonResponse(body, 429)
  res.headers.set('Retry-After', String(retryAfter))
  return res
}

// 격리(isolate)당 한 번만 찍는다 — 요청마다 찍으면 바인딩이 없는 테스트 env 가 로그로 뒤덮인다 (5.3)
let warnedMissingLimiter = false

export async function runWriteGate(request: Request, env: Env): Promise<Response | null> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  rememberUser(request, user)

  const usage = await usageOf(env, user)
  if (usage.blockedAt !== null) {
    const body: BlockedBody = { error: 'account_blocked' }
    return jsonResponse(body, 403)
  }

  const now = Date.now()
  if (isDailyLimitReached(usage, now)) {
    return rateLimitedResponse('day', DAILY_WRITE_LIMIT, secondsUntilUtcMidnight(now))
  }

  const limiter = env.WRITE_LIMITER
  if (!limiter || typeof limiter.limit !== 'function') {
    if (!warnedMissingLimiter) {
      warnedMissingLimiter = true
      console.warn('write_limiter_missing')
    }
    return null
  }

  try {
    const outcome = await limiter.limit({ key: user.id })
    if (outcome && outcome.success === false) {
      return rateLimitedResponse('minute', MINUTE_WRITE_LIMIT, MINUTE_RETRY_AFTER)
    }
  } catch (err) {
    console.error('write_limiter_failed', err)
  }

  return null
}
