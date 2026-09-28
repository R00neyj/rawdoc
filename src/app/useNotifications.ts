// 알림함 훅 — 가져오기 주기·읽음 표시 상태 (specs/features/F-507.md 3.3), 조건부 요청·탭 사이 결과 나누기 (F-2057 4장)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationItem, NotificationsResponse } from '../lib/docComments'
import {
  applyPendingReads,
  dropSettledReads,
  fetchNotifications,
  markNotificationsRead,
  NOTIFICATIONS_POLL_MS,
  shouldFetchNotifications,
  type PendingRead,
  type PollReason,
} from './notificationsApi'
import {
  isNewerStart,
  NOTIFICATIONS_CHANNEL_NAME,
  NOTIFICATIONS_FOLLOWER_DELAY_MS,
  readNotificationsShare,
  type NotificationsShareMessage,
} from './notificationsShare'
import { unreadNotificationIdsForDoc } from './docNotifications'
import { newTabId } from '../lib/tabChannel'

export type NotificationsState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' // idle = 꺼짐, loading = 첫 응답 전, failed = 한 번도 못 받음
  items: readonly NotificationItem[] // 대기 읽음을 얹은 값
  unread: number | null // null = 아직 모름 → 배지 없음
}

export type UseNotificationsResult = NotificationsState & {
  refresh: (reason: 'open') => void
  markRead: (id: string) => void
  markAllRead: () => void
  markDocRead: (docId: string) => void
}

type AppliedStart = { startedAt: number; tabId: string }

export function useNotifications(input: { enabled: boolean; blocked: boolean; accountId: string | null }): UseNotificationsResult {
  const { enabled, blocked, accountId } = input

  const [status, setStatus] = useState<NotificationsState['status']>('idle')
  const [items, setItems] = useState<readonly NotificationItem[]>([])
  const [unread, setUnread] = useState<number | null>(null)
  const [tabId] = useState(newTabId)

  const lastServerRef = useRef<NotificationsResponse | null>(null)
  const etagRef = useRef<string | null>(null) // lastServerRef 와 함께 온 ETag 만 쥔다
  const appliedRef = useRef<AppliedStart | null>(null)
  const pendingRef = useRef<PendingRead[]>([])
  const lastStartedAtRef = useRef<number | null>(null) // 어느 탭이든 마지막 시작
  const inFlightRef = useRef(false)
  const stoppedRef = useRef(false)
  const everReceivedRef = useRef(false)
  const generationRef = useRef(0) // 끄기·계정 바뀜마다 +1 — 그 전에 떠난 응답은 버린다
  const accountIdRef = useRef(accountId)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptFetchRef = useRef<(reason: PollReason) => void>(() => {})
  const receiveRef = useRef<(raw: unknown) => void>(() => {})

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const armInterval = useCallback(
    (delay: number = NOTIFICATIONS_POLL_MS) => {
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        attemptFetchRef.current('interval')
      }, delay)
    },
    [clearTimer],
  )

  const recomputeFromServer = useCallback(() => {
    const server = lastServerRef.current
    if (!server) return
    const applied = applyPendingReads(server, pendingRef.current)
    setItems(applied.items)
    setUnread(applied.unread)
  }, [])

  // 200·304·받은 메시지가 같은 길 (4.4). 지금까지 적용한 것보다 새 결과일 때만 참
  const applyResult = useCallback(
    (from: AppliedStart, fresh: { data: NotificationsResponse; etag: string | null } | null): boolean => {
      if (appliedRef.current && !isNewerStart(from, appliedRef.current)) return false
      appliedRef.current = from
      if (fresh) {
        lastServerRef.current = fresh.data
        etagRef.current = fresh.etag
      }
      everReceivedRef.current = true
      pendingRef.current = dropSettledReads(pendingRef.current, from.startedAt)
      recomputeFromServer()
      setStatus('ready')
      return true
    },
    [recomputeFromServer],
  )

  const share = useCallback((startedAt: number) => {
    const channel = channelRef.current
    const data = lastServerRef.current
    const account = accountIdRef.current
    if (!channel || !data || account === null) return
    const message: NotificationsShareMessage = {
      kind: 'notifications-result',
      v: 1,
      tabId,
      accountId: account,
      startedAt,
      etag: etagRef.current,
      data,
    }
    try {
      channel.postMessage(message)
    } catch {
      // 닫힌 채널 — 이 탭만 자기 결과를 쓴다 (11장)
    }
  }, [tabId])

  const attemptFetch = useCallback(
    (reason: PollReason) => {
      const now = Date.now()
      const should = shouldFetchNotifications({
        reason,
        now,
        lastStartedAt: lastStartedAtRef.current,
        inFlight: inFlightRef.current,
        visible: document.visibilityState === 'visible',
        online: navigator.onLine,
        stopped: stoppedRef.current,
      })
      if (!should) return
      inFlightRef.current = true
      lastStartedAtRef.current = now
      armInterval()
      setStatus((s) => (s === 'idle' ? 'loading' : s))
      const startedAt = now
      const generation = generationRef.current
      void fetchNotifications(etagRef.current).then((result) => {
        if (generation !== generationRef.current) return
        inFlightRef.current = false
        if (result.ok) {
          const fresh = 'data' in result ? { data: result.data, etag: result.etag } : null
          if (!applyResult({ startedAt, tabId }, fresh)) return
          // 가져온 탭은 60초 — 뒤따르는 탭(70초)보다 먼저 울려 가져오는 탭이 하나로 모인다 (4.3)
          armInterval(Math.max(0, startedAt + NOTIFICATIONS_POLL_MS - Date.now()))
          share(startedAt)
        } else {
          if (result.reason === 'unauthorized') stoppedRef.current = true
          if (!everReceivedRef.current) setStatus('failed')
        }
      })
    },
    [armInterval, applyResult, share, tabId],
  )

  const receive = useCallback(
    (raw: unknown) => {
      const message = readNotificationsShare(raw)
      if (!message || message.accountId !== accountIdRef.current) return
      if (!applyResult(message, { data: message.data, etag: message.etag })) return
      lastStartedAtRef.current = Math.max(lastStartedAtRef.current ?? message.startedAt, message.startedAt)
      armInterval(NOTIFICATIONS_POLL_MS + NOTIFICATIONS_FOLLOWER_DELAY_MS)
    },
    [applyResult, armInterval],
  )

  useEffect(() => {
    attemptFetchRef.current = attemptFetch
    receiveRef.current = receive
  }, [attemptFetch, receive])

  // 렌더 중 조정 — enabled 가 꺼지면 화면 상태를 초기화한다(ref 정리는 아래 effect)
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled)
    if (!enabled) {
      setStatus('idle')
      setItems([])
      setUnread(null)
    }
  }

  // 계정이 바뀌면 남의 ETag·서버 값·시작 시각을 버린다 (4.5)
  useEffect(() => {
    if (accountIdRef.current === accountId) return
    accountIdRef.current = accountId
    generationRef.current += 1
    inFlightRef.current = false
    etagRef.current = null
    appliedRef.current = null
    lastServerRef.current = null
    lastStartedAtRef.current = null
  }, [accountId])

  useEffect(() => {
    if (!enabled || accountId === null || typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(NOTIFICATIONS_CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent) => receiveRef.current(event.data)
    channelRef.current = channel
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [enabled, accountId])

  useEffect(() => {
    if (!enabled) {
      clearTimer()
      generationRef.current += 1
      stoppedRef.current = false
      inFlightRef.current = false
      lastStartedAtRef.current = null
      lastServerRef.current = null
      etagRef.current = null
      appliedRef.current = null
      pendingRef.current = []
      everReceivedRef.current = false
      return
    }
    attemptFetch('enable')
    function onVisible() {
      if (document.visibilityState === 'visible') attemptFetch('visible')
    }
    function onOnline() {
      attemptFetch('online')
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      clearTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const refresh = useCallback((reason: 'open') => attemptFetch(reason), [attemptFetch])

  const markRead = useCallback(
    (id: string) => {
      if (blocked) return
      const current = items.find((it) => it.id === id)
      if (!current || current.readAt !== null) return
      const at = Date.now()
      const pending: PendingRead = { kind: 'ids', ids: [id], at, settledAt: null }
      pendingRef.current = [...pendingRef.current, pending]
      recomputeFromServer()
      void markNotificationsRead({ ids: [id] }).then((ok) => {
        if (ok) {
          pendingRef.current = pendingRef.current.map((p) => (p === pending ? { ...p, settledAt: Date.now() } : p))
        } else {
          pendingRef.current = pendingRef.current.filter((p) => p !== pending)
        }
        recomputeFromServer()
      })
    },
    [blocked, items, recomputeFromServer],
  )

  // 문서를 열면 그 문서의 안 읽은 알림을 읽음으로 (F-510 3.2) — 렌더 사이 상태가 아니라 ref 의 마지막 서버 값 + 지금 대기에서 계산한다
  const markDocRead = useCallback(
    (docId: string) => {
      if (blocked) return
      if (!navigator.onLine) return
      const server = lastServerRef.current
      if (!server) return
      const applied = applyPendingReads(server, pendingRef.current)
      const ids = unreadNotificationIdsForDoc(applied.items, docId)
      if (ids.length === 0) return
      const at = Date.now()
      const pending: PendingRead = { kind: 'ids', ids, at, settledAt: null }
      pendingRef.current = [...pendingRef.current, pending]
      recomputeFromServer()
      void markNotificationsRead({ ids }).then((ok) => {
        if (ok) {
          pendingRef.current = pendingRef.current.map((p) => (p === pending ? { ...p, settledAt: Date.now() } : p))
        } else {
          pendingRef.current = pendingRef.current.filter((p) => p !== pending)
        }
        recomputeFromServer()
      })
    },
    [blocked, recomputeFromServer],
  )

  const markAllRead = useCallback(() => {
    if (blocked) return
    if (unread === null || unread === 0) return
    const at = Date.now()
    const pending: PendingRead = { kind: 'all', at, settledAt: null }
    pendingRef.current = [...pendingRef.current, pending]
    recomputeFromServer()
    void markNotificationsRead({ all: true }).then((ok) => {
      if (ok) {
        pendingRef.current = pendingRef.current.map((p) => (p === pending ? { ...p, settledAt: Date.now() } : p))
      } else {
        pendingRef.current = pendingRef.current.filter((p) => p !== pending)
      }
      recomputeFromServer()
    })
  }, [blocked, unread, recomputeFromServer])

  return { status, items, unread, refresh, markRead, markAllRead, markDocRead }
}
