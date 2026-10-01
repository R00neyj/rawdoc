// 매일 Cron 댓글·알림 안전망 정리 (specs/features/F-502.md 10장). 지운 행은 누계에서 빼지 않는다 — recount 몫
import { NOTIFICATION_RETAIN_DAYS, NOTIFICATIONS_PER_RECIPIENT_MAX } from '../src/lib/docComments'
import { TRIM_BY_CUT_DELETE, nthNotificationIdSql, notifRevBeforeDeleteSql } from './commentRows'

const DAY_MS = 24 * 60 * 60 * 1000
const NO_DOC = (table: string) => `NOT EXISTS (SELECT 1 FROM docs WHERE docs.id = ${table}.doc_id AND docs.e2ee_key IS NULL)`

const ORPHAN_ROWS_SQL = `DELETE FROM doc_comments WHERE ${NO_DOC('doc_comments')}`
const OLD_WHERE = 'created_at < ?'
const NO_INVITE =
  "NOT EXISTS (SELECT 1 FROM grants g WHERE g.target_type = CASE WHEN notifications.folder_id IS NULL THEN 'doc' ELSE 'folder' END AND g.target_id = COALESCE(notifications.doc_id, notifications.folder_id) AND g.grantee_email = notifications.recipient_email)"
const ORPHAN_WHERE = `(kind <> 'share' AND ${NO_DOC('notifications')}) OR (kind = 'share' AND ${NO_INVITE})`
const OLD_NOTIFICATIONS_SQL = `DELETE FROM notifications WHERE ${OLD_WHERE}`
const ORPHAN_NOTIFICATIONS_SQL = `DELETE FROM notifications WHERE ${ORPHAN_WHERE}`
// 300개를 넘는 받는 사람만 골라 300번째 행을 한 번 찾는다. 리비전은 넣기 때 TRIM 과 함께 이미 올랐다 (F-2057 3.5 ⑦, F-2075 3.3)
export const OVERFLOW_SQL =
  `WITH cut(r, i) AS MATERIALIZED (SELECT o.recipient_email, ${nthNotificationIdSql('o.recipient_email')} FROM notifications o ` +
  `GROUP BY o.recipient_email HAVING COUNT(*) > ${NOTIFICATIONS_PER_RECIPIENT_MAX}) ${TRIM_BY_CUT_DELETE}`

export async function cleanupComments(
  env: Env,
  now: number,
): Promise<{ orphanRows: number; oldNotifications: number; orphanNotifications: number; overflowNotifications: number }> {
  const db = env.DB
  const cutoff = now - NOTIFICATION_RETAIN_DAYS * DAY_MS
  const [rows, , old, , orphan, over] = await db.batch([
    db.prepare(ORPHAN_ROWS_SQL),
    db.prepare(notifRevBeforeDeleteSql(OLD_WHERE)).bind(cutoff),
    db.prepare(OLD_NOTIFICATIONS_SQL).bind(cutoff),
    db.prepare(notifRevBeforeDeleteSql(ORPHAN_WHERE)),
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
