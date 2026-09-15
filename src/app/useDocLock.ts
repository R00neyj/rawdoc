// 편집 잠금 — 서버 문서를 owner·edit 권한으로 온라인에서 열면 잡고 유지한다 (specs/features/F-213.md 2.3)
import { useEffect, useRef, useState } from 'react'
import { ApiError, lockDoc, lockSessionId, unlockDoc } from '../storage/docsApi'

export const EXTEND_INTERVAL_MS = 20_000
export const RETRY_INTERVAL_MS = 15_000

export type DocLockRole = 'owner' | 'edit' | 'view' | undefined

export type DocLockApi = {
  lockDoc: (id: string, sessionId: string) => Promise<{ expiresAt: number }>
  unlockDoc: (id: string, sessionId: string, opts?: { keepalive?: boolean }) => Promise<void>
}

export type DocLockCallbacks = {
  onReadOnlyChange: (readOnly: boolean) => void
  onNotice: (notice: { type: 'info'; message: string }) => void
  onReacquired: () => void
}

function lockedMessage(email: string | undefined, myEmail: string | null): string {
  if (email && myEmail && email === myEmail) return '다른 창에서 편집 중입니다. 읽기만 할 수 있습니다.'
  return `${email ?? ''} 님이 편집 중입니다. 읽기만 할 수 있습니다.`
}

// 잡기·연장·놓친 뒤 재시도의 상태 기계 — 훅과 분리해 가짜 타이머로 직접 검증한다 (usePresence.ts 와 같은 방식)
export function createDocLockController(
  docId: string,
  sessionId: string,
  myEmail: string | null,
  api: DocLockApi,
  callbacks: DocLockCallbacks,
): { start: () => void; pageHide: () => void; dispose: () => void } {
  let disposed = false
  let holding = false
  let extendTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null

  function stopExtend() {
    if (extendTimer) {
      clearInterval(extendTimer)
      extendTimer = null
    }
  }

  function stopRetry() {
    if (retryTimer) {
      clearInterval(retryTimer)
      retryTimer = null
    }
  }

  function startExtend() {
    stopExtend()
    extendTimer = setInterval(async () => {
      try {
        await api.lockDoc(docId, sessionId)
      } catch (err) {
        if (err instanceof ApiError && err.kind === 'locked') loseLock(err.email)
        // 네트워크 등 다른 오류는 다음 연장 때 다시 시도한다
      }
    }, EXTEND_INTERVAL_MS)
  }

  function startRetry() {
    stopRetry()
    retryTimer = setInterval(async () => {
      try {
        await api.lockDoc(docId, sessionId)
        if (disposed) return
        stopRetry()
        holding = true
        callbacks.onReadOnlyChange(false)
        callbacks.onNotice({ type: 'info', message: '이제 편집할 수 있습니다.' })
        callbacks.onReacquired()
        startExtend()
      } catch {
        // 다음 재시도 때 다시 (2.3)
      }
    }, RETRY_INTERVAL_MS)
  }

  function loseLock(email: string | undefined) {
    holding = false
    stopExtend()
    if (disposed) return
    callbacks.onReadOnlyChange(true)
    callbacks.onNotice({ type: 'info', message: lockedMessage(email, myEmail) })
    startRetry()
  }

  async function start() {
    try {
      await api.lockDoc(docId, sessionId)
      if (disposed) return
      holding = true
      callbacks.onReadOnlyChange(false)
      startExtend()
    } catch (err) {
      if (disposed) return
      if (err instanceof ApiError && err.kind === 'locked') {
        callbacks.onReadOnlyChange(true)
        callbacks.onNotice({ type: 'info', message: lockedMessage(err.email, myEmail) })
        startRetry()
      }
      // 네트워크 등 다른 오류는 조용히 둔다 — online 이 바뀌면 훅이 새 컨트롤러를 만든다
    }
  }

  function pageHide() {
    if (holding) api.unlockDoc(docId, sessionId, { keepalive: true })
  }

  function dispose() {
    disposed = true
    stopExtend()
    stopRetry()
    if (holding) api.unlockDoc(docId, sessionId)
  }

  return { start, pageHide, dispose }
}

export type UseDocLockOptions = {
  isServerStore: boolean
  docId: string | null
  role: DocLockRole
  online: boolean
  myEmail: string | null
  onNotice: (notice: { type: 'info'; message: string }) => void
  // 읽기 전용으로 있다가 다시 잡았을 때 — 서버 최신 값을 받아 에디터를 다시 마운트한다 (2.3)
  onReacquired: (docId: string) => void
}

export function useDocLock({
  isServerStore,
  docId,
  role,
  online,
  myEmail,
  onNotice,
  onReacquired,
}: UseDocLockOptions): { readOnly: boolean } {
  // 내 소유 문서는 role 이 비어 있을 수 있다(막 만든 직후 등) — 'view' 만 아니면 owner·edit 로 본다
  const applicable = isServerStore && Boolean(docId) && role !== 'view' && online
  const [readOnly, setReadOnly] = useState(false)

  // 이 문서·조건에서 못 쓰게 되면(문서 전환·오프라인 등) 렌더 중 바로 되돌린다 (usePresence.ts 와 같은 방식)
  const trackKey = `${docId ?? ''}:${applicable}`
  const [trackedKey, setTrackedKey] = useState(trackKey)
  if (trackKey !== trackedKey) {
    setTrackedKey(trackKey)
    if (!applicable) setReadOnly(false)
  }

  const onNoticeRef = useRef(onNotice)
  const onReacquiredRef = useRef(onReacquired)
  // ref 는 렌더 중에 건드리지 않는다. 매 커밋 후 최신 값을 반영한다
  useEffect(() => {
    onNoticeRef.current = onNotice
    onReacquiredRef.current = onReacquired
  })

  useEffect(() => {
    if (!applicable || !docId) return undefined

    const controller = createDocLockController(
      docId,
      lockSessionId,
      myEmail,
      { lockDoc, unlockDoc },
      {
        onReadOnlyChange: setReadOnly,
        onNotice: (notice) => onNoticeRef.current(notice),
        onReacquired: () => onReacquiredRef.current(docId),
      },
    )
    controller.start()

    function handlePageHide() {
      controller.pageHide()
    }
    if (typeof window !== 'undefined') window.addEventListener('pagehide', handlePageHide)

    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', handlePageHide)
      controller.dispose()
    }
  }, [applicable, docId, myEmail])

  return { readOnly }
}
