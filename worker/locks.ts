// 편집 잠금 라우트 (specs/features/F-213.md 2.2. 사용량 줄은 F-2025.md 6.4)
import { errorResponse, jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { getDocAccess, roleAtLeast } from './access'
import { badBody, readJsonLimited } from './docs'
import { MAX_BODY_BYTES } from './validate'
import { dayUsageStatement } from './usage'

export const LOCK_DURATION_MS = 60_000

type LockRow = { doc_id: string; user_id: string; email: string; session_id: string; expires_at: number }

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

// 유효한 잠금(만료 안 됨)이면 돌려주고, 없거나 만료면 null (F-206 PUT 에서 쓴다)
export async function getActiveLock(env: Env, docId: string): Promise<LockRow | null> {
  const row = await env.DB.prepare('SELECT * FROM doc_locks WHERE doc_id = ?').bind(docId).first<LockRow>()
  if (!row || row.expires_at <= Date.now()) return null
  return row
}

export type AcquireLockResult = { ok: true; expiresAt: number } | { ok: false; email: string; expiresAt: number }

// 잡기·연장을 한 문장 조건부 쓰기로 (specs/features/F-213.md 2.2)
export async function acquireLock(
  env: Env,
  docId: string,
  user: AuthUser,
  sessionId: string,
): Promise<AcquireLockResult> {
  const now = Date.now()
  const expiresAt = now + LOCK_DURATION_MS
  const [result] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO doc_locks (doc_id, user_id, email, session_id, expires_at) VALUES (?,?,?,?,?)
       ON CONFLICT(doc_id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email, session_id = excluded.session_id, expires_at = excluded.expires_at
       WHERE doc_locks.expires_at < ? OR doc_locks.session_id = ?`,
    ).bind(docId, user.id, user.email, sessionId, expiresAt, now, sessionId),
    dayUsageStatement(env.DB, user.id, now),
  ])

  if (result.meta.changes > 0) {
    return { ok: true, expiresAt }
  }

  const current = await env.DB.prepare('SELECT * FROM doc_locks WHERE doc_id = ?').bind(docId).first<LockRow>()
  return { ok: false, email: current?.email ?? '', expiresAt: current?.expires_at ?? 0 }
}

export async function handleLockDoc(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { sessionId } = body as Record<string, unknown>
  if (!isValidSessionId(sessionId)) return jsonResponse({ error: 'invalid', field: 'sessionId' }, 400)

  const access = await getDocAccess(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (!roleAtLeast(access.role, 'edit')) return errorResponse('forbidden', 403)

  const acquired = await acquireLock(env, params.id, user, sessionId)
  if (acquired.ok) return jsonResponse({ expiresAt: acquired.expiresAt })
  return jsonResponse({ error: 'locked', email: acquired.email, expiresAt: acquired.expiresAt }, 423)
}

export async function handleUnlockDoc(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session')
  if (sessionId) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM doc_locks WHERE doc_id = ? AND session_id = ?').bind(params.id, sessionId),
      dayUsageStatement(env.DB, user.id, Date.now()),
    ])
  }
  return new Response(null, { status: 204 })
}
