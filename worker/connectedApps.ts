// 연결된 앱 목록·연결 끊기 (specs/features/F-4011.md 4장)
import { requireUser } from './auth'
import { errorResponse, jsonResponse } from './http'
import { jsonList } from './mcpAuth'
import { clientLabel } from './oauthClientLabel'

type ConnectedAppRow = { client_id: string; name: string | null; redirect_uris: string | null; created_at: string; last_used_at: number | null }

export async function handleListConnectedApps(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(
    `SELECT s.client_id, c.name, c.redirect_uris, s.created_at, cu.last_used_at
FROM oauth_consents s
JOIN oauth_clients c ON c.client_id = s.client_id
LEFT JOIN oauth_client_use cu ON cu.user_id = s.user_id AND cu.client_id = s.client_id
WHERE s.user_id = ?
ORDER BY s.created_at DESC`,
  )
    .bind(user.id)
    .all<ConnectedAppRow>()
  return jsonResponse(
    results.map((row) => {
      const { name, host } = clientLabel({ name: row.name, redirectUris: jsonList(row.redirect_uris) })
      return { id: row.client_id, name, host, createdAt: Date.parse(row.created_at), lastUsedAt: row.last_used_at }
    }),
  )
}

// 클라이언트·oauth_client_use 행은 남겨 다시 붙는 앱의 client id 가 Cron 정리에서 산다 (4장)
export async function handleDeleteConnectedApp(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const consent = await env.DB.prepare('SELECT id FROM oauth_consents WHERE user_id = ? AND client_id = ? LIMIT 1')
    .bind(user.id, params.id)
    .first<{ id: string }>()
  if (!consent) return errorResponse('not_found', 404)

  // 접근 토큰이 갱신 토큰을 참조하므로 접근 → 갱신 → 동의 순
  await env.DB.batch(
    ['oauth_access_tokens', 'oauth_refresh_tokens', 'oauth_consents'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ? AND client_id = ?`).bind(user.id, params.id),
    ),
  )
  return new Response(null, { status: 204 })
}
