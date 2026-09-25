// 금고 React 배선 — 열쇠고리 하나, 활동·가시성·조합·pageshow 이벤트, 탭 채널, 대화상자 상태, requestOpen (specs/features/F-404.md 6장)
import { createElement, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Store } from '../types'
import type { ServerStore } from '../storage/serverStore'
import { createAccountBundleSource, createLocalBundleSource } from '../e2ee/bundleSource'
import {
  createKeyring,
  E2EE_DEFAULT_LOCK_MINUTES,
  E2EE_IDLE_CHECK_MS,
  parseLockMinutes,
  type E2eeActionError,
  type E2eeLockMinutes,
  type E2eeScope,
  type E2eeStatus,
  type Keyring,
} from '../e2ee/keyring'
import { getPref } from './prefs'
import { resetMapIndexCache } from './mapIndex'
import { resetSearchIndexCache } from './searchIndex'
import { revokeE2eeAttachmentUrls } from '../lib/attachmentUrls'
import type { TabMessage } from './tabSync'
import E2eeDialogs, { type E2eeDialogMode } from './E2eeDialogs'

export type UseE2eeOptions = {
  store: Store
  bootPhase: 'booting' | 'ready'
  tabId: string
  postTabMessage: (m: TabMessage) => void
  accountEmail: string | null
  showNotice: (input: { type: 'info' | 'error' | 'warn'; message: string }) => void
}

export type UseE2ee = {
  keyring: Keyring
  status: E2eeStatus
  requestOpen(): Promise<boolean>
  dialogs: ReactNode
  // useTabSync 의 onE2eeLock 이 부른다 (App.tsx 가 잇는다, F-404.md 4.4)
  handleOtherTabLock(): void
  // App 의 applyAccountFlags 가 부른다 (F-404.md 4.5)
  lockForAccountChange(): Promise<void>
  // 이 탭 로그아웃 직후 다른 탭에 잠그기 신호만 보낸다. 이 탭은 곧 떠난다 (F-404.md 4.5)
  broadcastLogoutLock(): void
  // recover 는 P1 의 암호를 잊었나요? — D-11 을 복구 1 모드로 연다 (F-405 6.2)
  openSettingsDialogs: { create(): void; unlock(): void; recover(): void; changePassword(): void; reset(): void; lockNow(): void }
  // 계정(또는 로컬) 금고 상태를 새로 읽어 돌려준다 — keyring.load() 뒤 getStatus() (F-408 D-14)
  refreshStatus(): Promise<E2eeStatus>
  // 받은 암호로 이 탭의 금고를 연다. 성공이면 null. 대화상자를 띄우지 않고 알림도 없다 (F-408 2.1)
  openWithPassword(password: string): Promise<E2eeActionError | null>
}

const LOCK_MINUTES_LABEL: Record<E2eeLockMinutes, string> = {
  5: '5분',
  15: '15분',
  30: '30분',
  60: '1시간',
  240: '4시간',
}

function resolveScope(store: Store): E2eeScope | null {
  if (store.kind === 'server') return { kind: 'account', userId: (store as ServerStore).userId }
  if (store.kind === 'idb') return { kind: 'local' }
  return null
}

export function useE2ee(options: UseE2eeOptions): UseE2ee | null {
  const { store, bootPhase, tabId, postTabMessage, accountEmail, showNotice } = options

  // 범위는 부팅이 끝난 뒤 한 번만 정한다(F-404.md 3.1) — effect 대신 렌더 중 조건부 setState 로("이전 렌더 값 저장" 패턴), 두 린트 규칙 다 피한다
  const [scope, setScope] = useState<E2eeScope | null>(null)
  const [scopeResolvedForPhase, setScopeResolvedForPhase] = useState<'booting' | 'ready' | null>(null)
  if (bootPhase === 'ready' && scopeResolvedForPhase !== 'ready') {
    setScopeResolvedForPhase('ready')
    const next = resolveScope(store)
    if (next) setScope(next)
  }

  const postRef = useRef(postTabMessage)
  const tabIdRef = useRef(tabId)
  const showNoticeRef = useRef(showNotice)
  useEffect(() => {
    postRef.current = postTabMessage
    tabIdRef.current = tabId
    showNoticeRef.current = showNotice
  })

  const composingRef = useRef(false)
  const abortedNoticeShownRef = useRef(false)

  // 렌더 중에는 만들지 않는다 — ref 를 쥔 콜백을 외부 함수(createKeyring)에 넘기는 일은 effect 안에서만 안전하다(react-hooks/refs)
  const [keyring, setKeyring] = useState<Keyring | null>(null)
  useEffect(() => {
    if (!scope) return undefined
    const source = scope.kind === 'local' ? createLocalBundleSource() : createAccountBundleSource(scope.userId)
    const ring = createKeyring({
      scope,
      source,
      isComposing: () => composingRef.current && document.hasFocus() && document.visibilityState === 'visible',
      onBroadcastLock: () => postRef.current({ kind: 'e2ee-lock', tabId: tabIdRef.current }),
    })
    setKeyring(ring)
    return undefined
  }, [scope])

  const status = useSyncExternalStore(
    (onChange) => (keyring ? keyring.subscribe(onChange) : () => {}),
    () => keyring?.getStatus() ?? 'unknown',
  )

  // 잠글 때 검색·지도 메모리 색인 비우기 — 함수 두 번 부르기 (4.1 indexes, F-400 2.5 ④)
  useEffect(() => {
    if (!keyring) return undefined
    const un1 = keyring.registerLockStep('indexes', () => resetSearchIndexCache())
    const un2 = keyring.registerLockStep('indexes', () => resetMapIndexCache())
    return () => {
      un1()
      un2()
    }
  }, [keyring])

  // open 에서 다른 값으로 바뀐 뒤 한 번 더 비운다 — ④와 ⑥ 사이에 시작한 색인 만들기는 세대 표지로 못 막는 구멍이 있다(F-405 c7, F-409 3.3)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'open' && status !== 'open') {
      resetSearchIndexCache()
      resetMapIndexCache()
    }
  }, [status])

  // 잠글 때 금고 첨부 blob: 주소를 모두 거둔다 (F-406 3.4)
  useEffect(() => {
    if (!keyring) return undefined
    return keyring.registerLockStep('blobs', () => {
      revokeE2eeAttachmentUrls()
    })
  }, [keyring])

  // 조합 판정 (4.2) — compositionstart 로 표지를 켜고, compositionend·blur·visibilitychange 에서 미룬 잠그기를 다시 시도한다
  useEffect(() => {
    if (!keyring) return undefined
    function retry() {
      setTimeout(() => {
        void keyring!.retryDeferredLock()
      }, 0)
    }
    function onCompositionStart() {
      composingRef.current = true
    }
    function onCompositionEnd() {
      composingRef.current = false
      retry()
    }
    function onBlur() {
      retry()
    }
    function onVisibility() {
      retry()
    }
    window.addEventListener('compositionstart', onCompositionStart, true)
    window.addEventListener('compositionend', onCompositionEnd, true)
    window.addEventListener('blur', onBlur, true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('compositionstart', onCompositionStart, true)
      window.removeEventListener('compositionend', onCompositionEnd, true)
      window.removeEventListener('blur', onBlur, true)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [keyring])

  // pageshow(persisted) — bfcache 복귀 즉시 잠금 (4.3 4번, 11장 Q4). 상태와 무관하게 늘 달아 둔다(열려 있지 않으면 lock() 이 그냥 'not-open')
  useEffect(() => {
    if (!keyring) return undefined
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) void keyring!.lock('page-restore')
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [keyring])

  // 자동 잠금 — open 일 때만 활동·타이머를 단다 (4.3)
  useEffect(() => {
    if (!keyring || status !== 'open') return undefined
    function currentLockMinutes(): E2eeLockMinutes {
      return parseLockMinutes(getPref('md.e2eeLockMinutes', String(E2EE_DEFAULT_LOCK_MINUTES)))
    }
    function check() {
      const minutes = currentLockMinutes()
      const outcome = keyring!.checkIdle(minutes)
      if (!outcome) return
      void outcome.then((result) => {
        if (result === 'locked') {
          showNoticeRef.current({ type: 'info', message: `${LOCK_MINUTES_LABEL[minutes]} 동안 쓰지 않아 금고를 잠갔습니다.` })
        }
      })
    }
    function onActivity() {
      check()
      keyring!.noteActivity()
    }
    const interval = setInterval(check, E2EE_IDLE_CHECK_MS)
    window.addEventListener('keydown', onActivity, { capture: true, passive: true })
    window.addEventListener('pointerdown', onActivity, { capture: true, passive: true })
    window.addEventListener('wheel', onActivity, { capture: true, passive: true })
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('keydown', onActivity, true)
      window.removeEventListener('pointerdown', onActivity, true)
      window.removeEventListener('wheel', onActivity, true)
      document.removeEventListener('visibilitychange', check)
    }
  }, [keyring, status])

  // aborted 알림(E14)은 열린 한 번에 한 번만 — 다시 열리면 다시 띄울 수 있다 (4.1)
  useEffect(() => {
    if (status === 'open') abortedNoticeShownRef.current = false
  }, [status])

  const [dialogMode, setDialogMode] = useState<E2eeDialogMode>(null)
  const requestResolverRef = useRef<((ok: boolean) => void) | null>(null)

  function settleRequest(ok: boolean) {
    const resolver = requestResolverRef.current
    requestResolverRef.current = null
    resolver?.(ok)
  }

  function closeDialogs() {
    setDialogMode(null)
    settleRequest(false)
  }

  // 암호로 열기 성공 — 알림 없음 (7.2)
  function handleOpened() {
    setDialogMode(null)
    settleRequest(true)
  }

  // 만들기 성공 — 알림 E15 (7.9)
  function handleCreated() {
    setDialogMode(null)
    settleRequest(true)
    showNotice({ type: 'info', message: '금고를 만들었습니다. 이 탭에서 열려 있습니다.' })
  }

  // 복구 코드로 새 암호 정하기 성공 — 알림 E17 (7.9)
  function handleRecovered() {
    setDialogMode(null)
    settleRequest(true)
    showNotice({ type: 'info', message: '새 금고 암호를 정하고 금고를 열었습니다.' })
  }

  function handleChanged() {
    setDialogMode(null)
    showNotice({ type: 'info', message: '금고 암호를 바꿨습니다. 복구 코드는 그대로입니다.' })
  }

  function handleReset() {
    setDialogMode(null)
    showNotice({ type: 'info', message: '금고를 초기화했습니다.' })
  }

  async function requestOpen(): Promise<boolean> {
    if (!keyring) return false
    if (keyring.getStatus() === 'open') return true
    if (keyring.getStatus() === 'unknown' || keyring.getStatus() === 'unavailable') {
      await keyring.load()
    }
    const s = keyring.getStatus()
    if (s === 'open') return true
    if (s === 'none') {
      setDialogMode('create')
    } else if (s === 'locked') {
      setDialogMode('unlock')
    } else {
      return false
    }
    return new Promise<boolean>((resolve) => {
      requestResolverRef.current = resolve
    })
  }

  // 금고 상태를 새로 읽는다 — D-14 를 열 때 계정(또는 로컬) 금고 상태로 덧붙임 줄을 고른다 (F-408 3.5)
  async function refreshStatus(): Promise<E2eeStatus> {
    if (!keyring) return 'unknown'
    await keyring.load()
    return keyring.getStatus()
  }

  // 받은 암호로 이 탭의 금고를 연다 — 대화상자를 띄우지 않고 알림도 없다 (F-408 3.5)
  async function openWithPasswordDirect(password: string): Promise<E2eeActionError | null> {
    if (!keyring) return 'failed'
    const err = await keyring.open(password)
    if (err === null) handleOpened()
    return err
  }

  function handleOtherTabLock() {
    if (!keyring) return
    if (keyring.getStatus() !== 'open') return
    void keyring.lock('other-tab').then((outcome) => {
      if (outcome === 'locked') showNotice({ type: 'info', message: '다른 탭에서 금고를 잠갔습니다.' })
    })
  }

  // 다른 이유로 계정이 바뀜 — App 의 applyAccountFlags 가 부른다 (4.5)
  async function lockForAccountChange() {
    if (!keyring) return
    const outcome = await keyring.lock('account')
    if (outcome === 'locked') showNotice({ type: 'info', message: '계정이 바뀌어 금고를 잠갔습니다.' })
  }

  async function lockManual() {
    if (!keyring) return
    const outcome = await keyring.lock('manual')
    if (outcome === 'aborted' && !abortedNoticeShownRef.current) {
      abortedNoticeShownRef.current = true
      showNotice({ type: 'error', message: '저장하지 못한 금고 문서가 있어 금고를 잠그지 못했습니다.' })
    }
  }

  const dialogs = keyring
    ? // eslint-disable-next-line react-hooks/refs -- .ts 라 JSX 를 못 쓴다. 아래 콜백은 다 나중에(이벤트·구독) 불린다
      createElement(E2eeDialogs, {
        mode: dialogMode,
        keyring,
        scope,
        accountEmail,
        onClose: closeDialogs,
        onOpened: handleOpened,
        onCreated: handleCreated,
        onRecovered: handleRecovered,
        onChanged: handleChanged,
        onReset: handleReset,
      })
    : null

  if (!keyring || !scope) return null

  return {
    keyring,
    status,
    requestOpen,
    dialogs,
    handleOtherTabLock,
    lockForAccountChange,
    broadcastLogoutLock: () => postRef.current({ kind: 'e2ee-lock', tabId: tabIdRef.current }),
    openSettingsDialogs: {
      create: () => setDialogMode('create'),
      unlock: () => setDialogMode('unlock'),
      recover: () => setDialogMode('recover'),
      changePassword: () => setDialogMode('changePassword'),
      reset: () => setDialogMode('reset'),
      lockNow: () => void lockManual(),
    },
    refreshStatus,
    openWithPassword: openWithPasswordDirect,
  }
}
