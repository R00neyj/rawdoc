// 폴더 라우트 (specs/features/F-206.md 2.4, 접근 판정은 F-212.md 2.2)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES, isValidFolderName, isValidUuid } from './validate'
import { canCreateFolder, canMoveFolder, descendantFolderIds } from '../src/lib/folderTree'
import { getOwnedFolder } from './access'

const BATCH_ID_LIMIT = 100

type FolderRow = {
  id: string
  owner_id: string
  name: string
  parent_id: string | null
  created_at: number
  updated_at: number
}

function rowToFolder(row: FolderRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function handleListFolders(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare('SELECT * FROM folders WHERE owner_id = ?')
    .bind(user.id)
    .all<FolderRow>()
  return jsonResponse(results.map(rowToFolder))
}

export async function handleCreateFolder(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { id: bodyId, name, parentId } = body as Record<string, unknown>

  if (bodyId !== undefined && !isValidUuid(bodyId)) {
    return jsonResponse({ error: 'invalid', field: 'id' }, 400)
  }
  if (!isValidFolderName(name)) return jsonResponse({ error: 'invalid', field: 'name' }, 400)
  if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
    return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
  }

  if (typeof bodyId === 'string') {
    const existing = await env.DB.prepare('SELECT * FROM folders WHERE id = ?')
      .bind(bodyId)
      .first<FolderRow>()
    if (existing) {
      if (existing.owner_id !== user.id) return jsonResponse({ error: 'id_taken' }, 409)
      return jsonResponse(rowToFolder(existing), 200)
    }
  }

  const { results: ownFolders } = await env.DB.prepare(
    'SELECT id, name, parent_id FROM folders WHERE owner_id = ?',
  )
    .bind(user.id)
    .all<{ id: string; name: string; parent_id: string | null }>()
  const folderLikes = ownFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id }))
  const resolvedParentId = (parentId as string | null | undefined) ?? null
  if (!canCreateFolder({ folders: folderLikes, parentId: resolvedParentId })) {
    return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
  }

  const id = typeof bodyId === 'string' ? bodyId : crypto.randomUUID()
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
  )
    .bind(id, user.id, name, resolvedParentId, now, now)
    .run()

  return jsonResponse(
    rowToFolder({
      id,
      owner_id: user.id,
      name: name as string,
      parent_id: resolvedParentId,
      created_at: now,
      updated_at: now,
    }),
    201,
  )
}

export async function handleUpdateFolder(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { name, parentId } = body as Record<string, unknown>

  if (name !== undefined && !isValidFolderName(name)) {
    return jsonResponse({ error: 'invalid', field: 'name' }, 400)
  }
  if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
    return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
  }

  const existing = await getOwnedFolder<FolderRow>(env, params.id, user)
  if (!existing) return errorResponse('not_found', 404)

  let nextParentId = existing.parent_id
  if (parentId !== undefined) {
    const { results: ownFolders } = await env.DB.prepare(
      'SELECT id, name, parent_id FROM folders WHERE owner_id = ?',
    )
      .bind(user.id)
      .all<{ id: string; name: string; parent_id: string | null }>()
    const folderLikes = ownFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id }))
    const resolvedParentId = (parentId as string | null) ?? null
    if (!canMoveFolder({ folders: folderLikes, id: params.id, parentId: resolvedParentId })) {
      return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
    }
    nextParentId = resolvedParentId
  }

  const nextName = name !== undefined ? (name as string) : existing.name
  const now = Date.now()
  await env.DB.prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind(nextName, nextParentId, now, params.id, user.id)
    .run()

  return jsonResponse(
    rowToFolder({ ...existing, name: nextName, parent_id: nextParentId, updated_at: now }),
  )
}

// contents 질의 문자열 — 'move-up'(기본) 또는 'delete-all' (specs/features/F-242.md 3.4)
export async function handleDeleteFolder(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const existing = await getOwnedFolder<FolderRow>(env, params.id, user)
  if (!existing) return errorResponse('not_found', 404)

  const contents = new URL(request.url).searchParams.get('contents') ?? 'move-up'
  if (contents !== 'move-up' && contents !== 'delete-all') {
    return jsonResponse({ error: 'invalid', field: 'contents' }, 400)
  }

  if (contents === 'delete-all') {
    const { results: ownFolders } = await env.DB.prepare(
      'SELECT id, name, parent_id FROM folders WHERE owner_id = ?',
    )
      .bind(user.id)
      .all<{ id: string; name: string; parent_id: string | null }>()
    const folderLikes = ownFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id }))
    const ids = descendantFolderIds(folderLikes, params.id)

    const statements = []
    for (let i = 0; i < ids.length; i += BATCH_ID_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_ID_LIMIT)
      const placeholders = chunk.map(() => '?').join(',')
      statements.push(
        env.DB.prepare(`DELETE FROM docs WHERE owner_id = ? AND folder_id IN (${placeholders})`).bind(
          user.id,
          ...chunk,
        ),
        env.DB.prepare(`DELETE FROM folders WHERE owner_id = ? AND id IN (${placeholders})`).bind(
          user.id,
          ...chunk,
        ),
      )
    }
    if (statements.length > 0) await env.DB.batch(statements)
    return new Response(null, { status: 204 })
  }

  const parentId = existing.parent_id
  await env.DB.batch([
    env.DB.prepare('UPDATE docs SET folder_id = ? WHERE folder_id = ? AND owner_id = ?').bind(
      parentId,
      params.id,
      user.id,
    ),
    env.DB.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND owner_id = ?').bind(
      parentId,
      params.id,
      user.id,
    ),
    env.DB.prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?').bind(params.id, user.id),
  ])

  return new Response(null, { status: 204 })
}
