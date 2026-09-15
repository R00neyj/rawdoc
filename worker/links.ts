// 공유 링크 라우트 — 관리(/api, 로그인) + 공개 조회(/pub, 로그인 없음) (specs/features/F-210.md 2.2, 2.3)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { generateToken, isValidToken } from './token'
import { stripComments } from '../src/lib/comments'

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

type FolderRow = {
  id: string
  owner_id: string
  name: string
  parent_id: string | null
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

async function findOwnedFolder(env: Env, folderId: string, ownerId: string): Promise<{ id: string } | null> {
  return env.DB.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
    .bind(folderId, ownerId)
    .first<{ id: string }>()
}

// 링크 폴더 + 그 직속 하위 폴더(폴더는 2단계까지만 있으므로 손자는 없다)의 id 목록. 조회 시점 기준
export async function folderTreeIds(env: Env, folderId: string, ownerId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT id FROM folders WHERE parent_id = ? AND owner_id = ?')
    .bind(folderId, ownerId)
    .all<{ id: string }>()
  return [folderId, ...results.map((r) => r.id)]
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
    content: stripComments(doc.content),
    lineEnding: doc.line_ending,
    updatedAt: doc.updated_at,
  })
}

export async function handleGetFolderLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const folder = await findOwnedFolder(env, params.id, user.id)
  if (!folder) return errorResponse('not_found', 404)

  const link = await findActiveLink(env, 'folder', params.id)
  if (!link) return jsonResponse({ error: 'no_link' }, 404)
  return jsonResponse({ token: link.token })
}

export async function handleCreateFolderLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const folder = await findOwnedFolder(env, params.id, user.id)
  if (!folder) return errorResponse('not_found', 404)

  const existing = await findActiveLink(env, 'folder', params.id)
  if (existing) return jsonResponse({ token: existing.token })

  const token = generateToken()
  await env.DB.prepare(
    'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)',
  )
    .bind(token, user.id, 'folder', params.id, Date.now())
    .run()
  return jsonResponse({ token }, 201)
}

export async function handleDeleteFolderLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const folder = await findOwnedFolder(env, params.id, user.id)
  if (!folder) return errorResponse('not_found', 404)

  await env.DB.prepare(
    'UPDATE share_links SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL',
  )
    .bind(Date.now(), 'folder', params.id)
    .run()
  return new Response(null, { status: 204 })
}

export async function handlePublicGetFolder(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')
    .bind(params.token)
    .first<LinkRow>()
  if (!link || link.target_type !== 'folder') return pubResponse({ error: 'not_found' }, 404)

  const rootFolder = await env.DB.prepare('SELECT * FROM folders WHERE id = ? AND owner_id = ?')
    .bind(link.target_id, link.owner_id)
    .first<FolderRow>()
  if (!rootFolder) return pubResponse({ error: 'not_found' }, 404)

  const treeIds = await folderTreeIds(env, link.target_id, link.owner_id)
  const { results: subfolders } = await env.DB.prepare(
    'SELECT id, name, parent_id FROM folders WHERE parent_id = ? AND owner_id = ?',
  )
    .bind(link.target_id, link.owner_id)
    .all<Pick<FolderRow, 'id' | 'name' | 'parent_id'>>()

  const placeholders = treeIds.map(() => '?').join(',')
  const { results: docs } = await env.DB.prepare(
    `SELECT id, title, folder_id, updated_at FROM docs WHERE owner_id = ? AND folder_id IN (${placeholders}) ORDER BY updated_at DESC`,
  )
    .bind(link.owner_id, ...treeIds)
    .all<{ id: string; title: string; folder_id: string | null; updated_at: number }>()

  return pubResponse({
    name: rootFolder.name,
    folders: subfolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id })),
    docs: docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folder_id, updatedAt: d.updated_at })),
  })
}

export async function handlePublicGetFolderDoc(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await env.DB.prepare('SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL')
    .bind(params.token)
    .first<LinkRow>()
  if (!link || link.target_type !== 'folder') return pubResponse({ error: 'not_found' }, 404)

  const treeIds = await folderTreeIds(env, link.target_id, link.owner_id)
  const doc = await env.DB.prepare('SELECT title, content, line_ending, updated_at, folder_id FROM docs WHERE id = ? AND owner_id = ?')
    .bind(params.docId, link.owner_id)
    .first<PublicDocRow & { folder_id: string | null }>()
  if (!doc || !doc.folder_id || !treeIds.includes(doc.folder_id)) return pubResponse({ error: 'not_found' }, 404)

  return pubResponse({
    title: doc.title,
    content: stripComments(doc.content),
    lineEnding: doc.line_ending,
    updatedAt: doc.updated_at,
  })
}
