// 초대(권한 부여) 라우트 — owner 전용 (specs/features/F-212.md 2.3)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES } from './validate'
import { resolveDocAccess, type Role } from './access'

type TargetType = 'doc' | 'folder'

type GrantRow = { grantee_email: string; role: 'view' | 'edit'; created_at: number }

type SharedDocRow = {
  id: string
  title: string
  line_ending: 'crlf' | 'lf'
  folder_id: string | null
  pinned_at: number | null
  version: number
  created_at: number
  updated_at: number
  owner_id: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 320 && EMAIL_RE.test(value)
}

function isValidRole(value: unknown): value is 'view' | 'edit' {
  return value === 'view' || value === 'edit'
}

type OwnerCheck = { ok: true } | { ok: false; status: 404 | 403 }

// 초대·이동·삭제·링크는 owner 만. 권한이 전혀 없으면 404, 있지만(view·edit) owner 가 아니면 403 (F-212 2.2)
async function checkOwnedTarget(env: Env, targetType: TargetType, targetId: string, user: AuthUser): Promise<OwnerCheck> {
  if (targetType === 'doc') {
    const doc = await env.DB.prepare('SELECT id, owner_id, folder_id FROM docs WHERE id = ?')
      .bind(targetId)
      .first<{ id: string; owner_id: string; folder_id: string | null }>()
    if (!doc) return { ok: false, status: 404 }
    if (doc.owner_id === user.id) return { ok: true }
    const access = await resolveDocAccess(env, doc, user)
    return { ok: false, status: access ? 403 : 404 }
  }

  const folder = await env.DB.prepare('SELECT id, owner_id FROM folders WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; owner_id: string }>()
  if (!folder) return { ok: false, status: 404 }
  if (folder.owner_id === user.id) return { ok: true }
  const grant = await env.DB.prepare(
    "SELECT role FROM grants WHERE target_type = 'folder' AND target_id = ? AND grantee_email = ?",
  )
    .bind(targetId, user.email)
    .first<{ role: 'view' | 'edit' }>()
  return { ok: false, status: grant ? 403 : 404 }
}

async function handleListGrants(
  targetType: TargetType,
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, targetType, params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)

  const { results } = await env.DB.prepare(
    'SELECT grantee_email, role, created_at FROM grants WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC',
  )
    .bind(targetType, params.id)
    .all<GrantRow>()
  return jsonResponse(results.map((r) => ({ email: r.grantee_email, role: r.role, createdAt: r.created_at })))
}

async function handlePutGrant(
  targetType: TargetType,
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, targetType, params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)

  const email = params.email.toLowerCase()
  if (!isValidEmail(email)) return jsonResponse({ error: 'invalid', field: 'email' }, 400)
  if (email === user.email) return errorResponse('invalid_self', 400)

  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { role } = body as Record<string, unknown>
  if (!isValidRole(role)) return jsonResponse({ error: 'invalid', field: 'role' }, 400)

  await env.DB.prepare(
    `INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(target_type, target_id, grantee_email) DO UPDATE SET role = excluded.role`,
  )
    .bind(targetType, params.id, user.id, email, role, Date.now())
    .run()

  return jsonResponse({ email, role })
}

async function handleDeleteGrant(
  targetType: TargetType,
  request: Request,
  env: Env,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, targetType, params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)

  const email = params.email.toLowerCase()
  await env.DB.prepare('DELETE FROM grants WHERE target_type = ? AND target_id = ? AND grantee_email = ?')
    .bind(targetType, params.id, email)
    .run()
  return new Response(null, { status: 204 })
}

export const handleGetDocGrants = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleListGrants('doc', r, e, p)
export const handleGetFolderGrants = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleListGrants('folder', r, e, p)
export const handlePutDocGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handlePutGrant('doc', r, e, p)
export const handlePutFolderGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handlePutGrant('folder', r, e, p)
export const handleDeleteDocGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleDeleteGrant('doc', r, e, p)
export const handleDeleteFolderGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleDeleteGrant('folder', r, e, p)

// 나에게 권한이 있는(내 소유가 아닌) 문서 메타 목록 — 문서 직접 grant + 폴더·상위 폴더 grant 로 덮이는 문서
export async function handleGetShared(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)

  const { results: myGrants } = await env.DB.prepare(
    'SELECT target_type, target_id, role FROM grants WHERE grantee_email = ?',
  )
    .bind(user.email)
    .all<{ target_type: TargetType; target_id: string; role: 'view' | 'edit' }>()
  if (myGrants.length === 0) return jsonResponse([])

  const docGrantIds = myGrants.filter((g) => g.target_type === 'doc').map((g) => g.target_id)
  const folderGrantIds = myGrants.filter((g) => g.target_type === 'folder').map((g) => g.target_id)

  const candidateDocIds = new Set<string>(docGrantIds)

  if (folderGrantIds.length > 0) {
    const placeholders = folderGrantIds.map(() => '?').join(',')
    const { results: coveredDocs } = await env.DB.prepare(
      `SELECT id FROM docs WHERE folder_id IN (${placeholders})`,
    )
      .bind(...folderGrantIds)
      .all<{ id: string }>()
    for (const d of coveredDocs) candidateDocIds.add(d.id)

    // 상위 폴더가 grant 대상인 하위 폴더의 문서도 포함 (폴더는 2단계까지)
    const { results: subfolders } = await env.DB.prepare(
      `SELECT id FROM folders WHERE parent_id IN (${placeholders})`,
    )
      .bind(...folderGrantIds)
      .all<{ id: string }>()
    if (subfolders.length > 0) {
      const subIds = subfolders.map((f) => f.id)
      const subPlaceholders = subIds.map(() => '?').join(',')
      const { results: subDocs } = await env.DB.prepare(
        `SELECT id FROM docs WHERE folder_id IN (${subPlaceholders})`,
      )
        .bind(...subIds)
        .all<{ id: string }>()
      for (const d of subDocs) candidateDocIds.add(d.id)
    }
  }

  if (candidateDocIds.size === 0) return jsonResponse([])

  const idList = [...candidateDocIds]
  const idPlaceholders = idList.map(() => '?').join(',')
  const { results: docs } = await env.DB.prepare(
    `SELECT id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at, owner_id FROM docs WHERE id IN (${idPlaceholders})`,
  )
    .bind(...idList)
    .all<SharedDocRow>()

  const folderCache = new Map<string, { id: string; name: string; parent_id: string | null } | null>()
  async function getFolder(id: string) {
    if (!folderCache.has(id)) {
      const f = await env.DB.prepare('SELECT id, name, parent_id FROM folders WHERE id = ?')
        .bind(id)
        .first<{ id: string; name: string; parent_id: string | null }>()
      folderCache.set(id, f ?? null)
    }
    return folderCache.get(id) ?? null
  }

  const ownerEmailCache = new Map<string, string>()
  async function getOwnerEmail(id: string) {
    if (!ownerEmailCache.has(id)) {
      const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string }>()
      ownerEmailCache.set(id, row?.email ?? '')
    }
    return ownerEmailCache.get(id) as string
  }

  const out: Array<{
    id: string
    title: string
    lineEnding: 'crlf' | 'lf'
    folderId: string | null
    pinnedAt: number | null
    version: number
    createdAt: number
    updatedAt: number
    role: Role
    ownerEmail: string
    viaFolder?: { id: string; name: string }
  }> = []

  for (const doc of docs) {
    if (doc.owner_id === user.id) continue
    const access = await resolveDocAccess(env, { id: doc.id, owner_id: doc.owner_id, folder_id: doc.folder_id }, user)
    if (!access) continue

    let viaFolder: { id: string; name: string } | undefined
    if (doc.folder_id) {
      const own = await getFolder(doc.folder_id)
      if (own && folderGrantIds.includes(own.id)) {
        viaFolder = { id: own.id, name: own.name }
      } else if (own?.parent_id && folderGrantIds.includes(own.parent_id)) {
        const parent = await getFolder(own.parent_id)
        if (parent) viaFolder = { id: parent.id, name: parent.name }
      }
    }

    out.push({
      id: doc.id,
      title: doc.title,
      lineEnding: doc.line_ending,
      folderId: doc.folder_id,
      pinnedAt: doc.pinned_at,
      version: doc.version,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      role: access.role,
      ownerEmail: await getOwnerEmail(doc.owner_id),
      viaFolder,
    })
  }

  return jsonResponse(out)
}
