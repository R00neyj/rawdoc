// 웹 푸시 구독 표 문장·켜짐 판정·매일 정리 — ./auth 를 import 하지 않는다, DO 도 가져다 쓴다 (specs/features/F-3003.md 4장)
import { readVar } from './origin'
import { importVapidKey, type PushOutcome, type VapidKeys } from './webPush'

export type PushVapid = { keys: VapidKeys; subject: string }
export type LivePushSubscription = {
  id: string
  email: string
  endpoint: string
  p256dh: string
  auth: string
  lastOkAt: number | null
  failCount: number
}

export const PUSH_FAIL_MAX = 3
export const PUSH_LAST_OK_REFRESH_MS = 86_400_000

const ALIVE_SQL = `(p.session_id IS NULL OR EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id = p.session_id AND s.expires_at > ?))`
const LIVE_SELECT = `SELECT p.id, u.email, p.endpoint, p.p256dh, p.auth, p.last_ok_at, p.fail_count FROM push_subscriptions p JOIN users u ON u.id = p.user_id`

type LiveRow = { id: string; email: string; endpoint: string; p256dh: string; auth: string; last_ok_at: number | null; fail_count: number }

function toLive(row: LiveRow): LivePushSubscription {
  return { id: row.id, email: row.email, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, lastOkAt: row.last_ok_at, failCount: row.fail_count }
}

export async function loadVapid(env: Env): Promise<PushVapid | null> {
  const keys = await importVapidKey(readVar(env, 'VAPID_PRIVATE_JWK'))
  if (!keys) return null
  try {
    return { keys, subject: new URL(readVar(env, 'BETTER_AUTH_URL') ?? '').origin }
  } catch {
    return null
  }
}

export async function listLivePushSubscriptions(db: D1Database, emails: readonly string[], nowMs: number): Promise<LivePushSubscription[]> {
  if (emails.length === 0) return []
  const { results } = await db
    .prepare(`${LIVE_SELECT} WHERE u.email IN (SELECT value FROM json_each(?)) AND ${ALIVE_SQL} ORDER BY u.email ASC, p.created_at DESC`)
    .bind(JSON.stringify(emails), new Date(nowMs).toISOString())
    .all<LiveRow>()
  return results.map(toLive)
}

export async function findLivePushSubscription(db: D1Database, userId: string, endpoint: string, nowMs: number): Promise<LivePushSubscription | null> {
  const row = await db
    .prepare(`${LIVE_SELECT} WHERE p.user_id = ? AND p.endpoint = ? AND ${ALIVE_SQL}`)
    .bind(userId, endpoint, new Date(nowMs).toISOString())
    .first<LiveRow>()
  return row ? toLive(row) : null
}

export function pushResultStatements(
  db: D1Database,
  sub: Pick<LivePushSubscription, 'id' | 'lastOkAt' | 'failCount'>,
  outcome: PushOutcome,
  nowMs: number,
): D1PreparedStatement[] {
  const remove = () => db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id)
  if (outcome === 'gone') return [remove()]
  if (outcome === 'rejected') {
    if (sub.failCount + 1 >= PUSH_FAIL_MAX) return [remove()]
    return [db.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?').bind(sub.id)]
  }
  if (outcome === 'transient') return []
  const stale = sub.lastOkAt === null || nowMs - sub.lastOkAt >= PUSH_LAST_OK_REFRESH_MS
  if (sub.failCount === 0 && !stale) return []
  return [
    db
      .prepare('UPDATE push_subscriptions SET fail_count = 0, last_ok_at = CASE WHEN ?2 THEN ?3 ELSE last_ok_at END WHERE id = ?1')
      .bind(sub.id, stale ? 1 : 0, nowMs),
  ]
}

export async function cleanupPushSubscriptions(env: Env, nowMs: number): Promise<{ dead: number }> {
  const result = await env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE
      (session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth_sessions s WHERE s.id = push_subscriptions.session_id AND s.expires_at > ?))
      OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = push_subscriptions.user_id)`,
  )
    .bind(new Date(nowMs).toISOString())
    .run()
  const dead = result.meta.changes
  console.info(`push gc: dead=${dead}`)
  return { dead }
}
