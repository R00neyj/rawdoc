// 문서 하나의 로컬 편집권 상태 기계 — 대기·재시도 타이머, claim-query/release, pagehide 놓기, 알림 (F-296 6.4, F-2160 3장)
import { useEffect, useRef, useState } from 'react'
import { CLAIM_WAIT_MS, CLAIM_RETRY_MS, reduceClaim, type ClaimState } from './tabSync'
import type { ClaimHub } from './useTabSync'

export type UseDocClaimOptions = {
  onNotice: (notice: { type: 'info'; message: string }) => void
  onRegained: (docId: string) => void // 편집권을 되찾았을 때 — 저장소에서 다시 읽어 편집기를 다시 마운트
}

// claimId — 편집권이 필요한 문서 id, 아니면 null. 읽기 전용(남이 쥠)이면 true
export function useDocClaim(hub: ClaimHub, claimId: string | null, options: UseDocClaimOptions): boolean {
  const { enabled, tabId, post, subscribe } = hub
  const [claimReadOnly, setClaimReadOnly] = useState(false)

  // 낙관적으로 시작한다(문서를 열면 곧바로 편집 가능, 6.4) — 렌더 중 상태 조정 패턴, useDocSaver.ts trackedDocId 와 같다
  const [trackedClaimId, setTrackedClaimId] = useState(claimId)
  if (claimId !== trackedClaimId) {
    setTrackedClaimId(claimId)
    setClaimReadOnly(false)
  }

  const claimStateRef = useRef<ClaimState | null>(null)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onNoticeRef = useRef(options.onNotice)
  const onRegainedRef = useRef(options.onRegained)
  useEffect(() => {
    onNoticeRef.current = options.onNotice
    onRegainedRef.current = options.onRegained
  })

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

  // claim-query 를 보내고 CLAIM_WAIT_MS 안에 무응답이면 편집권을 가진다(6.4) — 기다리는 동안 남의 claim-hold 나 이기는 대기 탭의 query 를 받으면 cancelWait 로 멈춘다(리뷰 Y2)
  function requestClaim(docId: string, onIdle: () => void) {
    const current = claimStateRef.current
    if (!current || current.docId !== docId) return
    claimStateRef.current = { ...current, waiting: true }
    post({ kind: 'claim-query', tabId, docId, since: current.since })
    clearWaitTimer()
    waitTimerRef.current = setTimeout(() => {
      waitTimerRef.current = null
      const state = claimStateRef.current
      if (!state || state.docId !== docId || state.held || !state.waiting) return
      onIdle()
    }, CLAIM_WAIT_MS)
  }

  function cancelWait() {
    clearWaitTimer()
    const state = claimStateRef.current
    if (state?.waiting) claimStateRef.current = { ...state, waiting: false }
  }

  function takeClaim(docId: string, { announce }: { announce: boolean }) {
    clearWaitTimer()
    clearRetryTimer()
    claimStateRef.current = { tabId, docId, since: Date.now(), held: true }
    setClaimReadOnly(false)
    if (announce) {
      onNoticeRef.current({ type: 'info', message: '이제 편집할 수 있습니다.' })
      onRegainedRef.current(docId)
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

  // claimId 가 바뀔 때마다 잡고 물어본다 (6.4). 채널 메시지는 쥐고 있는 동안만 받는다
  useEffect(() => {
    if (!enabled || !claimId) return undefined
    const docId = claimId
    clearWaitTimer()
    clearRetryTimer()
    const since = Date.now()
    claimStateRef.current = { tabId, docId, since, held: true }
    const unsubscribe = subscribe((msg) => {
      const state = claimStateRef.current
      if (!state) return
      const effect = reduceClaim(state, msg)
      if (!effect) return
      if (effect.type === 'reply') post(effect.message)
      else if (effect.type === 'yielded') yieldClaim(state.docId)
      else if (effect.type === 'retake') requestClaim(state.docId, () => takeClaim(state.docId, { announce: true }))
      else if (effect.type === 'cancel-wait') cancelWait()
    })
    post({ kind: 'claim-query', tabId, docId, since })

    // 문서를 떠나거나(claimId 변경) 언마운트되면 놓는다 (6.3)
    return () => {
      unsubscribe()
      post({ kind: 'claim-release', tabId, docId })
      clearWaitTimer()
      clearRetryTimer()
      claimStateRef.current = null
      setClaimReadOnly(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 타이머·상태는 ref 로만 읽는다
  }, [enabled, claimId, tabId, post, subscribe])

  // pagehide — 언마운트를 기다리지 않고 즉시 놓는다 (6.3)
  useEffect(() => {
    function handlePageHide() {
      const state = claimStateRef.current
      if (state) post({ kind: 'claim-release', tabId, docId: state.docId })
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [tabId, post])

  return claimReadOnly
}
