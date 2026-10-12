// 권한 요청 — 요청자 쪽 라우트와 공용 SQL 조각 (specs/features/F-4005.md 4·5장)
import { requireUser, type AuthUser } from './auth'
import { applyGrant } from './grants'
import { folderChainRole, resolveDocAccess, roleAtLeast, type GrantRole } from './access'
import { notifRevBeforeDeleteSql } from './commentRows'
import { readJsonLimited } from './docs'
import { errorResponse, jsonResponse } from './http'
import { findPublicLink, isDocInLinkSet } from './links'
import { isValidToken } from './token'
import { dayUsageStatement } from './usage'
import { MAX_BODY_BYTES } from './validate'
import {
  ACCESS_REQUEST_COOLDOWN_MS,
  ACCESS_REQUEST_EXPIRE_MS,
  ACCESS_REQUEST_OWNER_PENDING_MAX,
  ACCESS_REQUEST_PENDING_MAX,
  type AccessRequestStatus,
  type AccessRole,
} from '../src/lib/accessRequest'

type Target = { type: 'doc' | 'folder'; id: string; ownerId: string; folderId: string | null }
type RequestRow = { id: string; role: AccessRole; status: 'pending' | 'rejected'; decided_at: number | null; live: number }

// 요청 행 별칭 r — 링크가 살아 있고 대상이 아직 그 링크로 닿는 금고 아닌 주인 것. 막힘은 보지 않는다 (풀리면 돌아온다)
export const LIVE_REQUEST_SQL = `(
  ((r.target_type = 'doc' AND EXISTS (SELECT 1 FROM docs t WHERE t.id = r.target_id AND t.owner_id = r.owner_id AND t.e2ee_key IS NULL))
    OR (r.target_type = 'folder' AND EXISTS (SELECT 1 FROM folders t WHERE t.id = r.target_id AND t.owner_id = r.owner_id AND t.e2ee <> 1)))
  AND EXISTS (SELECT 1 FROM share_links l WHERE l.token = r.token AND l.revoked_at IS NULL AND l.owner_id = r.owner_id
    AND ((l.target_type = r.target_type AND l.target_id = r.target_id)
      OR (r.target_type = 'doc' AND l.target_type = 'doc' AND EXISTS (SELECT 1 FROM share_link_docs s WHERE s.token = l.token AND s.doc_id = r.target_id))))
)`

// where 는 별칭 없는 access_requests 열만 쓴다 — 같은 binds 가 세 문장에 각각 들어간다
export function accessRequestDeleteStatements(db: D1Database, where: string, binds: unknown[]): D1PreparedStatement[] {
  const ids = `SELECT id FROM access_requests WHERE ${where}`
  const notifWhere = `kind = 'access_request' AND id IN (${ids})`
  return [
    db.prepare(notifRevBeforeDeleteSql(notifWhere)).bind(...binds),
    db.prepare(`DELETE FROM notifications WHERE ${notifWhere}`).bind(...binds),
    db.prepare(`DELETE FROM access_requests WHERE ${where}`).bind(...binds),
  ]
}

async function findTarget(env: Env, token: string, docId: string | null): Promise<Target | null> {
  if (!isValidToken(token)) return null
  const link = await findPublicLink(env, token)
  if (!link) return null
  if (link.target_type === 'folder') {
    const folder = await env.DB.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ? AND e2ee <> 1').bind(link.target_id, link.owner_id).first<{ id: string }>()
    return folder ? { type: 'folder', id: folder.id, ownerId: link.owner_id, folderId: null } : null
  }
  const id = docId ?? link.target_id
  if (!(await isDocInLinkSet(env, token, link.target_id, id))) return null
  const doc = await env.DB.prepare('SELECT id, folder_id FROM docs WHERE id = ? AND owner_id = ? AND e2ee_key IS NULL')
    .bind(id, link.owner_id)
    .first<{ id: string; folder_id: string | null }>()
  return doc ? { type: 'doc', id: doc.id, ownerId: link.owner_id, folderId: doc.folder_id } : null
}

async function currentRole(env: Env, target: Target, user: AuthUser): Promise<GrantRole | null> {
  if (target.type === 'doc') {
    const access = await resolveDocAccess(env, { id: target.id, owner_id: target.ownerId, folder_id: target.folderId, e2ee_key: null }, user)
    return access && access.role !== 'owner' ? access.role : null
  }
  return folderChainRole(env, target.id, target.ownerId, user.email)
}

function statusBody(target: Target, owner: boolean, memberRole: GrantRole | null, request: AccessRequestStatus['request']): AccessRequestStatus {
  return { target: target.type, owner, memberRole, targetId: owner || memberRole ? target.id : null, request }
}

function docIdOf(request: Request): string | null {
  return new URL(request.url).searchParams.get('docId')
}

const FIND_ROW_SQL = `SELECT r.id, r.role, r.status, r.decided_at, ${LIVE_REQUEST_SQL} AS live FROM access_requests r WHERE r.target_type = ? AND r.target_id = ? AND r.requester_id = ?`
const COUNT_PENDING_SQL = (col: 'requester_id' | 'owner_id') => `SELECT COUNT(*) AS n FROM access_requests r WHERE r.${col} = ? AND r.status = 'pending' AND ${LIVE_REQUEST_SQL}`

export async function handleGetAccessRequest(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const target = await findTarget(env, params.token, docIdOf(request))
  if (!target) return errorResponse('not_found', 404)
  if (target.ownerId === user.id) return jsonResponse(statusBody(target, true, null, null))

  const memberRole = await currentRole(env, target, user)
  const row = await env.DB.prepare(FIND_ROW_SQL).bind(target.type, target.id, user.id).first<RequestRow>()
  const shown = row && row.live ? row : null
  const body: AccessRequestStatus['request'] = shown
    ? { state: shown.status, role: shown.role, retryAt: shown.status === 'rejected' && shown.decided_at !== null ? shown.decided_at + ACCESS_REQUEST_COOLDOWN_MS : null }
    : null
  return jsonResponse(statusBody(target, false, memberRole, body))
}

export async function handlePostAccessRequest(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return errorResponse(parsed.reason === 'too_large' ? 'too_large' : 'invalid', parsed.reason === 'too_large' ? 413 : 400)
  const data = parsed.data
  if (typeof data !== 'object' || data === null) return errorResponse('invalid', 400)
  const { role, docId } = data as Record<string, unknown>
  if (role !== 'view' && role !== 'edit') return jsonResponse({ error: 'invalid', field: 'role' }, 400)
  if (docId !== undefined && typeof docId !== 'string') return jsonResponse({ error: 'invalid', field: 'docId' }, 400)

  const target = await findTarget(env, params.token, docId ?? null)
  if (!target) return errorResponse('not_found', 404)
  if (target.ownerId === user.id) return jsonResponse({ error: 'owner' }, 409)
  const memberRole = await currentRole(env, target, user)
  if (memberRole && roleAtLeast(memberRole, role)) return jsonResponse({ error: 'already_member' }, 409)

  const now = Date.now()
  const existing = await env.DB.prepare(FIND_ROW_SQL).bind(target.type, target.id, user.id).first<RequestRow>()
  const pending = (): AccessRequestStatus => statusBody(target, false, memberRole, { state: 'pending', role, retryAt: null })

  if (existing && existing.live && existing.status === 'pending') {
    await env.DB.batch([
      env.DB.prepare("UPDATE access_requests SET role = ? WHERE id = ? AND status = 'pending'").bind(role, existing.id),
      dayUsageStatement(env.DB, user.id, now),
    ])
    return jsonResponse(pending(), 200)
  }
  if (existing && existing.live && existing.decided_at !== null && existing.decided_at + ACCESS_REQUEST_COOLDOWN_MS > now) {
    return jsonResponse({ error: 'cooldown', retryAt: existing.decided_at + ACCESS_REQUEST_COOLDOWN_MS }, 409)
  }

  const mine = await env.DB.prepare(COUNT_PENDING_SQL('requester_id')).bind(user.id).first<{ n: number }>()
  if ((mine?.n ?? 0) >= ACCESS_REQUEST_PENDING_MAX) return jsonResponse({ error: 'too_many_pending' }, 409)
  const theirs = await env.DB.prepare(COUNT_PENDING_SQL('owner_id')).bind(target.ownerId).first<{ n: number }>()
  if ((theirs?.n ?? 0) >= ACCESS_REQUEST_OWNER_PENDING_MAX) return jsonResponse({ error: 'owner_full' }, 409)

  const nameRow = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id).first<{ name: string }>()
  const statements: D1PreparedStatement[] = existing ? accessRequestDeleteStatements(env.DB, 'id = ?', [existing.id]) : []
  statements.push(
    env.DB.prepare(
      'INSERT INTO access_requests (id, target_type, target_id, owner_id, token, requester_id, requester_email, requester_name, role, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (target_type, target_id, requester_id) DO NOTHING',
    ).bind(crypto.randomUUID(), target.type, target.id, target.ownerId, params.token, user.id, user.email.toLowerCase(), (nameRow?.name ?? '').slice(0, 100), role, 'pending', now),
    dayUsageStatement(env.DB, user.id, now),
  )
  const results = await env.DB.batch(statements)
  return jsonResponse(pending(), results[statements.length - 2].meta.changes === 1 ? 201 : 200)
}

export async function handleDeleteAccessRequest(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const target = await findTarget(env, params.token, docIdOf(request))
  if (!target) return errorResponse('not_found', 404)
  const where = "target_type = ? AND target_id = ? AND requester_id = ? AND status = 'pending'"
  const binds = [target.type, target.id, user.id]
  const row = await env.DB.prepare(`SELECT id FROM access_requests WHERE ${where}`).bind(...binds).first()
  if (!row) return errorResponse('not_found', 404)
  await env.DB.batch([...accessRequestDeleteStatements(env.DB, where, binds), dayUsageStatement(env.DB, user.id, Date.now())])
  return new Response(null, { status: 204 })
}

type OwnedRequest = { id: string; target_type: 'doc' | 'folder'; target_id: string; requester_id: string; requester_email: string; role: AccessRole }

const OWNED_PENDING_SQL = `SELECT r.id, r.target_type, r.target_id, r.requester_id, r.requester_email, r.role FROM access_requests r WHERE r.id = ? AND r.owner_id = ? AND r.status = 'pending' AND ${LIVE_REQUEST_SQL}`

function ownedPending(env: Env, id: string, ownerId: string): Promise<OwnedRequest | null> {
  return env.DB.prepare(OWNED_PENDING_SQL).bind(id, ownerId).first<OwnedRequest>()
}

// 대상 이름과 (문서면) 폴더 — 승인 때 요청자의 지금 권한을 읽고 초대 이름을 만든다
async function readTarget(env: Env, row: OwnedRequest, ownerId: string): Promise<{ target: Target; name: string } | null> {
  if (row.target_type === 'folder') {
    const folder = await env.DB.prepare('SELECT name FROM folders WHERE id = ? AND owner_id = ?').bind(row.target_id, ownerId).first<{ name: string }>()
    return folder ? { target: { type: 'folder', id: row.target_id, ownerId, folderId: null }, name: folder.name } : null
  }
  const doc = await env.DB.prepare('SELECT title, folder_id FROM docs WHERE id = ? AND owner_id = ?').bind(row.target_id, ownerId).first<{ title: string; folder_id: string | null }>()
  return doc ? { target: { type: 'doc', id: row.target_id, ownerId, folderId: doc.folder_id }, name: doc.title } : null
}

export async function handleApproveAccessRequest(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await ownedPending(env, params.id, user.id)
  if (!row) return errorResponse('not_found', 404)
  const found = await readTarget(env, row, user.id)
  if (!found) return errorResponse('not_found', 404)

  const email = row.requester_email
  const current = await currentRole(env, found.target, { id: row.requester_id, email })
  const clearRequest = accessRequestDeleteStatements(env.DB, 'id = ?', [row.id])
  if (current && roleAtLeast(current, row.role)) {
    await env.DB.batch([...clearRequest, dayUsageStatement(env.DB, user.id, Date.now())])
    return jsonResponse({ email, role: current })
  }
  await applyGrant(env, ctx, user, { targetType: row.target_type, targetId: row.target_id, name: found.name }, email, row.role, clearRequest)
  return jsonResponse({ email, role: row.role })
}

export async function handleRejectAccessRequest(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await ownedPending(env, params.id, user.id)
  if (!row) return errorResponse('not_found', 404)
  const now = Date.now()
  await env.DB.batch([
    ...accessRequestDeleteStatements(env.DB, 'id = ?', [row.id]).slice(0, 2),
    env.DB.prepare("UPDATE access_requests SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, row.id),
    dayUsageStatement(env.DB, user.id, now),
  ])
  return new Response(null, { status: 204 })
}

const PURGE_WHERE = `id IN (SELECT r.id FROM access_requests r WHERE NOT ${LIVE_REQUEST_SQL})
  OR (status = 'pending' AND created_at < ?1) OR (status = 'rejected' AND decided_at < ?2)`

// 매일 Cron — 승인할 수 없게 된 요청과 기한 지난 행 (F-4006 4장)
export async function purgeAccessRequests(env: Env, now: number): Promise<void> {
  await env.DB.batch(accessRequestDeleteStatements(env.DB, PURGE_WHERE, [now - ACCESS_REQUEST_EXPIRE_MS, now - ACCESS_REQUEST_COOLDOWN_MS]))
}
