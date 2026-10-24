// 공유 폴더 새 문서 — 폴더 목록 구독·사전 검사·오류 알림·사이드바 메뉴 객체 (F-2166 3.3~3.5)
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { ApiError, type SharedFolderItem } from '../../storage/docsApi'
import type { ServerStore } from '../../storage/serverStore'
import { ACCOUNT_BLOCKED_MESSAGE } from '../../lib/account/usageLimits'
import { SHARED_CREATE_FALLBACK_NOTICE, SHARED_CREATE_OFFLINE_MESSAGE, sharedCreateErrorMessage } from './sharedFolderCreate'
import type { NoticeWithAction } from '../notices/NoticeBar'
import type { Store } from '../../types'

export type SharedNewDocMenu = { online: boolean; onCreate(folderId: string): void; onUnavailable(): void }

export type SharedCreateApi = {
  folders: SharedFolderItem[] | null
  precheck: () => boolean
  fail: (err: unknown) => void
  fallbackNotice: () => void
}

export type UseSharedFolderCreateOptions = {
  store: Store
  online: boolean
  accountBlocked: boolean
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  dismissNotice: (id: number) => void
  resyncFromStore: (deletedSource?: 'tab' | 'bootMerge') => Promise<void>
  recheckAccount: () => Promise<void>
}

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

export function useSharedFolderCreate(options: UseSharedFolderCreateOptions) {
  const { store, online, accountBlocked, showNotice, dismissNotice, resyncFromStore, recheckAccount } = options
  const server = store.kind === 'server' ? (store as ServerStore) : null
  const subscribe = useMemo(() => (server ? (l: () => void) => server.subscribeSharedFolders(l) : noopSubscribe), [server])
  const getSnapshot = useMemo(() => (server ? () => server.sharedFolders() : nullSnapshot), [server])
  const folders = useSyncExternalStore(subscribe, getSnapshot)
  const blockedNoticeRef = useRef<number | null>(null)

  useEffect(() => {
    if (accountBlocked && blockedNoticeRef.current !== null) dismissNotice(blockedNoticeRef.current)
    blockedNoticeRef.current = null
  }, [accountBlocked, dismissNotice])

  const offlineNotice = useCallback(() => {
    showNotice({ type: 'error', message: SHARED_CREATE_OFFLINE_MESSAGE })
  }, [showNotice])

  const precheck = useCallback(() => {
    if (!online) {
      offlineNotice()
      return false
    }
    if (accountBlocked) {
      showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      return false
    }
    return true
  }, [online, accountBlocked, offlineNotice, showNotice])

  const fail = useCallback(
    (err: unknown) => {
      const id = showNotice({ type: 'error', message: sharedCreateErrorMessage(err) })
      if (!(err instanceof ApiError)) return
      if (err.kind === 'forbidden' || err.kind === 'not_found') void resyncFromStore('bootMerge')
      if (err.kind === 'account_blocked') {
        blockedNoticeRef.current = id
        void recheckAccount()
      }
    },
    [showNotice, resyncFromStore, recheckAccount],
  )

  const fallbackNotice = useCallback(() => {
    showNotice({ type: 'info', message: SHARED_CREATE_FALLBACK_NOTICE })
  }, [showNotice])

  const api: SharedCreateApi = { folders, precheck, fail, fallbackNotice }
  const menu = (onCreate: (folderId: string) => void): SharedNewDocMenu | undefined =>
    server ? { online, onCreate, onUnavailable: offlineNotice } : undefined
  return { api, folders, menu }
}
