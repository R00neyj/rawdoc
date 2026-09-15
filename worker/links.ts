// 공유 링크 라우트 — 관리(/api, 로그인) + 공개 조회(/pub, 로그인 없음) (specs/features/F-210.md 2.2, 2.3)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { generateToken, isValidToken } from './token'

type LinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  created_at: number
  revoked_at: number | null
}

type PublicDocRow = {
  title: string
  content: string
  line_ending: 'crlf' | 'lf'
  updated_at: number
}

// F-210 2.3 헤더 — F-204 API 헤더 + 색인 금지·리퍼러 없음
function pubResponse(body: unknown, status = 200): Response {
  const res = jsonResponse(body, status)
  const headers = new Headers(res.headers)
  headers.set('X-Robots-Tag', 'noindex')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(res.body, { status: res.status, headers })
}

async function findOwnedDoc(env: Env, docId: string, ownerId: string): Promise<{ id: string } | null> {
  return env.DB.prepare('SELECT id FROM docs WHERE id = ? AND owner_id = ?')
    .bind(docId, ownerId)
    .first<{ id: string }>()
}

async function findActiveLink(env: Env, targetType: 'doc' | 'folder', targetId: string): Promise<LinkRow | null> {
  return env.DB.prepare('SELECT * FROM share_links WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL')
    .bind(targetType, targetId)
    .first<LinkRow>()
}

export async function handleGetDocLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findOwnedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)

  const link = await findActiveLink(env, 'doc', params.id)
  if (!link) return jsonResponse({ error: 'no_link' }, 404)
  return jsonResponse({ token: link.token })
}

// 재발급은 끊고 다시 만들기(DELETE → POST) 이므로 여기서는 살아있는 링크가 있으면 그대로 돌려준다
export async function handleCreateDocLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findOwnedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)

  const existing = await findActiveLink(env, 'doc', params.id)
  if (existing) return jsonResponse({ token: existing.token })

  const token = generateToken()
  await env.DB.prepare(
    'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)',
  )
    .bind(token, user.id, 'doc', params.id, Date.now())
    .run()
  return jsonResponse({ token }, 201)
}

export async function handleDeleteDocLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findOwnedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)

  await env.DB.prepare(
    'UPDATE share_links SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), 'doc', params.id)
    .run()
  return new Response(null, { status: 204 })
}

export async function handlePublicGetDoc(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')
    .bind(params.token)
    .first<LinkRow>()
  if (!link || link.target_type !== 'doc') return pubResponse({ error: 'not_found' }, 404)

  const doc = await env.DB.prepare('SELECT title, content, line_ending, updated_at FROM docs WHERE id = ?')
    .bind(link.target_id)
    .first<PublicDocRow>()
  if (!doc) return pubResponse({ error: 'not_found' }, 404)

  return pubResponse({
    title: doc.title,
    content: doc.content,
    lineEnding: doc.line_ending,
    updatedAt: doc.updated_at,
  })
}
