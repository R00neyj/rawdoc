// 문서 라우트 (specs/features/F-206.md 2.3, 접근 판정은 F-212.md 2.2. 사용량 줄·413 은 F-2025.md 6.2)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { getDocAccess, roleAtLeast } from './access'
import { getActiveLock } from './locks'
import { notifyPurge } from './docRoomRpc'
import { rowToDoc, updateDocRow } from './docWrite'
import type { DocRow } from './docWrite'
import {
  checkDocCreate,
  checkDocGrow,
  dayUsageStatement,
  deleteDocUsageStatement,
  docUsageStatements,
  readUsage,
  usageOf,
  utf8Bytes,
} from './usage'
import {
  MAX_BODY_BYTES,
  MAX_CONTENT_BYTES,
  isContentTooLarge,
  isValidLineEnding,
  isValidPinnedAt,
  isValidTimestamp,
  isValidTitle,
  isValidUuid,
} from './validate'

type ReadJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'too_large' | 'invalid_json' }

// 본문을 maxBytes 넘게 읽지 않는다. 넘으면 읽기를 멈추고 too_large 를 돌려준다
export async function readJsonLimited(request: Request, maxBytes: number): Promise<ReadJsonResult> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number(contentLength) > maxBytes) {
    return { ok: false, reason: 'too_large' }
  }
  if (!request.body) return { ok: true, data: undefined }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, reason: 'too_large' }
    }
    chunks.push(value)
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.length
  }
  const text = new TextDecoder().decode(buffer)
  if (text === '') return { ok: true, data: undefined }
  try {
    return { ok: true, data: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

function rowToDocSummary(row: Omit<DocRow, 'content' | 'owner_id'>) {
  return {
    id: row.id,
    title: row.title,
    lineEnding: row.line_ending,
    folderId: row.folder_id,
    pinnedAt: row.pinned_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function badBody(parsed: { reason: 'too_large' | 'invalid_json' }): Response {
  if (parsed.reason === 'too_large') {
    return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
  }
  return errorResponse('invalid', 400)
}

export async function handleListDocs(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(
    'SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at FROM docs WHERE owner_id = ? ORDER BY updated_at DESC',
  )
    .bind(user.id)
    .all<Omit<DocRow, 'content' | 'owner_id'>>()
  return jsonResponse(results.map(rowToDocSummary))
}

export async function handleGetDoc(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  return jsonResponse(rowToDoc(access.doc))
}

export async function handleCreateDoc(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { id: bodyId, title, content, lineEnding, folderId, createdAt, updatedAt, pinnedAt } =
    body as Record<string, unknown>

  if (bodyId !== undefined && !isValidUuid(bodyId)) {
    return jsonResponse({ error: 'invalid', field: 'id' }, 400)
  }
  if (!isValidTitle(title)) return jsonResponse({ error: 'invalid', field: 'title' }, 400)
  if (typeof content !== 'string') return jsonResponse({ error: 'invalid', field: 'content' }, 400)
  if (!isValidLineEnding(lineEnding)) {
    return jsonResponse({ error: 'invalid', field: 'lineEnding' }, 400)
  }
  if (folderId !== undefined && folderId !== null && !isValidUuid(folderId)) {
    return jsonResponse({ error: 'invalid', field: 'folderId' }, 400)
  }
  if (createdAt !== undefined && !isValidTimestamp(createdAt)) {
    return jsonResponse({ error: 'invalid', field: 'createdAt' }, 400)
  }
  if (updatedAt !== undefined && !isValidTimestamp(updatedAt)) {
    return jsonResponse({ error: 'invalid', field: 'updatedAt' }, 400)
  }
  if (pinnedAt !== undefined && !isValidPinnedAt(pinnedAt)) {
    return jsonResponse({ error: 'invalid', field: 'pinnedAt' }, 400)
  }
  if (isContentTooLarge(content)) {
    return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
  }

  if (typeof bodyId === 'string') {
    const existing = await env.DB.prepare('SELECT * FROM docs WHERE id = ?').bind(bodyId).first<DocRow>()
    if (existing) {
      if (existing.owner_id !== user.id) return jsonResponse({ error: 'id_taken' }, 409)
      return jsonResponse(rowToDoc(existing), 200)
    }
  }

  const newBytes = utf8Bytes(content)
  const quota = checkDocCreate(await usageOf(env, user), newBytes)
  if (quota) return jsonResponse(quota, 413)

  const id = typeof bodyId === 'string' ? bodyId : crypto.randomUUID()
  const now = Date.now()
  const resolvedFolderId = (folderId as string | null | undefined) ?? null
  const resolvedCreatedAt = typeof createdAt === 'number' ? createdAt : now
  const resolvedUpdatedAt = typeof updatedAt === 'number' ? updatedAt : now
  const resolvedPinnedAt = pinnedAt === undefined ? null : (pinnedAt as number | null)
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).bind(id, user.id, title, content, lineEnding, resolvedFolderId, resolvedPinnedAt, 1, resolvedCreatedAt, resolvedUpdatedAt),
    ...docUsageStatements(env.DB, { actorId: user.id, ownerId: user.id, now, deltaBytes: newBytes, deltaDocs: 1 }),
  ])

  return jsonResponse(
    rowToDoc({
      id,
      owner_id: user.id,
      title: title as string,
      content,
      line_ending: lineEnding as 'crlf' | 'lf',
      folder_id: resolvedFolderId,
      pinned_at: resolvedPinnedAt,
      version: 1,
      created_at: resolvedCreatedAt,
      updated_at: resolvedUpdatedAt,
    }),
    201,
  )
}

export async function handleUpdateDoc(
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
  const { title, content, baseVersion } = body as Record<string, unknown>

  if (title !== undefined && !isValidTitle(title)) {
    return jsonResponse({ error: 'invalid', field: 'title' }, 400)
  }
  if (content !== undefined && typeof content !== 'string') {
    return jsonResponse({ error: 'invalid', field: 'content' }, 400)
  }
  if (typeof content === 'string' && isContentTooLarge(content)) {
    return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
  }
  if (!Number.isInteger(baseVersion)) {
    return jsonResponse({ error: 'invalid', field: 'baseVersion' }, 400)
  }

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.blocked) return errorResponse('account_blocked', 403) // 쓸 수 있던 사람의 막힘 — 보낸 사람 또는 문서 소유자 (F-2028 4.3)
  if (!roleAtLeast(access.role, 'edit')) return errorResponse('forbidden', 403)
  const existing = access.doc

  const activeLock = await getActiveLock(env, params.id)
  if (activeLock && activeLock.session_id !== request.headers.get('X-Lock-Session')) {
    return jsonResponse({ error: 'locked', email: activeLock.email, expiresAt: activeLock.expires_at }, 423)
  }

  if (existing.version !== baseVersion) {
    return jsonResponse({ error: 'conflict', doc: rowToDoc(existing) }, 409)
  }

  if (typeof content === 'string') {
    const deltaBytes = utf8Bytes(content) - utf8Bytes(existing.content)
    if (deltaBytes > 0) {
      const ownerUsage = existing.owner_id === user.id ? await usageOf(env, user) : await readUsage(env, existing.owner_id)
      const quota = checkDocGrow(ownerUsage, deltaBytes)
      if (quota) return jsonResponse(quota, 413)
    }
  }

  const written = await updateDocRow(
    env,
    existing,
    {
      title: title as string | undefined,
      content: content as string | undefined,
    },
    user.id,
  )
  if (!written.ok) {
    const latest = await env.DB.prepare('SELECT * FROM docs WHERE id = ? AND owner_id = ?')
      .bind(params.id, existing.owner_id)
      .first<DocRow>()
    if (!latest) return errorResponse('not_found', 404)
    return jsonResponse({ error: 'conflict', doc: rowToDoc(latest) }, 409)
  }

  return jsonResponse(rowToDoc(written.row))
}

export async function handleMoveDocFolder(
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
  const { folderId } = body as Record<string, unknown>
  if (folderId !== null && !isValidUuid(folderId)) {
    return jsonResponse({ error: 'invalid', field: 'folderId' }, 400)
  }

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)
  const existing = access.doc

  if (folderId !== null) {
    const folder = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ?')
      .bind(folderId, user.id)
      .first<{ id: string }>()
    if (!folder) return jsonResponse({ error: 'invalid', field: 'folderId' }, 400)
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE docs SET folder_id = ? WHERE id = ? AND owner_id = ?').bind(folderId, params.id, user.id),
    dayUsageStatement(env.DB, user.id, Date.now()),
  ])

  return jsonResponse(rowToDoc({ ...existing, folder_id: folderId as string | null }))
}

export async function handleSetPinned(
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
  const { pinned } = body as Record<string, unknown>
  if (typeof pinned !== 'boolean') return jsonResponse({ error: 'invalid', field: 'pinned' }, 400)

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)
  const existing = access.doc

  const pinnedAt = pinned ? Date.now() : null
  await env.DB.batch([
    env.DB.prepare('UPDATE docs SET pinned_at = ? WHERE id = ? AND owner_id = ?').bind(pinnedAt, params.id, user.id),
    dayUsageStatement(env.DB, user.id, Date.now()),
  ])

  return jsonResponse(rowToDoc({ ...existing, pinned_at: pinnedAt }))
}

export async function handleDeleteDoc(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)

  await env.DB.batch([
    deleteDocUsageStatement(env.DB, user.id, params.id, Date.now()),
    env.DB.prepare('DELETE FROM docs WHERE id = ? AND owner_id = ?').bind(params.id, user.id),
  ])
  // 열린 연결을 닫고 DO 저장소를 비운다 (F-304 9.4)
  await notifyPurge(env, ctx, params.id)
  return new Response(null, { status: 204 })
}
