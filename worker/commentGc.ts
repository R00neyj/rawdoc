// 매일 Cron 댓글·알림 안전망 정리 (specs/features/F-502.md 10장). 지운 행은 누계에서 빼지 않는다 — recount 몫
import { NOTIFICATION_RETAIN_DAYS, NOTIFICATIONS_PER_RECIPIENT_MAX } from '../src/lib/docComments'
import { TRIM_NOTIFICATIONS_WHERE } from './commentRows'

const DAY_MS = 24 * 60 * 60 * 1000
const NO_DOC = (table: string) => `NOT EXISTS (SELECT 1 FROM docs WHERE docs.id = ${table}.doc_id AND docs.e2ee_key IS NULL)`

const ORPHAN_ROWS_SQL = `DELETE FROM doc_comments WHERE ${NO_DOC('doc_comments')}`
const OLD_NOTIFICATIONS_SQL = 'DELETE FROM notifications WHERE created_at < ?'
const ORPHAN_NOTIFICATIONS_SQL = `DELETE FROM notifications WHERE ${NO_DOC('notifications')}`
// 300개를 넘는 받는 사람만 골라 상관 부질의를 돌린다
const OVERFLOW_SQL = `DELETE FROM notifications WHERE recipient_email IN (SELECT recipient_email FROM notifications GROUP BY recipient_email HAVING COUNT(*) > ${NOTIFICATIONS_PER_RECIPIENT_MAX}) AND ${TRIM_NOTIFICATIONS_WHERE}`

export async function cleanupComments(
  env: Env,
  now: number,
): Promise<{ orphanRows: number; oldNotifications: number; orphanNotifications: number; overflowNotifications: number }> {
  const db = env.DB
  const [rows, old, orphan, over] = await db.batch([
    db.prepare(ORPHAN_ROWS_SQL),
    db.prepare(OLD_NOTIFICATIONS_SQL).bind(now - NOTIFICATION_RETAIN_DAYS * DAY_MS),
    db.prepare(ORPHAN_NOTIFICATIONS_SQL),
    db.prepare(OVERFLOW_SQL),
  ])
  const result = {
    orphanRows: rows.meta.changes,
    oldNotifications: old.meta.changes,
    orphanNotifications: orphan.meta.changes,
    overflowNotifications: over.meta.changes,
  }
  console.log(
    `comment gc: rows=${result.orphanRows} old=${result.oldNotifications} orphan=${result.orphanNotifications} over=${result.overflowNotifications}`,
  )
  return result
}
