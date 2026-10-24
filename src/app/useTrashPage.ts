// 휴지통 페이지 S-10 목록·복원·영구 삭제·비우기 — 들어올 때마다 새로 부른다. 지금 보는 저장소의 휴지통만 (F-2145 2장, small 2026-10-16)
import { useEffect, useMemo, useState } from 'react'
import type { AccountState } from './account/account'
import type { TrashItem } from '../lib/trash'
import type { Store } from '../types'
import type { NoticeWithAction } from './NoticeBar'
import { SERVER_TRASH, TrashApiError } from './trashApi'
import { localTrashSource } from './localTrash'
import { emptiedNotice, purgeOneNotice, restoreNotice, trashItemTitle, TRASH_NOTICE } from './trashView'

export type TrashStatus = 'loading' | 'offline' | 'failed' | 'ready'
export type TrashConfirm = { kind: 'one'; item: TrashItem } | { kind: 'all' } | null

export type UseTrashPageOptions = {
  trashOpen: boolean
  store: Pick<Store, 'kind' | 'listTrash' | 'restoreTrash' | 'purgeTrash'>
  account: AccountState
  showNotice: (notice: NoticeWithAction) => unknown
  resyncFromStore: () => Promise<void>
  selectDoc: (id: string) => Promise<void>
}

export type UseTrashPageResult = {
  trashLocal: boolean
  trashStatus: TrashStatus
  trashItems: TrashItem[]
  trashNow: number
  trashBusyIds: string[]
  trashConfirm: TrashConfirm
  retryTrash: () => void
  restoreTrashRow: (item: TrashItem) => Promise<void>
  askPurgeTrashRow: (item: TrashItem) => void
  askEmptyTrash: () => void
  cancelTrashConfirm: () => void
  confirmTrash: () => Promise<void>
}

export function useTrashPage({ trashOpen, store, account, showNotice, resyncFromStore, selectDoc }: UseTrashPageOptions): UseTrashPageResult {
  const [status, setStatus] = useState<TrashStatus>('loading')
  const [items, setItems] = useState<TrashItem[]>([])
  const [now, setNow] = useState(0)
  const [busyIds, setBusyIds] = useState<string[]>([])
  const [confirm, setConfirm] = useState<TrashConfirm>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const serverStore = store.kind === 'server'
  const source = useMemo(() => (serverStore ? SERVER_TRASH : localTrashSource(store)), [serverStore, store])
  const offlineAccount = serverStore && account.state === 'offline'

  useEffect(() => {
    if (!trashOpen) return
    let cancelled = false

    async function load() {
      if (offlineAccount && reloadTick === 0) {
        setStatus('offline')
        return
      }
      setStatus('loading')
      try {
        const list = await source.list()
        if (cancelled) return
        setItems(list)
        setNow(Date.now())
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        setStatus(error instanceof TrashApiError && error.kind === 'network' ? 'offline' : 'failed')
      }
    }
    void load()

    return () => {
      cancelled = true
    }
  }, [trashOpen, source, offlineAccount, reloadTick])

  const removeRow = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id))

  async function restoreTrashRow(item: TrashItem) {
    if (busyIds.includes(item.id)) return
    setBusyIds((prev) => [...prev, item.id])
    const result = await source.restore(item.id)
    setBusyIds((prev) => prev.filter((id) => id !== item.id))
    if (result.status === 'failed') {
      showNotice({ type: 'error', message: TRASH_NOTICE.restoreFailed })
      return
    }
    removeRow(item.id)
    if (result.status === 'gone') {
      showNotice({ type: 'info', message: TRASH_NOTICE.restoreGone })
      return
    }
    try {
      await resyncFromStore()
    } catch {
      // 목록 다시 받기가 실패해도 복원은 끝났다 — 다음 새로 읽기가 따라잡는다
    }
    const rootFallback = result.folderId === null && item.path !== null
    showNotice({
      type: 'info',
      message: restoreNotice(trashItemTitle(item), rootFallback),
      action: { label: '열기', onClick: () => void selectDoc(item.id) },
    })
  }

  async function confirmTrash() {
    const target = confirm
    setConfirm(null)
    if (!target) return
    if (target.kind === 'one') {
      const { item } = target
      const result = await source.purge(item.id)
      if (result === 'failed') {
        showNotice({ type: 'error', message: TRASH_NOTICE.purgeFailed })
        return
      }
      removeRow(item.id)
      if (result === 'ok') showNotice({ type: 'info', message: purgeOneNotice(trashItemTitle(item)) })
      return
    }
    const result = await source.empty()
    if (result.status === 'failed') {
      showNotice({ type: 'error', message: TRASH_NOTICE.emptyFailed })
      return
    }
    setItems([])
    try {
      await resyncFromStore()
    } catch {
      // 지우기는 끝났다 — 목록은 다음 새로 읽기가 따라잡는다
    }
    showNotice({ type: 'info', message: emptiedNotice(result.docs) })
  }

  return {
    trashLocal: !serverStore,
    trashStatus: status,
    trashItems: items,
    trashNow: now,
    trashBusyIds: busyIds,
    trashConfirm: confirm,
    retryTrash: () => setReloadTick((t) => t + 1),
    restoreTrashRow,
    askPurgeTrashRow: (item) => setConfirm({ kind: 'one', item }),
    askEmptyTrash: () => setConfirm({ kind: 'all' }),
    cancelTrashConfirm: () => setConfirm(null),
    confirmTrash,
  }
}
