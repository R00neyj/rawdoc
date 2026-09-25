// 문서·폴더 접근 권한 판정 (specs/features/F-212.md 2.2, 막힌 계정은 F-2028.md 4.2)
import type { AuthUser } from './auth'
import { folderAncestors } from '../src/lib/folderTree'
import { readUsage, usageOf } from './usage'

export type Role = 'owner' | 'edit' | 'view'
export type GrantRole = 'view' | 'edit'

const RANK: Record<GrantRole, number> = { view: 1, edit: 2 }

export function higherRole(a: GrantRole | null, b: GrantRole | null): GrantRole | null {
  if (!a) return b
  if (!b) return a
  return RANK[a] >= RANK[b] ? a : b
}

export function roleAtLeast(role: Role, min: GrantRole): boolean {
  if (role === 'owner') return true
  return RANK[role] >= RANK[min]
}

async function grantRole(
  env: Env,
  targetType: 'doc' | 'folder',
  targetId: string,
  email: string,
): Promise<GrantRole | null> {
  const row = await env.DB.prepare(
    'SELECT role FROM grants WHERE target_type = ? AND target_id = ? AND grantee_email = ?',
  )
    .bind(targetType, targetId, email)
    .first<{ role: GrantRole }>()
  return row?.role ?? null
}

// 위로 올라가는 재귀 — 기본키로 찾고 UNION 이라 순환에서도 끝난다 (F-2017 4.3)
const FOLDER_CHAIN_SQL = `WITH RECURSIVE chain(id, parent_id) AS (
  SELECT id, parent_id FROM folders WHERE id = ? AND owner_id = ?
  UNION
  SELECT f.id, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id WHERE f.owner_id = ?
)
SELECT id, parent_id FROM chain`

// 사슬의 폴더 초대 중 가장 높은 역할 — 사슬은 가까운 것부터, 없는 폴더·순환에서 멈춘다
function chainRole(
  folders: { id: string; parent_id: string | null }[],
  folderId: string | null,
  folderGrants: Map<string, GrantRole>,
): GrantRole | null {
  let role: GrantRole | null = null
  const chain = folderAncestors(
    folders.map((f) => ({ id: f.id, name: '', parentId: f.parent_id })),
    folderId,
  )
  for (const id of chain) role = higherRole(role, folderGrants.get(id) ?? null)
  return role
}

// 폴더 자신 + 상위 폴더 grant 중 가장 높은 역할. 질의는 2번 이하 — 이 소유자에게서 받은 폴더 초대가 없으면 사슬을 읽지 않는다
async function folderChainRole(
  env: Env,
  folderId: string | null,
  ownerId: string,
  email: string,
): Promise<GrantRole | null> {
  if (!folderId) return null
  const { results: grants } = await env.DB.prepare(
    "SELECT target_id, role FROM grants WHERE grantee_email = ? AND owner_id = ? AND target_type = 'folder'",
  )
    .bind(email, ownerId)
    .all<{ target_id: string; role: GrantRole }>()
  if (grants.length === 0) return null
  const folderGrants = new Map<string, GrantRole>()
  for (const g of grants) folderGrants.set(g.target_id, higherRole(folderGrants.get(g.target_id) ?? null, g.role) as GrantRole)

  const { results: chain } = await env.DB.prepare(FOLDER_CHAIN_SQL)
    .bind(folderId, ownerId, ownerId)
    .all<{ id: string; parent_id: string | null }>()
  return chainRole(chain, folderId, folderGrants)
}

export interface DocRowLike {
  id: string
  owner_id: string
  folder_id: string | null
  e2ee_key?: string | null // 없으면 일반 문서로 본다 — resolveDocAccess 에 행을 직접 넘기는 곳은 이 열을 함께 읽어야 한다 (F-401 6.1)
}

export interface DocAccess<T extends DocRowLike> {
  role: Role
  doc: T
  blocked?: true // 막힘 때문에 role 이 'owner'·'edit' 에서 'view' 로 낮아졌을 때만 있다 (F-2028 4.2)
}

// 보낸 사람 → 소유자 순. 사용량 행이 없으면 안 막힘 (F-2028 4.2 3번)
async function isWriteBlocked(env: Env, doc: DocRowLike, user: AuthUser): Promise<boolean> {
  if ((await usageOf(env, user)).blockedAt !== null) return true
  if (doc.owner_id === user.id) return false
  return (await readUsage(env, doc.owner_id)).blockedAt !== null
}

// 문서 role = 소유자 / 문서 grant·폴더·상위 폴더 grant 중 가장 높은 것 / 없음. 쓸 수 있는 role 은 막힘이면 view 로 낮춘다
export async function resolveDocAccess<T extends DocRowLike>(
  env: Env,
  doc: T,
  user: AuthUser,
): Promise<DocAccess<T> | null> {
  // 금고 문서는 소유자만 — 초대를 읽기 전에 끝낸다 (F-401 X1)
  if (doc.e2ee_key && doc.owner_id !== user.id) return null
  const role: Role | null =
    doc.owner_id === user.id
      ? 'owner'
      : higherRole(await grantRole(env, 'doc', doc.id, user.email), await folderChainRole(env, doc.folder_id, doc.owner_id, user.email))
  if (!role) return null
  if (role === 'view') return { role, doc }
  if (await isWriteBlocked(env, doc, user)) return { role: 'view', doc, blocked: true }
  return { role, doc }
}

// id 로 문서를 읽고 role 까지 판정. 문서가 없거나 권한이 전혀 없으면 null(호출부는 404)
export async function getDocAccess<T extends DocRowLike>(
  env: Env,
  docId: string,
  user: AuthUser,
  columns = '*',
): Promise<DocAccess<T> | null> {
  // 열을 골라 읽어도 금고 판정 열은 늘 읽는다 (F-401 X2)
  const selected = columns === '*' || columns.includes('e2ee_key') ? columns : `${columns}, e2ee_key`
  const doc = await env.DB.prepare(`SELECT ${selected} FROM docs WHERE id = ?`).bind(docId).first<T>()
  if (!doc) return null
  return resolveDocAccess(env, doc, user)
}

export interface FolderRowLike {
  id: string
  owner_id: string
}

// 폴더 자체 자원(이름 변경·삭제·이동·링크·초대 관리)은 소유자만
export async function getOwnedFolder<T extends FolderRowLike>(
  env: Env,
  folderId: string,
  user: AuthUser,
): Promise<T | null> {
  const folder = await env.DB.prepare('SELECT * FROM folders WHERE id = ?').bind(folderId).first<T>()
  if (!folder || folder.owner_id !== user.id) return null
  return folder
}

// 첨부 소유자가 문서 소유자이거나 그 문서의 edit 권한자인지 (F-209 2.4 를 F-212 2.2 로 넓힌다)
export async function isDocAttachmentOwner(env: Env, doc: DocRowLike, attachmentOwnerId: string): Promise<boolean> {
  if (attachmentOwnerId === doc.owner_id) return true
  const owner = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(attachmentOwnerId)
    .first<{ email: string }>()
  if (!owner) return false
  const role = higherRole(await grantRole(env, 'doc', doc.id, owner.email), await folderChainRole(env, doc.folder_id, doc.owner_id, owner.email))
  return role === 'edit'
}
