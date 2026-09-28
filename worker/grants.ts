// 초대(권한 부여) 라우트 — owner 전용 (specs/features/F-212.md 2.3. 사용량 줄은 F-2025.md 6.4)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES } from './validate'
import { higherRole, resolveDocAccess, type GrantRole, type Role } from './access'
import { notifyRevalidate } from './docRoomRpc'
import { dayUsageStatement } from './usage'

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

type OwnerCheck = { ok: true; e2ee: boolean } | { ok: false; status: 404 | 403 }

// 초대·이동·삭제·링크는 owner 만. 권한이 전혀 없으면 404, 있지만(view·edit) owner 가 아니면 403 (F-212 2.2)
// 금고 판정 열을 함께 읽는다 — resolveDocAccess 가 금고 비소유자를 null 로 본다 (F-401 X3)
async function checkOwnedTarget(env: Env, targetType: TargetType, targetId: string, user: AuthUser): Promise<OwnerCheck> {
  if (targetType === 'doc') {
    const doc = await env.DB.prepare('SELECT id, owner_id, folder_id, e2ee_key FROM docs WHERE id = ?')
      .bind(targetId)
      .first<{ id: string; owner_id: string; folder_id: string | null; e2ee_key?: string | null }>()
    if (!doc) return { ok: false, status: 404 }
    if (doc.owner_id === user.id) return { ok: true, e2ee: typeof doc.e2ee_key === 'string' }
    const access = await resolveDocAccess(env, doc, user)
    return { ok: false, status: access ? 403 : 404 }
  }

  const folder = await env.DB.prepare('SELECT id, owner_id, e2ee FROM folders WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; owner_id: string; e2ee?: number }>()
  if (!folder) return { ok: false, status: 404 }
  if (folder.owner_id === user.id) return { ok: true, e2ee: folder.e2ee === 1 }
  const grant = await env.DB.prepare(
    "SELECT role FROM grants WHERE target_type = 'folder' AND target_id = ? AND owner_id = ? AND grantee_email = ?",
  )
    .bind(targetId, folder.owner_id, user.email)
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

  // 지금 소유자가 준 초대만 — 지운 id 를 남이 다시 만들면 옛 초대 이메일이 보이지 않는다 (리뷰 W2)
  const { results } = await env.DB.prepare(
    'SELECT grantee_email, role, created_at FROM grants WHERE target_type = ? AND target_id = ? AND owner_id = ? ORDER BY created_at ASC',
  )
    .bind(targetType, params.id, user.id)
    .all<GrantRow>()
  return jsonResponse(results.map((r) => ({ email: r.grantee_email, role: r.role, createdAt: r.created_at })))
}

async function handlePutGrant(
  targetType: TargetType,
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, targetType, params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)
  // 금고 문서·폴더에는 초대 행이 생기지 않는다 (F-401 X4)
  if (check.e2ee) return jsonResponse({ error: targetType === 'doc' ? 'e2ee_doc' : 'e2ee_folder' }, 409)

  const email = params.email.toLowerCase()
  if (!isValidEmail(email)) return jsonResponse({ error: 'invalid', field: 'email' }, 400)
  if (email === user.email) return errorResponse('invalid_self', 400)

  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { role } = body as Record<string, unknown>
  if (!isValidRole(role)) return jsonResponse({ error: 'invalid', field: 'role' }, 400)

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(target_type, target_id, grantee_email) DO UPDATE SET role = excluded.role, owner_id = excluded.owner_id`,
    ).bind(targetType, params.id, user.id, email, role, now),
    dayUsageStatement(env.DB, user.id, now),
  ])

  const response = jsonResponse({ email, role })
  // 보기로 낮추면 열린 편집 연결을 다시 본다. 폴더 초대는 주기 점검이 잡는다 (F-304 9.1)
  if (targetType === 'doc' && role === 'view') await notifyRevalidate(env, ctx, params.id, email)
  return response
}

async function handleDeleteGrant(
  targetType: TargetType,
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const check = await checkOwnedTarget(env, targetType, params.id, user)
  if (!check.ok) return errorResponse(check.status === 403 ? 'forbidden' : 'not_found', check.status)

  const email = params.email.toLowerCase()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM grants WHERE target_type = ? AND target_id = ? AND owner_id = ? AND grantee_email = ?').bind(
      targetType,
      params.id,
      user.id,
      email,
    ),
    dayUsageStatement(env.DB, user.id, Date.now()),
  ])
  const response = new Response(null, { status: 204 })
  if (targetType === 'doc') await notifyRevalidate(env, ctx, params.id, email)
  return response
}

export const handleGetDocGrants = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleListGrants('doc', r, e, p)
export const handleGetFolderGrants = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleListGrants('folder', r, e, p)
export const handlePutDocGrant = (r: Request, e: Env, c: ExecutionContext, p: Record<string, string>) =>
  handlePutGrant('doc', r, e, c, p)
export const handlePutFolderGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handlePutGrant('folder', r, e, undefined, p)
export const handleDeleteDocGrant = (r: Request, e: Env, c: ExecutionContext, p: Record<string, string>) =>
  handleDeleteGrant('doc', r, e, c, p)
export const handleDeleteFolderGrant = (r: Request, e: Env, _c: ExecutionContext, p: Record<string, string>) =>
  handleDeleteGrant('folder', r, e, undefined, p)

// 저장된 부모 사슬(가까운 것부터) — folderAncestors 와 같은 규칙을 미리 만든 표로. 없는 폴더·순환에서 멈춘다
function storedChain(folderById: Map<string, { parent_id: string | null }>, folderId: string): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current: string | null = folderId
  while (current !== null && folderById.has(current) && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = folderById.get(current)!.parent_id
  }
  return chain
}

const SHARED_DOC_COLUMNS = 'id, title, line_ending, folder_id, pinned_at, version, created_at, updated_at, owner_id'
const BATCH_ID_LIMIT = 100

// 내 폴더 초대(?1 이메일, ?2 내 id)를 기점으로 같은 소유자의 하위 폴더만. UNION 이라 순환에서 멈춘다 (F-2058 3.2)
const SHARED_SUBTREE_CTE = `WITH RECURSIVE sub(id, owner_id) AS (
  SELECT f.id, f.owner_id FROM grants g JOIN folders f ON f.id = g.target_id AND f.owner_id = g.owner_id
   WHERE g.grantee_email = ?1 AND g.target_type = 'folder' AND g.owner_id <> ?2
  UNION
  SELECT f.id, f.owner_id FROM folders f JOIN sub s ON f.parent_id = s.id AND f.owner_id = s.owner_id
)`

// CROSS JOIN 은 고리 순서 고정 — 그냥 JOIN 이면 docs 를 바깥에 두고 훑는다 (F-2058 머리 (e))
export const SHARED_FOLDERS_SQL = `${SHARED_SUBTREE_CTE}
SELECT f.id, f.name, f.parent_id, f.owner_id FROM sub s CROSS JOIN folders f ON f.id = s.id`

export const SHARED_DOCS_SQL = `${SHARED_SUBTREE_CTE}
SELECT d.id, d.title, d.line_ending, d.folder_id, d.pinned_at, d.version, d.created_at, d.updated_at, d.owner_id
  FROM sub s CROSS JOIN docs d ON d.owner_id = s.owner_id AND d.folder_id = s.id
 WHERE d.e2ee_key IS NULL`

type SharedItem = {
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
}

// 내 소유가 아닌 공유받은 문서 목록 — 초대 폴더 하위만 재귀로 + 문서 초대. 질의 수는 폴더 깊이·문서 수와 무관하다 (F-2017 4.4, F-2058)
export async function handleGetShared(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)

  const { results: myGrants } = await env.DB.prepare(
    'SELECT target_type, target_id, role, owner_id FROM grants WHERE grantee_email = ?',
  )
    .bind(user.email)
    .all<{ target_type: TargetType; target_id: string; role: GrantRole; owner_id: string }>()
  if (myGrants.length === 0) return jsonResponse([])

  // 문서 초대는 준 소유자와 함께 — 같은 id 로 남의 문서가 생겨도 옛 초대가 붙지 않는다 (리뷰 W2)
  const docGrants = new Map<string, { role: GrantRole; ownerId: string }>()
  const docGrantRole = (doc: SharedDocRow): GrantRole | null => {
    const g = docGrants.get(doc.id)
    return g && g.ownerId === doc.owner_id ? g.role : null
  }
  const folderGrantsByOwner = new Map<string, Map<string, GrantRole>>()
  for (const g of myGrants) {
    if (g.target_type === 'doc') {
      docGrants.set(g.target_id, { role: g.role, ownerId: g.owner_id })
      continue
    }
    const byFolder = folderGrantsByOwner.get(g.owner_id) ?? new Map<string, GrantRole>()
    byFolder.set(g.target_id, g.role)
    folderGrantsByOwner.set(g.owner_id, byFolder)
  }

  const picked: Array<{ doc: SharedDocRow; role: GrantRole; viaFolder?: { id: string; name: string } }> = []
  const pickedIds = new Set<string>()

  if (folderGrantsByOwner.size > 0) {
    const { results: folders } = await env.DB.prepare(SHARED_FOLDERS_SQL)
      .bind(user.email, user.id)
      .all<{ id: string; name: string; parent_id: string | null; owner_id: string }>()
    const { results: docs } = await env.DB.prepare(SHARED_DOCS_SQL).bind(user.email, user.id).all<SharedDocRow>()

    // 하위 폴더만 든 표로 걸어도 사슬 앞부분에 초대 폴더가 모두 있다 (F-2058 5장)
    const foldersByOwner = new Map<string, Map<string, { name: string; parent_id: string | null }>>()
    for (const f of folders) {
      const byId = foldersByOwner.get(f.owner_id) ?? new Map<string, { name: string; parent_id: string | null }>()
      byId.set(f.id, f)
      foldersByOwner.set(f.owner_id, byId)
    }
    for (const doc of docs) {
      const folderById = foldersByOwner.get(doc.owner_id)
      const folderGrants = folderGrantsByOwner.get(doc.owner_id)
      let folderRole: GrantRole | null = null
      let viaFolder: { id: string; name: string } | undefined
      if (doc.folder_id && folderById && folderGrants) {
        for (const id of storedChain(folderById, doc.folder_id)) {
          const role = folderGrants.get(id)
          if (!role) continue
          folderRole = higherRole(folderRole, role)
          if (!viaFolder) viaFolder = { id, name: folderById.get(id)?.name ?? '' }
        }
      }
      const role = higherRole(folderRole, docGrantRole(doc))
      if (!role) continue
      picked.push({ doc, role, viaFolder })
      pickedIds.add(doc.id)
    }
  }

  // 하위 CTE 에서 뽑히지 않은 문서 초대 — 바인딩 한도 때문에 100개씩 나눈다
  const docOnlyIds = myGrants
    .filter((g) => g.target_type === 'doc' && !pickedIds.has(g.target_id))
    .map((g) => g.target_id)
  for (let i = 0; i < docOnlyIds.length; i += BATCH_ID_LIMIT) {
    const batch = docOnlyIds.slice(i, i + BATCH_ID_LIMIT)
    const { results: docs } = await env.DB.prepare(
      `SELECT ${SHARED_DOC_COLUMNS} FROM docs WHERE id IN (${batch.map(() => '?').join(',')}) AND e2ee_key IS NULL`,
    )
      .bind(...batch)
      .all<SharedDocRow>()
    for (const doc of docs) {
      const role = docGrantRole(doc)
      if (role) picked.push({ doc, role })
    }
  }

  const ownerEmailCache = new Map<string, string>()
  async function getOwnerEmail(id: string) {
    if (!ownerEmailCache.has(id)) {
      const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first<{ email: string }>()
      ownerEmailCache.set(id, row?.email ?? '')
    }
    return ownerEmailCache.get(id) as string
  }

  const out: SharedItem[] = []
  for (const { doc, role, viaFolder } of picked) {
    if (doc.owner_id === user.id) continue
    out.push({
      id: doc.id,
      title: doc.title,
      lineEnding: doc.line_ending,
      folderId: doc.folder_id,
      pinnedAt: doc.pinned_at,
      version: doc.version,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      role,
      ownerEmail: await getOwnerEmail(doc.owner_id),
      viaFolder,
    })
  }

  return jsonResponse(out)
}
