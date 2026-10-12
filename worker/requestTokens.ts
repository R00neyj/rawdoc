// 조각 링크용 요청 토큰 — 발급 핸들러와 끊기 문장 (specs/features/F-4007.md)
import { requireUser } from './auth'
import { checkOwnedTarget } from './grants'
import { errorResponse, jsonResponse } from './http'
import { generateToken } from './token'
import { dayUsageStatement } from './usage'

const LIVE_TOKEN_SQL = 'SELECT token FROM request_tokens WHERE doc_id = ? AND owner_id = ? AND revoked_at IS NULL'

export async function handleCreateRequestToken(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, 'doc', params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)
  if (check.e2ee) return jsonResponse({ error: 'e2ee_doc' }, 409)

  const existing = await env.DB.prepare(LIVE_TOKEN_SQL).bind(params.id, user.id).first<{ token: string }>()
  if (existing) return jsonResponse({ token: existing.token })

  const now = Date.now()
  const [inserted] = await env.DB.batch([
    env.DB.prepare('INSERT INTO request_tokens (token, owner_id, doc_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(generateToken(), user.id, params.id, now),
    dayUsageStatement(env.DB, user.id, now),
  ])
  // 동시에 먼저 들어간 행이 있으면 그 토큰을 돌려준다
  const live = await env.DB.prepare(LIVE_TOKEN_SQL).bind(params.id, user.id).first<{ token: string }>()
  return jsonResponse({ token: live?.token }, inserted.meta.changes === 1 ? 201 : 200)
}
