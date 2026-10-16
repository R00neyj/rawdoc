// /mcp 토큰 관문·401 도전·보호 자원 메타데이터 (specs/features/F-4011.md 2·3장)
import brand from '../brand.config'
import type { AuthUser } from './auth'
import { errorResponse } from './http'
import { clientLabel } from './oauthClientLabel'
import { OAUTH_SCOPES, mcpResource, oauthIssuer } from './oauthServer'
import { isAllowedOrigin } from './origin'
import { USAGE_COLUMNS, rowToUsage } from './usage'
import type { UsageRow } from './usage'

export type McpCaller = { user: AuthUser; clientId: string; clientName: string }

// apiTokens.ts LAST_USED_UPDATE_INTERVAL_MS 와 같은 값
const LAST_USED_UPDATE_INTERVAL_MS = 10 * 60 * 1000

const USER_COLUMNS = USAGE_COLUMNS.split(', ').map((column) => `u.${column}`).join(', ')

// 표·열은 F-4009 — 날짜 ISO TEXT, 배열 JSON TEXT, last_used_at 은 ms
const TOKEN_SQL = `SELECT t.client_id, t.resources, t.scopes, c.name AS client_name, c.redirect_uris, u.id, u.email, ${USER_COLUMNS}, cu.last_used_at
FROM oauth_access_tokens t
JOIN oauth_clients c ON c.client_id = t.client_id
JOIN users u ON u.id = t.user_id
LEFT JOIN oauth_client_use cu ON cu.user_id = t.user_id AND cu.client_id = t.client_id
WHERE t.token = ? AND t.revoked IS NULL AND t.expires_at > ? AND (c.disabled IS NULL OR c.disabled = 0)`

type TokenRow = {
  client_id: string
  resources: string | null
  scopes: string | null
  client_name: string | null
  redirect_uris: string | null
  id: string
  email: string
  last_used_at: number | null
} & UsageRow

// 플러그인이 string[] 을 JSON 글자로 저장한다 — 깨졌으면 빈 목록
export function jsonList(text: string | null): string[] {
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

// 플러그인 defaultHasher 와 같다 — SHA-256 → base64url(패딩 없음)
async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  let binary = ''
  for (const byte of digest) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function metadataUrl(env: Env): string {
  const resource = new URL(mcpResource(env))
  return new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource).href
}

// 매개변수 순서 고정, scope 에 offline_access 를 같이 넣어 갱신 토큰을 받게 한다 (2장)
function challengeResponse(env: Env, status: 401 | 403, error: 'unauthenticated' | 'invalid_token' | 'insufficient_scope'): Response {
  const errorParam = error === 'unauthenticated' ? '' : `error="${error}", `
  const res = errorResponse(error, status)
  res.headers.set('WWW-Authenticate', `Bearer ${errorParam}resource_metadata="${metadataUrl(env)}", scope="${OAUTH_SCOPES.join(' ')}"`)
  return res
}

export async function authenticateMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<McpCaller | Response> {
  const origin = request.headers.get('Origin')
  if (origin !== null && !isAllowedOrigin(origin, request, env)) return errorResponse('forbidden_origin', 403)

  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') ?? '')
  if (!match) return challengeResponse(env, 401, 'unauthenticated')

  const now = Date.now()
  const row = await env.DB.prepare(TOKEN_SQL).bind(await hashToken(match[1]), new Date(now).toISOString()).first<TokenRow>()
  if (!row || !jsonList(row.resources).includes(mcpResource(env))) return challengeResponse(env, 401, 'invalid_token')
  if (!jsonList(row.scopes).includes('docs')) return challengeResponse(env, 403, 'insufficient_scope')

  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_UPDATE_INTERVAL_MS) {
    ctx.waitUntil(
      env.DB.prepare(
        'INSERT INTO oauth_client_use (user_id, client_id, last_used_at) VALUES (?, ?, ?) ON CONFLICT(user_id, client_id) DO UPDATE SET last_used_at = excluded.last_used_at',
      )
        .bind(row.id, row.client_id, now)
        .run(),
    )
  }

  const { name } = clientLabel({ name: row.client_name, redirectUris: jsonList(row.redirect_uris) })
  return { user: { id: row.id, email: row.email, usage: rowToUsage(row) }, clientId: row.client_id, clientName: name }
}

const PROTECTED_RESOURCE_HEADERS: HeadersInit = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
}

export function handleProtectedResourceMetadata(request: Request, env: Env): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const body = {
    resource: mcpResource(env),
    authorization_servers: [oauthIssuer(env)],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: brand.name,
  }
  return new Response(JSON.stringify(body), { headers: PROTECTED_RESOURCE_HEADERS })
}
