// 탭 사이 알림 결과 메시지 — 채널 이름·모양 검사·더 새 결과 판정 (specs/features/F-2057.md 4.2·4.3). 순수
import type { NotificationsResponse } from '../lib/docComments'
import { readNotificationsResponse } from './notificationsApi'

export const NOTIFICATIONS_CHANNEL_NAME = 'md-notifications'
export const NOTIFICATIONS_FOLLOWER_DELAY_MS = 10_000

export type NotificationsShareMessage = {
  kind: 'notifications-result'
  v: 1
  tabId: string
  accountId: string
  startedAt: number // 그 결과를 가져온 요청을 시작한 시각(ms)
  etag: string | null
  data: NotificationsResponse // 서버 값 그대로 — 보낸 탭의 읽음 대기를 얹지 않는다
}

const MESSAGE_KEYS = ['kind', 'v', 'tabId', 'accountId', 'startedAt', 'etag', 'data']

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function readNotificationsShare(raw: unknown): NotificationsShareMessage | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const m = raw as Record<string, unknown>
  const keys = Object.keys(m)
  if (keys.length !== MESSAGE_KEYS.length || !MESSAGE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(m, k))) return null
  if (m.kind !== 'notifications-result' || m.v !== 1) return null
  if (!nonEmpty(m.tabId) || !nonEmpty(m.accountId)) return null
  if (typeof m.startedAt !== 'number' || !Number.isFinite(m.startedAt)) return null
  if (m.etag !== null && typeof m.etag !== 'string') return null
  const data = readNotificationsResponse(m.data)
  if (!data) return null
  return { kind: 'notifications-result', v: 1, tabId: m.tabId, accountId: m.accountId, startedAt: m.startedAt, etag: m.etag, data }
}

// 같은 밀리초면 탭 id 사전순 — 한쪽만 "더 새것" 이 된다
export function isNewerStart(a: { startedAt: number; tabId: string }, b: { startedAt: number; tabId: string }): boolean {
  return a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.tabId > b.tabId)
}
