// GitHub 기능 상태(켜짐·연결·월 사용량) 조회 — 메모리에만 둔다 (specs/features/F-2128.md 2장)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GithubStatus } from '../lib/githubContract'
import type { Store } from '../types'
import type { AccountState } from './account'
import { fetchGithubStatus } from './githubApi'

const RECHECK_MS = 600_000

export type UseGithubStatusOptions = { account: AccountState; bootPhase: 'booting' | 'ready'; storeKind: Store['kind'] }
export type UseGithubStatusResult = { status: GithubStatus | null; on: boolean; refresh: () => Promise<GithubStatus | null> }

export function useGithubStatus({ account, bootPhase, storeKind }: UseGithubStatusOptions): UseGithubStatusResult {
  const userId = account.state === 'in' ? account.id : null
  const eligible = userId !== null && storeKind === 'server'
  const [held, setHeld] = useState<{ userId: string; status: GithubStatus | null } | null>(null)
  const userIdRef = useRef<string | null>(null)
  const eligibleRef = useRef(false)
  const inFlight = useRef<Promise<GithubStatus | null> | null>(null)
  const lastOkAt = useRef(0)

  useEffect(() => {
    userIdRef.current = userId
    eligibleRef.current = eligible
  })

  const refresh = useCallback((): Promise<GithubStatus | null> => {
    if (!eligibleRef.current || userIdRef.current === null) return Promise.resolve(null)
    if (inFlight.current) return inFlight.current
    const asked = userIdRef.current
    const run = fetchGithubStatus()
      .then((r) => {
        const next = r.ok ? r.value : null
        if (r.ok) lastOkAt.current = Date.now()
        if (userIdRef.current === asked) setHeld({ userId: asked, status: next })
        return next
      })
      .finally(() => {
        inFlight.current = null
      })
    inFlight.current = run
    return run
  }, [])

  useEffect(() => {
    if (eligible && bootPhase === 'ready') void refresh()
  }, [eligible, userId, bootPhase, refresh])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastOkAt.current > RECHECK_MS) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const status = eligible && held?.userId === userId ? held.status : null
  return { status, on: status?.enabled === true, refresh }
}
