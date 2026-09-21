// 탭 간 동기화 React 배선 — BroadcastChannel 수명, docs-changed 디바운스, 편집권 상태 기계 (specs/features/F-296.md 6.3·6.4)
import { useEffect, useRef, useState } from 'react'
import { TAB_CHANNEL_NAME, RESYNC_DEBOUNCE_MS, CLAIM_WAIT_MS, CLAIM_RETRY_MS, reduceClaim, type ClaimState, type TabMessage } from './tabSync'

export type UseTabSyncOptions = {
  enabled: boolean // bootPhase === 'ready'
  tabId: string
  claimDocId: string | null // 편집권이 필요한 문서 id. store.kind !== 'idb' 이거나 문서가 없으면 null
  onDocsChanged: () => void // 디바운스된 뒤 1회 — App 의 resyncFromStore
  onNotice: (notice: { type: 'info'; message: string }) => void
  onClaimRegained: () => void // 편집권을 되찾았을 때 — 저장소에서 다시 읽어 에디터를 다시 마운트
}

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined'

export function useTabSync({
  enabled,
  tabId,
  claimDocId,
  onDocsChanged,
  onNotice,
  onClaimRegained,
}: UseTabSyncOptions): { post: (m: TabMessage) => void; claimReadOnly: boolean } {
  const [claimReadOnly, setClaimReadOnly] = useState(false)

  // 낙관적으로 시작한다(문서를 열면 곧바로 편집 가능, 6.4) — 렌더 중 상태 조정 패턴, useDocSaver.ts trackedDocId 와 같다
  const [trackedClaimDocId, setTrackedClaimDocId] = useState(claimDocId)
  if (claimDocId !== trackedClaimDocId) {
    setTrackedClaimDocId(claimDocId)
    setClaimReadOnly(false)
  }

  const channelRef = useRef<BroadcastChannel | null>(null)
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const claimStateRef = useRef<ClaimState | null>(null)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const onDocsChangedRef = useRef(onDocsChanged)
  const onNoticeRef = useRef(onNotice)
  const onClaimRegainedRef = useRef(onClaimRegained)
  useEffect(() => {
    onDocsChangedRef.current = onDocsChanged
    onNoticeRef.current = onNotice
    onClaimRegainedRef.current = onClaimRegained
  })

  // 채널이 없으면(폴백 없음, 5.4) 아무 것도 하지 않는다 — channelRef 를 매번 최신으로 읽는다
  function post(message: TabMessage) {
    channelRef.current?.postMessage(message)
  }

  function clearWaitTimer() {
    if (waitTimerRef.current) {
      clearTimeout(waitTimerRef.current)
      waitTimerRef.current = null
    }
  }

  function clearRetryTimer() {
    if (retryTimerRef.current) {
      clearInterval(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  // claim-query 를 보내고 CLAIM_WAIT_MS 안에 아무도 응답하지 않으면 편집권을 가진다 (6.4)
  function requestClaim(docId: string, onIdle: () => void) {
    post({ kind: 'claim-query', tabId, docId })
    clearWaitTimer()
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null
      const state = claimStateRef.current
      if (!state || state.docId !== docId || state.held) return
      onIdle()
    }, CLAIM_WAIT_MS)
  }

  function takeClaim(docId: string, { announce }: { announce: boolean }) {
    clearWaitTimer()
    clearRetryTimer()
    claimStateRef.current = { tabId, docId, since: Date.now(), held: true }
    setClaimReadOnly(false)
    if (announce) {
      onNoticeRef.current({ type: 'info', message: '이제 편집할 수 있습니다.' })
      onClaimRegainedRef.current()
    }
  }

  function yieldClaim(docId: string) {
    const state = claimStateRef.current
    if (!state || state.docId !== docId) return
    claimStateRef.current = { ...state, held: false }
    setClaimReadOnly(true)
    onNoticeRef.current({ type: 'info', message: '다른 탭에서 편집 중입니다. 읽기만 할 수 있습니다.' })
    clearRetryTimer()
    retryTimerRef.current = setInterval(() => {
      requestClaim(docId, () => takeClaim(docId, { announce: true }))
    }, CLAIM_RETRY_MS)
  }

  // ----- 채널 수명 — enabled 인 동안 탭당 하나 (6.3) -----
  useEffect(() => {
    if (!enabled || !hasBroadcastChannel) return undefined
    const channel = new BroadcastChannel(TAB_CHANNEL_NAME)
    channelRef.current = channel

    function handleMessage(e: MessageEvent<TabMessage>) {
      const msg = e.data
      if (msg.kind === 'docs-changed') {
        if (msg.tabId === tabId) return
        if (resyncTimerRef.current) clearTimeout(resyncTimerRef.current)
        resyncTimerRef.current = setTimeout(() => onDocsChangedRef.current(), RESYNC_DEBOUNCE_MS)
        return
      }
      const state = claimStateRef.current
      if (!state) return
      const effect = reduceClaim(state, msg)
      if (!effect) return
      if (effect.type === 'reply') post(effect.message)
      else if (effect.type === 'yielded') yieldClaim(state.docId)
      else if (effect.type === 'retake') requestClaim(state.docId, () => takeClaim(state.docId, { announce: true }))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tabId])

  // 편집권 — claimDocId 가 바뀔 때마다 잡고 물어본다 (6.4). claimReadOnly=false 는 위 렌더 중 조정이 이미 맡았다
  useEffect(() => {
    if (!enabled || !claimDocId || !hasBroadcastChannel) return undefined
    const docId = claimDocId
    clearWaitTimer()
    clearRetryTimer()
    claimStateRef.current = { tabId, docId, since: Date.now(), held: true }
    post({ kind: 'claim-query', tabId, docId })

    // 문서를 떠나거나(claimDocId 변경) 언마운트되면 놓는다 — 비활성 상태로 바뀔 때도 여기를 거친다 (6.3)
    return () => {
      post({ kind: 'claim-release', tabId, docId })
      clearWaitTimer()
      clearRetryTimer()
      claimStateRef.current = null
      setClaimReadOnly(false)
    }
  }, [enabled, claimDocId, tabId])

  // ----- pagehide — 언마운트를 기다리지 않고 즉시 놓는다 (6.3) -----
  useEffect(() => {
    function handlePageHide() {
      const state = claimStateRef.current
      if (state) post({ kind: 'claim-release', tabId, docId: state.docId })
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [tabId])

  return { post, claimReadOnly }
}
