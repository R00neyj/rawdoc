// 문서·폴더 접근 권한 판정 (specs/features/F-212.md 2.2)
import type { AuthUser } from './auth'

export type Role = 'owner' | 'edit' | 'view'
export type GrantRole = 'view' | 'edit'

const RANK: Record<GrantRole, number> = { view: 1, edit: 2 }

function higher(a: GrantRole | null, b: GrantRole | null): GrantRole | null {
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

// 폴더 자신 + 상위 폴더 grant 중 가장 높은 역할. 조회 시점 기준(옮기면 바로 바뀐다)
async function folderChainRole(env: Env, folderId: string | null, email: string): Promise<GrantRole | null> {
  let role: GrantRole | null = null
  let currentId = folderId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    role = higher(role, await grantRole(env, 'folder', currentId, email))
    const parent = await env.DB.prepare('SELECT parent_id FROM folders WHERE id = ?')
      .bind(currentId)
      .first<{ parent_id: string | null }>()
    currentId = parent?.parent_id ?? null
  }
  return role
}

export interface DocRowLike {
  id: string
  owner_id: string
  folder_id: string | null
}

export interface DocAccess<T extends DocRowLike> {
  role: Role
  doc: T
}

// 문서 role = 소유자 / 문서 grant·폴더·상위 폴더 grant 중 가장 높은 것 / 없음
export async function resolveDocAccess<T extends DocRowLike>(
  env: Env,
  doc: T,
  user: AuthUser,
): Promise<DocAccess<T> | null> {
  if (doc.owner_id === user.id) return { role: 'owner', doc }
  const role = higher(await grantRole(env, 'doc', doc.id, user.email), await folderChainRole(env, doc.folder_id, user.email))
  if (!role) return null
  return { role, doc }
}

// id 로 문서를 읽고 role 까지 판정. 문서가 없거나 권한이 전혀 없으면 null(호출부는 404)
export async function getDocAccess<T extends DocRowLike>(
  env: Env,
  docId: string,
  user: AuthUser,
  columns = '*',
): Promise<DocAccess<T> | null> {
  const doc = await env.DB.prepare(`SELECT ${columns} FROM docs WHERE id = ?`).bind(docId).first<T>()
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
  const role = higher(await grantRole(env, 'doc', doc.id, owner.email), await folderChainRole(env, doc.folder_id, owner.email))
  return role === 'edit'
}
