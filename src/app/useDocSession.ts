// 세션 핵 — 문서 열기 경로 판정·실시간 세션·접속자·렌더 중 블록 a~d, App.tsx 에서 옮김 (F-2077, F-2059)
import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type * as Y from 'yjs'
import type { ServerStore } from '../storage/serverStore'
import type { YjsStore } from '../storage/yjsStore'
import type { ShareDoc } from '../lib/shareCodec'
import type { Peer } from '../lib/peers'
import { Y_CONTENT_NAME, Y_TITLE_NAME } from '../lib/docRoomProtocol'
import { countChars, countWords } from '../editor/stats'
import type { Store } from '../types'
import type { DocMeta, OpenDoc } from './docMeta'
import { decideDocPath, type DocPathKind, type FallbackReason } from './docPath'
import type { LiveSnapshot } from './liveDoc'
import { useLiveDoc, type LiveDocSession } from './useLiveDoc'
import { usePeers } from './usePeers'

// 문서 열기 세션 (F-305 3장) — 같은 currentDocId 가 유지되는 동안 한 번 정한 경로는 바뀌지 않는다. path 가 null 이면 판정 중
export type DocSession = {
  seq: number
  docId: string | null
  store: Store
  path: DocPathKind | null
  fallbackReason: FallbackReason | null
  // 첫 동기화 전 4403 으로 보기로 연 세션 — N1 을 띄우고 본문은 서버에서 먼저 읽는다 (8장)
  forbiddenClose: boolean
  // 읽기 전용 세션이 첫 동기화 전 4403 으로 보기로 내려감 — N1 없이 /api/me 만 한 번 다시 읽는다 (F-506 3.3)
  quietForbidden: boolean
  // realtime 일 때만 뜻이 있다 — md-yjs 기록으로 재개하는가, 오프라인으로 시작하는가, 쓸 md-yjs (F-306 5.1·6.4)
  resume: boolean
  startOffline: boolean
  // 보기 권한자의 읽기 전용 실시간 세션 — md-yjs 없음, 댓글은 명령으로 (F-506 3.2·4장)
  readOnly: boolean
  persist: YjsStore | null
}

export type UseDocSessionOptions = {
  store: Store
  currentDocId: string | null
  currentDoc: DocMeta | null
  sharedDoc: ShareDoc | null
  forbiddenDocIds: Set<string>
  accountBlocked: boolean
  bootPhase: 'booting' | 'ready'
  convertingDocId: string | null
  docs: DocMeta[]
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  setStats: (stats: { line: number; col: number; charCount: number; wordCount: number }) => void
  setForbiddenDocIds: Dispatch<SetStateAction<Set<string>>>
  createdHereRef: RefObject<Set<string>>
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  currentDocIdRef: RefObject<string | null>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
}

export type UseDocSessionResult = {
  docSession: DocSession
  setDocSession: Dispatch<SetStateAction<DocSession>>
  docPath: DocPathKind | null
  isRealtime: boolean
  everLiveIds: Set<string>
  restartDocSession: () => void
  restartDocSessionAfterFlush: () => Promise<void>
  liveSession: LiveDocSession | null
  liveSnapshot: LiveSnapshot | undefined
  liveAwareness: LiveDocSession['awareness'] | null
  livePeers: Peer[]
  liveStopped: boolean
  isOfflineView: boolean
}

export function useDocSession(options: UseDocSessionOptions): UseDocSessionResult {
  const {
    store, currentDocId, currentDoc, sharedDoc, forbiddenDocIds, accountBlocked, bootPhase, convertingDocId, docs, setDocs, setOpenDoc,
    setStats, setForbiddenDocIds, createdHereRef, yjsStoreRef, currentDocIdRef, docSaverFlushRef,
  } = options

  // ----- 문서 열기 경로 (F-305 4장) — 문서·저장소가 바뀌면 새 세션. local·view 는 여기서, 나머지는 아래 effect 가 outbox 를 읽고 정한다 -----
  const [docSession, setDocSession] = useState<DocSession>(() => ({
    seq: 0,
    docId: null,
    store,
    path: null,
    fallbackReason: null,
    forbiddenClose: false,
    quietForbidden: false,
    resume: false,
    startOffline: false,
    readOnly: false,
    persist: null,
  }))
  if (docSession.docId !== currentDocId || docSession.store !== store) {
    const quick = decideDocPath({
      storeKind: store.kind,
      shareLinkScreen: Boolean(sharedDoc),
      role: currentDoc?.role as 'owner' | 'edit' | 'view' | undefined,
      forbidden: (currentDocId != null && forbiddenDocIds.has(currentDocId)) || accountBlocked,
      hasPendingChanges: false,
      online: true,
      hasLocalState: false,
      e2ee: Boolean(currentDoc?.e2ee), // F-405 7.5
    })
    setDocSession({
      seq: docSession.seq + 1,
      docId: currentDocId,
      store,
      path: quick.kind === 'local' || quick.kind === 'view' || quick.kind === 'e2ee' ? quick.kind : null,
      fallbackReason: null,
      forbiddenClose: false,
      quietForbidden: false,
      resume: false,
      startOffline: false,
      readOnly: false,
      persist: null,
    })
    // 옛 세션의 본문 스냅샷으로 편집기가 먼저 뜨지 않게 비운다 — 실시간이면 첫 동기화 뒤에 채운다 (5.1)
    setOpenDoc(null)
  }
  const sessionReady = docSession.docId === currentDocId && docSession.store === store
  const docPath = sessionReady ? docSession.path : null
  const isRealtime = docPath === 'realtime'

  // 이 페이지에서 실시간으로 동기화한 적 있는 문서 — 폴백으로 다시 열 때 캐시 대신 서버 본문을 먼저 읽는다 (8장)
  const [everLiveIds, setEverLiveIds] = useState<Set<string>>(() => new Set())

  // 두 판정 자리에 같은 role·forbidden 을 넘긴다 — 빠른 판정이 온라인 view 를 realtime 으로 내므로 effect 가 다시 가린다 (F-506 3.2)
  const decideRole = currentDoc?.role as 'owner' | 'edit' | 'view' | undefined
  const decideForbidden = (currentDocId != null && forbiddenDocIds.has(currentDocId)) || accountBlocked
  useEffect(() => {
    if (bootPhase !== 'ready' || docSession.path !== null || !docSession.docId) return
    const id = docSession.docId
    const sessionStore = docSession.store as Partial<ServerStore>
    let cancelled = false
    const pendingCheck =
      typeof sessionStore.hasPendingChanges === 'function' ? sessionStore.hasPendingChanges(id) : Promise.resolve(false)
    // outbox 와 md-yjs 기록을 함께 기다린다. 기록 확인이 실패하면 없음으로 (F-306 5.1)
    const persistCheck = yjsStoreRef.current.then(async (persist) => ({
      persist,
      hasLocalState: persist ? await persist.hasState(id).catch(() => false) : false,
    }))
    // 목록에 아직 없는 금고 문서(해시로 바로 연 문서)가 실시간으로 잘못 판정되지 않게 한 번 더 본다 (F-405 7.5)
    const e2eeCheck =
      docSession.store.kind === 'server' ? docSession.store.get(id).then((d) => Boolean(d?.e2ee)).catch(() => false) : Promise.resolve(false)
    Promise.all([pendingCheck.catch(() => true), persistCheck.catch(() => ({ persist: null, hasLocalState: false })), e2eeCheck]).then(
      ([pending, { persist, hasLocalState }, isE2eeDoc]) => {
        if (cancelled) return
        const createdHere = createdHereRef.current.delete(id)
        const online = navigator.onLine
        const decided = decideDocPath({
          storeKind: docSession.store.kind,
          shareLinkScreen: false,
          role: decideRole,
          forbidden: decideForbidden,
          hasPendingChanges: pending || createdHere,
          online,
          hasLocalState,
          e2ee: isE2eeDoc,
        })
        const realtime = decided.kind === 'realtime' ? decided : null
        const readOnly = realtime?.readOnly === true
        setDocSession((cur) =>
          cur.seq === docSession.seq && cur.path === null
            ? {
                ...cur,
                path: decided.kind,
                // 오프라인에서 연 view 는 online 에 다시 시작한다 (F-506 3.4)
                fallbackReason: decided.kind === 'view' && decideRole === 'view' && !online ? 'offline' : null,
                resume: realtime?.resume ?? false,
                startOffline: realtime?.startOffline ?? false,
                readOnly,
                persist: readOnly ? null : persist,
              }
            : cur,
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [bootPhase, docSession, decideRole, decideForbidden, createdHereRef, yjsStoreRef])

  // 기록을 못 불러온 재개 세션 — 기록 없음으로 다시 판정한다. 오프라인이면 offline-view, 온라인이면 비재개 실시간 (F-306 6.4 4번)
  const handleResumeFailed = useCallback((docId: string) => {
    setDocSession((cur) => {
      if (cur.docId !== docId || cur.path !== 'realtime' || !cur.resume) return cur
      return navigator.onLine
        ? { ...cur, resume: false, startOffline: false }
        : { ...cur, path: 'offline-view', resume: false, startOffline: false }
    })
  }, [])
  // 같은 문서의 열기 세션을 새로 시작한다 — 경로 판정이 지금 금고 여부로 다시 고른다 (F-407 7.4)
  const restartDocSession = useCallback(() => {
    setDocSession((cur) => ({ ...cur, seq: cur.seq + 1, path: null, fallbackReason: null, forbiddenClose: false, quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null }))
    setOpenDoc(null)
  }, [setOpenDoc])
  // 편집기를 내리기 전에 대기 저장을 끝낸다 — 기다리는 사이 다른 문서로 옮겼으면 다시 열지 않는다 (리뷰 A2)
  const restartDocSessionAfterFlush = useCallback(async () => {
    const docId = currentDocIdRef.current
    await docSaverFlushRef.current()
    if (docId === currentDocIdRef.current) restartDocSession()
  }, [restartDocSession, currentDocIdRef, docSaverFlushRef])
  const liveSession = useLiveDoc(isRealtime && convertingDocId !== currentDocId ? currentDocId : null, {
    store: docSession.readOnly ? null : docSession.persist,
    resume: docSession.resume,
    startOffline: docSession.startOffline,
    readOnly: docSession.readOnly,
    onResumeFailed: handleResumeFailed,
  })
  const liveSnapshot = liveSession?.snapshot
  // 접속자 — 편집기가 아니라 방 Doc 의 awareness 에서 온다. 첫 동기화 전·편집기 다시 마운트에도 흔들리지 않는다 (F-307 7.4)
  const liveAwareness = liveSession?.awareness ?? null
  const livePeers = usePeers(liveAwareness)

  // ready 전에 끝난 경우 — 폴백으로 가거나(7.2), 4403 이면 보기로 연다(8장). 오프라인 폴백은 잠금·PUT 대신 offline-view (F-306 9.1). 렌더 중 상태를 맞추는 패턴
  if (isRealtime && liveSnapshot && !liveSnapshot.ready && docSession.readOnly) {
    // 읽기 전용 세션 — 폴백은 모두 view, 4403 은 조용히 view, 4404 는 편집 세션과 같다 (F-506 8.2)
    if (liveSnapshot.phase === 'fallback') {
      setDocSession({ ...docSession, path: 'view', fallbackReason: liveSnapshot.fallbackReason })
    } else if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'forbidden') {
      setDocSession({ ...docSession, path: 'view', quietForbidden: true })
      if (currentDocId && !forbiddenDocIds.has(currentDocId)) setForbiddenDocIds(new Set(forbiddenDocIds).add(currentDocId))
    }
  } else if (isRealtime && liveSnapshot && !liveSnapshot.ready) {
    if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'read-only') {
      // 서버는 이 연결을 읽기 전용으로 받았다 — 목록 역할이 낡았다. 편집기가 없어 잃을 글이 없으니 view 로 다시 연다 (F-506 5.3)
      const readOnlyDocId = liveSession?.docId
      if (readOnlyDocId) setDocs(docs.map((d) => (d.id === readOnlyDocId ? { ...d, role: 'view' } : d)))
      restartDocSession()
    } else if (liveSnapshot.phase === 'fallback' && liveSnapshot.fallbackReason === 'offline') {
      setDocSession({ ...docSession, path: 'offline-view', fallbackReason: null })
    } else if (liveSnapshot.phase === 'fallback') {
      setDocSession({ ...docSession, path: 'fallback', fallbackReason: liveSnapshot.fallbackReason })
    } else if (liveSnapshot.phase === 'stopped' && liveSnapshot.stopReason === 'forbidden') {
      setDocSession({ ...docSession, path: 'view', forbiddenClose: true })
      if (currentDocId && !forbiddenDocIds.has(currentDocId)) setForbiddenDocIds(new Set(forbiddenDocIds).add(currentDocId))
    }
  }

  // 첫 ready — 한 렌더 안에서 방 Doc 본문으로 편집기 스냅샷·제목·글자 수를 맞춘다 (5.2). 재개 세션은 synced 전에도 로컬 기록으로 (F-306 9.1)
  const [liveOpenedDoc, setLiveOpenedDoc] = useState<Y.Doc | null>(null)
  if (isRealtime && liveSession && liveSnapshot?.everSynced && !everLiveIds.has(liveSession.docId)) {
    setEverLiveIds(new Set(everLiveIds).add(liveSession.docId))
  }
  if (isRealtime && liveSession && liveSnapshot?.ready && liveOpenedDoc !== liveSession.roomDoc) {
    const content = liveSession.roomDoc.getText(Y_CONTENT_NAME).toString()
    const title = liveSession.roomDoc.getText(Y_TITLE_NAME).toString()
    setLiveOpenedDoc(liveSession.roomDoc)
    setOpenDoc({ id: liveSession.docId, content, lineEnding: currentDoc?.lineEnding ?? 'lf' })
    setDocs(docs.map((d) => (d.id === liveSession.docId ? { ...d, title } : d)))
    setStats({ line: 1, col: 1, charCount: countChars(content), wordCount: countWords(content) })
  }
  const liveStopped = isRealtime && liveSnapshot?.phase === 'stopped'
  const isOfflineView = docPath === 'offline-view'

  return {
    docSession, setDocSession, docPath, isRealtime, everLiveIds, restartDocSession, restartDocSessionAfterFlush,
    liveSession, liveSnapshot, liveAwareness, livePeers, liveStopped, isOfflineView,
  }
}
