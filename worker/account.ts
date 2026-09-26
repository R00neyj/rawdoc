// GET·DELETE /api/account — 미리 보기, 최근 로그인 판정, 지우기 batch (specs/features/F-2038.md 3~5장)
import { errorResponse, jsonResponse } from './http'
import { getUserWithSessionStart } from './auth'
import { accountCommentDeleteStatements } from './commentRows'
import { PURGE_CALLS_ON_DELETE, runPurgeJobs } from './purgeJobs'
import { ACCOUNT_DELETE_FRESH_MS, type AccountDeletePreview } from '../src/lib/accountDeletion'

// better-auth 가 >= 로 거절하는 것과 같은 방향 (4.1)
export function isFreshSession(createdAt: number, now: number): boolean {
  return now - createdAt < ACCOUNT_DELETE_FRESH_MS
}

const COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM docs WHERE owner_id = ?1) AS docs,
  (SELECT COUNT(*) FROM docs WHERE owner_id = ?1 AND e2ee_key IS NOT NULL) AS e2ee_docs,
  (SELECT COUNT(*) FROM folders WHERE owner_id = ?1) AS folders,
  (SELECT COUNT(*) FROM attachments WHERE owner_id = ?1) AS att_count,
  (SELECT COALESCE(SUM(size), 0) FROM attachments WHERE owner_id = ?1) AS att_bytes,
  (SELECT COUNT(*) FROM api_tokens WHERE user_id = ?1 AND revoked_at IS NULL) AS tokens`

// 3.2 다섯 규칙 — 초대·살아있는 폴더 링크가 걸린 폴더와 그 하위를 재귀로 모은다. UNION 이라 순환에서도 끝난다
const SHARED_DOCS_SQL = `WITH RECURSIVE shared_folders(id) AS (
  SELECT target_id FROM grants WHERE owner_id = ?1 AND target_type = 'folder'
  UNION
  SELECT target_id FROM share_links WHERE owner_id = ?1 AND target_type = 'folder' AND revoked_at IS NULL
  UNION
  SELECT f.id FROM folders f JOIN shared_folders s ON f.parent_id = s.id WHERE f.owner_id = ?1
)
SELECT COUNT(*) AS n FROM docs d WHERE d.owner_id = ?1 AND (
  d.folder_id IN (SELECT id FROM shared_folders)
  OR EXISTS (SELECT 1 FROM grants g WHERE g.owner_id = ?1 AND g.target_type = 'doc' AND g.target_id = d.id)
  OR EXISTS (SELECT 1 FROM share_links l WHERE l.owner_id = ?1 AND l.target_type = 'doc' AND l.target_id = d.id AND l.revoked_at IS NULL)
  OR EXISTS (
    SELECT 1 FROM share_link_docs sd JOIN share_links l ON l.token = sd.token
    WHERE sd.doc_id = d.id AND l.owner_id = ?1 AND l.revoked_at IS NULL
  )
)`

type CountsRow = { docs: number; e2ee_docs: number; folders: number; att_count: number; att_bytes: number; tokens: number }

export async function handleGetAccount(request: Request, env: Env): Promise<Response> {
  const found = await getUserWithSessionStart(request, env)
  if (!found) return errorResponse('unauthenticated', 401)
  const { user, sessionCreatedAt } = found
  const [counts, shared] = await Promise.all([
    env.DB.prepare(COUNTS_SQL).bind(user.id).first<CountsRow>(),
    env.DB.prepare(SHARED_DOCS_SQL).bind(user.id).first<{ n: number }>(),
  ])
  const now = Date.now()
  const body: AccountDeletePreview = {
    email: user.email,
    docs: counts?.docs ?? 0,
    e2eeDocs: counts?.e2ee_docs ?? 0,
    sharedDocs: shared?.n ?? 0,
    folders: counts?.folders ?? 0,
    attachments: { count: counts?.att_count ?? 0, bytes: counts?.att_bytes ?? 0 },
    tokens: counts?.tokens ?? 0,
    fresh: sessionCreatedAt === null || isFreshSession(sessionCreatedAt, now),
    freshUntil: sessionCreatedAt === null ? null : sessionCreatedAt + ACCOUNT_DELETE_FRESH_MS,
  }
  return jsonResponse(body)
}

// 5.2 표 순서 — 외래 키 때문에 이 순서가 결정이다. 대상 행 수와 무관하게 문장 수가 같다
function deleteAccountStatements(db: D1Database, userId: string, email: string, now: number): D1PreparedStatement[] {
  const byUser = (sql: string) => db.prepare(sql).bind(userId)
  return [
    db
      .prepare(
        "INSERT INTO purge_jobs (kind, target, priority, created_at) SELECT 'room', id, updated_at, ?2 FROM docs WHERE owner_id = ?1 ON CONFLICT (kind, target) DO NOTHING",
      )
      .bind(userId, now),
    db
      .prepare("INSERT INTO purge_jobs (kind, target, priority, created_at) VALUES ('r2_prefix', ?1, 0, ?2) ON CONFLICT (kind, target) DO NOTHING")
      .bind(`att/${userId}/`, now),
    byUser('DELETE FROM doc_locks WHERE user_id = ?1 OR doc_id IN (SELECT id FROM docs WHERE owner_id = ?1)'),
    byUser('DELETE FROM share_link_docs WHERE token IN (SELECT token FROM share_links WHERE owner_id = ?1)'),
    byUser('DELETE FROM share_links WHERE owner_id = ?1'),
    byUser('DELETE FROM grants WHERE owner_id = ?1'),
    db.prepare('DELETE FROM grants WHERE grantee_email = ?1').bind(email.toLowerCase()),
    byUser('DELETE FROM api_tokens WHERE user_id = ?1'),
    byUser('DELETE FROM e2ee_keys WHERE user_id = ?1'),
    byUser('DELETE FROM attachments WHERE owner_id = ?1'),
    ...accountCommentDeleteStatements(db, userId, email),
    byUser('DELETE FROM docs WHERE owner_id = ?1'),
    byUser('DELETE FROM folders WHERE owner_id = ?1'),
    byUser('DELETE FROM auth_sessions WHERE user_id = ?1'),
    byUser('DELETE FROM auth_accounts WHERE user_id = ?1'),
    byUser('DELETE FROM users WHERE id = ?1'),
  ]
}

async function purgeQuietly(env: Env, now: number): Promise<void> {
  try {
    await runPurgeJobs(env, now, PURGE_CALLS_ON_DELETE)
  } catch (err) {
    console.error('purge_after_delete_failed', err)
  }
}

export async function handleDeleteAccount(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const found = await getUserWithSessionStart(request, env)
  if (!found) return errorResponse('unauthenticated', 401)
  const { user, sessionCreatedAt } = found
  const now = Date.now()
  if (sessionCreatedAt !== null && !isFreshSession(sessionCreatedAt, now)) {
    return jsonResponse({ error: 'reauth_required', freshMinutes: ACCOUNT_DELETE_FRESH_MS / 60_000 }, 403)
  }
  try {
    await env.DB.batch(deleteAccountStatements(env.DB, user.id, user.email, now))
  } catch (err) {
    console.error('account_delete_failed', err)
    return errorResponse('internal', 500)
  }
  ctx.waitUntil(purgeQuietly(env, now))
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
