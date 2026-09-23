// 공유 링크 라우트 — 관리(/api, 로그인) + 공개 조회(/pub, 로그인 없음) (specs/features/F-210.md 2.2, 2.3)
// 위키링크로 묶인 문서 묶음 공유는 F-252 2.3~2.5
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { generateToken, isValidToken } from './token'
import { stripComments } from '../src/lib/comments'
import { collectWikiSet, type LoadDoc } from './shareSet'

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

async function fetchShareLinkDocIds(env: Env, token: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT doc_id FROM share_link_docs WHERE token = ?')
    .bind(token)
    .all<{ doc_id: string }>()
  return results.map((r) => r.doc_id)
}

// docId 가 링크의 시작 문서이거나 share_link_docs 묶음 안인지 (F-252 2.5·2.6 공용)
export async function isDocInLinkSet(env: Env, token: string, targetId: string, docId: string): Promise<boolean> {
  if (docId === targetId) return true
  const row = await env.DB.prepare('SELECT 1 FROM share_link_docs WHERE token = ? AND doc_id = ?')
    .bind(token, docId)
    .first()
  return row !== null
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
  const docIds = await fetchShareLinkDocIds(env, link.token)
  return jsonResponse({ token: link.token, docIds })
}

// 문서 원문에서 위키링크로 연결된 대상 문서 묶음 미리보기 (F-252 2.3)
export async function handleGetDocShareSet(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findOwnedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)

  const { results: allDocs } = await env.DB.prepare('SELECT id, title, content FROM docs WHERE owner_id = ?')
    .bind(user.id)
    .all<{ id: string; title: string; content: string }>()

  const byId = new Map(allDocs.map((d) => [d.id, d]))
  const loadDoc: LoadDoc = (id) => {
    const found = byId.get(id)
    if (!found) return null
    return { id: found.id, title: found.title, content: stripComments(found.content) }
  }

  const { nodes, truncated } = collectWikiSet(
    params.id,
    loadDoc,
    allDocs.map((d) => ({ id: d.id, title: d.title })),
  )
  return jsonResponse({
    nodes: nodes.map((n) => ({ id: n.id, title: n.title, depth: n.depth, parentId: n.parentId })),
    truncated,
  })
}

// docIds 본문을 읽는다. docIds 필드가 아예 없으면 undefined('묶음 정보 없음' — 기존 묶음 유지), 있으면(빈 배열 포함) 그 배열, 모양이 틀리면 'bad_request' (F-259 2장)
async function readDocIds(request: Request): Promise<string[] | 'bad_request' | undefined> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return undefined
  }
  if (raw === null || typeof raw !== 'object') return undefined
  const docIds = (raw as { docIds?: unknown }).docIds
  if (docIds === undefined) return undefined
  if (!Array.isArray(docIds) || !docIds.every((id) => typeof id === 'string')) return 'bad_request'
  return docIds
}

async function insertLink(env: Env, token: string, ownerId: string, targetId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)',
  )
    .bind(token, ownerId, 'doc', targetId, Date.now())
    .run()
}

async function replaceShareLinkDocs(env: Env, token: string, docIds: string[]): Promise<void> {
  await env.DB.prepare('DELETE FROM share_link_docs WHERE token = ?').bind(token).run()
  for (const id of docIds) {
    await env.DB.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').bind(token, id).run()
  }
}

// 살아있는 링크가 있으면 토큰은 유지하고 share_link_docs 만 갱신한다 — 주소는 살아있는 링크가 있는 한 유지(F-259 2장). 새 토큰 발급은 살아있는 링크가 없을 때만
export async function handleCreateDocLink(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findOwnedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)

  const docIds = await readDocIds(request)
  if (docIds === 'bad_request') return errorResponse('bad_request', 400)

  const existing = await findActiveLink(env, 'doc', params.id)

  // 묶음 정보 없이 호출(예: ShareMenu 단순 링크 복사) — 기존 링크가 있으면 묶음을 건드리지 않고 그대로 반환
  if (docIds === undefined) {
    if (existing) return jsonResponse({ token: existing.token })
    const token = generateToken()
    await insertLink(env, token, user.id, params.id)
    return jsonResponse({ token }, 201)
  }

  const uniqueIds = [...new Set(docIds)].filter((id) => id !== params.id)
  for (const id of uniqueIds) {
    const owned = await findOwnedDoc(env, id, user.id)
    if (!owned) return errorResponse('bad_request', 400)
  }

  if (existing) {
    const existingIds = new Set(await fetchShareLinkDocIds(env, existing.token))
    const sameSet = existingIds.size === uniqueIds.length && uniqueIds.every((id) => existingIds.has(id))
    if (!sameSet) await replaceShareLinkDocs(env, existing.token, uniqueIds)
    return jsonResponse({ token: existing.token })
  }

  const token = generateToken()
  await insertLink(env, token, user.id, params.id)
  if (uniqueIds.length > 0) await replaceShareLinkDocs(env, token, uniqueIds)
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

// 묶음 문서 목록 — 시작 문서가 맨 앞, 삭제된 문서는 빠진다 (F-252 2.5)
export async function handlePublicGetDocSet(
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

  const bundledIds = await fetchShareLinkDocIds(env, params.token)
  const orderedIds = [link.target_id, ...bundledIds]
  const placeholders = orderedIds.map(() => '?').join(',')
  const { results: docs } = await env.DB.prepare(`SELECT id, title FROM docs WHERE id IN (${placeholders})`)
    .bind(...orderedIds)
    .all<{ id: string; title: string }>()

  const byId = new Map(docs.map((d) => [d.id, d]))
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((d): d is { id: string; title: string } => d !== undefined)

  return pubResponse({ docs: ordered })
}

// 묶음 안 문서 본문. docId 가 묶음 밖(시작 문서도 아니고 share_link_docs 에도 없음)이면 404 (F-252 2.5)
export async function handlePublicGetDocSetDoc(
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

  if (!(await isDocInLinkSet(env, params.token, link.target_id, params.docId))) return pubResponse({ error: 'not_found' }, 404)

  const doc = await env.DB.prepare('SELECT title, content, line_ending, updated_at FROM docs WHERE id = ?')
    .bind(params.docId)
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
