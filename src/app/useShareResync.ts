// 새 공유 알림 행이 처음 나타날 때 공유 목록을 한 번 다시 읽는다 (F-2116 2.3)
import { useEffect, useRef } from 'react'
import type { InboxNotificationItem } from '../lib/docComments'
import { nextShareSeen } from './shareNotifications'
import type { NotificationsState } from './useNotifications'

export type UseShareResyncInput = {
  status: NotificationsState['status']
  items: readonly InboxNotificationItem[]
  accountId: string | null
  resync: (deletedSource: 'bootMerge') => Promise<void>
}

export function useShareResync({ status, items, accountId, resync }: UseShareResyncInput): void {
  const seenRef = useRef<ReadonlySet<string> | null>(null)
  const accountRef = useRef(accountId)
  const resyncRef = useRef(resync)
  useEffect(() => {
    resyncRef.current = resync
  })
  useEffect(() => {
    if (accountRef.current !== accountId) {
      accountRef.current = accountId
      seenRef.current = null
    }
    if (status === 'idle') {
      seenRef.current = null
      return
    }
    if (status !== 'ready') return
    const next = nextShareSeen(seenRef.current, items)
    seenRef.current = next.seen
    if (next.resync) void resyncRef.current('bootMerge').catch(() => {})
  }, [status, items, accountId])
}
