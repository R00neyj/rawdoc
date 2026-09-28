// 알림 API — 목록·읽음 (specs/features/F-503.md 6.5·6.6). 행은 F-502 스냅숏이 만든다
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { readNotificationsUsageStatement } from './usage'
import { isValidUuid } from './validate'
import { NOTIFICATIONS_LIST_DEFAULT, NOTIFICATIONS_LIST_MAX, NOTIFICATIONS_READ_IDS_MAX } from '../src/lib/docComments'
import type { NotificationItem, NotificationsResponse } from '../src/lib/docComments'

// UUID 50개 몸통이 약 2,000 B
export const NOTIFICATIONS_READ_MAX_BODY_BYTES = 8_192

type NotificationRow = {
  id: string
  kind: 'mention' | 'reply'
  doc_id: string
  comment_id: string
  thread_id: string
  actor_email: string
  doc_title: string
  excerpt: string
  created_at: number
  read_at: number | null
}

const LIST_SQL =
  'SELECT id, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at, read_at FROM notifications WHERE recipient_email = ? ORDER BY created_at DESC, id DESC LIMIT ?'
const UNREAD_SQL = 'SELECT COUNT(*) AS n FROM notifications WHERE recipient_email = ? AND read_at IS NULL'
const READ_ALL_SQL = 'UPDATE notifications SET read_at = ?1 WHERE recipient_email = ?2 AND read_at IS NULL'
const READ_IDS_SQL = `${READ_ALL_SQL} AND id IN (SELECT value FROM json_each(?3))`

function toItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    docId: row.doc_id,
    commentId: row.comment_id,
    threadId: row.thread_id,
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
export function notificationsEtag(p: { userId: string; rev: number; limit: number }): string {
  return `W/"n1-${p.userId}-${p.rev}-${p.limit}"`
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
  const limit = readLimit(new URL(request.url).searchParams.get('limit'))
  if (limit === null) return jsonResponse({ error: 'invalid', field: 'limit' }, 400)
  // 리비전은 인증 때 목록보다 먼저 읽혔다 — 사이에 생긴 알림은 다음 요청이 200 으로 받는다 (F-2057 3.4)
  const etag = typeof user.notifRev === 'number' ? notificationsEtag({ userId: user.id, rev: user.notifRev, limit }) : null
  if (etag !== null && ifNoneMatchHits(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } })
  }
  const recipient = user.email.toLowerCase()
  const { results } = await env.DB.prepare(LIST_SQL).bind(recipient, limit).all<NotificationRow>()
  const unread = await env.DB.prepare(UNREAD_SQL).bind(recipient).first<{ n: number }>()
  const res = jsonResponse({ items: results.map(toItem), unread: unread?.n ?? 0 } satisfies NotificationsResponse)
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
