// 공유 관리 페이지 S-6 목록·해제·권한 요청 처리 — 들어올 때마다 새로 부른다 (F-243 3.4, F-2064, F-2136)
import { useEffect, useRef, useState } from 'react'
import { loginUrl, type AccountState } from './account'
import { approveAccessRequest, listShares, rejectAccessRequest, type AccessRequestDecision, type ShareLinkRow, type ShareGrantRow } from './sharesApi'
import { revokeShareLink, revokeFolderShareLink } from './linkApi'
import { deleteGrant } from '../storage/docsApi'
import type { Notice } from './notice'
import type { AccessRequestRow } from '../lib/accessRequest'

export type UseSharesPageOptions = {
  sharesOpen: boolean
  account: AccountState
  accessRequestKey: string
  showNotice: (notice: Notice) => unknown
}

export type UseSharesPageResult = {
  sharesLoading: boolean
  sharesLinks: ShareLinkRow[]
  sharesGrants: ShareGrantRow[]
  sharesRequests: AccessRequestRow[]
  busyRequestIds: string[]
  revokeShareLinkRow: (link: ShareLinkRow) => Promise<void>
  revokeShareGrantRow: (grant: ShareGrantRow) => Promise<void>
  approveRequestRow: (row: AccessRequestRow) => Promise<void>
  rejectRequestRow: (row: AccessRequestRow) => Promise<void>
  loginFromShares: () => void
}

const ROLE_LABEL = { view: '보기', edit: '편집' } as const

export function useSharesPage({ sharesOpen, account, accessRequestKey, showNotice }: UseSharesPageOptions): UseSharesPageResult {
  const [sharesLoading, setSharesLoading] = useState(false)
  const [sharesLinks, setSharesLinks] = useState<ShareLinkRow[]>([])
  const [sharesGrants, setSharesGrants] = useState<ShareGrantRow[]>([])
  const [sharesRequests, setSharesRequests] = useState<AccessRequestRow[]>([])
  const [busyRequestIds, setBusyRequestIds] = useState<string[]>([])
  const [reloadTick, setReloadTick] = useState(0)
  const loadedRef = useRef(false)

  // ----- 공유 관리 페이지 (specs/features/F-243.md 3.4) — 들어올 때마다 새로 부른다, 로그인 아니면 요청하지 않는다 -----
  // 들어온 뒤 다시 부를 때(새 권한 요청·승인)는 목록을 지우지 않고 바꿔 끼운다
  useEffect(() => {
    if (!sharesOpen || account.state !== 'in') {
      loadedRef.current = false
      return
    }
    let cancelled = false

    async function loadShares() {
      if (!loadedRef.current) setSharesLoading(true)
      try {
        const data = await listShares()
        if (cancelled) return
        setSharesLinks(data.links)
        setSharesGrants(data.grants)
        setSharesRequests(data.requests ?? [])
        loadedRef.current = true
      } catch {
        if (!cancelled && !loadedRef.current) {
          setSharesLinks([])
          setSharesGrants([])
          setSharesRequests([])
        }
      } finally {
        if (!cancelled) setSharesLoading(false)
      }
    }
    loadShares()

    return () => {
      cancelled = true
    }
  }, [sharesOpen, account.state, accessRequestKey, reloadTick])

  async function revokeShareLinkRow(link: ShareLinkRow) {
    if (link.targetType === 'doc') {
      await revokeShareLink(link.targetId)
    } else {
      await revokeFolderShareLink(link.targetId)
    }
    setSharesLinks((prev) => prev.filter((l) => l.token !== link.token))
  }

  async function revokeShareGrantRow(grant: ShareGrantRow) {
    await deleteGrant(grant.targetType, grant.targetId, grant.email)
    setSharesGrants((prev) =>
      prev.filter((g) => !(g.targetType === grant.targetType && g.targetId === grant.targetId && g.email === grant.email)),
    )
  }

  async function decideRequest(row: AccessRequestRow, decide: (id: string) => Promise<AccessRequestDecision>, okMessage: string, reload: boolean) {
    if (busyRequestIds.includes(row.id)) return
    setBusyRequestIds((prev) => [...prev, row.id])
    const result = await decide(row.id)
    setBusyRequestIds((prev) => prev.filter((id) => id !== row.id))
    if (result === 'failed') {
      showNotice({ type: 'error', message: '요청을 처리하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.' })
      return
    }
    setSharesRequests((prev) => prev.filter((r) => r.id !== row.id))
    if (result === 'gone') {
      showNotice({ type: 'info', message: '이미 처리됐거나 사라진 요청입니다.' })
      return
    }
    showNotice({ type: 'info', message: okMessage })
    if (reload) setReloadTick((t) => t + 1)
  }

  const approveRequestRow = (row: AccessRequestRow) =>
    decideRequest(row, approveAccessRequest, `${row.email}에게 ${ROLE_LABEL[row.role]} 권한을 주었습니다.`, true)
  const rejectRequestRow = (row: AccessRequestRow) => decideRequest(row, rejectAccessRequest, '요청을 거절했습니다.', false)

  function loginFromShares() {
    location.href = loginUrl('#/shares')
  }

  return {
    sharesLoading, sharesLinks, sharesGrants, sharesRequests, busyRequestIds,
    revokeShareLinkRow, revokeShareGrantRow, approveRequestRow, rejectRequestRow, loginFromShares,
  }
}
