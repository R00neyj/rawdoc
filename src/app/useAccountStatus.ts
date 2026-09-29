// 계정 상태·차단·경고 알림·다시 읽기 — App.tsx 에서 옮김 (F-2079, F-207, F-2030)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { fetchAccount, type AccountState } from './account'
import { planAccountNotices, ACCOUNT_RECHECK_MS, ACCOUNT_BLOCKED_MESSAGE, ACCOUNT_WARNED_MESSAGE, type AccountFlags } from '../lib/usageLimits'
import type { ServerStore } from '../storage/serverStore'
import type { NoticeWithAction } from './NoticeBar'
import type { UseE2ee } from './useE2ee'
import type { Store } from '../types'

export type UseAccountStatusOptions = {
  store: Store
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  dismissNotice: (id: number) => void
  e2eeRef: RefObject<UseE2ee | null>
}

export type UseAccountStatusResult = {
  account: AccountState
  accountBlocked: boolean
  applyAccountFlags: (next: AccountState) => void
  recheckAccount: () => Promise<void>
}

export function useAccountStatus(options: UseAccountStatusOptions): UseAccountStatusResult {
  const { store, showNotice, dismissNotice, e2eeRef } = options
  const [account, setAccount] = useState<AccountState>({ state: 'offline' })
  // 계정 차단·경고 상태 (F-2030 5.2) — /api/me 의 blocked·warned 를 반영한다. warned 는 화면 렌더에 안 쓰여 ref 로 충분하다
  const [accountBlocked, setAccountBlockedFlag] = useState(false)
  const accountWarnedRef = useRef(false)
  // 이 페이지에서 직전에 반영한 값 — planAccountNotices 의 prev (5.3)
  const accountFlagsRef = useRef<AccountFlags | null>(null)
  const warnedShownThisPageRef = useRef(false)
  const blockedNoticeIdRef = useRef<number | null>(null)
  const warnedNoticeIdRef = useRef<number | null>(null)
  // 마지막으로 성공한 /api/me 읽기 시각 — 화면 복귀 10분 스로틀 (5.1 ⑤)
  const lastAccountCheckOkRef = useRef(0)
  const accountCheckInFlightRef = useRef<Promise<void> | null>(null)

  // /api/me 결과를 반영 — 계정 상태·blocked·warned·L5·L7 (F-2030 5.2·5.3)
  const applyAccountFlags = useCallback(
    (next: AccountState) => {
      setAccount(next)
      // 다른 이유로 계정이 바뀜 — offline 은 바뀜으로 보지 않는다. 로컬 범위에는 해당 없다 (F-404.md 4.5)
      const e2eeScope = e2eeRef.current?.keyring.scope
      if (e2eeScope?.kind === 'account' && next.state !== 'offline') {
        const nextId = next.state === 'in' ? next.id : undefined
        if (nextId !== e2eeScope.userId) void e2eeRef.current?.lockForAccountChange()
      }
      if (next.state !== 'in') return
      lastAccountCheckOkRef.current = Date.now()
      const nextFlags: AccountFlags = { blocked: next.blocked, warned: next.warned }
      const plan = planAccountNotices(accountFlagsRef.current, nextFlags, warnedShownThisPageRef.current)
      if (plan.showBlocked) {
        blockedNoticeIdRef.current = showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      }
      if (plan.dismissBlocked && blockedNoticeIdRef.current !== null) {
        dismissNotice(blockedNoticeIdRef.current)
        blockedNoticeIdRef.current = null
      }
      if (plan.showWarned) {
        warnedNoticeIdRef.current = showNotice({ type: 'warn', message: ACCOUNT_WARNED_MESSAGE })
        warnedShownThisPageRef.current = true
      }
      if (plan.dismissWarned && warnedNoticeIdRef.current !== null) {
        dismissNotice(warnedNoticeIdRef.current)
        warnedNoticeIdRef.current = null
      }
      accountFlagsRef.current = nextFlags
      setAccountBlockedFlag(nextFlags.blocked)
      accountWarnedRef.current = nextFlags.warned
    },
    [showNotice, dismissNotice, e2eeRef],
  )

  // 겹치는 계기는 하나만 진행 — 진행 중이면 그 결과를 기다린다 (5.1)
  const recheckAccount = useCallback((): Promise<void> => {
    if (accountCheckInFlightRef.current) return accountCheckInFlightRef.current
    const p = fetchAccount()
      .then((next) => {
        applyAccountFlags(next)
      })
      .finally(() => {
        accountCheckInFlightRef.current = null
      })
    accountCheckInFlightRef.current = p
    return p
  }, [applyAccountFlags])

  // 계정 상태 시작 때 1회는 boot() 가 읽는다 — 여기는 online 때 화면 표시만 최신화 (F-207.md 2.6, F-2030 5.1 ②)
  useEffect(() => {
    function load() {
      recheckAccount()
    }
    window.addEventListener('online', load)
    return () => window.removeEventListener('online', load)
  }, [recheckAccount])

  // 화면이 다시 보일 때 — 마지막 성공한 읽기에서 10분이 지났을 때만 다시 읽는다 (F-2030 5.1 ⑤)
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAccountCheckOkRef.current < ACCOUNT_RECHECK_MS) return
      recheckAccount()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [recheckAccount])

  // accountBlocked 가 바뀔 때마다 서버 저장소면 outbox 를 멈추거나 다시 연다 (F-2030 4.4, 5.2)
  useEffect(() => {
    if (store.kind !== 'server') return
    ;(store as ServerStore).setAccountBlocked(accountBlocked)
  }, [accountBlocked, store])

  return { account, accountBlocked, applyAccountFlags, recheckAccount }
}
