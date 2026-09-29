// 실시간 알림 띠 N1~N10·오프라인 보기 알림·문서에 묶인 새 문서로 저장 알림 — App.tsx 에서 옮김 (F-2070, F-2059)
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type * as Y from 'yjs'
import type { Store } from '../types'
import type { ServerStore } from '../storage/serverStore'
import type { ShareDoc } from '../lib/shareCodec'
import { ACCOUNT_BLOCKED_MESSAGE } from '../lib/usageLimits'
import type { DocMeta } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { LiveDocSession } from './useLiveDoc'
import { IconNoteAdd } from './icons'
import { READ_ONLY_LIVE_NOTICE, LIVE_NOTICE } from './appNotices'
import { guardForDoc, staleDocBoundNotices } from './docBoundNotice'
import { disconnectedNoticeMessage, isOwnServerDoc, liveStopNoticeBranch } from './liveNotices'

export type UseLiveNoticesOptions = {
  store: Store
  currentDoc: DocMeta | null
  currentDocId: string | null
  sharedDoc: ShareDoc | null
  accountBlocked: boolean
  docSession: { seq: number; forbiddenClose: boolean; quietForbidden: boolean }
  liveSession: LiveDocSession | null
  isOfflineView: boolean
  showNotice: (input: NoticeWithAction) => number
  dismissNotice: (id: number) => void
  recheckAccount: () => Promise<void>
  restartDocSession: () => void
  currentDocIdRef: RefObject<string | null>
  saveCurrentAsNewDocRef: RefObject<() => Promise<void>>
}

export type UseLiveNoticesResult = {
  showSaveAsNewNotice: (docId: string, input: { type: 'error' | 'warn'; message: string }) => number
}

export function useLiveNotices(options: UseLiveNoticesOptions): UseLiveNoticesResult {
  const {
    store, currentDoc, currentDocId, sharedDoc, accountBlocked, docSession, liveSession, isOfflineView, showNotice, dismissNotice,
    recheckAccount, restartDocSession, currentDocIdRef, saveCurrentAsNewDocRef,
  } = options

  // ----- 실시간 알림 띠 N1~N6 (F-305 11.2) -----
  // `새 문서로 저장` 알림은 만든 문서에 묶는다 — 다른 문서로 옮기면 걷고, 옮긴 뒤 누르면 아무것도 하지 않는다 (리뷰 A5)
  const docBoundNoticesRef = useRef(new Map<number, string>())
  const showSaveAsNewNotice = useCallback(
    (docId: string, input: { type: 'error' | 'warn'; message: string }): number => {
      const onClick = guardForDoc(docId, () => currentDocIdRef.current, () => void saveCurrentAsNewDocRef.current())
      const id = showNotice({ ...input, action: { label: '새 문서로 저장', icon: IconNoteAdd, onClick } })
      docBoundNoticesRef.current.set(id, docId)
      return id
    },
    [showNotice, currentDocIdRef, saveCurrentAsNewDocRef],
  )
  useEffect(() => {
    const bound = docBoundNoticesRef.current
    for (const id of staleDocBoundNotices(bound, currentDocId)) {
      dismissNotice(id)
      bound.delete(id)
    }
  }, [currentDocId, dismissNotice])
  // 읽기 전용 세션의 첫 동기화 전 4403 — 알림 없이 /api/me 만 한 번 (F-506 3.3)
  const quietForbiddenSeqRef = useRef(0)
  useEffect(() => {
    if (!docSession.quietForbidden || quietForbiddenSeqRef.current === docSession.seq) return
    quietForbiddenSeqRef.current = docSession.seq
    void recheckAccount()
  }, [docSession, recheckAccount])

  // N1 — 첫 동기화 전 4403 으로 보기로 연 세션마다 한 번. 내 소유 문서면 계정 차단인지 본다 (F-2030 5.4)
  const forbiddenNoticeSeqRef = useRef(0)
  useEffect(() => {
    if (!docSession.forbiddenClose || forbiddenNoticeSeqRef.current === docSession.seq) return
    forbiddenNoticeSeqRef.current = docSession.seq
    const ownDoc = isOwnServerDoc(store.kind, currentDoc, sharedDoc)
    if (ownDoc && accountBlocked) {
      showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      return
    }
    showNotice({ type: 'info', message: LIVE_NOTICE.forbidden })
    if (ownDoc) recheckAccount()
  }, [docSession, showNotice, store, currentDoc, sharedDoc, accountBlocked, recheckAccount])

  // N2·N3·N4 — 멈춘 방 Doc 마다 한 번. N5·N6 — 조건이 풀리면 그 알림이 아직 떠 있을 때만 걷는다
  const liveStopNoticeDocRef = useRef<Y.Doc | null>(null)
  const liveNoticeIdsRef = useRef<{ disconnected: number | null; tooLarge: number | null }>({ disconnected: null, tooLarge: null })
  // 이 방 Doc 에서 이미 알린 병합 수 (F-306 7.3)
  const mergedSeenRef = useRef<{ doc: Y.Doc | null; count: number }>({ doc: null, count: 0 })
  useEffect(() => {
    const snap = liveSession?.snapshot
    const ids = liveNoticeIdsRef.current
    const readOnlySession = liveSession?.readOnly === true
    if (snap?.disconnectedLong && ids.disconnected === null) {
      const message = disconnectedNoticeMessage(readOnlySession, liveSession?.persistBroken)
      ids.disconnected = showNotice({ type: 'warn', message })
    } else if (!snap?.disconnectedLong && ids.disconnected !== null) {
      dismissNotice(ids.disconnected)
      ids.disconnected = null
    }
    // N8 — N5 를 걷은 뒤에 띄운다 (F-306 7.3)
    if (liveSession) {
      if (mergedSeenRef.current.doc !== liveSession.roomDoc) mergedSeenRef.current = { doc: liveSession.roomDoc, count: 0 }
      if (liveSession.merged > mergedSeenRef.current.count) {
        mergedSeenRef.current.count = liveSession.merged
        showNotice({ type: 'info', message: LIVE_NOTICE.merged })
      }
    }
    // N6 — 읽기 전용 세션은 할 수 있는 것이 없어 띄우지 않는다 (F-506 5.2)
    if (snap?.tooLarge && ids.tooLarge === null && !readOnlySession) {
      ids.tooLarge = showNotice({ type: 'error', message: LIVE_NOTICE.tooLarge })
    } else if (!snap?.tooLarge && ids.tooLarge !== null) {
      dismissNotice(ids.tooLarge)
      ids.tooLarge = null
    }
    if (!liveSession || snap?.phase !== 'stopped' || liveStopNoticeDocRef.current === liveSession.roomDoc) return
    liveStopNoticeDocRef.current = liveSession.roomDoc
    const branch = liveStopNoticeBranch(snap.stopReason, readOnlySession)
    // 읽기 전용 세션에는 내 편집이 없다 — 새 문서로 저장 없이 N9·N3·N10 (F-506 5.2)
    const stopDocId = liveSession.docId
    // 읽기 전용 세션이면 버튼 없이 띄운다
    const showStopNotice = (input: { type: 'error' | 'warn'; message: string }) =>
      readOnlySession ? showNotice(input) : showSaveAsNewNotice(stopDocId, input)
    if (branch === 'read-only-revoked') {
      showNotice({ type: 'warn', message: READ_ONLY_LIVE_NOTICE.revoked })
      recheckAccount()
    } else if (branch === 'read-only-signed-out') {
      showNotice({ type: 'error', message: READ_ONLY_LIVE_NOTICE.signedOut })
    } else if (branch === 'revoked') {
      // 내 소유 문서의 4403 — 이미 계정 차단이면 L5, 아니면 N2 를 띄우고 /api/me 를 다시 읽는다 (F-2030 5.4)
      const ownDoc = isOwnServerDoc(store.kind, currentDoc, sharedDoc)
      if (ownDoc && accountBlocked) {
        showNotice({ type: 'error', message: ACCOUNT_BLOCKED_MESSAGE })
      } else {
        showSaveAsNewNotice(stopDocId, { type: 'warn', message: LIVE_NOTICE.revoked })
        if (ownDoc) recheckAccount()
      }
    } else if (branch === 'gone') {
      // 다른 탭·기기가 금고로 옮겨 방이 닫혔으면 알리지 않고 새 세션으로 다시 연다 (F-407 7.4)
      const goneDocId = liveSession.docId
      const refresh = (store as Partial<ServerStore>).refreshDocFromServer
      if (store.kind === 'server' && typeof refresh === 'function') {
        void refresh(goneDocId).then((fresh) => {
          if (fresh?.e2ee) {
            if (goneDocId === currentDocIdRef.current) restartDocSession()
            return
          }
          // 확인하는 동안 다른 문서로 옮겼으면 띄우지 않는다 (리뷰 A5)
          if (goneDocId !== currentDocIdRef.current) return
          showStopNotice({ type: 'error', message: LIVE_NOTICE.gone })
        })
      } else showStopNotice({ type: 'error', message: LIVE_NOTICE.gone })
    } else if (branch === 'signed-out') showSaveAsNewNotice(stopDocId, { type: 'error', message: LIVE_NOTICE.signedOut })
  }, [liveSession, showNotice, dismissNotice, showSaveAsNewNotice, store, currentDoc, sharedDoc, accountBlocked, recheckAccount, restartDocSession, currentDocIdRef])

  // N7 — offline-view 세션마다 한 번. 그 세션이 끝나면 아직 떠 있을 때만 걷는다 (F-306 11.2)
  const offlineViewNoticeRef = useRef<{ seq: number; id: number } | null>(null)
  useEffect(() => {
    const shown = offlineViewNoticeRef.current
    if (isOfflineView && shown?.seq !== docSession.seq) {
      if (shown) dismissNotice(shown.id)
      offlineViewNoticeRef.current = { seq: docSession.seq, id: showNotice({ type: 'warn', message: LIVE_NOTICE.offlineView }) }
    } else if (!isOfflineView && shown) {
      dismissNotice(shown.id)
      offlineViewNoticeRef.current = null
    }
  }, [isOfflineView, docSession.seq, showNotice, dismissNotice])

  return { showSaveAsNewNotice }
}
