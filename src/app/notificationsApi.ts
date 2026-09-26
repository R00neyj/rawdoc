// 알림함 API·순수 함수 — 응답 검사, 문구, 가져오기 판정, 읽음 대기 합치기 (specs/features/F-507.md 3.1). React·DOM 없음
import type { DocPeopleResponse, NotificationItem, NotificationsResponse } from '../lib/docComments'

export const NOTIFICATIONS_POLL_MS = 60_000 // F-500 4.8
export const NOTIFICATIONS_MIN_GAP_MS = 5_000 // 자동 가져오기끼리의 최소 간격
export const NOTIFICATION_TITLE_MAX = 40 // 문구 안 문서 제목 (코드 포인트)

export type NotificationsFetchResult = { ok: true; data: NotificationsResponse } | { ok: false; reason: 'network' | 'unauthorized' | 'server' | 'invalid' }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj)
  return objKeys.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k))
}

function isNotificationItem(value: unknown): value is NotificationItem {
  if (!isPlainObject(value) || !hasExactKeys(value, NOTIFICATION_ITEM_KEYS)) return false
  if (typeof value.id !== 'string') return false
  if (value.kind !== 'mention' && value.kind !== 'reply') return false
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

export function readNotificationsResponse(json: unknown): NotificationsResponse | null {
  if (!isPlainObject(json)) return null
  if (!Array.isArray(json.items)) return null
  if (typeof json.unread !== 'number' || !Number.isInteger(json.unread) || json.unread < 0) return null
  for (const item of json.items) {
    if (!isNotificationItem(item)) return null
  }
  return { items: json.items as NotificationItem[], unread: json.unread }
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

export async function fetchNotifications(): Promise<NotificationsFetchResult> {
  let res: Response
  try {
    res = await fetch('/api/notifications', { credentials: 'same-origin' })
  } catch {
    return { ok: false, reason: 'network' }
  }
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
  return { ok: true, data }
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

function formatNotificationTitle(docTitle: string): string {
  const trimmed = docTitle.trim()
  if (trimmed === '') return '제목 없는 문서'
  const chars = [...trimmed]
  if (chars.length > NOTIFICATION_TITLE_MAX) return chars.slice(0, NOTIFICATION_TITLE_MAX - 1).join('') + '…'
  return trimmed
}

// F-500 5.1 두 문구
export function notificationText(item: NotificationItem): string {
  const title = formatNotificationTitle(item.docTitle)
  if (item.kind === 'mention') return `${item.actorEmail}님이 "${title}" 댓글에서 멘션했습니다.`
  return `${item.actorEmail}님이 "${title}"의 댓글에 답글을 달았습니다.`
}

export function notificationExcerptLine(excerpt: string): string {
  return excerpt.replace(/\r\n|\r|\n/g, ' ').trim()
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

export function applyPendingReads(data: NotificationsResponse, pending: readonly PendingRead[]): NotificationsResponse {
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
