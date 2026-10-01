// 알림 API — 목록·읽음 (specs/features/F-503.md 6.5·6.6). 행은 F-502 스냅숏이 만든다
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { readNotificationsUsageStatement } from './usage'
import { isValidUuid } from './validate'
import { INBOX_NOTIFICATION_KINDS, NOTIFICATIONS_DEFAULT_KINDS, NOTIFICATIONS_LIST_DEFAULT, NOTIFICATIONS_LIST_MAX, NOTIFICATIONS_READ_IDS_MAX } from '../src/lib/docComments'
import type { InboxNotificationItem, InboxNotificationKind, InboxNotificationsResponse } from '../src/lib/docComments'

// UUID 50개 몸통이 약 2,000 B
export const NOTIFICATIONS_READ_MAX_BODY_BYTES = 8_192

type NotificationRow = {
  id: string
  kind: InboxNotificationKind
  doc_id: string | null
  comment_id: string | null
  thread_id: string | null
  actor_email: string
  doc_title: string
  excerpt: string
  created_at: number
  read_at: number | null
  folder_id: string | null
  role: 'view' | 'edit' | null
}

const KINDS_IN = 'kind IN (SELECT value FROM json_each(?))'
const LIST_SQL = `SELECT id, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at, folder_id, role FROM notifications WHERE recipient_email = ? AND ${KINDS_IN} ORDER BY created_at DESC, id DESC LIMIT ?`
const UNREAD_SQL = `SELECT COUNT(*) AS n FROM notifications WHERE recipient_email = ? AND ${KINDS_IN} AND read_at IS NULL`
const READ_ALL_SQL = 'UPDATE notifications SET read_at = ?1, push_due_at = NULL WHERE recipient_email = ?2 AND read_at IS NULL'
const READ_IDS_SQL = `${READ_ALL_SQL} AND id IN (SELECT value FROM json_each(?3))`

function toItem(row: NotificationRow): InboxNotificationItem {
  if (row.kind === 'share') {
    return {
      id: row.id,
      kind: 'share',
      target: row.folder_id ? 'folder' : 'doc',
      targetId: (row.doc_id ?? row.folder_id) as string,
      name: row.doc_title,
      role: row.role as 'view' | 'edit',
      actorEmail: row.actor_email,
      createdAt: row.created_at,
      readAt: row.read_at,
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    docId: row.doc_id as string,
    commentId: row.comment_id as string,
    threadId: row.thread_id as string,
    actorEmail: row.actor_email,
    docTitle: row.doc_title,
    excerpt: row.excerpt,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

function readLimit(raw: string | null): number | null {
  if (raw === null) return NOTIFICATIONS_LIST_DEFAULT
  if (!/^[0-9]+$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 && n <= NOTIFICATIONS_LIST_MAX ? n : null
}

// n1 = 응답 모양의 판. userId 가 있어야 계정이 바뀌면 빗나간다 (F-2057 3.3)
export function notificationsEtag(p: { userId: string; rev: number; limit: number; kinds?: readonly InboxNotificationKind[] }): string {
  const tail = p.kinds && !isDefaultKinds(p.kinds) ? `-${p.kinds.join('.')}` : ''
  return `W/"n1-${p.userId}-${p.rev}-${p.limit}${tail}"`
}

const isDefaultKinds = (kinds: readonly InboxNotificationKind[]) => kinds.length === NOTIFICATIONS_DEFAULT_KINDS.length && NOTIFICATIONS_DEFAULT_KINDS.every((k, i) => kinds[i] === k)

// 쉼표로 이은 종류를 INBOX_NOTIFICATION_KINDS 순서로 정규화 — 틀리면 null
function readKinds(raw: string | null): InboxNotificationKind[] | null {
  if (raw === null) return [...NOTIFICATIONS_DEFAULT_KINDS]
  if (raw.length > 64) return null
  const parts = raw.split(',')
  if (!parts.every((p) => (INBOX_NOTIFICATION_KINDS as readonly string[]).includes(p))) return null
  return INBOX_NOTIFICATION_KINDS.filter((k) => parts.includes(k))
}

const stripWeak = (tag: string) => (tag.startsWith('W/') ? tag.slice(2) : tag)

export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false
  const want = stripWeak(etag)
  return header.split(',').some((part) => {
    const tag = part.trim()
    return tag !== '*' && stripWeak(tag) === want
  })
}

// 문서 접근을 다시 보지 않는다 — 막힌 계정도 본다 (6.5)
export async function handleListNotifications(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const params = new URL(request.url).searchParams
  const limit = readLimit(params.get('limit'))
  if (limit === null) return jsonResponse({ error: 'invalid', field: 'limit' }, 400)
  const kinds = readKinds(params.get('kinds'))
  if (kinds === null) return jsonResponse({ error: 'invalid', field: 'kinds' }, 400)
  // 리비전은 인증 때 목록보다 먼저 읽혔다 — 사이에 생긴 알림은 다음 요청이 200 으로 받는다 (F-2057 3.4)
  const etag = typeof user.notifRev === 'number' ? notificationsEtag({ userId: user.id, rev: user.notifRev, limit, kinds }) : null
  if (etag !== null && ifNoneMatchHits(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } })
  }
  const recipient = user.email.toLowerCase()
  const kindsJson = JSON.stringify(kinds)
  const { results } = await env.DB.prepare(LIST_SQL).bind(recipient, kindsJson, limit).all<NotificationRow>()
  const unread = await env.DB.prepare(UNREAD_SQL).bind(recipient, kindsJson).first<{ n: number }>()
  const res = jsonResponse({ items: results.map(toItem), unread: unread?.n ?? 0 } satisfies InboxNotificationsResponse)
  if (etag !== null) res.headers.set('ETag', etag)
  return res
}

// 정확히 { all: true } 또는 1~50개 UUID 의 { ids } — 그 밖은 null
function readTarget(body: unknown): { all: true } | { ids: string[] } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1) return null
  if (keys[0] === 'all') return record.all === true ? { all: true } : null
  if (keys[0] !== 'ids') return null
  const ids = record.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > NOTIFICATIONS_READ_IDS_MAX || !ids.every(isValidUuid)) return null
  return { ids: ids as string[] }
}

// 남의 id·없는 id·이미 읽은 행은 조용히 건너뛴다 (6.6)
export async function handleReadNotifications(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, NOTIFICATIONS_READ_MAX_BODY_BYTES)
  if (!parsed.ok) {
    return parsed.reason === 'too_large' ? jsonResponse({ error: 'too_large', limit: NOTIFICATIONS_READ_MAX_BODY_BYTES }, 413) : errorResponse('invalid', 400)
  }
  const target = readTarget(parsed.data)
  if (!target) return errorResponse('invalid', 400)
  const now = Date.now()
  const recipient = user.email.toLowerCase()
  const update =
    'all' in target
      ? env.DB.prepare(READ_ALL_SQL).bind(now, recipient)
      : env.DB.prepare(READ_IDS_SQL).bind(now, recipient, JSON.stringify(target.ids))
  await env.DB.batch([update, readNotificationsUsageStatement(env.DB, user.id, now)])
  return new Response(null, { status: 204 })
}
