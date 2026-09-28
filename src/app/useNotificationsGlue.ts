// 알림함 여닫기·항목 이동·안 읽은 점·멘션 후보 원천 — App 배선 (F-507 3.3·5.1, F-510 3.3·4.2, F-2069)
import { useCallback, useMemo, useState, type RefObject } from 'react'
import type { AccountState } from './account'
import type { CommentAccess } from './commentRail'
import type { DocMeta } from './docMeta'
import type { MentionSource } from './MentionField'
import { useNotifications, type UseNotificationsResult } from './useNotifications'
import { fetchDocPeople } from './notificationsApi'
import { unreadNotificationDocIds } from './docNotifications'
import { createPeopleCache } from './mentionCandidates'
import { formatCommentHash } from './hashRoute'
import type { NotificationItem } from '../lib/docComments'
import type { Store } from '../types'

export type UseNotificationsGlueOptions = {
  bootPhase: 'booting' | 'ready'
  store: Pick<Store, 'kind'>
  account: AccountState
  currentDocId: string | null
  docScreenId: string | null
  commentAccessValue: CommentAccess
  docsRef: RefObject<DocMeta[]>
  resyncFromStore: () => Promise<void>
}

export type UseNotificationsGlueResult = {
  notificationsEnabled: boolean
  notifications: UseNotificationsResult
  notificationsOpen: boolean
  setNotificationsOpen: (open: boolean) => void
  handleOpenNotification: (item: NotificationItem) => Promise<void>
  unreadNotificationDocIdsValue: ReadonlySet<string>
  mentionSource: MentionSource | null
}

export function useNotificationsGlue({
  bootPhase,
  store,
  account,
  currentDocId,
  docScreenId,
  commentAccessValue,
  docsRef,
  resyncFromStore,
}: UseNotificationsGlueOptions): UseNotificationsGlueResult {
  // ----- 알림함 (F-507 3.3·4장) -----
  const notificationsEnabled = bootPhase === 'ready' && store.kind === 'server' && account.state === 'in'
  const notifications = useNotifications({ enabled: notificationsEnabled, blocked: account.state === 'in' && account.blocked, accountId: account.state === 'in' ? account.id : null })
  const [notificationsOpen, setNotificationsOpenState] = useState(false)
  // 렌더 중 조정 — enabled 가 꺼지면 알림함을 닫는다(useDocComments 의 resetFor 와 같은 패턴)
  const [wasNotificationsEnabled, setWasNotificationsEnabled] = useState(notificationsEnabled)
  if (wasNotificationsEnabled !== notificationsEnabled) {
    setWasNotificationsEnabled(notificationsEnabled)
    if (!notificationsEnabled) setNotificationsOpenState(false)
  }
  const setNotificationsOpen = useCallback(
    (open: boolean) => {
      setNotificationsOpenState(open)
      if (open) notifications.refresh('open')
    },
    [notifications],
  )
  // 항목 → 문서·스레드 이동 (4.5)
  const handleOpenNotification = useCallback(
    async (item: NotificationItem) => {
      setNotificationsOpen(false)
      notifications.markRead(item.id)
      if (!docsRef.current.some((d) => d.id === item.docId) && navigator.onLine) {
        await resyncFromStore().catch(() => {})
      }
      location.hash = formatCommentHash(item.docId, item.threadId)
    },
    [setNotificationsOpen, notifications, resyncFromStore, docsRef],
  )

  // ----- 사이드바 안 읽은 알림 점 (F-510 2·3.3) -----
  const unreadNotificationDocIdsValue = useMemo(() => unreadNotificationDocIds(notifications.items), [notifications.items])

  const [prevDocScreenId, setPrevDocScreenId] = useState(docScreenId)
  if (prevDocScreenId !== docScreenId) {
    setPrevDocScreenId(docScreenId)
    // 상태가 바뀐 것만으로는 부르지 않는다 — 전환된 순간 notifications.status 가 ready 여야 한다(r4, 부팅 직후 문서는 idle)
    if (docScreenId !== null && notifications.status === 'ready') notifications.markDocRead(docScreenId)
  }

  // ----- 멘션 후보 원천 (F-507 5.1, 8.1) -----
  const [peopleCache] = useState(() =>
    createPeopleCache({
      load: async (docId: string) => {
        const result = await fetchDocPeople(docId)
        return result.ok ? result.people : null
      },
      now: () => Date.now(),
      online: () => navigator.onLine,
    }),
  )
  // 렌더마다 새 객체면 MentionField 의 후보 불러오기 effect 가 App 렌더마다 다시 돌아, 실패 중에는 요청이 반복된다 (리뷰 U5)
  const mentionDocId = notificationsEnabled && currentDocId && commentAccessValue.kind === 'write' && account.state === 'in' ? currentDocId : null
  const mentionSelfEmail = account.state === 'in' ? account.email : null
  const mentionSource: MentionSource | null = useMemo(
    () => (mentionDocId && mentionSelfEmail !== null ? { docId: mentionDocId, selfEmail: mentionSelfEmail, people: peopleCache } : null),
    [mentionDocId, mentionSelfEmail, peopleCache],
  )

  return {
    notificationsEnabled,
    notifications,
    notificationsOpen,
    setNotificationsOpen,
    handleOpenNotification,
    unreadNotificationDocIdsValue,
    mentionSource,
  }
}
