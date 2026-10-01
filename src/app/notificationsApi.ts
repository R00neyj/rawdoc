// 알림함 API·순수 함수 — 응답 검사, 문구, 가져오기 판정, 읽음 대기 합치기 (specs/features/F-507.md 3.1). React·DOM 없음
import {
  INBOX_NOTIFICATION_KINDS,
  NOTIFICATION_KINDS,
  type DocPeopleResponse,
  type InboxNotificationItem,
  type InboxNotificationsResponse,
  type NotificationItem,
} from '../lib/docComments'
import { formatNotificationTitle, notificationExcerptLine, sharePushPayload } from '../lib/pushText'

export { NOTIFICATION_TITLE_MAX, notificationExcerptLine } from '../lib/pushText' // F-3002 5.4 — 옛 import 그대로

export const NOTIFICATIONS_POLL_MS = 60_000 // F-500 4.8
export const NOTIFICATIONS_MIN_GAP_MS = 5_000 // 자동 가져오기끼리의 최소 간격

export const NOTIFICATIONS_ETAG_MAX = 200 // 이보다 긴 ETag 는 쥐지 않는다 (F-2057 4.1)

export type NotificationsFetchResult =
  | { ok: true; data: InboxNotificationsResponse; etag: string | null }
  | { ok: true; notModified: true }
  | { ok: false; reason: 'network' | 'unauthorized' | 'server' | 'invalid' }
export type DocPeopleFetchResult = { ok: true; people: DocPeopleResponse['people'] } | { ok: false }

const NOTIFICATION_ITEM_KEYS = [
  'id',
  'kind',
  'docId',
  'commentId',
  'threadId',
  'actorEmail',
  'docTitle',
  'excerpt',
  'createdAt',
  'readAt',
] as const

const SHARE_ITEM_KEYS = ['id', 'kind', 'target', 'targetId', 'name', 'role', 'actorEmail', 'createdAt', 'readAt'] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj)
  return objKeys.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k))
}

function isTimestampPair(value: Record<string, unknown>): boolean {
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false
  return value.readAt === null || (typeof value.readAt === 'number' && Number.isFinite(value.readAt))
}

function isShareItem(value: Record<string, unknown>): boolean {
  if (!hasExactKeys(value, SHARE_ITEM_KEYS)) return false
  if (typeof value.id !== 'string' || typeof value.targetId !== 'string' || typeof value.name !== 'string' || typeof value.actorEmail !== 'string') return false
  if (value.target !== 'doc' && value.target !== 'folder') return false
  if (value.role !== 'view' && value.role !== 'edit') return false
  return isTimestampPair(value)
}

function isNotificationItem(value: unknown): value is InboxNotificationItem {
  if (!isPlainObject(value)) return false
  if (value.kind === 'share') return isShareItem(value)
  if (!hasExactKeys(value, NOTIFICATION_ITEM_KEYS)) return false
  if (typeof value.id !== 'string') return false
  if (!NOTIFICATION_KINDS.some((k) => k === value.kind)) return false
  if (typeof value.docId !== 'string') return false
  if (typeof value.commentId !== 'string') return false
  if (typeof value.threadId !== 'string') return false
  if (typeof value.actorEmail !== 'string') return false
  if (typeof value.docTitle !== 'string') return false
  if (typeof value.excerpt !== 'string') return false
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false
  if (value.readAt !== null && (typeof value.readAt !== 'number' || !Number.isFinite(value.readAt))) return false
  return true
}

export function readNotificationsResponse(json: unknown): InboxNotificationsResponse | null {
  if (!isPlainObject(json)) return null
  if (!Array.isArray(json.items)) return null
  if (typeof json.unread !== 'number' || !Number.isInteger(json.unread) || json.unread < 0) return null
  for (const item of json.items) {
    if (!isNotificationItem(item)) return null
  }
  return { items: json.items as InboxNotificationItem[], unread: json.unread }
}

function isDocPerson(value: unknown): value is DocPeopleResponse['people'][number] {
  if (!isPlainObject(value)) return false
  if (typeof value.email !== 'string') return false
  return value.role === 'owner' || value.role === 'edit' || value.role === 'view'
}

export function readDocPeopleResponse(json: unknown): DocPeopleResponse | null {
  if (!isPlainObject(json)) return null
  if (!Array.isArray(json.people)) return null
  for (const person of json.people) {
    if (!isDocPerson(person)) return null
  }
  return { people: json.people as DocPeopleResponse['people'] }
}

// 조건부 요청 — 304 는 !res.ok 판정보다 먼저 가른다 (F-2057 4.1)
export async function fetchNotifications(etag: string | null): Promise<NotificationsFetchResult> {
  let res: Response
  try {
    res = await fetch(`/api/notifications?kinds=${INBOX_NOTIFICATION_KINDS.join(',')}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: etag !== null ? { 'If-None-Match': etag } : {},
    })
  } catch {
    return { ok: false, reason: 'network' }
  }
  if (res.status === 304) return etag !== null ? { ok: true, notModified: true } : { ok: false, reason: 'invalid' }
  if (res.status === 401) return { ok: false, reason: 'unauthorized' }
  if (res.status >= 500) return { ok: false, reason: 'server' }
  if (!res.ok) return { ok: false, reason: 'invalid' }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const data = readNotificationsResponse(json)
  if (!data) return { ok: false, reason: 'invalid' }
  const header = res.headers.get('ETag')
  return { ok: true, data, etag: header !== null && header.length <= NOTIFICATIONS_ETAG_MAX ? header : null }
}

export async function markNotificationsRead(target: { ids: string[] } | { all: true }): Promise<boolean> {
  let res: Response
  try {
    res = await fetch('/api/notifications/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    })
  } catch {
    return false
  }
  return res.status === 204
}

export async function fetchDocPeople(docId: string): Promise<DocPeopleFetchResult> {
  let res: Response
  try {
    res = await fetch(`/api/docs/${encodeURIComponent(docId)}/people`, { credentials: 'same-origin' })
  } catch {
    return { ok: false }
  }
  if (!res.ok) return { ok: false }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false }
  }
  const data = readDocPeopleResponse(json)
  if (!data) return { ok: false }
  return { ok: true, people: data.people }
}

// F-500 5.1 문구, comment 는 F-2111
export function notificationText(item: NotificationItem): string {
  const title = formatNotificationTitle(item.docTitle)
  if (item.kind === 'mention') return `${item.actorEmail}님이 "${title}" 댓글에서 멘션했습니다.`
  if (item.kind === 'comment') return `${item.actorEmail}님이 "${title}"에 댓글을 달았습니다.`
  return `${item.actorEmail}님이 "${title}"의 댓글에 답글을 달았습니다.`
}

// 알림함 행 두 줄 — 공유는 푸시 문구에 마침표 (F-2116 2.2)
export function notificationLines(item: InboxNotificationItem): { text: string; excerpt: string } {
  if (item.kind !== 'share') return { text: notificationText(item), excerpt: notificationExcerptLine(item.excerpt) }
  const { title, body } = sharePushPayload(item)
  return { text: `${title}.`, excerpt: body }
}

export type PollReason = 'enable' | 'interval' | 'visible' | 'online' | 'open'

export function shouldFetchNotifications(input: {
  reason: PollReason
  now: number
  lastStartedAt: number | null
  inFlight: boolean
  visible: boolean
  online: boolean
  stopped: boolean
}): boolean {
  if (input.stopped || input.inFlight || !input.online) return false
  if (input.reason === 'enable') return true
  if (input.reason === 'interval') {
    if (!input.visible) return false
    return input.lastStartedAt === null || input.now - input.lastStartedAt >= NOTIFICATIONS_POLL_MS
  }
  return input.lastStartedAt === null || input.now - input.lastStartedAt >= NOTIFICATIONS_MIN_GAP_MS
}

export type PendingRead =
  | { kind: 'ids'; ids: readonly string[]; at: number; settledAt: number | null }
  | { kind: 'all'; at: number; settledAt: number | null }

export function applyPendingReads(data: InboxNotificationsResponse, pending: readonly PendingRead[]): InboxNotificationsResponse {
  let allAt: number | null = null
  const idsAt = new Map<string, number>()
  for (const p of pending) {
    if (p.kind === 'all') {
      if (allAt === null || p.at > allAt) allAt = p.at
    } else {
      for (const id of p.ids) idsAt.set(id, p.at)
    }
  }

  const items = data.items.map((item) => {
    if (allAt !== null && item.createdAt <= allAt) return { ...item, readAt: item.readAt ?? allAt }
    if (idsAt.has(item.id)) return { ...item, readAt: item.readAt ?? idsAt.get(item.id)! }
    return item
  })

  let unread: number
  if (allAt !== null) {
    const at = allAt
    unread = items.filter((item) => item.createdAt > at && item.readAt === null).length
  } else {
    const doubleCounted = data.items.filter((item) => idsAt.has(item.id) && item.readAt === null).length
    unread = Math.max(0, data.unread - doubleCounted)
  }

  return { items, unread }
}

// 요청이 끝난 뒤에 시작한 가져오기가 돌아왔을 때만 뺀다 (판정 U8)
export function dropSettledReads(pending: readonly PendingRead[], fetchStartedAt: number): PendingRead[] {
  return pending.filter((p) => !(p.settledAt !== null && p.settledAt <= fetchStartedAt))
}
