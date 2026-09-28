// 계정 삭제 D-15·다시 열기 표지·설정 계정 줄 — App.tsx 에서 옮김 (F-2079, F-2038)
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { deleteE2eeRow } from '../storage/idbStore'
import { deleteYjsUserRows, type YjsStore } from '../storage/yjsStore'
import { deleteRemoteCacheUserRows } from '../storage/remoteCache'
import { setPref } from './prefs'
import { storedAccount, type AccountState } from './account'
import {
  ACCOUNT_DELETE_MARKER_KEY,
  cleanUpAfterAccountDelete,
  decideAccountDeleteMarker,
  hasUnsyncedChanges,
  reauthLoginUrl,
  resumeMarker,
} from './accountDelete'
import type { NoticeWithAction } from './NoticeBar'
import type { SettingsAccount } from './SettingsDialog'
import type { UseE2ee } from './useE2ee'
import type { SyncState } from '../types'

export type UseAccountDeleteOptions = {
  bootPhase: 'booting' | 'ready'
  account: AccountState
  syncState: SyncState | undefined
  e2ee: UseE2ee | null
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
}

export type UseAccountDeleteResult = {
  accountDeleteUserId: string | null
  accountDeleteUnsynced: boolean
  closeAccountDelete: () => void
  reauthForAccountDelete: () => Promise<void>
  finishAccountDelete: () => Promise<void>
  settingsAccount: SettingsAccount | undefined
}

export function useAccountDelete(options: UseAccountDeleteOptions): UseAccountDeleteResult {
  const { bootPhase, account, syncState, e2ee, showNotice, yjsStoreRef, docSaverFlushRef } = options
  // 계정 삭제 D-15 (specs/features/F-2038.md 6장) — 연 계정 id 와 안 올린 변경 여부
  const [accountDeleteUserId, setAccountDeleteUserId] = useState<string | null>(null)
  const [accountDeleteUnsynced, setAccountDeleteUnsynced] = useState(false)

  // 계정 삭제 D-15 (F-2038 6장) — 안 올린 변경(6.4)을 먼저 센 뒤 연다. outbox 수는 서버 저장소의 syncState.pending(countOutbox) — 모르면 안내를 보인다
  const openAccountDelete = useCallback((userId: string, pendingOutbox: number | undefined) => {
    const unknownAfter = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1_000))
    const counted = hasUnsyncedChanges({
      outboxCount: async () => {
        if (pendingOutbox === undefined) throw new Error('outbox 수 모름')
        return pendingOutbox
      },
      unsyncedDocCount: async () => {
        const persist = await yjsStoreRef.current
        if (!persist) throw new Error('md-yjs 없음')
        return (await persist.unsyncedDocIds()).length
      },
    })
    void Promise.race([counted, unknownAfter]).then((unsynced) => {
      setAccountDeleteUnsynced(unsynced)
      setAccountDeleteUserId(userId)
    })
  }, [yjsStoreRef])

  // 다시 열기 표지 (6.5) — 부팅이 계정 상태를 정한 뒤 읽고, 읽은 즉시 지운다. offline 이면 resume 을 남겨 다음 in 을 기다린다
  useEffect(() => {
    if (bootPhase !== 'ready') return
    let raw: string | null
    try {
      raw = sessionStorage.getItem(ACCOUNT_DELETE_MARKER_KEY)
    } catch {
      return
    }
    const decision = decideAccountDeleteMarker(raw, account, Date.now())
    if (decision.clear) sessionStorage.removeItem(ACCOUNT_DELETE_MARKER_KEY)
    if (decision.action === 'open' && account.state === 'in') openAccountDelete(account.id, syncState?.pending)
    else if (decision.action === 'warn') {
      showNotice({ type: 'warn', message: '다른 계정으로 로그인해 계정 삭제 창을 열지 않았습니다. 지우려던 계정으로 다시 로그인하세요.' })
    } else if (decision.action === 'done') showNotice({ type: 'info', message: '계정을 삭제했습니다.' })
  }, [bootPhase, account, syncState?.pending, openAccountDelete, showNotice])

  function closeAccountDelete() {
    setAccountDeleteUserId(null)
  }

  async function reauthForAccountDelete() {
    const userId = accountDeleteUserId
    if (!userId) return
    await docSaverFlushRef.current()
    sessionStorage.setItem(ACCOUNT_DELETE_MARKER_KEY, resumeMarker(userId, Date.now()))
    location.href = reauthLoginUrl(location.hash)
  }

  async function finishAccountDelete() {
    const userId = accountDeleteUserId
    if (!userId) return
    await cleanUpAfterAccountDelete({
      lockVault: () => e2ee?.broadcastLogoutLock(),
      clearRemoteCache: () => deleteRemoteCacheUserRows(userId),
      clearYjs: () => deleteYjsUserRows(userId),
      clearE2eeRow: () => deleteE2eeRow(`account:${userId}`),
      setPref: (key, value) => setPref(key, value),
      writeMarker: (value) => sessionStorage.setItem(ACCOUNT_DELETE_MARKER_KEY, value),
      navigate: (url) => location.replace(url),
    })
  }

  const storedAccountForSettings = account.state === 'offline' ? storedAccount() : null
  const settingsAccount =
    account.state === 'in'
      ? { email: account.email, online: syncState?.online !== false, onDelete: () => openAccountDelete(account.id, syncState?.pending) }
      : storedAccountForSettings
        ? { email: storedAccountForSettings.email, online: false, onDelete: () => {} }
        : undefined

  return { accountDeleteUserId, accountDeleteUnsynced, closeAccountDelete, reauthForAccountDelete, finishAccountDelete, settingsAccount }
}
