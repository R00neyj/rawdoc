// 알림함 훅 — 가져오기 주기·읽음 표시 상태 (specs/features/F-507.md 3.3)
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

export type NotificationsState = {
  status: 'idle' | 'loading' | 'ready' | 'failed' // idle = 꺼짐, loading = 첫 응답 전, failed = 한 번도 못 받음
  items: readonly NotificationItem[] // 대기 읽음을 얹은 값
  unread: number | null // null = 아직 모름 → 배지 없음
}

export type UseNotificationsResult = NotificationsState & {
  refresh: (reason: 'open') => void
  markRead: (id: string) => void
  markAllRead: () => void
}

export function useNotifications(input: { enabled: boolean; blocked: boolean }): UseNotificationsResult {
  const { enabled, blocked } = input

  const [status, setStatus] = useState<NotificationsState['status']>('idle')
  const [items, setItems] = useState<readonly NotificationItem[]>([])
  const [unread, setUnread] = useState<number | null>(null)

  const lastServerRef = useRef<NotificationsResponse | null>(null)
  const pendingRef = useRef<PendingRead[]>([])
  const lastStartedAtRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const stoppedRef = useRef(false)
  const everReceivedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptFetchRef = useRef<(reason: PollReason) => void>(() => {})

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const armInterval = useCallback(() => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      attemptFetchRef.current('interval')
    }, NOTIFICATIONS_POLL_MS)
  }, [clearTimer])

  const recomputeFromServer = useCallback(() => {
    const server = lastServerRef.current
    if (!server) return
    const applied = applyPendingReads(server, pendingRef.current)
    setItems(applied.items)
    setUnread(applied.unread)
  }, [])

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
      void fetchNotifications().then((result) => {
        inFlightRef.current = false
        if (result.ok) {
          everReceivedRef.current = true
          lastServerRef.current = result.data
          pendingRef.current = dropSettledReads(pendingRef.current, startedAt)
          recomputeFromServer()
          setStatus('ready')
        } else {
          if (result.reason === 'unauthorized') stoppedRef.current = true
          if (!everReceivedRef.current) setStatus('failed')
        }
      })
    },
    [armInterval, recomputeFromServer],
  )

  useEffect(() => {
    attemptFetchRef.current = attemptFetch
  }, [attemptFetch])

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

  useEffect(() => {
    if (!enabled) {
      clearTimer()
      stoppedRef.current = false
      inFlightRef.current = false
      lastStartedAtRef.current = null
      lastServerRef.current = null
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

  return { status, items, unread, refresh, markRead, markAllRead }
}
