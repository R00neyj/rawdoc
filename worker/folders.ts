// 폴더 라우트 (specs/features/F-206.md 2.4, 접근 판정은 F-212.md 2.2. 사용량 줄은 F-2025.md 6.4, 금고 폴더 규칙은 F-401.md 5장)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES, isValidFolderName, isValidUuid } from './validate'
import { canCreateFolder, canMoveFolder, descendantFolderIds } from '../src/lib/folderTree'
import { getOwnedFolder } from './access'
import { dayUsageStatement, deleteFoldersUsageStatement } from './usage'
import { notifyPurge } from './docRoomRpc'

const BATCH_ID_LIMIT = 100

type FolderRow = {
  id: string
  owner_id: string
  name: string
  parent_id: string | null
  created_at: number
  updated_at: number
  e2ee?: number // 가짜 D1 행에는 없을 수 있다 — 없으면 일반 폴더
}

// 바로 아래의 일반 문서·일반 폴더 (금고 폴더 켜기·금고 부모 아래 move-up 판정)
const PLAIN_CHILDREN_SQL =
  'SELECT (SELECT COUNT(*) FROM docs WHERE owner_id = ?1 AND folder_id = ?2 AND e2ee_key IS NULL) AS docs, (SELECT COUNT(*) FROM folders WHERE owner_id = ?1 AND parent_id = ?2 AND e2ee = 0) AS folders'
const TURN_ON_SQL =
  'UPDATE folders SET name = ?1, parent_id = ?2, updated_at = ?3, e2ee = 1 WHERE id = ?4 AND owner_id = ?5 AND NOT EXISTS (SELECT 1 FROM docs WHERE owner_id = ?5 AND folder_id = ?4 AND e2ee_key IS NULL) AND NOT EXISTS (SELECT 1 FROM folders WHERE owner_id = ?5 AND parent_id = ?4 AND e2ee = 0)'
// 켜기가 0행이면 링크·초대가 그대로 남도록 — 폴더가 실제로 금고일 때만
const REVOKE_FOLDER_LINKS_SQL =
  "UPDATE share_links SET revoked_at = ?1 WHERE target_type = 'folder' AND target_id = ?2 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM folders WHERE id = ?2 AND e2ee = 1)"
const DROP_FOLDER_GRANTS_SQL =
  "DELETE FROM grants WHERE target_type = 'folder' AND target_id = ?1 AND EXISTS (SELECT 1 FROM folders WHERE id = ?1 AND e2ee = 1)"

function isE2eeFolder(row: { e2ee?: number } | null): boolean {
  return row?.e2ee === 1
}

function rowToFolder(row: FolderRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(isE2eeFolder(row) ? { e2ee: true as const } : {}),
  }
}

async function isE2eeParent(env: Env, parentId: string | null, user: AuthUser): Promise<boolean> {
  if (!parentId) return false
  return isE2eeFolder(await getOwnedFolder<FolderRow>(env, parentId, user))
}

async function plainChildren(env: Env, folderId: string, ownerId: string): Promise<{ docs: number; folders: number }> {
  const row = await env.DB.prepare(PLAIN_CHILDREN_SQL).bind(ownerId, folderId).first<{ docs: number; folders: number }>()
  return row ?? { docs: 0, folders: 0 }
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
  const { id: bodyId, name, parentId, e2ee } = body as Record<string, unknown>

  if (bodyId !== undefined && !isValidUuid(bodyId)) {
    return jsonResponse({ error: 'invalid', field: 'id' }, 400)
  }
  if (!isValidFolderName(name)) return jsonResponse({ error: 'invalid', field: 'name' }, 400)
  if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
    return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
  }
  if (e2ee !== undefined && typeof e2ee !== 'boolean') return jsonResponse({ error: 'invalid', field: 'e2ee' }, 400)

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
  // 금고 폴더 아래는 늘 금고 (5.2)
  if (e2ee !== true && (await isE2eeParent(env, resolvedParentId, user))) return jsonResponse({ error: 'e2ee_folder' }, 409)

  const id = typeof bodyId === 'string' ? bodyId : crypto.randomUUID()
  const now = Date.now()
  const e2eeValue = e2ee === true ? 1 : 0
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)',
    ).bind(id, user.id, name, resolvedParentId, now, now, e2eeValue),
    dayUsageStatement(env.DB, user.id, now),
  ])

  return jsonResponse(
    rowToFolder({
      id,
      owner_id: user.id,
      name: name as string,
      parent_id: resolvedParentId,
      created_at: now,
      updated_at: now,
      e2ee: e2eeValue,
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
  const { name, parentId, e2ee } = body as Record<string, unknown>

  if (name !== undefined && !isValidFolderName(name)) {
    return jsonResponse({ error: 'invalid', field: 'name' }, 400)
  }
  if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
    return jsonResponse({ error: 'invalid', field: 'parentId' }, 400)
  }
  if (e2ee !== undefined && typeof e2ee !== 'boolean') return jsonResponse({ error: 'invalid', field: 'e2ee' }, 400)

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

  const wasE2ee = isE2eeFolder(existing)
  const nextE2ee = typeof e2ee === 'boolean' ? e2ee : wasE2ee
  // 새 부모(또는 끄기일 때 지금 부모)가 금고면 결과도 금고여야 한다 — 금고 폴더 아래는 늘 금고 (5.2, 11장 Q3)
  if ((parentId !== undefined || e2ee === false) && !nextE2ee && (await isE2eeParent(env, nextParentId, user))) {
    return jsonResponse({ error: 'e2ee_folder' }, 409)
  }
  const turningOn = nextE2ee && !wasE2ee
  if (turningOn) {
    const children = await plainChildren(env, params.id, user.id)
    if (children.docs > 0 || children.folders > 0) return jsonResponse({ error: 'e2ee_folder_not_ready', ...children }, 409)
  }

  const nextName = name !== undefined ? (name as string) : existing.name
  const now = Date.now()
  const turningOff = wasE2ee && !nextE2ee
  const updateSql = turningOn
    ? TURN_ON_SQL
    : `UPDATE folders SET name = ?, parent_id = ?, updated_at = ?${turningOff ? ', e2ee = 0' : ''} WHERE id = ? AND owner_id = ?`
  const statements = [env.DB.prepare(updateSql).bind(nextName, nextParentId, now, params.id, user.id)]
  if (turningOn) {
    statements.push(
      env.DB.prepare(REVOKE_FOLDER_LINKS_SQL).bind(now, params.id),
      env.DB.prepare(DROP_FOLDER_GRANTS_SQL).bind(params.id),
    )
  }
  statements.push(dayUsageStatement(env.DB, user.id, now))
  const [written] = await env.DB.batch(statements)
  // 사전 검사 뒤 끼어든 평문 — 켜기가 0행이면 다시 센다. 하루는 이미 +1 이다 (5.2)
  if (turningOn && written.meta.changes !== 1) {
    return jsonResponse({ error: 'e2ee_folder_not_ready', ...(await plainChildren(env, params.id, user.id)) }, 409)
  }

  return jsonResponse(
    rowToFolder({ ...existing, name: nextName, parent_id: nextParentId, updated_at: now, e2ee: nextE2ee ? 1 : 0 }),
  )
}

// contents 질의 문자열 — 'move-up'(기본) 또는 'delete-all' (specs/features/F-242.md 3.4)
export async function handleDeleteFolder(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
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

    // 지울 문서 id 를 먼저 모은다 — share_link_docs 정리(FK, 버그 수정 F-2038.md 12장 X1)와
    // DO 방 비우기(notifyPurge, 문서 단건 삭제와 같게, X2) 둘 다 문서 id 가 있어야 한다
    const docIds: string[] = []
    for (let i = 0; i < ids.length; i += BATCH_ID_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_ID_LIMIT)
      const placeholders = chunk.map(() => '?').join(',')
      const { results } = await env.DB.prepare(
        `SELECT id FROM docs WHERE owner_id = ? AND folder_id IN (${placeholders})`,
      )
        .bind(user.id, ...chunk)
        .all<{ id: string }>()
      docIds.push(...results.map((r) => r.id))
    }

    const statements = []
    if (ids.length > 0) statements.push(deleteFoldersUsageStatement(env.DB, user.id, ids, Date.now()))
    for (let i = 0; i < docIds.length; i += BATCH_ID_LIMIT) {
      const chunk = docIds.slice(i, i + BATCH_ID_LIMIT)
      const placeholders = chunk.map(() => '?').join(',')
      statements.push(env.DB.prepare(`DELETE FROM share_link_docs WHERE doc_id IN (${placeholders})`).bind(...chunk))
    }
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
    // 열린 연결을 닫고 DO 저장소를 비운다 — 문서 단건 삭제와 같게 (F-304 9.4, 버그 수정 X2)
    for (const docId of docIds) await notifyPurge(env, ctx, docId)
    return new Response(null, { status: 204 })
  }

  const parentId = existing.parent_id
  // 올라가는 평문이 금고 폴더에 들어가지 않게 (5.2)
  if (await isE2eeParent(env, parentId, user)) {
    const children = await plainChildren(env, params.id, user.id)
    if (children.docs > 0 || children.folders > 0) return jsonResponse({ error: 'e2ee_folder' }, 409)
  }
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
    dayUsageStatement(env.DB, user.id, Date.now()),
  ])

  return new Response(null, { status: 204 })
}
