// OpenAI 앱 도메인 확인 — 출처 루트 평문 토큰, 선택 비밀 OPENAI_APPS_CHALLENGE (specs/features/F-4011.md 3장)
import { errorResponse } from './http'

export function handleOpenaiChallenge(request: Request, env: Env): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const secret = 'OPENAI_APPS_CHALLENGE' in env ? env.OPENAI_APPS_CHALLENGE : undefined
  const value = typeof secret === 'string' ? secret.trim() : ''
  if (!value) return errorResponse('not_found', 404)
  return new Response(value, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
