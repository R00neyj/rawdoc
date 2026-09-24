// API 토큰 발급·목록·폐기, /v1/ 요청의 토큰 판정 (specs/features/F-222.md 2.1~2.3)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES } from './validate'
import { USAGE_COLUMNS, dayUsageStatement, rowToUsage } from './usage'
import type { UsageRow } from './usage'

export const MAX_TOKENS = 10
const LAST_USED_UPDATE_INTERVAL_MS = 10 * 60 * 1000

type ApiTokenListRow = { id: string; name: string; prefix: string; created_at: number; last_used_at: number | null }
type ApiTokenAuthRow = { id: string; user_id: string; last_used_at: number | null }

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// rd_ + 32바이트 무작위 base64url(패딩 없음) (F-222 2.1)
export function generateApiToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `rd_${base64UrlEncode(bytes)}`
}

// 표시용 앞 11자 — 'rd_' + 8자 (F-222 2.1)
export function prefixOf(token: string): string {
  return token.slice(0, 11)
}

export function isValidTokenName(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 40
}

export async function handleListTokens(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(
    'SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
  )
    .bind(user.id)
    .all<ApiTokenListRow>()
  return jsonResponse(
    results.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at })),
  )
}

export async function handleCreateToken(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { name: rawName } = body as Record<string, unknown>
  const name = typeof rawName === 'string' ? rawName.trim() : rawName
  if (!isValidTokenName(name)) return jsonResponse({ error: 'invalid', field: 'name' }, 400)

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL',
  )
    .bind(user.id)
    .first<{ count: number }>()
  if ((countRow?.count ?? 0) >= MAX_TOKENS) return jsonResponse({ error: 'too_many', limit: MAX_TOKENS }, 409)

  const token = generateApiToken()
  const tokenHash = await sha256Hex(token)
  const prefix = prefixOf(token)
  const id = crypto.randomUUID()
  const createdAt = Date.now()

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?,?,?,?,?,?)',
    ).bind(id, user.id, name, tokenHash, prefix, createdAt),
    dayUsageStatement(env.DB, user.id, Date.now()),
  ])

  // token(원문)은 이 응답에만 담긴다 — D1 에는 해시·prefix 만 (F-222 2.1)
  return jsonResponse({ id, name, prefix, createdAt, lastUsedAt: null, token }, 201)
}

export async function handleDeleteToken(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await env.DB.prepare(
    'SELECT id FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(params.id, user.id)
    .first<{ id: string }>()
  if (!row) return errorResponse('not_found', 404)

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').bind(now, params.id),
    dayUsageStatement(env.DB, user.id, now),
  ])
  return new Response(null, { status: 204 })
}

// /v1/ 요청의 사용자 판정 — Authorization: Bearer rd_… 만 본다 (F-222 2.3)
export async function getTokenUser(request: Request, env: Env, ctx?: ExecutionContext): Promise<AuthUser | null> {
  const auth = request.headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice('Bearer '.length).trim()
  if (!token.startsWith('rd_')) return null

  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    'SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL',
  )
    .bind(tokenHash)
    .first<ApiTokenAuthRow>()
  if (!row) return null

  const userRow = await env.DB.prepare(`SELECT id, email, ${USAGE_COLUMNS} FROM users WHERE id = ?`)
    .bind(row.user_id)
    .first<{ id: string; email: string } & UsageRow>()
  if (!userRow) return null

  const now = Date.now()
  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_UPDATE_INTERVAL_MS) {
    const update = env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run()
    if (ctx) ctx.waitUntil(update)
    else await update
  }

  return { id: userRow.id, email: userRow.email, usage: rowToUsage(userRow) }
}
