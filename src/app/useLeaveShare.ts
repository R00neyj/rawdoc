// 공유에서 나가기 — 대화상자 상태·나가기 실행·다른 탭 수신·md-yjs 정리 (specs/features/F-2115.md 2장)
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { leaveShare } from '../storage/docsApi'
import type { ServerStore } from '../storage/serverStore'
import type { YjsStore } from '../storage/yjsStore'
import type { Store } from '../types'
import { displayDocTitle, type DocMeta } from './docMeta'
import {
  LEAVE_SHARE_OFFLINE,
  LEAVE_SHARE_OTHER_TAB,
  removeSharedIds,
  runLeaveShare,
  type LeaveShareTarget,
} from './leaveShare'
import type { Notice } from './notice'
import type { SharedLeaveMenu } from './Sidebar'

type Options = {
  store: Store
  docsRef: RefObject<DocMeta[]>
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  currentDocIdRef: RefObject<string | null>
  currentDocId: string | null
  online: boolean
  beforeLeaveDoc: () => Promise<void>
  goHome: () => Promise<void>
  showNotice: (notice: Notice) => unknown
  resyncFromStore: (source: 'tab') => unknown
  postLeft: (docIds: string[]) => void
  closeSidebarIfNarrow: () => void
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  otherTabLeftRef: MutableRefObject<(docIds: string[]) => void>
}

export function useLeaveShare(o: Options) {
  const [target, setTarget] = useState<LeaveShareTarget | null>(null)
  const [sending, setSending] = useState(false)
  const [removalTick, setRemovalTick] = useState(0)
  const pendingYjsRef = useRef<string[]>([])
  const pendingFocusRef = useRef<(() => HTMLElement | null) | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const optsRef = useRef(o)
  const { otherTabLeftRef, yjsStoreRef, currentDocId } = o
  useEffect(() => {
    optsRef.current = o
  })

  const queueYjsRemoval = useCallback((ids: string[]) => {
    pendingYjsRef.current = [...pendingYjsRef.current, ...ids]
    setRemovalTick((n) => n + 1)
  }, [])

  // 열린 문서는 홈 이동이 커밋돼 실시간 세션 정리가 돈 뒤에 지운다
  useEffect(() => {
    const ready = pendingYjsRef.current.filter((id) => id !== currentDocId)
    if (ready.length === 0) return
    pendingYjsRef.current = pendingYjsRef.current.filter((id) => id === currentDocId)
    void yjsStoreRef.current.then((yjs) => {
      for (const id of ready) void yjs?.removeDoc(id).catch(() => {})
    })
  }, [currentDocId, removalTick, yjsStoreRef])

  // 대화상자 close 이벤트의 포커스 복귀보다 뒤에 와야 해서 커밋 뒤 타이머로 옮긴다
  useEffect(() => {
    const find = pendingFocusRef.current
    if (!find) return undefined
    pendingFocusRef.current = null
    const timer = setTimeout(() => find()?.focus(), 0)
    return () => clearTimeout(timer)
  }, [focusTick])

  function focusAfterClose(find: () => HTMLElement | null) {
    pendingFocusRef.current = find
    setFocusTick((n) => n + 1)
  }

  const dropLocally = useCallback((ids: string[]) => {
    const cur = optsRef.current
    ;(cur.store as ServerStore).forgetSharedDocs?.(ids)
    cur.setDocs((prev) => removeSharedIds(prev, ids))
    queueYjsRemoval(ids)
  }, [queueYjsRemoval])

  useEffect(() => {
    otherTabLeftRef.current = (docIds) => {
      const cur = optsRef.current
      const openId = cur.currentDocIdRef.current
      void (async () => {
        if (openId && docIds.includes(openId)) {
          await cur.goHome()
          cur.showNotice({ type: 'info', message: LEAVE_SHARE_OTHER_TAB })
        }
        dropLocally(docIds)
        cur.resyncFromStore('tab')
      })()
    }
  }, [otherTabLeftRef, dropLocally])

  function focusRowMenu(t: LeaveShareTarget) {
    const label = `${t.type === 'doc' ? displayDocTitle(t.name) : t.name} 메뉴`
    focusAfterClose(() => [...document.querySelectorAll<HTMLElement>('.shared-doc-list button')].find((b) => b.getAttribute('aria-label') === label) ?? null)
  }

  function cancel() {
    if (sending) return
    if (target) focusRowMenu(target)
    setTarget(null)
  }

  async function confirm() {
    if (!target || sending) return
    const leaving = target
    setSending(true)
    const result = await runLeaveShare(leaving, {
      docs: o.docsRef.current,
      openDocId: o.currentDocIdRef.current,
      beforeLeaveDoc: o.beforeLeaveDoc,
      flushOutbox: async () => { await (o.store as ServerStore).flushOutbox?.() },
      leaveShare,
      goHome: o.goHome,
      forgetSharedDocs: (ids) => (o.store as ServerStore).forgetSharedDocs?.(ids),
      removeFromList: (ids) => o.setDocs((prev) => removeSharedIds(prev, ids)),
      queueYjsRemoval,
      post: o.postLeft,
      notify: (n) => { o.showNotice(n) },
      resync: () => { void o.resyncFromStore('tab') },
    })
    setSending(false)
    setTarget(null)
    if (result === 'failed') {
      focusRowMenu(leaving)
    } else {
      focusAfterClose(
        () => document.querySelector<HTMLElement>('.shared-group-toggle') ?? document.querySelector<HTMLElement>('.sidebar-actions button[aria-label="새 문서"]'),
      )
    }
  }

  const menu: SharedLeaveMenu = {
    online: o.online,
    onRequest: (t) => {
      o.closeSidebarIfNarrow()
      setTarget(t)
    },
    onUnavailable: () => { o.showNotice({ type: 'info', message: LEAVE_SHARE_OFFLINE }) },
  }

  return { menu, target, sending, cancel, confirm }
}

