// 권한 요청 받음 알림함 행과 푸시 (specs/features/F-3020.md 2·3장)
import { TRIM_NOTIFICATIONS_SQL } from './commentRows'
import { pushToEmail } from './pushSend'
import type { VapidAuth } from './webPush'
import { PUSH_SHARE_DEDUPE_MS } from '../src/lib/push/pushPayload'
import { accessRequestPushPayload, type PushShare } from '../src/lib/push/pushText'

const INSERT_SQL =
  'INSERT INTO notifications (id, recipient_email, kind, doc_id, folder_id, actor_email, doc_title, excerpt, created_at, role) ' +
  "SELECT r.id, u.email, 'access_request', CASE WHEN r.target_type = 'doc' THEN r.target_id END, CASE WHEN r.target_type = 'folder' THEN r.target_id END, r.requester_email, " +
  "COALESCE(CASE r.target_type WHEN 'doc' THEN (SELECT title FROM docs WHERE id = r.target_id) ELSE (SELECT name FROM folders WHERE id = r.target_id) END, ''), '', r.created_at, r.role " +
  "FROM access_requests r JOIN users u ON u.id = r.owner_id WHERE r.id = ? AND r.status = 'pending'"
const REV_SQL = "UPDATE users SET notif_rev = notif_rev + 1 WHERE id = (SELECT owner_id FROM access_requests WHERE id = ?1 AND status = 'pending')"
const ROLE_CHANGED = "id = ?1 AND kind = 'access_request' AND role <> ?2"
const ROLE_REV_SQL = `UPDATE users SET notif_rev = notif_rev + 1 WHERE email = (SELECT recipient_email FROM notifications WHERE ${ROLE_CHANGED})`
const ROLE_SQL = `UPDATE notifications SET role = ?2 WHERE ${ROLE_CHANGED}`
const OVERLAP_SQL = `SELECT 1 FROM access_requests WHERE owner_id = ?1 AND status = 'pending' AND created_at > ?2 AND created_at <= ?3 AND id <> ?4 LIMIT 1`

// 새 대기 행이 실제로 들어갔을 때만 행이 생긴다 — 같은 batch 의 INSERT 뒤에 붙인다
export function accessRequestNotificationInsertStatements(db: D1Database, p: { id: string; ownerEmail: string }): D1PreparedStatement[] {
  return [
    db.prepare(INSERT_SQL).bind(p.id),
    db.prepare(REV_SQL).bind(p.id),
    db.prepare(TRIM_NOTIFICATIONS_SQL).bind(JSON.stringify([p.ownerEmail])),
  ]
}

// 권한만 바뀐 200 — 읽음·시각은 그대로, 바뀐 때만 리비전을 올린다
export function accessRequestRoleStatements(db: D1Database, p: { id: string; role: 'view' | 'edit' }): D1PreparedStatement[] {
  return [db.prepare(ROLE_REV_SQL).bind(p.id, p.role), db.prepare(ROLE_SQL).bind(p.id, p.role)]
}

export async function pushAccessRequest(
  db: D1Database,
  auth: VapidAuth,
  p: { id: string; ownerId: string; ownerEmail: string; now: number; share: PushShare },
): Promise<void> {
  const overlap = await db.prepare(OVERLAP_SQL).bind(p.ownerId, p.now - PUSH_SHARE_DEDUPE_MS, p.now, p.id).first()
  if (overlap) return
  await pushToEmail(db, auth, p.ownerEmail, accessRequestPushPayload(p.share), p.now)
}
