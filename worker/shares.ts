// 공유 관리 목록 — 내 링크 + 내가 준 권한 (specs/features/F-243.md 3.1)
import { jsonResponse } from './http'
import { requireUser } from './auth'
import { LIVE_REQUEST_SQL } from './accessRequests'
import type { AccessRequestRow, AccessRole } from '../src/lib/accessRequest'

type TargetType = 'doc' | 'folder'

type LinkListItem = {
  token: string
  targetType: TargetType
  targetId: string
  targetName: string
  createdAt: number
}

type GrantListItem = {
  targetType: TargetType
  targetId: string
  targetName: string
  email: string
  role: 'view' | 'edit'
  createdAt: number
}

function targetTable(targetType: TargetType): { table: string; nameCol: string } {
  return targetType === 'doc' ? { table: 'docs', nameCol: 'title' } : { table: 'folders', nameCol: 'name' }
}

// 대상이 지워졌거나 같은 id 로 남의 것이 생겼으면 JOIN 이 걸러낸다 (리뷰 W2) — 대상마다 따로 조회하지 않고 target_type 별 JOIN 하나로 끝낸다
async function listLinksForTarget(env: Env, ownerId: string, targetType: TargetType): Promise<LinkListItem[]> {
  const { table, nameCol } = targetTable(targetType)
  const { results } = await env.DB.prepare(
    `SELECT sl.token AS token, sl.target_id AS target_id, sl.created_at AS created_at, t.${nameCol} AS target_name
     FROM share_links sl JOIN ${table} t ON t.id = sl.target_id AND t.owner_id = sl.owner_id
     WHERE sl.owner_id = ? AND sl.target_type = ? AND sl.revoked_at IS NULL`,
  )
    .bind(ownerId, targetType)
    .all<{ token: string; target_id: string; created_at: number; target_name: string }>()
  return results.map((r) => ({
    token: r.token,
    targetType,
    targetId: r.target_id,
    targetName: r.target_name,
    createdAt: r.created_at,
  }))
}

async function listGrantsForTarget(env: Env, ownerId: string, targetType: TargetType): Promise<GrantListItem[]> {
  const { table, nameCol } = targetTable(targetType)
  const { results } = await env.DB.prepare(
    `SELECT g.target_id AS target_id, g.grantee_email AS email, g.role AS role, g.created_at AS created_at, t.${nameCol} AS target_name
     FROM grants g JOIN ${table} t ON t.id = g.target_id AND t.owner_id = g.owner_id
     WHERE g.owner_id = ? AND g.target_type = ?`,
  )
    .bind(ownerId, targetType)
    .all<{ target_id: string; email: string; role: 'view' | 'edit'; created_at: number; target_name: string }>()
  return results.map((r) => ({
    targetType,
    targetId: r.target_id,
    targetName: r.target_name,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
  }))
}

const REQUESTS_SQL = `SELECT r.id, r.target_type, r.target_id, r.requester_email, r.requester_name, r.role, r.created_at,
  CASE r.target_type WHEN 'doc' THEN (SELECT t.title FROM docs t WHERE t.id = r.target_id) ELSE (SELECT t.name FROM folders t WHERE t.id = r.target_id) END AS target_name
  FROM access_requests r WHERE r.owner_id = ? AND r.status = 'pending' AND ${LIVE_REQUEST_SQL} ORDER BY r.created_at DESC`

async function listRequests(env: Env, ownerId: string): Promise<AccessRequestRow[]> {
  const { results } = await env.DB.prepare(REQUESTS_SQL)
    .bind(ownerId)
    .all<{ id: string; target_type: TargetType; target_id: string; requester_email: string; requester_name: string; role: AccessRole; created_at: number; target_name: string }>()
  return results.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    targetName: r.target_name,
    email: r.requester_email,
    name: r.requester_name,
    role: r.role,
    createdAt: r.created_at,
  }))
}

export async function handleListShares(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)

  const [docLinks, folderLinks, docGrants, folderGrants, requests] = await Promise.all([
    listLinksForTarget(env, user.id, 'doc'),
    listLinksForTarget(env, user.id, 'folder'),
    listGrantsForTarget(env, user.id, 'doc'),
    listGrantsForTarget(env, user.id, 'folder'),
    listRequests(env, user.id),
  ])

  const links = [...docLinks, ...folderLinks].sort((a, b) => b.createdAt - a.createdAt)
  const grants = [...docGrants, ...folderGrants].sort((a, b) => b.createdAt - a.createdAt)

  return jsonResponse({ links, grants, requests })
}
