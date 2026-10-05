// 권한 회수 뒤 다시 확인할 열린 방의 문서 구하기 (specs/features/F-4002.md 3.2)
import { folderAncestors, type FolderLike } from '../src/lib/folderTree'
import { notifyRevalidateDocs, REVALIDATE_FANOUT_MAX } from './docRoomRpc'

export type RoomTargets = { ids: string[]; capped: boolean }

// 재귀 단계는 owner_id 를 sub 행에서 이어받는다 — 상수로 묶으면 folders 를 owner_id 로 훑는다 (r8)
const SUBTREE_DOCS_SQL = `WITH RECURSIVE sub(id, owner_id) AS (
  SELECT id, owner_id FROM folders WHERE id = ?1 AND owner_id = ?2
  UNION
  SELECT f.id, f.owner_id FROM folders f JOIN sub s ON f.parent_id = s.id AND f.owner_id = s.owner_id
)
SELECT d.id FROM sub s CROSS JOIN docs d ON d.owner_id = s.owner_id AND d.folder_id = s.id
 WHERE d.e2ee_key IS NULL
 ORDER BY d.updated_at DESC
 LIMIT ?3`

export async function subtreeRoomDocIds(env: Env, folderId: string, ownerId: string): Promise<RoomTargets> {
  const { results } = await env.DB.prepare(SUBTREE_DOCS_SQL)
    .bind(folderId, ownerId, REVALIDATE_FANOUT_MAX + 1)
    .all<{ id: string }>()
  const ids = results.map((r) => r.id)
  return { ids: ids.slice(0, REVALIDATE_FANOUT_MAX), capped: ids.length > REVALIDATE_FANOUT_MAX }
}

export function lostAncestorIds(folders: FolderLike[], oldParentId: string | null, newParentId: string | null): string[] {
  const kept = new Set(folderAncestors(folders, newParentId))
  return folderAncestors(folders, oldParentId).filter((id) => !kept.has(id))
}

export async function anyFolderGrant(env: Env, ownerId: string, folderIds: readonly string[]): Promise<boolean> {
  if (folderIds.length === 0) return false
  const row = await env.DB.prepare(
    "SELECT 1 AS hit FROM grants WHERE owner_id = ?1 AND target_type = 'folder' AND target_id IN (SELECT value FROM json_each(?2)) LIMIT 1",
  )
    .bind(ownerId, JSON.stringify(folderIds))
    .first()
  return row !== null
}

// 폴더 하위 문서 방을 바로 다시 본다 — 상한을 넘는 문서는 주기 점검에 맡긴다 (F-4002 3.3)
export async function notifyFolderRooms(env: Env, ctx: ExecutionContext | undefined, folderId: string, ownerId: string, email?: string): Promise<void> {
  const { ids, capped } = await subtreeRoomDocIds(env, folderId, ownerId)
  if (capped) console.warn('room revalidate capped', folderId)
  if (ids.length > 0) await notifyRevalidateDocs(env, ctx, ids, email)
}
