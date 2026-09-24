// 공유 링크 라우트 — 관리(/api, 로그인) + 공개 조회(/pub, 로그인 없음) (specs/features/F-210.md 2.2, 2.3)
// 위키링크로 묶인 문서 묶음 공유는 F-252 2.3~2.5. 사용량 줄은 F-2025.md 6.4
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { generateToken, isValidToken } from './token'
import { stripComments } from '../src/lib/comments'
import { buildWikiLinkTable, collectWikiSet, type LoadDoc } from './shareSet'
import { descendantFolderIds } from '../src/lib/folderTree'
import { createWikiResolver, type WikiFolderRef } from '../src/lib/wikiResolve'
import { dayUsageStatement } from './usage'

export type PublicLinkRow = {
  token: string
  owner_id: string
  target_type: 'doc' | 'folder'
  target_id: string
  created_at: number
  revoked_at: number | null
}

// 공개 조회는 모두 여기로 — 링크 소유자가 막혔으면 없는 링크와 같다. 행은 지우지 않아 풀면 같은 주소가 돌아온다 (F-2028 5.1)
const PUBLIC_LINK_SQL =
  'SELECT * FROM share_links WHERE token = ? AND revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = share_links.owner_id AND users.blocked_at IS NOT NULL)'

export async function findPublicLink(env: Env, token: string): Promise<PublicLinkRow | null> {
  return env.DB.prepare(PUBLIC_LINK_SQL).bind(token).first<PublicLinkRow>()
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

async function findActiveLink(env: Env, targetType: 'doc' | 'folder', targetId: string): Promise<PublicLinkRow | null> {
  return env.DB.prepare('SELECT * FROM share_links WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL')
    .bind(targetType, targetId)
    .first<PublicLinkRow>()
}

async function findOwnedFolder(env: Env, folderId: string, ownerId: string): Promise<{ id: string } | null> {
  return env.DB.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
    .bind(folderId, ownerId)
    .first<{ id: string }>()
}

type FolderListRow = Pick<FolderRow, 'id' | 'name' | 'parent_id'>

// 소유자 폴더를 한 번 읽는다 — parent_id 색인이 없어 아래로 내려가는 재귀 CTE 는 쓰지 않는다 (F-2017 4.2)
async function ownerFolders(env: Env, ownerId: string): Promise<FolderListRow[]> {
  const { results } = await env.DB.prepare('SELECT id, name, parent_id FROM folders WHERE owner_id = ?')
    .bind(ownerId)
    .all<FolderListRow>()
  return results
}

function toWikiFolders(folders: FolderListRow[]): WikiFolderRef[] {
  return folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id }))
}

function subtreeIds(folders: FolderListRow[], folderId: string): string[] {
  const ids = descendantFolderIds(
    folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id })),
    folderId,
  )
  return ids.length > 0 ? ids : [folderId]
}

// 링크 폴더 + 모든 자손 폴더의 id 목록(링크 폴더가 맨 앞). 조회 시점 기준
export async function folderTreeIds(env: Env, folderId: string, ownerId: string): Promise<string[]> {
  return subtreeIds(await ownerFolders(env, ownerId), folderId)
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

  // updated_at 내림차순 — 같은 제목이면 최근 수정이 같은 단계 안에서 이긴다 (F-2018 10.4)
  const [{ results: allDocs }, folders] = await Promise.all([
    env.DB.prepare('SELECT id, title, content, folder_id FROM docs WHERE owner_id = ? ORDER BY updated_at DESC')
      .bind(user.id)
      .all<{ id: string; title: string; content: string; folder_id: string | null }>(),
    ownerFolders(env, user.id),
  ])

  const byId = new Map(allDocs.map((d) => [d.id, d]))
  const loadDoc: LoadDoc = (id) => {
    const found = byId.get(id)
    if (!found) return null
    return { id: found.id, title: found.title, content: stripComments(found.content) }
  }

  const { nodes, truncated } = collectWikiSet(
    params.id,
    loadDoc,
    allDocs.map((d) => ({ id: d.id, title: d.title, folderId: d.folder_id })),
    toWikiFolders(folders),
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

// 실행하지 않고 문장만 만든다 — 부르는 쪽이 사용량 줄과 한 batch 로 묶는다 (F-2025 6.4)
function insertLink(env: Env, token: string, ownerId: string, targetId: string): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)',
  ).bind(token, ownerId, 'doc', targetId, Date.now())
}

function replaceShareLinkDocs(env: Env, token: string, docIds: string[]): D1PreparedStatement[] {
  const statements = [env.DB.prepare('DELETE FROM share_link_docs WHERE token = ?').bind(token)]
  for (const id of docIds) {
    statements.push(env.DB.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').bind(token, id))
  }
  return statements
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
    await env.DB.batch([insertLink(env, token, user.id, params.id), dayUsageStatement(env.DB, user.id, Date.now())])
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
    if (!sameSet) {
      await env.DB.batch([...replaceShareLinkDocs(env, existing.token, uniqueIds), dayUsageStatement(env.DB, user.id, Date.now())])
    }
    return jsonResponse({ token: existing.token })
  }

  const token = generateToken()
  const statements = [insertLink(env, token, user.id, params.id)]
  if (uniqueIds.length > 0) statements.push(...replaceShareLinkDocs(env, token, uniqueIds))
  statements.push(dayUsageStatement(env.DB, user.id, Date.now()))
  await env.DB.batch(statements)
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

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE share_links SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL',
    ).bind(now, 'doc', params.id),
    dayUsageStatement(env.DB, user.id, now),
  ])
  return new Response(null, { status: 204 })
}

export async function handlePublicGetDoc(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await findPublicLink(env, params.token)
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

  const link = await findPublicLink(env, params.token)
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

  // 문서 1개면 위키링크를 쓰지 않는다 — 소유자 전체를 읽지 않는다 (F-2018 10.3)
  if (ordered.length < 2) return pubResponse({ docs: ordered.map((d) => ({ id: d.id, title: d.title, links: {} })) })

  const setIds = ordered.map((d) => d.id)
  const [{ results: bodies }, { results: ownerDocs }, folders] = await Promise.all([
    env.DB.prepare(`SELECT id, content, folder_id FROM docs WHERE id IN (${setIds.map(() => '?').join(',')})`)
      .bind(...setIds)
      .all<{ id: string; content: string; folder_id: string | null }>(),
    env.DB.prepare('SELECT id, title, folder_id FROM docs WHERE owner_id = ? ORDER BY updated_at DESC')
      .bind(link.owner_id)
      .all<{ id: string; title: string; folder_id: string | null }>(),
    ownerFolders(env, link.owner_id),
  ])
  const resolver = createWikiResolver(
    ownerDocs.map((d) => ({ id: d.id, title: d.title, folderId: d.folder_id })),
    toWikiFolders(folders),
  )
  const allowed = new Set(setIds)
  const bodyById = new Map(bodies.map((b) => [b.id, b]))

  return pubResponse({
    docs: ordered.map((d) => {
      const body = bodyById.get(d.id)
      const links = body ? buildWikiLinkTable(stripComments(body.content), body.folder_id, resolver, allowed) : {}
      return { id: d.id, title: d.title, links }
    }),
  })
}

// 묶음 안 문서 본문. docId 가 묶음 밖(시작 문서도 아니고 share_link_docs 에도 없음)이면 404 (F-252 2.5)
export async function handlePublicGetDocSetDoc(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await findPublicLink(env, params.token)
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
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)',
    ).bind(token, user.id, 'folder', params.id, now),
    dayUsageStatement(env.DB, user.id, now),
  ])
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

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE share_links SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL',
    ).bind(now, 'folder', params.id),
    dayUsageStatement(env.DB, user.id, now),
  ])
  return new Response(null, { status: 204 })
}

export async function handlePublicGetFolder(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  if (!isValidToken(params.token)) return pubResponse({ error: 'not_found' }, 404)

  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'folder') return pubResponse({ error: 'not_found' }, 404)

  // 폴더 목록은 요청당 한 번. 트리 id 를 IN (…) 바인딩으로 보내지 않고 소유자 문서를 읽어 메모리에서 거른다 (F-2017 4.1·4.2)
  const folders = await ownerFolders(env, link.owner_id)
  const rootFolder = folders.find((f) => f.id === link.target_id)
  if (!rootFolder) return pubResponse({ error: 'not_found' }, 404)

  const treeIds = new Set(subtreeIds(folders, link.target_id))
  const subfolders = folders.filter((f) => f.id !== link.target_id && treeIds.has(f.id))

  const { results: ownerDocs } = await env.DB.prepare(
    'SELECT id, title, folder_id, updated_at FROM docs WHERE owner_id = ? ORDER BY updated_at DESC',
  )
    .bind(link.owner_id)
    .all<{ id: string; title: string; folder_id: string | null; updated_at: number }>()
  const docs = ownerDocs.filter((d) => d.folder_id !== null && treeIds.has(d.folder_id))

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

  const link = await findPublicLink(env, params.token)
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
