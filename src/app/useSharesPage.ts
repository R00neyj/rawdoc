// 공유 관리 페이지 S-6 목록·해제 — 들어올 때마다 새로 부른다 (F-243 3.4, F-2064)
import { useEffect, useState } from 'react'
import { loginUrl, type AccountState } from './account'
import { listShares, type ShareLinkRow, type ShareGrantRow } from './sharesApi'
import { revokeShareLink, revokeFolderShareLink } from './linkApi'
import { deleteGrant } from '../storage/docsApi'

export type UseSharesPageOptions = {
  sharesOpen: boolean
  account: AccountState
}

export type UseSharesPageResult = {
  sharesLoading: boolean
  sharesLinks: ShareLinkRow[]
  sharesGrants: ShareGrantRow[]
  revokeShareLinkRow: (link: ShareLinkRow) => Promise<void>
  revokeShareGrantRow: (grant: ShareGrantRow) => Promise<void>
  loginFromShares: () => void
}

export function useSharesPage({ sharesOpen, account }: UseSharesPageOptions): UseSharesPageResult {
  const [sharesLoading, setSharesLoading] = useState(false)
  const [sharesLinks, setSharesLinks] = useState<ShareLinkRow[]>([])
  const [sharesGrants, setSharesGrants] = useState<ShareGrantRow[]>([])

  // ----- 공유 관리 페이지 (specs/features/F-243.md 3.4) — 들어올 때마다 새로 부른다, 로그인 아니면 요청하지 않는다 -----
  useEffect(() => {
    if (!sharesOpen || account.state !== 'in') return
    let cancelled = false

    async function loadShares() {
      setSharesLoading(true)
      try {
        const data = await listShares()
        if (cancelled) return
        setSharesLinks(data.links)
        setSharesGrants(data.grants)
      } catch {
        if (!cancelled) {
          setSharesLinks([])
          setSharesGrants([])
        }
      } finally {
        if (!cancelled) setSharesLoading(false)
      }
    }
    loadShares()

    return () => {
      cancelled = true
    }
  }, [sharesOpen, account.state])

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

  function loginFromShares() {
    location.href = loginUrl('#/shares')
  }

  return { sharesLoading, sharesLinks, sharesGrants, revokeShareLinkRow, revokeShareGrantRow, loginFromShares }
}
