// 댓글 D1 복사본·알림 문장, 행 ↔ CommentRecord, 알림 받는 사람·발췌 (specs/features/F-502.md 4장·5장·6장·8장)
import { NOTIFICATIONS_PER_RECIPIENT_MAX, commentSig, recordAnchorSig } from '../src/lib/docComments'
import type { AnchorRange, CommentEntry, CommentRecord, CommentThread, NotificationKind } from '../src/lib/docComments'
import { toCommentRecord } from '../src/lib/commentAnchor'
import { commentBytesInStatement, commentBytesOutStatement, deleteFolderCommentBytesStatement, e2eeCommentBytesOutStatement } from './usage'
import { utf8ByteLength } from './validate'

// 바인딩 JSON 한 개의 UTF-8 상한 — D1 바인딩 문자열 2MB 의 절반, 본문 한도와 같은 값 (4.4)
export const COMMENT_JSON_CHUNK_BYTES = 1_000_000
export const NOTIFICATIONS_PER_BATCH_MAX = 2_000
export const NOTIFICATION_EXCERPT_CHARS = 120

export type CommentRow = CommentRecord & { sig: string; anchorSig: string }

export type DocCommentDbRow = {
  doc_id: string
  id: string
  parent_id: string | null
  author_id: string | null
  author_email: string | null
  body: string
  mentions: string
  quote: string
  prefix: string
  suffix: string
  anchor_from: number | null
  anchor_length: number | null
  resolved_at: number | null
  resolved_by: string | null
  resolved_by_id: string | null
  created_at: number
  bytes: number
  sig: string
  anchor_sig: string
}

export type NotificationDraft = { recipient: string; kind: NotificationKind; commentId: string; threadId: string; actor: string; excerpt: string }

export const KNOWN_COMMENTS_SQL = 'SELECT id, sig, anchor_sig FROM doc_comments WHERE doc_id = ?'
export const ALL_COMMENTS_SQL = 'SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, id'

const DOC_WRITABLE = 'EXISTS (SELECT 1 FROM docs WHERE id = ?1 AND e2ee_key IS NULL)'
const field = (name: string) => `json_extract(value, '$.${name}')`
const byteLen = (name: string) => `length(CAST(${field(name)} AS BLOB))`

const UPSERT_SQL =
  'INSERT INTO doc_comments (doc_id, id, parent_id, author_id, author_email, body, mentions, quote, prefix, suffix, anchor_from, anchor_length, resolved_at, resolved_by, resolved_by_id, created_at, bytes, sig, anchor_sig) ' +
  `SELECT ?1, ${['id', 'parent', 'authorId', 'authorEmail', 'body', 'mentions', 'quote', 'prefix', 'suffix', 'anchorFrom', 'anchorLength', 'resolvedAt', 'resolvedBy', 'resolvedById', 'createdAt'].map(field).join(', ')}, ` +
  `${['body', 'quote', 'prefix', 'suffix'].map(byteLen).join(' + ')}, ${field('sig')}, ${field('anchorSig')} ` +
  `FROM json_each(?2) WHERE ${DOC_WRITABLE} ` +
  'ON CONFLICT (doc_id, id) DO UPDATE SET parent_id = excluded.parent_id, author_id = excluded.author_id, author_email = excluded.author_email, body = excluded.body, mentions = excluded.mentions, quote = excluded.quote, prefix = excluded.prefix, suffix = excluded.suffix, anchor_from = excluded.anchor_from, anchor_length = excluded.anchor_length, resolved_at = excluded.resolved_at, resolved_by = excluded.resolved_by, resolved_by_id = excluded.resolved_by_id, created_at = excluded.created_at, bytes = excluded.bytes, sig = excluded.sig, anchor_sig = excluded.anchor_sig'
const DELETE_ROWS_SQL = 'DELETE FROM doc_comments WHERE doc_id = ?1 AND id IN (SELECT value FROM json_each(?2))'
const ROW_NOTIFICATIONS_WHERE = 'doc_id = ?1 AND comment_id IN (SELECT value FROM json_each(?2))'
// 푸시가 켜져 있고(?5) 받는 사람에게 구독이 있을 때만 (F-3005 4.2)
const PUSH_DUE_SQL = `CASE WHEN ?5 IS NOT NULL AND EXISTS (SELECT 1 FROM users u JOIN push_subscriptions p ON p.user_id = u.id WHERE u.email = ${field('recipient')}) THEN ?5 END`
const INSERT_NOTIFICATIONS_SQL =
  'INSERT OR IGNORE INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, push_due_at) ' +
  `SELECT ${field('id')}, ${field('recipient')}, ${field('kind')}, ?1, ${field('commentId')}, ${field('threadId')}, ${field('actor')}, ?2, ${field('excerpt')}, ?3, ${PUSH_DUE_SQL} ` +
  `FROM json_each(?4) WHERE ${DOC_WRITABLE}`
// 받는 사람 식마다 300번째 행 id — 그보다 뒤가 지울 행 (F-2075 3.2)
export const nthNotificationIdSql = (recipient: string) =>
  `(SELECT id FROM notifications WHERE recipient_email = ${recipient} ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ${NOTIFICATIONS_PER_RECIPIENT_MAX - 1})`
// cut(r, i) 뒤에 붙는 꼬리 — 넣기 정리·매일 정리가 같이 쓴다
export const TRIM_BY_CUT_DELETE =
  'DELETE FROM notifications WHERE rowid IN (SELECT n.rowid FROM cut JOIN notifications t ON t.id = cut.i ' +
  'JOIN notifications n ON n.recipient_email = cut.r AND n.created_at <= t.created_at WHERE (n.created_at, n.id) < (t.created_at, t.id))'
export const TRIM_NOTIFICATIONS_SQL = `WITH cut(r, i) AS MATERIALIZED (SELECT value, ${nthNotificationIdSql('value')} FROM json_each(?1)) ${TRIM_BY_CUT_DELETE}`
// F-2057 3.5 ① — 넣기 문장의 DOC_WRITABLE 과 같은 조건이라 금고 문서면 0행
const INSERT_NOTIF_REV_SQL =
  'UPDATE users SET notif_rev = notif_rev + 1 WHERE email IN (SELECT value FROM json_each(?1)) AND EXISTS (SELECT 1 FROM docs WHERE id = ?2 AND e2ee_key IS NULL)'

// F-2057 3.5 — 지운 뒤에는 받는 사람을 알 수 없어, 같은 WHERE 로 DELETE 바로 앞에 둔다
export function notifRevBeforeDeleteSql(where: string): string {
  return `UPDATE users SET notif_rev = notif_rev + 1 WHERE email IN (SELECT recipient_email FROM notifications WHERE ${where})`
}

const DOC_COMMENTS_DELETE_SQL = 'DELETE FROM doc_comments WHERE doc_id = ?'
const DOC_NOTIFICATIONS_WHERE = 'doc_id = ?'
const FOLDER_DOCS = 'SELECT id FROM docs WHERE owner_id = ?1 AND folder_id IN (SELECT value FROM json_each(?2))'
const WROTE_KEY = 'EXISTS (SELECT 1 FROM docs WHERE id = ?1 AND e2ee_key = ?2)'
const OWNER_DOCS = 'SELECT id FROM docs WHERE owner_id = ?1'
const FOLDER_NOTIFICATIONS_WHERE = `doc_id IN (${FOLDER_DOCS})`
const E2EE_NOTIFICATIONS_WHERE = `doc_id = ?1 AND ${WROTE_KEY}`
const ACCOUNT_NOTIFICATIONS_WHERE = `doc_id IN (${OWNER_DOCS}) OR recipient_email = ?2`

// 받는 사람 리비전 → 알림 지우기, 같은 WHERE·같은 바인딩
function deleteNotificationsStatements(db: D1Database, where: string, ...args: unknown[]): D1PreparedStatement[] {
  return [db.prepare(notifRevBeforeDeleteSql(where)).bind(...args), db.prepare(`DELETE FROM notifications WHERE ${where}`).bind(...args)]
}

// ----- 행 만들기·읽기 -----

export function commentRowOf(id: string, entry: CommentEntry, text: string, range: AnchorRange | null): CommentRow {
  const record = toCommentRecord(id, entry, text, range)
  return { ...record, sig: commentSig(entry), anchorSig: recordAnchorSig(record) }
}

function readMentions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((m) => typeof m === 'string') ? parsed : []
  } catch {
    return []
  }
}

export function rowToCommentRecord(row: DocCommentDbRow): CommentRecord {
  return {
    id: row.id,
    parent: row.parent_id,
    body: row.body,
    mentions: readMentions(row.mentions),
    authorId: row.author_id,
    authorEmail: row.author_email,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedById: row.resolved_by_id,
    resolvedBy: row.resolved_by,
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    anchorFrom: row.anchor_from,
    anchorLength: row.anchor_length,
  }
}

// 행 단위로 채우다 다음 행이 넘치면 새 배열을 연다
export function chunkJsonRows(rows: readonly unknown[], limit = COMMENT_JSON_CHUNK_BYTES): string[] {
  const chunks: string[] = []
  let parts: string[] = []
  let size = 2
  for (const row of rows) {
    const json = JSON.stringify(row)
    const bytes = utf8ByteLength(json)
    if (parts.length > 0 && size + 1 + bytes > limit) {
      chunks.push(`[${parts.join(',')}]`)
      parts = []
      size = 2
    }
    size += (parts.length > 0 ? 1 : 0) + bytes
    parts.push(json)
  }
  if (parts.length > 0) chunks.push(`[${parts.join(',')}]`)
  return chunks
}

// ----- 스냅숏 batch 의 댓글 묶음 (4.3) -----

export function upsertCommentStatements(db: D1Database, docId: string, rows: readonly CommentRow[]): D1PreparedStatement[] {
  return chunkJsonRows(rows).map((json) => db.prepare(UPSERT_SQL).bind(docId, json))
}

export function notificationStatements(
  db: D1Database,
  p: { docId: string; docTitle: string; now: number; drafts: readonly NotificationDraft[]; pushDueAt?: number | null },
): D1PreparedStatement[] {
  if (p.drafts.length === 0) return []
  const rows = p.drafts.map((d) => ({ id: crypto.randomUUID(), ...d }))
  const recipients = JSON.stringify([...new Set(p.drafts.map((d) => d.recipient))])
  return [
    ...chunkJsonRows(rows).map((json) => db.prepare(INSERT_NOTIFICATIONS_SQL).bind(p.docId, p.docTitle, p.now, json, p.pushDueAt ?? null)),
    db.prepare(TRIM_NOTIFICATIONS_SQL).bind(recipients),
    db.prepare(INSERT_NOTIF_REV_SQL).bind(recipients, p.docId),
  ]
}

export function commentBundleStatements(
  db: D1Database,
  p: { docId: string; ownerId: string; upserts: readonly CommentRow[]; deletes: readonly string[]; drafts: readonly NotificationDraft[]; docTitle: string; now: number; pushDueAt?: number | null },
): D1PreparedStatement[] {
  const statements = [commentBytesOutStatement(db, p.ownerId, p.docId), ...upsertCommentStatements(db, p.docId, p.upserts)]
  if (p.deletes.length > 0) {
    const ids = JSON.stringify(p.deletes)
    statements.push(db.prepare(DELETE_ROWS_SQL).bind(p.docId, ids), ...deleteNotificationsStatements(db, ROW_NOTIFICATIONS_WHERE, p.docId, ids))
  }
  statements.push(...notificationStatements(db, p), commentBytesInStatement(db, p.ownerId, p.docId))
  return statements
}

// ----- 알림 받는 사람·발췌 (6.2·6.5) -----

export function notificationExcerpt(body: string): string {
  if (body.length <= NOTIFICATION_EXCERPT_CHARS) return body
  const last = body.charCodeAt(NOTIFICATION_EXCERPT_CHARS - 1)
  const cut = last >= 0xd800 && last <= 0xdbff ? NOTIFICATION_EXCERPT_CHARS - 1 : NOTIFICATION_EXCERPT_CHARS
  return body.slice(0, cut)
}

export function notificationTargets(
  item: { id: string; entry: CommentEntry },
  thread: CommentThread | null,
  people: ReadonlySet<string>,
  owner: string | null,
): NotificationDraft[] {
  const actor = item.entry.author.email?.toLowerCase()
  if (!actor) return []
  const base = {
    commentId: item.id,
    threadId: item.entry.parent ?? item.id,
    actor: item.entry.author.email as string,
    excerpt: notificationExcerpt(item.entry.body),
  }
  const drafts: NotificationDraft[] = []
  const taken = new Set([actor])
  for (const email of item.entry.mentions) {
    const lower = email.toLowerCase()
    if (taken.has(lower) || !people.has(lower)) continue
    taken.add(lower)
    drafts.push({ recipient: lower, kind: 'mention', ...base })
  }
  const addOwnerComment = () => {
    if (owner && !taken.has(owner) && people.has(owner)) drafts.push({ recipient: owner, kind: 'comment', ...base })
  }
  if (item.entry.parent === null || !thread) {
    addOwnerComment()
    return drafts
  }
  const earlier = [thread.root.author.email]
  for (const r of thread.replies) {
    if (r.id === item.id) break
    earlier.push(r.entry.author.email)
  }
  for (const email of earlier) {
    const lower = email?.toLowerCase()
    if (!lower || taken.has(lower) || !people.has(lower)) continue
    taken.add(lower)
    drafts.push({ recipient: lower, kind: 'reply', ...base })
  }
  addOwnerComment()
  return drafts
}

// ----- 지우는 자리 (8장) — 이미 있는 batch 에 더하는 문장 -----

export function docCommentDeleteStatements(db: D1Database, ownerId: string, docId: string): D1PreparedStatement[] {
  return [
    commentBytesOutStatement(db, ownerId, docId),
    db.prepare(DOC_COMMENTS_DELETE_SQL).bind(docId),
    ...deleteNotificationsStatements(db, DOC_NOTIFICATIONS_WHERE, docId),
  ]
}

export function folderCommentDeleteStatements(db: D1Database, ownerId: string, folderIds: string[]): D1PreparedStatement[] {
  const ids = JSON.stringify(folderIds)
  return [
    deleteFolderCommentBytesStatement(db, ownerId, folderIds),
    db.prepare(`DELETE FROM doc_comments WHERE doc_id IN (${FOLDER_DOCS})`).bind(ownerId, ids),
    ...deleteNotificationsStatements(db, FOLDER_NOTIFICATIONS_WHERE, ownerId, ids),
  ]
}

export function e2eeCommentDeleteStatements(db: D1Database, ownerId: string, docId: string, e2eeKey: string): D1PreparedStatement[] {
  return [
    e2eeCommentBytesOutStatement(db, ownerId, docId, e2eeKey),
    db.prepare(`DELETE FROM doc_comments WHERE doc_id = ?1 AND ${WROTE_KEY}`).bind(docId, e2eeKey),
    ...deleteNotificationsStatements(db, E2EE_NOTIFICATIONS_WHERE, docId, e2eeKey),
  ]
}

// 계정 삭제 (F-2038 5.2 11번 앞) — 사용량 문장은 없다(users 행을 지운다)
export function accountCommentDeleteStatements(db: D1Database, userId: string, email: string): D1PreparedStatement[] {
  return [
    db.prepare(`DELETE FROM doc_comments WHERE doc_id IN (${OWNER_DOCS})`).bind(userId),
    ...deleteNotificationsStatements(db, ACCOUNT_NOTIFICATIONS_WHERE, userId, email.toLowerCase()),
  ]
}
