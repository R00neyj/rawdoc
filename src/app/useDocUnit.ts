// 문서 하나의 묶음 — 세션 → 편집권 → 방 Doc → 본문 1회 읽기 → 저장, 이 순서로 부른다 (F-2160 3장)
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { DEV_YSYNC } from '../editor/devSyncFlag'
import { countChars, countWords } from '../editor/stats'
import type { E2eeStatus } from '../e2ee/keyring'
import type { ShareDoc } from '../lib/share/shareCodec'
import type { ServerStore } from '../storage/serverStore'
import type { YjsStore } from '../storage/yjsStore'
import type { Doc, Store } from '../types'
import { sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import { isDocLoading } from './docLoading'
import { openLoadOf, saverBlocked, unitLocked, type DocUnit, type DocUnitHost } from './docUnit'
import { useDocClaim } from './useDocClaim'
import { useDocSaver } from './useDocSaver'
import { useDocSession } from './useDocSession'
import { useLiveRoomDoc } from './useLiveRoomDoc'
import type { ClaimHub } from './useTabSync'

type Stats = { line: number; col: number; charCount: number; wordCount: number }

// 창에 하나인 값 — 지금 세 훅이 App 에서 받던 그대로 (F-2160 3장)
export type DocUnitShared = {
  store: Store
  docs: DocMeta[]
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  sharedDoc: ShareDoc | null
  forbiddenDocIds: Set<string>
  setForbiddenDocIds: Dispatch<SetStateAction<Set<string>>>
  accountBlocked: boolean
  bootPhase: 'booting' | 'ready' // 본문 1회 읽기
  sessionPhase: 'booting' | 'ready' // 경로 판정 — 계정 확인을 기다리는 동안 booting (F-2134 6장)
  convertingDocId: string | null
  deletedElsewhereIds: ReadonlySet<string> // 칸마다 지워짐 — 문서가 모든 칸에서 빠질 때 걷힌다 (F-2163 7장)
  e2eeStatus: E2eeStatus | null
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  createdHereRef: RefObject<Set<string>>
  liveChangedAtRef: RefObject<Map<string, number>>
  focusEditorRef: RefObject<boolean>
  claimHub: ClaimHub
  focusDocId: string | null
  setStats: (stats: Stats) => void
  showNotice: (notice: { type: 'info'; message: string }) => void
}

export type EverLiveIds = { ids: ReadonlySet<string>; set: Dispatch<SetStateAction<Set<string>>> }

export function useDocUnit(docId: string | null, shared: DocUnitShared, everLive: EverLiveIds, hostRef: RefObject<DocUnitHost>): DocUnit {
  const {
    store, docs, setDocs, sharedDoc, forbiddenDocIds, setForbiddenDocIds, accountBlocked, bootPhase, sessionPhase, convertingDocId,
    deletedElsewhereIds, e2eeStatus, yjsStoreRef, createdHereRef, liveChangedAtRef, focusEditorRef, claimHub, focusDocId, setStats, showNotice,
  } = shared
  const meta = docId === null ? null : (docs.find((d) => d.id === docId) ?? null)
  const isFocus = docId !== null && docId === focusDocId
  const deletedElsewhereId = docId !== null && deletedElsewhereIds.has(docId) ? docId : null
  // 문서를 열 때 편집기에 넘기는 스냅샷 — 편집 중 동기화하지 않는다, 원본은 CM6 EditorState 하나다 (architecture.md 3장)
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null)
  // 편집권을 되찾거나 가져오기로 덮어써 서버 값을 다시 받아 편집기를 다시 마운트할 때 올린다 (F-213.md 2.3)
  const [remountNonce, setRemountNonce] = useState(0)
  const flushRef = useRef(async (): Promise<boolean> => true)
  const docIdRef = useRef(docId)
  const openIdRef = useRef<string | null>(null)
  const focusRef = useRef(isFocus)

  const session = useDocSession({
    store, docId, meta, sharedDoc, forbiddenDocIds, accountBlocked, bootPhase: sessionPhase, convertingDocId, docs, setDocs, setOpenDoc,
    setStats: isFocus ? setStats : null, setForbiddenDocIds, createdHereRef, yjsStoreRef, everLiveIds: everLive.ids, setEverLiveIds: everLive.set, flushRef,
  })
  const { docSession, setDocSession, docPath, isRealtime, liveSession, liveSnapshot, liveAwareness, isOfflineView, liveStopped } = session

  const reload = useCallback(
    (fresh: Doc) => {
      setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
      focusEditorRef.current = false
      setRemountNonce((n) => n + 1)
    },
    [focusEditorRef, setOpenDoc],
  )

  // 로컬 편집권을 되찾으면 다시 읽어 다시 마운트한다 — 잠긴 금고 문서는 빈 본문으로 올리지 않는다 (F-296.md 6.4, F-405 7.4)
  const handleRegained = useCallback(
    (claimedId: string) => {
      store.get(claimedId).then((fresh) => {
        if (!fresh || claimedId !== docIdRef.current || fresh.e2ee === 'locked') return
        reload(fresh)
        setDocs((prev) =>
          sortByUpdatedAtDesc(prev.map((d) => (d.id === fresh.id ? { ...d, title: fresh.title, updatedAt: fresh.updatedAt } : d))),
        )
      })
    },
    [store, reload, setDocs],
  )
  // 편집권은 로컬(idb)·서버 금고 문서에만 켠다 — 메모리는 탭마다 저장소가 달라 안 겹치고 ?ysync 두 탭은 안 켠다 (F-296.md 6.4, F-303 9.4, F-405 7.5)
  const claimId = (store.kind === 'idb' || docPath === 'e2ee') && !sharedDoc && !DEV_YSYNC ? docId : null
  const claimReadOnly = useDocClaim(claimHub, claimId, { onNotice: showNotice, onRegained: handleRegained })

  const { liveRoomDoc, liveEditorOption } = useLiveRoomDoc({
    docSession, setDocSession, docPath, isRealtime, isOfflineView, liveSession, liveSnapshot, liveAwareness, setDocs, setOpenDoc, liveChangedAtRef,
  })

  // ----- 문서를 열 때 저장소 본문을 1회 읽어 편집기에 넘긴다 (architecture.md 3장) -----
  const notFoundBeforeSync = isRealtime && liveSnapshot?.stopReason === 'not-found' && !liveSnapshot.ready
  const openLoad = openLoadOf({ docId, path: docPath, notFoundBeforeSync, everLive: docId !== null && everLive.ids.has(docId), forbiddenClose: docSession.forbiddenClose })
  // 금고 문서는 금고가 열리고 잠길 때 본문 읽기를 다시 돈다 (F-405 7.4)
  const openLoadE2eeKey = meta?.e2ee ? e2eeStatus : null
  useEffect(() => {
    if (bootPhase !== 'ready' || !docId || openLoad === null) return
    let cancelled = false
    const serverStore = store as Partial<ServerStore>
    const load =
      openLoad === 'server-first' && typeof serverStore.refreshDocFromServer === 'function'
        ? serverStore.refreshDocFromServer(docId).then((fresh) => fresh ?? store.get(docId))
        : store.get(docId)
    load.then((doc) => {
      if (cancelled || !doc) return
      // 잠긴 금고 문서는 빈 본문으로 편집기를 올리지 않는다 — P1 이 그 자리에 뜬다. 이미 열린 금고 편집기는 다시 만들지 않는다
      if (doc.e2ee === 'locked' || (doc.e2ee && openIdRef.current === doc.id)) return
      setOpenDoc({ id: doc.id, content: doc.content, lineEnding: doc.lineEnding })
      if (focusRef.current) setStats({ line: 1, col: 1, charCount: countChars(doc.content), wordCount: countWords(doc.content) })
    })
    return () => {
      cancelled = true
    }
  }, [store, bootPhase, docId, openLoad, openLoadE2eeKey, setStats])

  const onSaved = useCallback((doc: Doc) => hostRef.current.onSaved(doc), [hostRef])
  const onSaveError = useCallback((error: unknown) => hostRef.current.onSaveError(docIdRef.current ?? '', error), [hostRef])
  const saver = useDocSaver({
    store,
    docId,
    lineEnding: openDoc?.lineEnding,
    getText: (lineEnding) => (docId ? hostRef.current.getText(docId, lineEnding ?? 'crlf') : ''),
    getComments: () => (docId ? hostRef.current.getComments(docId) : null),
    onSaved,
    onSaveError,
    blocked: saverBlocked({ docId, openDocId: openDoc?.id ?? null, path: docPath, claimReadOnly, deletedElsewhereId }),
  })

  // ref 는 렌더 중에 건드리지 않는다 — 매 커밋 후 최신 값을 반영한다
  useEffect(() => {
    flushRef.current = saver.flush
    docIdRef.current = docId
    openIdRef.current = openDoc?.id ?? null
    focusRef.current = isFocus
  })

  const loading = isDocLoading({
    currentDocId: docId, openDocId: openDoc?.id ?? null, sharedScreen: Boolean(sharedDoc), e2eeLocked: meta?.e2ee === 'locked',
    offlineView: isOfflineView, liveStopped, deletedElsewhere: docId !== null && deletedElsewhereId === docId,
  })

  return {
    docId, meta, session: docSession, setSession: setDocSession, docPath, isRealtime, isOfflineView, liveStopped,
    restart: session.restartDocSession, restartAfterFlush: session.restartDocSessionAfterFlush,
    live: liveSession, liveSnapshot, livePeers: session.livePeers, liveRoomDoc, liveEditorOption,
    openDoc, setOpenDoc, remountNonce, reload, claimReadOnly, locked: unitLocked(meta, openDoc?.id ?? null), loading, saver,
  }
}
