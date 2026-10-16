// 휴지통 — 보내기·복원·영구 삭제·비우기·30일 만료. /api·/v1·MCP 가 같이 쓴다 (specs/features/F-3021.md 4장, F-3023)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { docSetShareCleanupStatements, findTrashedDoc, getDocAccess, getOwnedFolder, targetShareCleanupStatements, type DocRowLike } from './access'
import { docSetCommentDeleteStatements, folderOnlyNotificationDeleteStatements } from './commentRows'
import { deleteDocRows } from './docs'
import { folderSubtreeHasE2ee, type FolderRow } from './folders'
import { notifyTrashed } from './docRoomRpc'
import { purgeQuietly } from './purgeJobs'
import { dayUsageStatement, purgeDocsUsageStatement, type DocIdSubquery } from './usage'
import { descendantFolderIds, type FolderLike } from '../src/lib/folderTree'
import { TRASH_RETENTION_DAYS, trashPathOf, trashPurgeAt, type TrashActor, type TrashItem } from '../src/lib/trash'

const DAY_MS = 24 * 60 * 60 * 1000
// 만료 한 번의 문서 수 — 비우기와 같은 16문장이 문서 수와 무관하게 끝나도록 상한만 둔다 (5장)
const EXPIRE_BATCH = 99
// 한 tick 에 시도할 소유자 수 — 실패한 소유자가 다음 소유자를 막지 않게. 17문장 × 2 라 비우기 호출을 줄여 50 안에 든다 (5장)
export const EXPIRE_OWNER_TRIES = 2

export type TrashOptions = { by: TrashActor; allowE2ee: boolean }
export type TrashDocResult = { ok: true; id: string; title: string } | { ok: false; error: 'not_found' | 'forbidden' | 'e2ee_doc' }
export type TrashFolderResult =
  | { ok: true; id: string; parentId: string | null; docs: number; folders: number }
  | { ok: false; error: 'not_found' | 'e2ee_folder' }
export type TrashScope = 'all' | { before: number }

type FolderNameRow = { id: string; name: string; parent_id: string | null }
type TrashTarget = DocRowLike & { title: string }
type SentDoc = { id: string; updated_at: number; plain: number }
type TrashRow = { id: string; title: string; e2ee: number; deleted_at: number; deleted_by: TrashActor; deleted_path: string | null }

const FOLDER_PATH_SQL = `WITH RECURSIVE chain(id, name, parent_id) AS (
  SELECT id, name, parent_id FROM folders WHERE id = ?1 AND owner_id = ?2
  UNION
  SELECT f.id, f.name, f.parent_id FROM folders f JOIN chain c ON f.id = c.parent_id WHERE f.owner_id = ?2
)
SELECT id, name, parent_id FROM chain`
const TRASH_DOC_SQL = 'UPDATE docs SET deleted_at = ?1, deleted_by = ?2, deleted_path = ?3 WHERE id = ?4 AND owner_id = ?5 AND deleted_at IS NULL'
// 폴더마다 경로가 달라 [폴더 id, 경로] JSON 하나를 바인딩한다 (3.2 ①)
const TRASH_FOLDER_DOCS_SQL =
  "UPDATE docs SET deleted_at = ?1, deleted_by = ?2, deleted_path = (SELECT json_extract(value, '$[1]') FROM json_each(?3) WHERE json_extract(value, '$[0]') = docs.folder_id) " +
  "WHERE owner_id = ?4 AND deleted_at IS NULL AND folder_id IN (SELECT json_extract(value, '$[0]') FROM json_each(?3)) RETURNING id, updated_at, e2ee_key IS NULL AS plain"
const DELETE_FOLDERS_SQL = 'DELETE FROM folders WHERE owner_id = ?1 AND id IN (SELECT value FROM json_each(?2))'
const LIST_SQL =
  "SELECT id, CASE WHEN e2ee_key IS NULL THEN title ELSE '' END AS title, e2ee_key IS NOT NULL AS e2ee, deleted_at, deleted_by, deleted_path FROM docs WHERE owner_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id"
const RESTORE_FOLDER_SQL = 'SELECT e2ee FROM folders WHERE id = ? AND owner_id = ?'
const RESTORE_SQL = 'UPDATE docs SET deleted_at = NULL, deleted_by = NULL, deleted_path = NULL, folder_id = ?1 WHERE id = ?2 AND owner_id = ?3 AND deleted_at IS NOT NULL'
const ALL_TRASH_SQL = 'SELECT id FROM docs WHERE owner_id = ?1 AND deleted_at IS NOT NULL'
const EXPIRED_TRASH_SQL = `SELECT id FROM docs WHERE owner_id = ?1 AND deleted_at < ?2 ORDER BY deleted_at, id LIMIT ${EXPIRE_BATCH}`
const OLDEST_EXPIRED_SQL = 'SELECT owner_id FROM docs WHERE deleted_at < ?1 AND owner_id NOT IN (SELECT value FROM json_each(?2)) ORDER BY deleted_at LIMIT 1'

function toFolderLikes(rows: FolderNameRow[]): FolderLike[] {
  return rows.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id }))
}

async function folderPath(env: Env, ownerId: string, folderId: string | null): Promise<string | null> {
  if (folderId === null) return null
  const { results } = await env.DB.prepare(FOLDER_PATH_SQL).bind(folderId, ownerId).all<FolderNameRow>()
  return trashPathOf(toFolderLikes(results), folderId)
}

// 판정 순서 F-2050 3.2 — 없음 → 금고(/v1·MCP) → 소유자 아님. 초대·링크·묶음·댓글·GitHub 행은 그대로 (F-3021 결정 4)
export async function trashDoc(env: Env, ctx: ExecutionContext | undefined, user: AuthUser, docId: string, opts: TrashOptions): Promise<TrashDocResult> {
  const access = await getDocAccess<TrashTarget>(env, docId, user, 'id, owner_id, folder_id, e2ee_key, title')
  if (!access) return { ok: false, error: 'not_found' }
  const vault = !!access.doc.e2ee_key
  if (vault && !opts.allowE2ee) return { ok: false, error: 'e2ee_doc' }
  if (access.role !== 'owner') return { ok: false, error: 'forbidden' }

  const now = Date.now()
  const path = await folderPath(env, user.id, access.doc.folder_id)
  const [sent] = await env.DB.batch([env.DB.prepare(TRASH_DOC_SQL).bind(now, opts.by, path, docId, user.id), dayUsageStatement(env.DB, user.id, now)])
  if (sent.meta.changes === 0) return { ok: false, error: 'not_found' }
  if (!vault) await notifyTrashed(env, ctx, [docId])
  return { ok: true, id: docId, title: access.doc.title }
}

// contents=delete-all — 폴더와 그 링크·초대·알림은 지우고, 안의 살아 있는 문서는 각각 휴지통으로 (F-3023 3.2)
export async function trashFolder(env: Env, ctx: ExecutionContext | undefined, user: AuthUser, folderId: string, opts: TrashOptions): Promise<TrashFolderResult> {
  const target = await getOwnedFolder<FolderRow>(env, folderId, user)
  if (!target) return { ok: false, error: 'not_found' }
  if (!opts.allowE2ee && (await folderSubtreeHasE2ee(env, user, folderId))) return { ok: false, error: 'e2ee_folder' }

  const { results } = await env.DB.prepare('SELECT id, name, parent_id FROM folders WHERE owner_id = ?').bind(user.id).all<FolderNameRow>()
  const folders = toFolderLikes(results)
  const ids = descendantFolderIds(folders, folderId)
  const paths = JSON.stringify(ids.map((id) => [id, trashPathOf(folders, id)]))
  const now = Date.now()
  const [sent] = await env.DB.batch([
    env.DB.prepare(TRASH_FOLDER_DOCS_SQL).bind(now, opts.by, paths, user.id),
    ...targetShareCleanupStatements(env.DB, 'folder', ids, now),
    ...folderOnlyNotificationDeleteStatements(env.DB, ids),
    env.DB.prepare(DELETE_FOLDERS_SQL).bind(user.id, JSON.stringify(ids)),
    dayUsageStatement(env.DB, user.id, now),
  ])
  const docs = (sent.results ?? []) as SentDoc[]
  const rooms = docs.filter((d) => d.plain === 1).sort((a, b) => b.updated_at - a.updated_at)
  await notifyTrashed(env, ctx, rooms.map((d) => d.id))
  return { ok: true, id: folderId, parentId: target.parent_id, docs: docs.length, folders: ids.length }
}

// 영구 삭제 한 벌 — 모든 문장이 같은 하위 질의를 써서 문서 수와 무관하게 16문장, 한 batch 라 같은 행을 본다 (F-3023 4장)
export function purgeTrashStatements(db: D1Database, ownerId: string, scope: TrashScope, now: number, countWrite: boolean): D1PreparedStatement[] {
  const docs: DocIdSubquery = scope === 'all' ? { sql: ALL_TRASH_SQL, binds: [ownerId] } : { sql: EXPIRED_TRASH_SQL, binds: [ownerId, scope.before] }
  const ids = `(${docs.sql})`
  return [
    purgeDocsUsageStatement(db, ownerId, docs, now, countWrite),
    ...docSetCommentDeleteStatements(db, ownerId, docs),
    ...docSetShareCleanupStatements(db, docs, now),
    db
      .prepare(
        `INSERT INTO purge_jobs (kind, target, priority, created_at) SELECT 'room', id, updated_at, ?${docs.binds.length + 1} FROM docs WHERE deleted_at IS NOT NULL AND e2ee_key IS NULL AND id IN ${ids} ON CONFLICT (kind, target) DO NOTHING`,
      )
      .bind(...docs.binds, now),
    // share_link_docs·github_* 는 docs(id) 를 참조한다 — docs 보다 먼저 (F-2038 12장 X1, F-3015 A13)
    db.prepare(`DELETE FROM share_link_docs WHERE doc_id IN ${ids}`).bind(...docs.binds),
    db.prepare(`DELETE FROM github_images WHERE doc_id IN ${ids}`).bind(...docs.binds),
    db.prepare(`DELETE FROM github_links WHERE doc_id IN ${ids}`).bind(...docs.binds),
    db.prepare(`DELETE FROM docs WHERE deleted_at IS NOT NULL AND id IN ${ids}`).bind(...docs.binds),
  ]
}

// 10분 Cron — 가장 오래된 만료 행의 소유자 한 명, 99개까지, 하루 쓰기는 그대로. 실패하면 로그 뒤 다음 소유자. 쓴 D1 문장 수를 돌려준다 (F-3023 5장)
export async function expireTrash(env: Env, now: number): Promise<number> {
  const before = now - TRASH_RETENTION_DAYS * DAY_MS
  const failed: string[] = []
  let statements = 0
  while (failed.length < EXPIRE_OWNER_TRIES) {
    let owner: string | null = null
    try {
      statements++
      const oldest = await env.DB.prepare(OLDEST_EXPIRED_SQL).bind(before, JSON.stringify(failed)).first<{ owner_id: string }>()
      if (!oldest) return statements
      owner = oldest.owner_id
      const batch = purgeTrashStatements(env.DB, owner, { before }, now, false)
      statements += batch.length
      await env.DB.batch(batch)
      return statements
    } catch (err) {
      console.error('expire_trash_failed', err)
      if (owner === null) return statements
      failed.push(owner)
    }
  }
  return statements
}

function rowToTrashItem(row: TrashRow): TrashItem {
  const item: TrashItem = { id: row.id, title: row.title, deletedAt: row.deleted_at, deletedBy: row.deleted_by, path: row.deleted_path, purgeAt: trashPurgeAt(row.deleted_at) }
  return row.e2ee === 1 ? { ...item, e2ee: true } : item
}

export async function handleListTrash(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(LIST_SQL).bind(user.id).all<TrashRow>()
  return jsonResponse(results.map(rowToTrashItem))
}

// 원래 폴더가 있고 내 것이며 금고 여부가 같을 때만 그 자리, 아니면 최상위 (F-401 "금고 폴더 안에 일반 문서 없음")
async function restoreFolderId(env: Env, ownerId: string, doc: DocRowLike): Promise<string | null> {
  if (doc.folder_id === null) return null
  const folder = await env.DB.prepare(RESTORE_FOLDER_SQL).bind(doc.folder_id, ownerId).first<{ e2ee: number }>()
  return folder && (folder.e2ee === 1) === !!doc.e2ee_key ? doc.folder_id : null
}

export async function handleRestoreTrash(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const doc = await findTrashedDoc(env, params.id, user.id)
  if (!doc) return errorResponse('not_found', 404)
  const folderId = await restoreFolderId(env, user.id, doc)
  const [restored] = await env.DB.batch([env.DB.prepare(RESTORE_SQL).bind(folderId, params.id, user.id), dayUsageStatement(env.DB, user.id, Date.now())])
  if (restored.meta.changes === 0) return errorResponse('not_found', 404)
  return jsonResponse({ id: params.id, folderId })
}

// 금고 문서도 — F-2145 의 금고 초기화가 휴지통 금고 문서를 먼저 지운다 (F-3021 Q2)
export async function handlePurgeTrashDoc(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  if (!(await findTrashedDoc(env, params.id, user.id))) return errorResponse('not_found', 404)
  await deleteDocRows(env, ctx, params.id, user.id)
  return new Response(null, { status: 204 })
}

export async function handleEmptyTrash(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const now = Date.now()
  const results = await env.DB.batch(purgeTrashStatements(env.DB, user.id, 'all', now, true))
  await purgeQuietly(env, now)
  return jsonResponse({ docs: results[results.length - 1].meta.changes })
}
