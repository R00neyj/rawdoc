// 탭 간 동기화 React 배선 — BroadcastChannel 수명, docs-changed 디바운스, 편집권 메시지를 문서별 구독자에게 나눔 (specs/features/F-296.md 6.3, F-2160 3장)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TAB_CHANNEL_NAME, RESYNC_DEBOUNCE_MS, type TabMessage } from './tabSync'

// 문서마다 편집권(useDocClaim)이 채널을 나눠 쓰는 자리 — enabled 는 부팅이 끝났고 채널이 있을 때
export type ClaimHub = { enabled: boolean; tabId: string; post: (m: TabMessage) => void; subscribe: (on: (m: TabMessage) => void) => () => void }

export type UseTabSyncOptions = {
  enabled: boolean // bootPhase === 'ready'
  tabId: string
  onDocsChanged: () => void // 디바운스된 뒤 1회 — App 의 resyncFromStore
  // 다른 탭이 금고를 잠갔다는 신호를 받았을 때(자기 tabId 는 걸러진 뒤) — 선택 (F-404.md 4.4)
  onE2eeLock?: () => void
  // 다른 탭이 공유에서 나갔을 때 (F-2115 2.5)
  onSharedLeft?: (docIds: string[]) => void
}

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'

export function useTabSync({
  enabled,
  tabId,
  onDocsChanged,
  onE2eeLock,
  onSharedLeft,
}: UseTabSyncOptions): { post: (m: TabMessage) => void; claimHub: ClaimHub } {
  const channelRef = useRef<BroadcastChannel | null>(null)
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [subscribers] = useState(() => new Set<(m: TabMessage) => void>())

  const onDocsChangedRef = useRef(onDocsChanged)
  const onE2eeLockRef = useRef(onE2eeLock)
  const onSharedLeftRef = useRef(onSharedLeft)
  useEffect(() => {
    onSharedLeftRef.current = onSharedLeft
    onDocsChangedRef.current = onDocsChanged
    onE2eeLockRef.current = onE2eeLock
  })

  // 채널이 없으면(폴백 없음, 5.4) 아무 것도 하지 않는다 — channelRef 를 매번 최신으로 읽는다
  const post = useCallback((message: TabMessage) => {
    channelRef.current?.postMessage(message)
  }, [])

  const subscribe = useCallback(
    (on: (m: TabMessage) => void) => {
      subscribers.add(on)
      return () => {
        subscribers.delete(on)
      }
    },
    [subscribers],
  )

  // ----- 채널 수명 — enabled 인 동안 탭당 하나 (6.3) -----
  useEffect(() => {
    if (!enabled || !hasBroadcastChannel) return undefined
    const channel = new BroadcastChannel(TAB_CHANNEL_NAME)
    channelRef.current = channel

    function handleMessage(e: MessageEvent<TabMessage>) {
      const msg = e.data
      if (msg.kind === 'docs-changed') {
        if (msg.tabId === tabId) return
        clearTimeout(resyncTimerRef.current ?? undefined)
        resyncTimerRef.current = setTimeout(() => onDocsChangedRef.current(), RESYNC_DEBOUNCE_MS)
        return
      }
      if (msg.kind === 'e2ee-lock') {
        if (msg.tabId === tabId) return
        onE2eeLockRef.current?.()
        return
      }
      if (msg.kind === 'shared-left') {
        if (msg.tabId === tabId) return
        onSharedLeftRef.current?.(msg.docIds)
        return
      }
      for (const on of [...subscribers]) on(msg)
    }

    channel.addEventListener('message', handleMessage)
    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
      channelRef.current = null
      if (resyncTimerRef.current) {
        clearTimeout(resyncTimerRef.current)
        resyncTimerRef.current = null
      }
    }
  }, [enabled, tabId, subscribers])

  const claimHub = useMemo(
    () => ({ enabled: enabled && hasBroadcastChannel, tabId, post, subscribe }),
    [enabled, tabId, post, subscribe],
  )

  return { post, claimHub }
}
