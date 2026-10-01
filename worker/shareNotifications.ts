// 초대 받음 알림함 행 — 넣기·지우기 문장 (specs/features/F-3012.md 3장)
import { TRIM_NOTIFICATIONS_SQL, notifRevBeforeDeleteSql } from './commentRows'

export type ShareTarget = { targetType: 'doc' | 'folder'; targetId: string; email: string }

const INVITED_NOW = 'EXISTS (SELECT 1 FROM grants WHERE target_type = ? AND target_id = ? AND grantee_email = ? AND created_at = ?)'
const INSERT_SQL =
  'INSERT INTO notifications (id, recipient_email, kind, doc_id, folder_id, actor_email, doc_title, excerpt, created_at, role) ' +
  `SELECT ?, ?, 'share', CASE WHEN ? = 'doc' THEN ? END, CASE WHEN ? = 'folder' THEN ? END, ?, ?, '', ?, ? WHERE ${INVITED_NOW}`
const REV_SQL = `UPDATE users SET notif_rev = notif_rev + 1 WHERE email = ? AND ${INVITED_NOW}`

// 초대 upsert 뒤에 붙인다 — 이번 now 로 만들어진 새 초대일 때만 행이 생긴다
export function shareNotificationInsertStatements(
  db: D1Database,
  p: ShareTarget & { id: string; actorEmail: string; name: string; role: 'view' | 'edit'; now: number },
): D1PreparedStatement[] {
  const invited = [p.targetType, p.targetId, p.email, p.now] as const
  return [
    db
      .prepare(INSERT_SQL)
      .bind(p.id, p.email, p.targetType, p.targetId, p.targetType, p.targetId, p.actorEmail, p.name, p.now, p.role, ...invited),
    db.prepare(REV_SQL).bind(p.email, ...invited),
    db.prepare(TRIM_NOTIFICATIONS_SQL).bind(JSON.stringify([p.email])),
  ]
}

export function shareNotificationDeleteStatements(db: D1Database, p: ShareTarget): D1PreparedStatement[] {
  const where = `recipient_email = ? AND kind = 'share' AND ${p.targetType === 'doc' ? 'doc_id' : 'folder_id'} = ?`
  return [db.prepare(notifRevBeforeDeleteSql(where)).bind(p.email, p.targetId), db.prepare(`DELETE FROM notifications WHERE ${where}`).bind(p.email, p.targetId)]
}
