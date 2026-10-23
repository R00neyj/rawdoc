// 공유 폴더에 편집 초대자가 만든 새 문서는 폴더 소유자 소유 (specs/features/F-4017.md 3.1)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { folderChainRole, isWriteBlocked, resolveDocAccess, roleAtLeast } from './access'
import { badBody, checkTitleContent, fieldErrorResponse, readJsonLimited } from './docs'
import type { DocRow } from './docWrite'
import { DOC_BYTES_QUOTA, DOC_COUNT_QUOTA, checkDocCreate, docUsageStatements, quotaPushInBackground, readUsage, utf8Bytes } from './usage'
import { MAX_BODY_BYTES, isValidLineEnding, isValidTimestamp, isValidUuid } from './validate'

const FORBIDDEN_FIELDS = ['folderId', 'pinnedAt', 'e2eeKey', 'attachmentRefs'] as const

// 폴더 자신부터 위로 — 같은 소유자 폴더만, UNION 이라 순환에서 멈춘다
const CHAIN_SQL = `WITH RECURSIVE chain(id, parent_id, name, e2ee) AS (
  SELECT id, parent_id, name, e2ee FROM folders WHERE id = ?1 AND owner_id = ?2
  UNION
  SELECT f.id, f.parent_id, f.name, f.e2ee FROM folders f JOIN chain c ON f.id = c.parent_id WHERE f.owner_id = ?2
)
SELECT id, parent_id, name, e2ee FROM chain`

type ChainRow = { id: string; parent_id: string | null; name: string; e2ee: number }

async function readChain(env: Env, folderId: string, ownerId: string): Promise<ChainRow[]> {
  const { results } = await env.DB.prepare(CHAIN_SQL).bind(folderId, ownerId).all<ChainRow>()
  const byId = new Map(results.map((r) => [r.id, r]))
  const ordered: ChainRow[] = []
  const seen = new Set<string>()
  let current: string | null = folderId
  while (current !== null && byId.has(current) && !seen.has(current)) {
    ordered.push(byId.get(current)!)
    seen.add(current)
    current = byId.get(current)!.parent_id
  }
  return ordered
}

async function nearestInvited(env: Env, chain: ChainRow[], ownerId: string, email: string): Promise<{ id: string; name: string } | null> {
  const { results } = await env.DB.prepare("SELECT target_id FROM grants WHERE grantee_email = ? AND owner_id = ? AND target_type = 'folder'")
    .bind(email, ownerId)
    .all<{ target_id: string }>()
  const invited = new Set(results.map((g) => g.target_id))
  const hit = chain.find((f) => invited.has(f.id))
  return hit ? { id: hit.id, name: hit.name } : null
}

function toItem(row: DocRow, ownerEmail: string, viaFolder: { id: string; name: string }) {
  return {
    id: row.id,
    title: row.title,
    lineEnding: row.line_ending,
    folderId: row.folder_id,
    pinnedAt: null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: 'edit' as const,
    ownerEmail,
    viaFolder,
  }
}

export async function handleCreateSharedFolderDoc(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const fields = body as Record<string, unknown>
  for (const field of FORBIDDEN_FIELDS) {
    if (fields[field] !== undefined) return jsonResponse({ error: 'invalid', field }, 400)
  }
  const { id: bodyId, title, content, lineEnding, createdAt, updatedAt } = fields
  if (bodyId !== undefined && !isValidUuid(bodyId)) return jsonResponse({ error: 'invalid', field: 'id' }, 400)
  if (!isValidLineEnding(lineEnding)) return jsonResponse({ error: 'invalid', field: 'lineEnding' }, 400)
  if (createdAt !== undefined && !isValidTimestamp(createdAt)) return jsonResponse({ error: 'invalid', field: 'createdAt' }, 400)
  if (updatedAt !== undefined && !isValidTimestamp(updatedAt)) return jsonResponse({ error: 'invalid', field: 'updatedAt' }, 400)
  const fieldError = checkTitleContent(title, content, false, true)
  if (fieldError) return fieldErrorResponse(fieldError)

  const folderId = params.id
  if (!isValidUuid(folderId)) return errorResponse('not_found', 404)
  const folder = await env.DB.prepare('SELECT id, owner_id FROM folders WHERE id = ?').bind(folderId).first<{ id: string; owner_id: string }>()
  if (!folder) return errorResponse('not_found', 404)
  if (folder.owner_id === user.id) return jsonResponse({ error: 'own_folder' }, 409)

  const role = await folderChainRole(env, folderId, folder.owner_id, user.email)
  if (!role) return errorResponse('not_found', 404)
  if (role === 'view') return errorResponse('forbidden', 403)

  const chain = await readChain(env, folderId, folder.owner_id)
  if (chain.some((f) => f.e2ee === 1)) return errorResponse('not_found', 404)
  if (await isWriteBlocked(env, { id: '', owner_id: folder.owner_id, folder_id: folderId }, user)) return errorResponse('account_blocked', 403)

  const owner = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(folder.owner_id).first<{ email: string }>()
  const ownerEmail = owner?.email ?? ''
  const via = (await nearestInvited(env, chain, folder.owner_id, user.email)) ?? { id: folderId, name: chain[0]?.name ?? '' }

  if (typeof bodyId === 'string') {
    const existing = await env.DB.prepare('SELECT * FROM docs WHERE id = ?').bind(bodyId).first<DocRow>()
    if (existing) {
      const access = existing.owner_id === folder.owner_id ? await resolveDocAccess(env, existing, user) : null
      const reusable = existing.deleted_at == null && existing.e2ee_key == null && access !== null && roleAtLeast(access.role, 'edit')
      if (!reusable) return jsonResponse({ error: 'id_taken' }, 409)
      const existingChain = existing.folder_id ? await readChain(env, existing.folder_id, folder.owner_id) : []
      const existingVia = (await nearestInvited(env, existingChain, folder.owner_id, user.email)) ?? via
      return jsonResponse(toItem(existing, ownerEmail, existingVia), 200)
    }
  }

  const ownerUsage = await readUsage(env, folder.owner_id)
  const newBytes = utf8Bytes(content as string)
  const quota = checkDocCreate(ownerUsage, newBytes)
  if (quota) return jsonResponse({ error: 'owner_quota_exceeded', resource: quota.resource }, 413)

  const id = typeof bodyId === 'string' ? bodyId : crypto.randomUUID()
  const now = Date.now()
  const row: DocRow = {
    id,
    owner_id: folder.owner_id,
    title: title as string,
    content: content as string,
    line_ending: lineEnding as 'crlf' | 'lf',
    folder_id: folderId,
    pinned_at: null,
    version: 1,
    created_at: typeof createdAt === 'number' ? createdAt : now,
    updated_at: typeof updatedAt === 'number' ? updatedAt : now,
    e2ee_key: null,
    attachment_refs: null,
  }
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key, attachment_refs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(row.id, row.owner_id, row.title, row.content, row.line_ending, folderId, null, 1, row.created_at, row.updated_at, null, null),
    ...docUsageStatements(env.DB, { actorId: user.id, ownerId: folder.owner_id, now, deltaBytes: newBytes, deltaDocs: 1 }),
  ])
  await quotaPushInBackground(
    env,
    ctx,
    folder.owner_id,
    {
      docBytes: { used: ownerUsage.contentBytes + newBytes, limit: DOC_BYTES_QUOTA },
      docCount: { used: ownerUsage.docCount + 1, limit: DOC_COUNT_QUOTA },
    },
    now,
  )
  return jsonResponse(toItem(row, ownerEmail, via), 201)
}
